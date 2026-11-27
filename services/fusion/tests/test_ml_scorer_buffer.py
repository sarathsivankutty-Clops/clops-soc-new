"""The ML scorer's training buffers are bounded and retrain on a sane cadence.

One feature vector is buffered per scored alert. The buffer was a list that
was never trimmed, so fusion's memory grew for the life of the process.
"""

from __future__ import annotations

import asyncio
import time
from uuid import uuid4

import pytest
from app.models.alert import AnalystFeedback, FusedAlert, FusionDecision, RawAlert
from app.services import ml_scorer as ml_mod
from app.services.ml_scorer import MLScorer

_TENANT = uuid4()


def _fused() -> FusedAlert:
    alert = RawAlert(tenant_id=_TENANT, source="edr", title="t", severity="high")
    return FusedAlert(id=alert.id, tenant_id=_TENANT, fusion_decision=FusionDecision.NEW_INCIDENT, alert=alert)


def _feedback() -> AnalystFeedback:
    return AnalystFeedback(alert_id=uuid4(), tenant_id=_TENANT, analyst_id="a", is_true_positive=True, assigned_priority=2)


@pytest.mark.asyncio
async def test_the_feature_buffer_is_capped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ml_mod, "_BUFFER_MAX", 20)
    scorer = MLScorer()
    for _ in range(50):
        await scorer.score(_fused())
    assert len(scorer._feature_buffer) == 20
    assert scorer._features_seen == 50


@pytest.mark.asyncio
async def test_a_full_buffer_does_not_retrain_on_every_feedback(monkeypatch: pytest.MonkeyPatch) -> None:
    """With maxlen 100 a full deque has length 100, which satisfies the old
    `len % 100 == 0` check forever. The cadence must count feedback seen."""
    monkeypatch.setattr(ml_mod, "_BUFFER_MAX", 100)
    scorer = MLScorer()
    scorer._lgbm_trained = True
    scorer._iso_trained = True
    started: list[tuple[bool, bool]] = []

    async def _record(do_iso: bool, do_lgbm: bool) -> None:
        started.append((do_iso, do_lgbm))

    monkeypatch.setattr(scorer, "_retrain_background", _record)
    for _ in range(150):
        await scorer.record_feedback(_feedback())
        await asyncio.sleep(0)

    assert len(scorer._feedback_buffer) == 100
    # Exactly once, at the 100th feedback, not on each of the 51 calls made
    # while the full deque's length sat at 100.
    assert len([s for s in started if s[1]]) == 1


@pytest.mark.asyncio
async def test_feedback_during_a_retrain_does_not_break_the_training_snapshot(monkeypatch: pytest.MonkeyPatch) -> None:
    """Training runs in a worker thread while the loop keeps appending. It
    must iterate a copy; iterating the live deque raises
    `RuntimeError: deque mutated during iteration`."""
    scorer = MLScorer()
    errors: list[BaseException] = []
    in_training = asyncio.Event()
    loop = asyncio.get_running_loop()

    def _slow_train(features, feedback=None):  # noqa: ANN001
        loop.call_soon_threadsafe(in_training.set)
        try:
            for _ in features:
                time.sleep(0.001)
            for _ in feedback or []:
                time.sleep(0.001)
        except RuntimeError as exc:
            errors.append(exc)
        return {"status": "trained"}

    monkeypatch.setattr(scorer, "_train_isolation_forest", _slow_train)
    monkeypatch.setattr(scorer, "_train_lgbm_ranker", _slow_train)

    for _ in range(60):
        await scorer.score(_fused())
    for _ in range(30):
        scorer._feedback_buffer.append(_feedback().model_dump(mode="json"))
        scorer._feedback_seen += 1

    task = asyncio.create_task(scorer._retrain_background(True, True))
    await asyncio.wait_for(in_training.wait(), timeout=5)
    for _ in range(200):
        await scorer.record_feedback(_feedback())
        await scorer.score(_fused())
    await asyncio.wait_for(task, timeout=30)

    assert errors == []
