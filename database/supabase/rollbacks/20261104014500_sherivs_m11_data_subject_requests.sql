-- M11 rollback is intentionally non-destructive: keep every request and audit event as evidence.
-- Disable the write/read entry points; tables stay in place, read-only and tenant-isolated.
REVOKE EXECUTE ON FUNCTION
  public.dsr_settings_configure(uuid,integer), public.dsr_open(uuid,uuid,text),
  public.dsr_verify_identity(uuid,text), public.dsr_erasure_decide(uuid),
  public.dsr_portability_export(uuid), public.dsr_close(uuid,text,text),
  public.dsr_overdue(uuid,timestamptz)
  FROM authenticated, service_role;
