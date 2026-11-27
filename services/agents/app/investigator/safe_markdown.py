"""Markdown to HTML for incident reports, with no path for untrusted markup.

Report Markdown is model output written over attacker-influenced alert text,
so the renderer must not pass raw HTML through and must not emit a URL that
makes a browser, or weasyprint, fetch something. Python-Markdown passes raw
HTML through by default; this module turns that off and filters every
``href`` and ``src`` the Markdown syntax itself can produce.

``markdown`` is imported inside :func:`render_markdown` so callers keep their
``ImportError`` fallback for slim images.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlsplit

#: Browsers drop ASCII control characters and spaces inside a scheme
#: (`java\tscript:`), so the check runs on the URL with them removed.
_IGNORED = re.compile(r"[\x00-\x20\x7f]")
_HREF_SCHEMES = frozenset({"http", "https", "mailto"})

#: The header served with the HTML report. Nothing loads from anywhere, inline
#: styles only, images only from `data:`, and the page runs sandboxed.
REPORT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"


def _classify(url: str) -> tuple[str, bool]:
    """Return ``(scheme, is_relative)`` for a URL as a browser would read it."""
    cleaned = _IGNORED.sub("", url or "").replace("\\", "/")
    # A `#fragment` parses with no scheme and no netloc, so it is relative.
    parts = urlsplit(cleaned)
    # `//host/x` has no scheme but is external.
    return parts.scheme.lower(), not parts.scheme and not parts.netloc


def safe_src(url: str) -> bool:
    """Relative paths, ``#`` fragments and ``data:image/`` only."""
    scheme, relative = _classify(url)
    if relative:
        return True
    return scheme == "data" and _IGNORED.sub("", url).lower().startswith("data:image/")


def safe_href(url: str) -> bool:
    """Relative paths, ``#`` fragments, and http/https/mailto links."""
    scheme, relative = _classify(url)
    return relative or scheme in _HREF_SCHEMES


def _drop(parent: Any, child: Any) -> None:
    """Remove ``child`` from ``parent`` and keep the text that followed it."""
    if child.tail:
        siblings = list(parent)
        index = siblings.index(child)
        if index:
            previous = siblings[index - 1]
            previous.tail = (previous.tail or "") + child.tail
        else:
            parent.text = (parent.text or "") + child.tail
    parent.remove(child)


def render_markdown(md: str) -> str:
    """Render ``md`` with raw HTML disabled and unsafe URLs removed."""
    import markdown
    from markdown.treeprocessors import Treeprocessor

    class _UrlFilter(Treeprocessor):
        def run(self, root: Any) -> None:
            for parent in list(root.iter()):
                for child in list(parent):
                    if child.tag == "img" and not safe_src(child.get("src", "")):
                        _drop(parent, child)
                    elif child.tag == "a" and "href" in child.attrib and not safe_href(child.get("href", "")):
                        del child.attrib["href"]

    converter = markdown.Markdown(extensions=["tables", "fenced_code"])
    # Raw HTML, both block (`<script>...`) and inline (`<img onerror=...>`),
    # now reaches the output as escaped text.
    converter.preprocessors.deregister("html_block")
    converter.inlinePatterns.deregister("html")
    converter.treeprocessors.register(_UrlFilter(converter), "aisoc_url_filter", 0)
    return converter.convert(md)


def report_url_fetcher() -> Any:
    """A weasyprint ``url_fetcher`` that fetches only ``data:`` URLs.

    weasyprint skips a resource whose fetch raises and keeps rendering, so a
    report naming ``http://169.254.169.254/...`` renders without the request
    ever leaving the container. weasyprint 70 takes a ``URLFetcher`` object
    (a plain function fails with ``AttributeError: _fail_on_errors``); older
    versions, still allowed by pyproject, take a function.
    """
    try:
        from weasyprint.urls import URLFetcher
    except ImportError:  # weasyprint < 70
        from weasyprint import default_url_fetcher

        def _fetch(url: str, *args: Any, **kwargs: Any) -> Any:
            if not _IGNORED.sub("", url).lower().startswith("data:"):
                raise ValueError(f"report rendering fetches no external resources: {url[:80]}")
            return default_url_fetcher(url, *args, **kwargs)

        return _fetch
    return URLFetcher(allowed_protocols=("data",))
