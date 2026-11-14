-- =============================================================================
-- ENGINE-02 (ADR-080): Hermes is renamed to the Sherivs Conductor.
-- Compatibility-first: the physical table public.cg_hermes_observation is NOT
-- renamed (it carries RLS posture, a guard trigger and the V1 apply-record
-- manifests that name it). The Conductor name is exposed as a read-only,
-- security-invoker view so callers can migrate before any physical rename.
-- Forward-only; exact inverse in rollbacks/20261110000200_*.sql.
-- =============================================================================

CREATE OR REPLACE VIEW public.cg_conductor_observation
WITH (security_invoker = true) AS
SELECT * FROM public.cg_hermes_observation;

COMMENT ON VIEW public.cg_conductor_observation IS
  'ENGINE-02 / ADR-080: Sherivs Conductor name for cg_hermes_observation. Read-only security-invoker view; writes go through the governed observation port against the base table.';

REVOKE ALL ON public.cg_conductor_observation FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cg_conductor_observation TO service_role;
