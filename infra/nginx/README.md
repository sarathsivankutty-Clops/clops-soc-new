# nginx TLS edge

Two configurations, one service. `docker-compose.yml` mounts whichever
directory `NGINX_CONF_DIR` names into `/etc/nginx/conf.d`:

| `NGINX_CONF_DIR` | Directory | Listens | When |
| --- | --- | --- | --- |
| `bootstrap` (default) | `bootstrap/` | :80, ACME + redirect | before a certificate exists |
| `tls` | `tls/` | :80 redirect, :443 TLS | after Certbot has issued one |

`bootstrap` is the default because nginx will not start with an
`ssl_certificate` file that does not exist — the first `up` on a fresh host has
to come up on plain HTTP or there is no web server to answer the ACME
challenge.

The snippets directory mounts read-only at `/etc/nginx/snippets` and is shared
by both configurations, so the proxy headers and the challenge location are
defined once.

## Routing

| Path | Upstream | Why |
| --- | --- | --- |
| `/ws` `/ws/<channel>` | `realtime:4000` | Next.js rewrites do not carry a WebSocket upgrade |
| `/sse` | `realtime:4000` | same gateway, `proxy_buffering off` |
| `/api/v1/auth/login` | `web:3000` | rate limited (10 r/m, burst 5) |
| `/auth/` | `web:3000` | OIDC/SAML browser flow, rate limited (30 r/m, burst 20) |
| `/nginx-health` | nginx itself | compose healthcheck, answered for any Host |
| everything else | `web:3000` | pages, `_next`, `/api/v1/*` |

## Adding a second host

Copy `tls/30-auth.conf.example` to `tls/30-auth.conf` and give it its own
`snippets/server-name-*.conf`. The existing block is not edited; the
`default_server` still closes unknown hostnames with 444.

HSTS is deliberately commented out in `tls/20-soc.conf`. Enable it only after
the checks in `docs/DEPLOY-HTTPS.md` pass — it is cached by browsers for
`max-age` and cannot be taken back.
