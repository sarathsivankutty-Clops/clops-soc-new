-- 163_sso_identity_idp_groups.sql
-- Record what the IdP (Keycloak) said about a bound identity so Settings -> Users
-- can show it, and track the state of the two-way sync. Additive and idempotent.
ALTER TABLE aisoc_sso_identities
    ADD COLUMN IF NOT EXISTS idp_groups     JSONB       NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sync_status    TEXT;

COMMENT ON COLUMN aisoc_sso_identities.idp_groups IS
    'Group names the IdP asserted at last sign-in or reconcile. Display only; roles still come from group_role_mapping.';
COMMENT ON COLUMN aisoc_sso_identities.sync_status IS
    'synced | pending | failed | unconfigured, set by app.services.keycloak_sync.';
