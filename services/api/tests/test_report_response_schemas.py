"""The report response models must accept what the ORM hands them.

Both ``/reports/templates`` and ``/reports/artefacts`` returned HTTP 500 on a
real deployment while the suite was green, because ``TemplateOut`` and
``ArtefactOut`` declared ``str`` for columns the model declares as
``DateTime(timezone=True)``. ``from_attributes`` then passed a ``datetime``
into a string field and FastAPI raised ``ResponseValidationError`` -- a 500
with an empty body, on a read route with no user input.

The suite missed it because no test ever validated an ORM row through the
response model: the endpoint tests that exist stub the database, and a stub
returns whatever the test wrote, not a ``datetime``. So these tests hand each
model a real ``datetime``, which is exactly the shape production supplies.

There is also a guard test below that reads the annotations out of the
endpoint module and compares them with the ORM columns. That is the direction
that drifts: a column type is rarely changed, a schema is edited casually.
"""

from __future__ import annotations

import typing
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import DateTime

from app.api.v1.endpoints.reports import ArtefactOut, TemplateOut
from app.models.report import ReportArtefact, ReportTemplate

NOW = datetime(2026, 11, 16, 10, 34, 1, 46691, tzinfo=UTC)


def _template() -> ReportTemplate:
    return ReportTemplate(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        name="Weekly board pack",
        report_type="board_summary",
        cron_schedule="0 6 * * 1",
        timezone="UTC",
        sections=[],
        recipients=["ciso@example.com"],
        output_format="pdf",
        is_enabled=True,
        last_run_at=None,
        created_at=NOW,
        updated_at=NOW,
    )


def _artefact() -> ReportArtefact:
    return ReportArtefact(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        template_id=uuid.uuid4(),
        report_type="board_summary",
        title="Weekly board pack",
        period_start=NOW,
        period_end=NOW,
        output_format="pdf",
        file_size_bytes=1024,
        delivered_to=["ciso@example.com"],
        delivered_at=None,
        generated_by="system",
        status="completed",
        delivery_status="not_attempted",
        delivery_detail="",
        error_message=None,
        created_at=NOW,
    )


def test_template_out_accepts_orm_datetimes() -> None:
    """``from_attributes`` on a real template row must not raise."""
    out = TemplateOut.model_validate(_template())

    assert out.created_at == NOW
    assert out.updated_at == NOW
    assert out.last_run_at is None


def test_artefact_out_accepts_orm_datetimes() -> None:
    """Same for an artefact row, including its non-nullable period window."""
    out = ArtefactOut.model_validate(_artefact())

    assert out.period_start == NOW
    assert out.period_end == NOW
    assert out.created_at == NOW
    assert out.delivered_at is None


def test_datetimes_serialise_to_iso_8601() -> None:
    """The wire format stays a string, which is why a plain ``datetime`` is
    the fix and not a ``datetime | str`` union: FastAPI already renders one.
    """
    payload = TemplateOut.model_validate(_template()).model_dump(mode="json")

    assert payload["created_at"] == "2026-11-16T10:34:01.046691Z"


@pytest.mark.parametrize("out_model, orm_model", [(TemplateOut, ReportTemplate), (ArtefactOut, ReportArtefact)])
def test_schema_types_match_orm_datetime_columns(out_model: type, orm_model: type) -> None:
    """Every shared field declared as a DateTime column must accept a datetime.

    A ``str`` annotation is the specific regression this guards: it made
    ``from_attributes`` fail for every row, not just the ones with a value.
    """
    hints = typing.get_type_hints(out_model)
    offenders = []

    for column in orm_model.__table__.columns:
        if not isinstance(column.type, DateTime):
            continue
        if column.name not in hints:
            continue  # not projected by this response model at all
        if datetime not in typing.get_args(hints[column.name]) and hints[column.name] is not datetime:
            offenders.append(f"{column.name}: {hints[column.name]!r}")

    assert not offenders, (
        "response model declares a non-datetime type for a DateTime column, "
        f"so from_attributes will fail on every row: {offenders}"
    )
