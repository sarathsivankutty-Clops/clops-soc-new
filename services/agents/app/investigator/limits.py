"""How long an investigator agent's reply is allowed to get.

Every LLM call in the four-agent investigator pipeline was placed with no
completion bound, so a model that failed to stop generated until it hit the
context window. That is not theoretical: dispatching the pipeline against
``qwen2.5:0.5b`` on a GitHub-hosted runner produced

    completion_tokens=40960  latency_ms=1208829.8  step=recon

— the model's whole context, twenty minutes, for one call, twice in the same
investigation. The identical call on a developer machine returned 200 tokens
in two seconds. Greedy decoding is only deterministic *for a fixed kernel*,
and a small quantised model that diverges by one token can fall into a
repetition loop that nothing downstream interrupts.

Unbounded is the wrong default wherever this runs. Against a hosted provider
it is a 41,000-token bill per degenerate call and an investigation that never
returns, and the reply is unusable either way: the four agents parse JSON, and
a reply that ran past the schema was never going to parse.

The default is 1000 to fit Groq's on-demand output-token request limit. That
still clears the longest measured reply; operators on a higher-capacity
provider or tier can raise it with ``AISOC_INVESTIGATOR_MAX_COMPLETION_TOKENS``.

LLM requests also have an explicit timeout so a slow provider call cannot
consume the full investigation budget. Override it with
``AISOC_INVESTIGATOR_LLM_TIMEOUT_SECONDS``.
"""

from __future__ import annotations

import math
import os

#: Groq's on-demand request cap is 1000 output tokens; this also exceeds the
#: longest legitimate investigator completion measured on the eval corpus.
DEFAULT_MAX_COMPLETION_TOKENS = 1000
DEFAULT_LLM_TIMEOUT_SECONDS = 120

_MAX_COMPLETION_TOKENS_ENV = "AISOC_INVESTIGATOR_MAX_COMPLETION_TOKENS"
_LLM_TIMEOUT_SECONDS_ENV = "AISOC_INVESTIGATOR_LLM_TIMEOUT_SECONDS"


def max_completion_tokens() -> int | None:
    """The completion bound, or ``None`` when an operator has removed it."""
    raw = os.getenv(_MAX_COMPLETION_TOKENS_ENV)
    if raw is None or not raw.strip():
        return DEFAULT_MAX_COMPLETION_TOKENS
    try:
        value = int(raw)
    except ValueError:
        # A typo must not silently restore the unbounded behaviour this
        # module exists to end, so it falls back to the bound, not past it.
        return DEFAULT_MAX_COMPLETION_TOKENS
    return value if value > 0 else None


def llm_timeout_seconds() -> float:
    """Return a positive per-request timeout, defaulting safely on bad input."""
    raw = os.getenv(_LLM_TIMEOUT_SECONDS_ENV)
    if raw is None or not raw.strip():
        return DEFAULT_LLM_TIMEOUT_SECONDS
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_LLM_TIMEOUT_SECONDS
    return value if value > 0 and math.isfinite(value) else DEFAULT_LLM_TIMEOUT_SECONDS
