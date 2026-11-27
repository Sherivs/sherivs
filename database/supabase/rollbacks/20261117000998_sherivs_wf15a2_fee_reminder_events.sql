-- Rollback for WF-15a2. Events already emitted stay (append-only); templates that reference the event types must be retired first.
BEGIN;
DROP TRIGGER IF EXISTS wf15a2_cg_fee_payment_stop ON public.cg_fee_payment;
DROP FUNCTION IF EXISTS public.wf_fee_reminder_stop_on_payment();
DROP FUNCTION IF EXISTS public.wf_fee_reminder_scan(timestamptz, integer);
DROP FUNCTION IF EXISTS public.wf_fee_invoice_settled(uuid);
DROP FUNCTION IF EXISTS public.wf_fee_reminder_rungs(timestamptz);
DELETE FROM public.wf_event_source WHERE event_type IN ('fees.reminder_week_start', 'fees.reminder_week_end', 'fees.reminder_due_day', 'fees.reminder_overdue', 'fees.reminder_escalation');
COMMIT;
