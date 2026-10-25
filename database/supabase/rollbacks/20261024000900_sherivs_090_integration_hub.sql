-- Rollback SHERIVS-090 (Integration Hub). Drops hub tables and functions. Students created by
-- imports stay (they are real school records); their external-id links are dropped.
BEGIN;
DROP FUNCTION IF EXISTS public.integration_claim_due_jobs(integer), public.integration_webhook_target(uuid),
  public.integration_ingest(uuid, text, jsonb, text, text), public.integration_set_mappings(uuid, text, jsonb),
  public.integration_update(uuid, text, text, jsonb), public.integration_connect(uuid, text, text, text),
  public._integration_audit(uuid, uuid, text, jsonb);
DROP TABLE IF EXISTS public.integration_audit, public.integration_records, public.external_id_map, public.sync_runs,
  public.sync_jobs, public.field_mappings, public.integrations, public.connector_manifests;
DROP FUNCTION IF EXISTS public._integration_audit_immutable(), public._integration_admin_schools();
COMMIT;
