-- Rollback for 20261101100100. Drops the mapping RPC; restoring the buggy
-- cg_whatsapp_receive is intentionally not done (re-run 20261101000020 definition if required).
BEGIN;
DROP FUNCTION IF EXISTS public.cg_whatsapp_map_sender(text, text, text, text, text, text);
COMMIT;
