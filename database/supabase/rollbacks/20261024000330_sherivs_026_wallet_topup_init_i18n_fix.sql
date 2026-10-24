-- Rollback SHERIVS-026. Wallet ledger credits already posted by settled top-ups stay (ledger is append-only).
BEGIN;
DROP FUNCTION IF EXISTS public.wallet_topup_settle(text, text, bigint, text), public.wallet_topup_intent_create(uuid, numeric, text);
DROP TABLE IF EXISTS public.wallet_topup_intents;
UPDATE public.ui_translations SET text = 'Dashboard' WHERE locale = 'ig' AND key = 'nav.dashboard';
COMMIT;
