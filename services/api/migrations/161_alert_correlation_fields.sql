-- 161_alert_correlation_fields.sql
-- Additive columns for fusion correlation linkage and decision transparency.
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS incident_id TEXT;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS fusion_decision TEXT;

CREATE INDEX IF NOT EXISTS idx_alerts_tenant_incident
    ON alerts (tenant_id, incident_id)
    WHERE incident_id IS NOT NULL;
