-- M12 rollback is intentionally non-destructive: retain policies, reports,
-- holds, approvals and audit evidence. Disable the tenant bootstrap and RPCs.
DROP TRIGGER IF EXISTS retention_seed_school_defaults ON public.schools;

REVOKE EXECUTE ON FUNCTION public.retention_policy_configure(uuid,text,integer,boolean),
  public.retention_legal_hold_create(uuid,text,text,uuid,text,uuid,text),
  public.retention_legal_hold_release(uuid,text),
  public.retention_run_approve(uuid), public.retention_run_execute(uuid),
  public.retention_run_dry(uuid) FROM authenticated, service_role;
