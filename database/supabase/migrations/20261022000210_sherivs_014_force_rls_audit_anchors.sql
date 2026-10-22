-- Sherivs 014: force row-level security on public.audit_chain_anchors.
-- 013 enabled RLS on this table but did not FORCE it (every other 012/013 table
-- is forced). No policies exist; anon/authenticated have no grants. service_role
-- has BYPASSRLS, so the daily anchor writer (service role) is unaffected.
BEGIN;
ALTER TABLE public.audit_chain_anchors FORCE ROW LEVEL SECURITY;
COMMIT;
