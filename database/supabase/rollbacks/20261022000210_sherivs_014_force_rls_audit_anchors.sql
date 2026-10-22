-- Rollback for 20261022000210_sherivs_014_force_rls_audit_anchors.sql
BEGIN;
ALTER TABLE public.audit_chain_anchors NO FORCE ROW LEVEL SECURITY;
COMMIT;
