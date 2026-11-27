-- Rollback for 20261117003100_sherivs_m6_onboarding_provisioning.sql (M6, ADR-148).
-- NOT APPLIED. Removes the review columns, the invitation table, the provisioning functions and
-- the self-serve flag. Organizations already provisioned are NOT deleted: they are ordinary
-- organizations with all root records; their onboarding_sessions rows keep plan, plan_hash and
-- applied_result. Invitation rows are lost with the table: export them first if any exist.

DROP FUNCTION IF EXISTS public.onboarding_provision_from_plan(uuid, uuid, text, jsonb, text);
DROP FUNCTION IF EXISTS public.onboarding_review_approve(uuid, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.onboarding_review_set_plan(uuid, uuid, text, jsonb, text, integer);
DROP FUNCTION IF EXISTS public.onboarding_review_assign(uuid, uuid);
DROP FUNCTION IF EXISTS public.onboarding_m6_slug(text);
DROP FUNCTION IF EXISTS public.onboarding_m6_audit(uuid, uuid, text, uuid, jsonb);
DROP FUNCTION IF EXISTS public.onboarding_m6_plan_hash(jsonb);
DROP FUNCTION IF EXISTS public.onboarding_m6_require(uuid, text[]);
DROP FUNCTION IF EXISTS public.onboarding_m6_actor_can(uuid, text);
DROP FUNCTION IF EXISTS public.onboarding_m6_caller_is_service();

DROP TABLE IF EXISTS public.organization_invitations;

DROP INDEX IF EXISTS public.onboarding_sessions_one_per_request;
ALTER TABLE public.onboarding_sessions DROP COLUMN IF EXISTS onboarding_request_id;

DROP INDEX IF EXISTS public.onboarding_requests_one_org;
ALTER TABLE public.onboarding_requests DROP CONSTRAINT IF EXISTS onboarding_requests_m6_approval_shape;
ALTER TABLE public.onboarding_requests DROP CONSTRAINT IF EXISTS onboarding_requests_m6_plan_shape;
-- 'approved' and 'provisioned' remain valid statuses of the M5b table; nothing to rewrite.
ALTER TABLE public.onboarding_requests
  DROP COLUMN IF EXISTS provisioned_at,
  DROP COLUMN IF EXISTS provisioned_org_id,
  DROP COLUMN IF EXISTS approval_step_up,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS approved_plan_hash,
  DROP COLUMN IF EXISTS plan_edited_at,
  DROP COLUMN IF EXISTS plan_edited_by,
  DROP COLUMN IF EXISTS plan_graph_version,
  DROP COLUMN IF EXISTS plan_revision,
  DROP COLUMN IF EXISTS plan_hash,
  DROP COLUMN IF EXISTS review_plan,
  DROP COLUMN IF EXISTS generated_plan;

-- The flag is locked; the 018 guard allows the change only with the named unlock setting.
SELECT set_config('sherivs.unlock_flag', 'self_serve_provisioning', false);
UPDATE public.feature_flags SET locked = false WHERE key = 'self_serve_provisioning' AND org_id IS NULL;
DELETE FROM public.feature_flags WHERE key = 'self_serve_provisioning';
SELECT set_config('sherivs.unlock_flag', '', false);
