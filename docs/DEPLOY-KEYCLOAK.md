# Deploying Keycloak at `auth.cloudifyops.com`

Production runbook for adding Keycloak (`quay.io/keycloak/keycloak:26.8@sha256:b0f60d489d51c5d113390bdf5461d4c06e6051be026c05549f2e1e10ec352bcc`) to the single-EC2 Docker Compose stack (`clops-soc`) behind the existing nginx TLS edge (`docs/DEPLOY-HTTPS.md`).

---

## Architecture & Security Model

- **Public surface**: `https://auth.cloudifyops.com` is served by `nginx` (`infra/nginx/tls/30-auth.conf`), which terminates TLS and forwards to `http://keycloak:8080` over the internal `clops-soc` network with `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Forwarded-Host`, and `X-Real-IP`.
- **Admin lockdown**: `nginx` blocks `/admin`, `/admin/*`, `/realms/master`, and `/realms/master/*` on the public listener with **HTTP 403**. The administration console is reachable only over an SSH tunnel to the loopback port `127.0.0.1:18080` (`--hostname-admin=http://127.0.0.1:18080`).
- **Dedicated database**: `keycloak-db` (`postgres:16-alpine`) uses its own volume (`clops_soc_keycloak_db_data`) and credential (`KEYCLOAK_DB_PASSWORD`). It never shares the application Postgres instance.
- **Secrets isolation**: `KEYCLOAK_DB_PASSWORD`, `KEYCLOAK_ADMIN_USER`, `KEYCLOAK_ADMIN_PASSWORD`, and `OIDC_CLIENT_SECRET` have **no defaults** in `docker-compose.yml` (`${VAR:?}`). They live in `.env.secrets` (gitignored, `chmod 600`) and are passed via:
  ```bash
  docker compose --env-file .env --env-file .env.secrets ...
  ```

---

## Step-by-Step EC2 Deployment

### 1. Confirm DNS for `auth.cloudifyops.com`
Verify `auth.cloudifyops.com` resolves to this EC2 instance's Elastic IP before invoking Let's Encrypt:
```bash
PUBLIC_IP="$(curl -fsS --max-time 5 https://checkip.amazonaws.com | tr -d '[:space:]')"
DIG_IP="$(dig +short A auth.cloudifyops.com @1.1.1.1 | tail -n1)"
printf 'EC2 Elastic IP: %s\nDNS A record:   %s\n' "$PUBLIC_IP" "$DIG_IP"
test "$PUBLIC_IP" = "$DIG_IP"
```

### 2. Issue the Let's Encrypt Certificate for `auth.cloudifyops.com`
`nginx` already serves `/.well-known/acme-challenge/` on port 80 for `auth.cloudifyops.com` (`infra/nginx/bootstrap/default.conf` and `infra/nginx/tls/30-auth.conf`).

1. **Staging certificate first** (protects against Let's Encrypt rate limits):
   ```bash
   docker compose --env-file .env --env-file .env.secrets --profile certbot run --rm certbot \
     certonly --webroot -w /var/www/certbot \
     -d auth.cloudifyops.com \
     --email ops@cloudifyops.com --agree-tos --no-eff-email --non-interactive \
     --staging
   ```
2. **Production certificate** (replace the staging lineage once step 1 succeeds):
   ```bash
   docker compose --env-file .env --env-file .env.secrets --profile certbot run --rm certbot \
     certonly --webroot -w /var/www/certbot \
     -d auth.cloudifyops.com \
     --email ops@cloudifyops.com --agree-tos --no-eff-email --non-interactive \
     --force-renewal
   ```
3. **Validate and reload nginx**:
   ```bash
   docker compose --env-file .env --env-file .env.secrets exec nginx nginx -t
   docker compose --env-file .env --env-file .env.secrets exec nginx nginx -s reload
   ```

### 3. Create `.env.secrets` and Start `keycloak-db` + `keycloak`
1. Create `.env.secrets` from `.env.secrets.example` with fresh random secrets:
   ```bash
   umask 077
   cat > .env.secrets <<EOF
   KEYCLOAK_DB_PASSWORD=$(openssl rand -hex 32)
   KEYCLOAK_ADMIN_USER=kc-bootstrap-admin
   KEYCLOAK_ADMIN_PASSWORD=$(openssl rand -hex 32)
   OIDC_CLIENT_SECRET=$(openssl rand -hex 32)
   EOF
   chmod 600 .env.secrets
   ```
2. Start `keycloak-db` and `keycloak`:
   ```bash
   docker compose --env-file .env --env-file .env.secrets up -d keycloak-db keycloak
   ```

### 4. Verify Realm Import and Health
Wait for `keycloak` to report `(healthy)` and confirm the `clopssoc` realm (`infra/keycloak/realm-clopssoc.json`) was imported on first start:
```bash
docker compose --env-file .env --env-file .env.secrets ps keycloak-db keycloak
docker compose --env-file .env --env-file .env.secrets logs keycloak | grep -E "imported|clopssoc|Listening on"
curl -fsS https://auth.cloudifyops.com/realms/clopssoc/.well-known/openid-configuration | jq '{issuer, authorization_endpoint, token_endpoint, jwks_uri, code_challenge_methods_supported}'
```
Also verify that public access to `/admin` and `/realms/master` is blocked by nginx:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://auth.cloudifyops.com/admin          # must print 403
curl -s -o /dev/null -w "%{http_code}\n" https://auth.cloudifyops.com/realms/master  # must print 403
```

### 5. Access the Admin Console via SSH Tunnel
From your operator workstation, open a local port forward to the EC2 loopback port `127.0.0.1:18080`:
```bash
ssh -L 18080:127.0.0.1:18080 ubuntu@soc.cloudifyops.com
```
Open `http://127.0.0.1:18080/admin/` in your local browser and sign in with `KEYCLOAK_ADMIN_USER` and `KEYCLOAK_ADMIN_PASSWORD` from `.env.secrets`.

### 6. Rotate the Bootstrap Admin Password & Regenerate the Client Secret
1. **Create a permanent master admin & rotate/remove bootstrap user**:
   - In the `master` realm -> **Users**, create your personal admin user (or select `kc-bootstrap-admin` -> **Credentials** -> **Reset password** with **Temporary: Off**), update `KEYCLOAK_ADMIN_PASSWORD` in `.env.secrets`, and keep `.env.secrets` mode `0600`.
2. **Rotate the `clopssoc-console` OIDC client secret**:
   - Switch to the **`clopssoc`** realm (top-left realm dropdown).
   - Navigate to **Clients** -> **`clopssoc-console`** -> **Credentials** tab.
   - Click **Regenerate** on **Client Secret** (replacing the `REPLACE_VIA_KEYCLOAK_ADMIN_UI_OR_CLI` placeholder from `realm-clopssoc.json`).
   - Copy the new secret and set `OIDC_CLIENT_SECRET=<new-secret>` in `.env.secrets`.

### 7. Create the First Realm User
In the **`clopssoc`** realm:
1. Navigate to **Users** -> **Add user**:
   - **Email**: `analyst@cloudifyops.com` (or your `@cloudifyops.com` address)
   - **Email verified**: **On** (required: `services/api/app/auth/oidc.py` and `sso_provisioning.py` reject unverified emails when claiming existing accounts, and `verifyEmail` is enabled on the realm)
   - **First name** / **Last name**: fill both (Keycloak's default `VERIFY_PROFILE` check requires non-empty names before issuing tokens)
   - **Groups**: join **`soc-analysts`** (or **`soc-admins`**)
2. Go to the user's **Credentials** tab -> **Set password** (minimum 12 characters per the realm password policy, **Temporary: Off**).

### 8. Configure Google Identity Provider (Manual — Never in Git)
The Google IdP requires a client secret and is deliberately excluded from `infra/keycloak/realm-clopssoc.json`. To enable Google Workspace sign-in for `@cloudifyops.com`:
1. In Google Cloud Console -> **APIs & Services -> Credentials**, create an **OAuth 2.0 Client ID** (Web application):
   - **Authorized redirect URI**: `https://auth.cloudifyops.com/realms/clopssoc/broker/google/endpoint`
2. In Keycloak (`http://127.0.0.1:18080/admin/`, **`clopssoc`** realm) -> **Identity providers** -> **Google**:
   - **Client ID** / **Client Secret**: paste from Google Cloud Console.
   - **Hosted Domain**: `cloudifyops.com` (restricts Google sign-in to `cloudifyops.com` accounts).
   - **Trust Email**: **On** (Google verifies workspace emails; ensure the resulting Keycloak user has `emailVerified = true`).
   - **First login flow**: `first broker login` (verify in **Authentication -> Flows -> First Broker Login** that **Review Profile** and **Verify Existing Account by Email** are enabled so unverified emails cannot silently claim an account).
3. Click **Save**.

### 9. Set Application Environment Variables
Add the following variables to `.env` on the EC2 server (and ensure `OIDC_CLIENT_SECRET` is set in `.env.secrets`):

| Variable | Exact Value | Notes |
| --- | --- | --- |
| `SSO_ENABLED` | `true` | Enables `/auth/oidc/login`, `/auth/oidc/callback`, and the SSO button on `/login` (`auth.py:226-239`) |
| `SSO_PROVIDER` | `oidc` | Directs the login button to `/auth/oidc/login` |
| `SSO_LOGIN_LABEL` | `Sign in with CloudifyOps SSO` | Button label on `/login` (max 80 chars) |
| `SSO_LOCAL_ADMIN_ONLY` | `false` | **Must stay `false`** so password login continues working alongside SSO (`auth.py:128-133`) |
| `OIDC_ISSUER` | `https://auth.cloudifyops.com/realms/clopssoc` | Exact `iss` claim in Keycloak's discovery document and `id_token` |
| `OIDC_CLIENT_ID` | `clopssoc-console` | Matches the confidential client in `realm-clopssoc.json` |
| `OIDC_CLIENT_SECRET` | *(set in `.env.secrets`)* | Confidential client secret regenerated in Step 6 |
| `OIDC_REDIRECT_URI` | `https://soc.cloudifyops.com/auth/oidc/callback` | Matches `redirectUris` in `realm-clopssoc.json` |
| `OIDC_SCOPES` | `openid email profile` | `groups` is emitted by the client's `oidc-group-membership-mapper` into `id_token` & `userinfo` |
| `OIDC_PKCE` | `true` | Sends `code_challenge_method=S256` (`oidc.py:261,294-303`) |
| `SSO_GROUPS_CLAIM` | `groups` | Matches `claim.name: "groups"` on the protocol mapper (`oidc.py:501-502`) |

 Also make sure `JWT_SECRET` in `.env` is a 32+ byte random string (not empty and not `changeme-insecure-default`).

Apply the updated environment to `api`:
```bash
docker compose --env-file .env --env-file .env.secrets up -d api
```

### 10. Create the `aisoc_sso_connections` Row & Confirm MFA Policy Is Off
There is **no console UI** for creating SSO connections; rows in `aisoc_sso_connections` are managed exclusively via the REST API (`/api/v1/sso-connections` in `services/api/app/api/v1/endpoints/sso_connections.py`), which requires an authenticated caller holding `settings:write` (such as the break-glass `bootstrap_admin` account).

> **Note on roles**: `sso_provisioning.py:59` (`ASSIGNABLE_ROLES`) and `sso_connections.py:141-165` (`_assert_roles_grantable`) forbid mapping any IdP group to `admin` or `platform_admin`. The highest grantable role is `tenant_admin` (or `soc_lead` / `infosec` for analysts).

1. **Obtain an admin bearer token** (using the break-glass password login):
   ```bash
   ADMIN_TOKEN="$(curl -fsS -X POST https://soc.cloudifyops.com/api/v1/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@aisoc.internal","password":"'"$AISOC_ADMIN_PASSWORD"'"}' \
     | jq -r '.access_token')"
   ```
2. **Confirm the tenant MFA policy is OFF** (so SSO users are not prompted for a second TOTP/WebAuthn factor by the console):
   - By default, a fresh tenant has no rows in `aisoc_tenant_mfa_policy` or `aisoc_tenant_mfa_role_policy`, which evaluates to `require_totp: false` and `require_for_roles: []` (`services/api/app/api/v1/endpoints/mfa.py:201-255`).
   - Verify (and force off if anyone enabled it earlier):
     ```bash
     curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
       https://soc.cloudifyops.com/api/v1/auth/mfa/policy | jq .
     # Must return: {"require_totp": false, "require_for_roles": []}
     # If either is non-empty, reset to off:
     curl -fsS -X PUT https://soc.cloudifyops.com/api/v1/auth/mfa/policy \
       -H "Authorization: Bearer $ADMIN_TOKEN" \
       -H 'Content-Type: application/json' \
       -d '{"require_totp": false, "require_for_roles": []}' | jq .
     ```
3. **Create the OIDC connection disabled, verify it, then enable it**:
   ```bash
   CONN_ID="$(curl -fsS -X POST https://soc.cloudifyops.com/api/v1/sso-connections \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{
       "provider": "oidc",
       "issuer": "https://auth.cloudifyops.com/realms/clopssoc",
       "display_name": "CloudifyOps Keycloak",
       "login_label": "Sign in with CloudifyOps SSO",
       "enabled": false,
       "default_role": "viewer",
       "allowed_email_domains": "cloudifyops.com",
       "jit_provisioning": true,
       "group_role_mode": "first_login_only",
       "group_role_mapping": {
         "soc-analysts": "infosec",
         "soc-admins": "tenant_admin"
       }
     }' | jq -r '.id')"
   echo "Created connection: $CONN_ID"
   ```
4. **Enable the connection**:
   ```bash
   curl -fsS -X PATCH "https://soc.cloudifyops.com/api/v1/sso-connections/$CONN_ID" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{
       "provider": "oidc",
       "issuer": "https://auth.cloudifyops.com/realms/clopssoc",
       "display_name": "CloudifyOps Keycloak",
       "login_label": "Sign in with CloudifyOps SSO",
       "enabled": true,
       "default_role": "viewer",
       "allowed_email_domains": "cloudifyops.com",
       "jit_provisioning": true,
       "group_role_mode": "first_login_only",
       "group_role_mapping": {
         "soc-analysts": "infosec",
         "soc-admins": "tenant_admin"
       }
     }' | jq .
   ```

---

## Verification & Test Checklist

1. **SSO status endpoint**:
   ```bash
   curl -fsS https://soc.cloudifyops.com/api/v1/auth/sso/status | jq .
   # Expected: {"sso_enabled":true,"provider":"oidc","login_label":"Sign in with CloudifyOps SSO","local_login_enabled":true}
   ```
2. **OIDC Login (PKCE S256 + group mapping)**:
   - Open `https://soc.cloudifyops.com/login` in an incognito window.
   - Click **Sign in with CloudifyOps SSO**.
   - Verify redirect to `https://auth.cloudifyops.com/realms/clopssoc/protocol/openid-connect/auth?...&code_challenge_method=S256`.
   - Sign in as `analyst@cloudifyops.com` (member of `soc-analysts`).
   - Verify callback lands on `/login?next=%2F#access_token=...` and routes into `/dashboard` with role `infosec` (or `tenant_admin` for `soc-admins`) without any MFA prompt.
3. **Token Refresh**:
   - Call `POST /api/v1/auth/refresh` with the issued `refresh_token` and verify HTTP 200 with a fresh token pair.
4. **Logout**:
   - Click Sign out in the console (clears `localStorage` tokens), and test RP-initiated logout via `curl -I https://soc.cloudifyops.com/auth/oidc/logout` (verifies HTTP 302 redirect to `https://auth.cloudifyops.com/realms/clopssoc/protocol/openid-connect/logout`).
5. **Failed Login & Brute-Force Protection**:
   - Attempt sign-in at Keycloak with a wrong password; verify Keycloak rejects with invalid credentials and increments the brute-force failure counter (locks for 15 minutes after 10 failures).
6. **Break-Glass Local Admin Login Still Works**:
   - On `https://soc.cloudifyops.com/login`, sign in with email/password as `admin@aisoc.internal` (with `SSO_LOCAL_ADMIN_ONLY=false`, both admin and non-admin password accounts continue to work).
7. **Verified vs. Unverified Email**:
   - **Verified email (`emailVerified: true`)**: Sign in with a Keycloak user matching an existing local email or a new `@cloudifyops.com` address -> succeeds and binds subject in `aisoc_sso_identities`.
   - **Unverified email (`emailVerified: false`)**: In Keycloak Admin, create a user whose email matches an existing local user but toggle **Email verified: Off** (and remove the `VERIFY_EMAIL` required action so Keycloak issues a token with `"email_verified": false`). Attempt to sign in -> verify `/auth/oidc/callback` rejects with **HTTP 403** (`"the provider did not assert that <email> is verified, so it cannot be used to sign in as an existing account"`).

---

## Rollback

To disable Keycloak SSO and revert cleanly to password-only authentication:
1. Set `SSO_ENABLED=false` in `.env` and recreate `api`:
   ```bash
   docker compose --env-file .env --env-file .env.secrets up -d api
   ```
   (Or disable the connection row via `PATCH /api/v1/sso-connections/$CONN_ID` with `"enabled": false`.)
2. Stop the Keycloak containers if desired:
   ```bash
   docker compose --env-file .env --env-file .env.secrets stop keycloak keycloak-db
   ```
3. `soc.cloudifyops.com` continues serving on `20-soc.conf` unaffected.
