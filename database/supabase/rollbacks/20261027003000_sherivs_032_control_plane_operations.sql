-- Rollback of 20261027003000_sherivs_032_control_plane_operations.sql.
BEGIN;
DROP TABLE IF EXISTS public.platform_ticket;
DROP TABLE IF EXISTS public.platform_incident;
DROP INDEX IF EXISTS public.audit_logs_action_created_idx;
COMMIT;
