-- PROPOSAL ONLY. NOT APPLIED. NOT IN THE MIGRATIONS DIRECTORY.
-- SEC-H3: stop tenant users writing their own subscription rows.
-- Origin: independent audit of 2026-11-16 (finding "school admins can write public.subscriptions").
-- Verified on production 2026-11-16 by read-only query: role `authenticated` holds INSERT, UPDATE
-- and DELETE on public.subscriptions; the permissive policy tenant_all_subscriptions allows ALL for
-- the caller's own organization, and the restrictive sv4_* policies narrow writes to admin and
-- principal only. So an organization admin can set plan, amount_paid and expires_at on their own row.
-- Production has 0 subscriptions and 0 organizations today, so nothing is exposed yet. Apply before
-- the first organization is created.
--
-- Every writer in the code base uses the service role (console settlement, billing store), which
-- bypasses grants and policies, so this does not change any supported flow. Tenants keep read access.
-- Needs the founder's approval: it changes financial policy.

BEGIN;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.subscriptions FROM authenticated, anon;

DROP POLICY IF EXISTS tenant_all_subscriptions ON public.subscriptions;
DROP POLICY IF EXISTS tenant_read_subscriptions ON public.subscriptions;
CREATE POLICY tenant_read_subscriptions ON public.subscriptions
  FOR SELECT TO authenticated
  USING (school_id = public.get_my_school_id() OR public.is_super_admin());

COMMIT;

-- Rollback (restores the previous, wider access; do not use without a reason):
-- BEGIN;
-- GRANT INSERT, UPDATE, DELETE ON TABLE public.subscriptions TO authenticated;
-- DROP POLICY IF EXISTS tenant_read_subscriptions ON public.subscriptions;
-- CREATE POLICY tenant_all_subscriptions ON public.subscriptions FOR ALL TO public
--   USING (school_id = public.get_my_school_id() OR public.is_super_admin())
--   WITH CHECK (school_id = public.get_my_school_id() OR public.is_super_admin());
-- COMMIT;
