-- 162_backfill_alerts_case_id.sql
-- Idempotent backfill: sync alerts.case_id from aisoc_cases.alert_ids where unset.
UPDATE alerts AS a
SET case_id = c.id,
    updated_at = NOW()
FROM aisoc_cases AS c
WHERE a.tenant_id = c.tenant_id
  AND a.case_id IS NULL
  AND a.id = ANY(c.alert_ids);
