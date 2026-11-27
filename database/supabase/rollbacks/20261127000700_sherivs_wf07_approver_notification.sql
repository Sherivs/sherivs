-- Rollback: removes the scan. Notifications already sent are kept (they are user-visible history).
DROP FUNCTION IF EXISTS public.wf_approval_notify_scan(integer);
