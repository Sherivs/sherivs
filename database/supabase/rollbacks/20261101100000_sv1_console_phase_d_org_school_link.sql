-- Rollback of 20261101100000_sv1_console_phase_d_org_school_link.sql.
BEGIN;
DROP FUNCTION IF EXISTS public.provision_platform_organization_school(uuid, text);
COMMIT;
