"""Incident-report Markdown cannot carry markup, external URLs, or a fetch.

The Markdown is model output over attacker-influenced alert text. It reaches
an analyst as `report.html` and reaches weasyprint as `report.pdf`, so a
`<script>` is stored XSS and an `<img src=http://169.254.169.254/...>` is
SSRF from the agents container.
"""

from __future__ import annotations

import re
import socket
import urllib.request

import pytest
from app.investigator.safe_markdown import REPORT_CSP, render_markdown, report_url_fetcher, safe_href, safe_src


class TestRawHtmlIsText:
    def test_a_script_block_is_escaped(self) -> None:
        out = render_markdown("<script>alert('xss')</script>")
        assert "<script" not in out
        assert "&lt;script&gt;" in out

    def test_inline_html_is_escaped(self) -> None:
        out = render_markdown("before <img src=x onerror=alert(1)> after")
        assert "<img" not in out
        assert "before" in out and "after" in out


class TestUrls:
    def test_an_external_image_is_removed(self) -> None:
        out = render_markdown("see ![](https://attacker.example/x) here")
        assert "attacker.example" not in out
        assert "<img" not in out
        assert "see" in out and "here" in out

    def test_an_imds_image_is_removed(self) -> None:
        out = render_markdown("![x](http://169.254.169.254/latest/meta-data/)")
        assert "169.254.169.254" not in out

    def test_a_protocol_relative_image_is_removed(self) -> None:
        assert "<img" not in render_markdown("![x](//attacker.example/x)")

    def test_a_javascript_href_is_stripped(self) -> None:
        out = render_markdown("[click](javascript:alert(1))")
        assert "javascript" not in out.lower()
        assert "click" in out

    def test_an_obfuscated_javascript_href_is_stripped(self) -> None:
        assert not safe_href("java\tscript:alert(1)")
        assert not safe_href(" JAVASCRIPT:alert(1)")
        assert not safe_href("data:text/html,<script>alert(1)</script>")

    def test_allowed_urls_survive(self) -> None:
        out = render_markdown("[docs](https://example.com/a) [mail](mailto:soc@example.com) [top](#top) [rel](notes/a.md)")
        for href in ("https://example.com/a", "mailto:soc@example.com", "#top", "notes/a.md"):
            assert f'href="{href}"' in out
        assert safe_src("img/logo.png")
        assert safe_src("data:image/png;base64,AAAA")
        assert not safe_src("https://example.com/logo.png")


class TestOrdinaryMarkdownStillRenders:
    def test_tables_and_fenced_code(self) -> None:
        out = render_markdown("| a | b |\n|---|---|\n| 1 | 2 |\n\n```\nx < y\n```\n")
        assert "<table>" in out
        assert re.search(r"<code>x &lt; y\s*</code>", out)


def test_the_report_csp_blocks_everything_external() -> None:
    assert "default-src 'none'" in REPORT_CSP
    assert "img-src data:" in REPORT_CSP
    assert "sandbox" in REPORT_CSP


async def test_report_html_is_served_with_the_csp(monkeypatch: pytest.MonkeyPatch) -> None:
    from uuid import UUID

    from app.api import investigate
    from app.security.tenant_scope import TenantPrincipal, require_console_or_service_auth
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient

    monkeypatch.setitem(investigate._runs, "run-1", {"status": "completed", "report_html": "<html><body>ok</body></html>"})
    app = FastAPI()
    app.include_router(investigate.router)
    app.dependency_overrides[require_console_or_service_auth] = lambda: TenantPrincipal(
        tenant_ids=frozenset({UUID("11111111-1111-1111-1111-111111111111")}), subject="t"
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://agents") as client:
        resp = await client.get("/api/v1/investigations/run-1/report.html")

    assert resp.status_code == 200
    assert resp.headers["content-security-policy"] == REPORT_CSP
    assert "ok" in resp.text


class TestReportFetcher:
    """Needs weasyprint, which is an optional extra: these run in the agents
    image (weasyprint 70.0, the version the lock pins)."""

    def test_it_refuses_a_network_url(self) -> None:
        pytest.importorskip("weasyprint")
        with pytest.raises(ValueError):
            report_url_fetcher()("http://169.254.169.254/latest/meta-data/")

    def test_weasyprint_skips_the_resource_and_still_renders(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The property that matters: the render succeeds and nothing touches
        the network. Asserting only that the fetcher raises would pass even if
        weasyprint aborted the render or fell back to its own fetcher."""
        weasyprint = pytest.importorskip("weasyprint")
        attempts: list[str] = []

        def _no_network(*args, **_kwargs):
            attempts.append(repr(args[:1]))
            raise AssertionError("weasyprint attempted a network fetch")

        monkeypatch.setattr(socket, "create_connection", _no_network)
        monkeypatch.setattr(urllib.request, "urlopen", _no_network)

        html = '<html><body><p>report</p><img src="http://169.254.169.254/x"></body></html>'
        pdf = weasyprint.HTML(string=html, url_fetcher=report_url_fetcher()).write_pdf()
        assert isinstance(pdf, bytes)
        assert pdf.startswith(b"%PDF")
        assert attempts == []

    def test_a_data_image_still_renders(self) -> None:
        weasyprint = pytest.importorskip("weasyprint")
        png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        html = f'<html><body><img src="data:image/png;base64,{png}"></body></html>'
        pdf = weasyprint.HTML(string=html, url_fetcher=report_url_fetcher()).write_pdf()
        assert pdf.startswith(b"%PDF")
