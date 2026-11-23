# Deploying AiSOC behind HTTPS (`soc.cloudifyops.com`)

EC2, single host, Docker Compose project `clops-soc`. nginx terminates TLS on
80/443; `web` and `realtime` publish no host port at all. Read
`infra/nginx/README.md` for the routing table.

Assumptions: repo at `/opt/clops-soc`, the Elastic IP is attached, and `.env`
already holds the secrets (`SECRET_KEY`, `AISOC_CREDENTIAL_KEY`, database and
broker passwords). **Nothing here asks you to change a secret.**

## 1. Confirm DNS before anything else

```bash
dig +short A soc.cloudifyops.com          # must print the Elastic IP
aws ec2 describe-addresses --public-ips "$(curl -s https://checkip.amazonaws.com)" \
  --query 'Addresses[0].PublicIp'
```

A certificate is issued for a name, so an unchanged or still-propagating record
fails the ACME challenge in a way that reads like an nginx fault. `dig @8.8.8.8`
as well if the resolver in `/etc/resolv.conf` is a local one.

## 2. Merge the HTTPS variables

```bash
cd /opt/clops-soc
grep -q '^PUBLIC_SCHEME=' .env || cat .env.https.example >> .env
# edit .env: ACME_EMAIL must be a mailbox you read (expiry notices)
grep -E '^(PUBLIC_HOST|PUBLIC_SCHEME|PUBLIC_PORT_SUFFIX|HTTP_PORT|HTTPS_PORT|ACME_EMAIL|NGINX_CONF_DIR)=' .env
```

`NGINX_CONF_DIR` must stay unset (default `bootstrap`) for steps 3–5.

```bash
docker compose config -q && echo compose-ok
bash scripts/preflight.sh        # 80/443 free, DNS warning if it is not pointed here yet
```

## 3. Start nginx on the bootstrap config

```bash
docker compose up -d nginx
docker compose ps nginx                       # healthy
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1/nginx-health   # 200
curl -sS -o /dev/null -w '%{http_code}\n' \
  http://soc.cloudifyops.com/.well-known/acme-challenge/not-a-token        # 404, not 301
```

`404` proves the challenge location is being reached; a `301` means the
redirect is winning and issuance will fail.

## 4. Staging certificate first

The staging CA has generous limits; the production one allows five duplicate
certificates a week. Prove the path here, not there.

```bash
docker compose run --rm certbot
docker compose run --rm certbot certificates      # shows (STAGING) soc.cloudifyops.com
```

## 5. Real certificate

Delete the staging lineage first — Certbot keeps one live directory per name and
will not overwrite a valid certificate without `--force-renewal`.

```bash
docker compose run --rm certbot delete --cert-name soc.cloudifyops.com
docker compose run --rm certbot certonly --webroot -w /var/www/certbot \
  -d soc.cloudifyops.com --email "$(grep -E '^ACME_EMAIL=' .env | cut -d= -f2)" \
  --agree-tos --no-eff-email --non-interactive
docker compose run --rm certbot certificates      # no (STAGING)
```

## 6. Switch to the TLS config and reload

```bash
printf '\nNGINX_CONF_DIR=tls\n' >> .env
docker compose up -d --no-deps --force-recreate nginx
docker compose exec nginx nginx -t
```

`nginx -t` reads the config mounted at container start, so it fails loudly if
the certificate paths do not exist.

## 7. Rebuild `web`, then bring the stack up

`NEXT_PUBLIC_WS_URL` and `NEXT_PUBLIC_REALTIME_URL` are inlined by `next build`,
so a restart is not enough:

```bash
docker compose build web
docker compose up -d
docker compose ps
```

Only `nginx` should list published ports:

```bash
docker compose ps --format '{{.Name}}\t{{.Ports}}' | grep -v '^$'
```

## 8. Verify

```bash
# HTTP redirects, and the challenge path is still served (renewal depends on it)
curl -sSI http://soc.cloudifyops.com/ | head -3            # 301 -> https://…
curl -sSI http://soc.cloudifyops.com/.well-known/acme-challenge/x | head -1

# TLS listener serves the app, with the headers that cannot break it
curl -sSI https://soc.cloudifyops.com/ | grep -Ei 'HTTP/|strict-transport|x-content-type|referrer-policy'
curl -sS https://soc.cloudifyops.com/api/health

# Certificate validity (and that it is the real CA, not staging)
echo | openssl s_client -servername soc.cloudifyops.com -connect soc.cloudifyops.com:443 2>/dev/null \
  | openssl x509 -noout -issuer -dates

# WebSocket route reaches the realtime gateway. Without a ticket it must answer
# 401, which proves nginx routed /ws — a 404 or 502 means it did not.
curl -sS -o /dev/null -w '%{http_code}\n' -N \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://soc.cloudifyops.com/ws/all

# SSE route, same reasoning
curl -sS -o /dev/null -w '%{http_code}\n' -N https://soc.cloudifyops.com/sse
```

Then in a browser: sign in, leave the Alerts page open, and confirm the live
indicator connects (DevTools → Network → WS → `wss://soc.cloudifyops.com/ws/…`).

Only after all of the above passes, uncomment the HSTS line in
`infra/nginx/tls/20-soc.conf` and `docker compose exec nginx nginx -s reload`.
HSTS is cached by browsers for `max-age` and cannot be recalled.

## 9. Close 13000/18086, open 80/443

```bash
SG=$(aws ec2 describe-instances --filters "Name=ip-address,Values=$(curl -s https://checkip.amazonaws.com)" \
  --query 'Reservations[0].Instances[0].SecurityGroups[0].GroupId' --output text)
aws ec2 revoke-security-group-ingress --group-id "$SG" --protocol tcp --port 13000 --cidr 0.0.0.0/0
aws ec2 revoke-security-group-ingress --group-id "$SG" --protocol tcp --port 18086 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 80  --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 443 --cidr 0.0.0.0/0
```

From **outside** the instance (a laptop, not the EC2 shell):

```bash
nc -zv soc.cloudifyops.com 13000    # timed out / refused
nc -zv soc.cloudifyops.com 18086    # timed out / refused
curl -sS -o /dev/null -w '%{http_code}\n' http://soc.cloudifyops.com:13000/   # must not be 200
```

Inside the instance the ports are now closed by compose anyway; the security
group is what makes "closed from outside" true.

## 10. Renewal

The `certbot` service is a one-shot under the `certbot` profile, so renewal is
a cron entry or a systemd timer, not a daemon. Webroot renewal does not need
nginx stopped.

```bash
# /etc/cron.d/aisoc-certbot
0 3 * * * root cd /opt/clops-soc && docker compose run --rm certbot renew --webroot -w /var/www/certbot --quiet && docker compose exec -T nginx nginx -s reload
```

Test it without spending a real issuance:

```bash
docker compose run --rm certbot renew --webroot -w /var/www/certbot --dry-run
docker compose run --rm certbot certificates      # VALID: N days
```

Certbot renews at 30 days remaining; the reload in the cron line is what makes
nginx serve the new certificate.

## 11. Rollback

Every step here is reversible without touching data.

```bash
# 1. Back to plain HTTP on the console's old port
sed -i 's/^NGINX_CONF_DIR=.*/NGINX_CONF_DIR=bootstrap/' .env
sed -i 's/^PUBLIC_SCHEME=.*/PUBLIC_SCHEME=http/' .env
sed -i 's/^PUBLIC_WS_SCHEME=.*/PUBLIC_WS_SCHEME=ws/' .env
sed -i 's/^PUBLIC_PORT_SUFFIX=.*/PUBLIC_PORT_SUFFIX=:13000/' .env
sed -i 's#^AISOC_CONSOLE_URL=.*#AISOC_CONSOLE_URL=http://soc.cloudifyops.com:13000#' .env
sed -i 's#^AISOC_WEB_BASE_URL=.*#AISOC_WEB_BASE_URL=http://soc.cloudifyops.com:13000#' .env
sed -i 's#^AISOC_CORS_ORIGINS=.*#AISOC_CORS_ORIGINS=http://soc.cloudifyops.com:13000#' .env
sed -i 's#^NEXT_PUBLIC_WS_URL=.*#NEXT_PUBLIC_WS_URL=ws://soc.cloudifyops.com:18086#' .env
sed -i 's#^NEXT_PUBLIC_REALTIME_URL=.*#NEXT_PUBLIC_REALTIME_URL=http://soc.cloudifyops.com:18086#' .env

# 2. Restore the old port mappings (web 13000 -> 3000, realtime 18086 -> 4000)
git revert --no-edit <commit>          # the commit that removed them
docker compose build web && docker compose up -d

# 3. Re-open 13000/18086 in the security group, close 80/443 if nothing else uses them
```

The certificate stays in `clops_soc_letsencrypt`; leaving it there is harmless
and makes the second attempt a reload rather than an issuance.

## Notes and known gaps

- **Audit client IP** — the API records the nginx container address until
  `AISOC_TRUSTED_PROXIES` names the compose subnet (see the `[TODO]` in
  `docker-compose.yml` and `.env.https.example`). Realtime already prefers
  `X-Forwarded-For`.
- **Alertmanager and Grafana** are not proxied: they stay on loopback and are
  reachable only over an SSH tunnel.
- **Keycloak at `auth.cloudifyops.com`** — `infra/nginx/tls/30-auth.conf.example`
  is the shape of the second server block; the first one is not edited.
- `PUBLIC_PORT_SUFFIX` uses `${VAR-}` so the empty value above survives; do not
  rewrite it to `${VAR:-}`.
