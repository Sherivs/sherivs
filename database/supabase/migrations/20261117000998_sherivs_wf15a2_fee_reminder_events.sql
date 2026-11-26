-- NOT APPLIED. Needs the founder's written approval for this file, a fresh backup and a restore test; applied from merged master only.
-- WF-15a2 (ADR-136): due-date-relative fee reminder events and stop-on-payment.
-- Strategy of 26 Nov 2026: four weeks before the due date (first and last school day of each week), the due date,
-- weekly after it, a bursar escalation four weeks after. Dates are Africa/Lagos wall-clock; nothing is sent here:
-- the scanner only emits WF-05 events, which do nothing while WORKFLOWS_ENABLED is off for the organisation.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.wf_emit_event(uuid,text,text,text,text,jsonb)') IS NULL
     OR to_regclass('public.wf_event_source') IS NULL
     THEN
    RAISE EXCEPTION 'WF-15a2: WF-05 event sources are required first';
  END IF;
  IF to_regprocedure('public.wf_fee_reminder_scan(timestamptz,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'WF-15a2: already applied';
  END IF;
END $$;

-- Pure schedule. offset_days is the number of whole days from the rung to the due date (positive = before the due date).
CREATE FUNCTION public.wf_fee_reminder_rungs(p_due timestamptz)
RETURNS TABLE (rung text, class text, at timestamptz, offset_days integer)
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  WITH d AS (SELECT (p_due AT TIME ZONE 'Africa/Lagos')::date AS due_day),
  weeks AS (
    SELECT k, date_trunc('week', (due_day - 7 * k)::timestamp)::date AS monday FROM d, generate_series(1, 4) AS k
  )
  SELECT 'w' || k || '_first', 'week_start', ((monday::timestamp + interval '8 hours') AT TIME ZONE 'Africa/Lagos'),
         (SELECT due_day FROM d) - monday FROM weeks
  UNION ALL
  SELECT 'w' || k || '_last', 'week_end', (((monday + 4)::timestamp + interval '12 hours') AT TIME ZONE 'Africa/Lagos'),
         (SELECT due_day FROM d) - (monday + 4) FROM weeks
  UNION ALL
  SELECT 'due_day', 'due_day', ((due_day::timestamp + interval '8 hours') AT TIME ZONE 'Africa/Lagos'), 0 FROM d
  UNION ALL
  SELECT 'over_w' || n, 'overdue', (((due_day + 7 * n)::timestamp + interval '8 hours') AT TIME ZONE 'Africa/Lagos'), -7 * n
    FROM d, generate_series(1, 12) AS n
  UNION ALL
  SELECT 'escalate', 'escalation', (((due_day + 28)::timestamp + interval '9 hours') AT TIME ZONE 'Africa/Lagos'), -28 FROM d
$$;

-- True when recorded payments cover the invoice. Part payment does not stop the ladder.
CREATE FUNCTION public.wf_fee_invoice_settled(p_invoice uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT coalesce((SELECT sum(p.amount_kobo) FROM public.cg_fee_payment p WHERE p.invoice_id = p_invoice), 0)
         >= coalesce((SELECT i.amount_kobo FROM public.cg_fee_invoice i WHERE i.id = p_invoice), 9223372036854775807)
$$;

-- One event type per message class keeps every template a straight line (no routing inside a graph).
INSERT INTO public.wf_event_source (event_type, domain, source_table, description, payload_keys)
SELECT t.event_type, 'fees', 'cg_fee_invoice', t.descr, ARRAY['amount_kobo', 'due_at', 'invoice_id', 'offset_days']
  FROM (VALUES
    ('fees.reminder_week_start', 'A fee reminder is due on the first school day of a week before the due date.'),
    ('fees.reminder_week_end', 'A fee reminder is due on the last school day of a week before the due date.'),
    ('fees.reminder_due_day', 'A fee invoice is due today.'),
    ('fees.reminder_overdue', 'A weekly reminder is due for an unpaid, overdue fee invoice.'),
    ('fees.reminder_escalation', 'A fee invoice is four weeks overdue and needs the bursar.')
  ) AS t(event_type, descr)
 WHERE to_regclass('public.cg_fee_invoice') IS NOT NULL
ON CONFLICT (event_type) DO NOTHING;

CREATE FUNCTION public.wf_fee_reminder_scan(p_now timestamptz DEFAULT now(), p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_row record;
  v_scanned integer := 0;
  v_skipped_paid integer := 0;
  v_emitted integer := 0;
  v_before bigint;
  v_after bigint;
BEGIN
  IF to_regclass('public.cg_fee_invoice') IS NULL THEN
    RETURN jsonb_build_object('scanned', 0, 'emitted', 0, 'skipped_paid', 0);
  END IF;
  SELECT count(*) INTO v_before FROM public.wf_event WHERE event_type LIKE 'fees.reminder\_%';
  FOR v_row IN
    SELECT i.id, i.school_id, i.amount_kobo, i.due_at, i.issued_at, r.rung, r.class, r.at, r.offset_days
      FROM public.cg_fee_invoice i
      JOIN public.wf_org_settings s ON s.org_id = i.school_id AND s.workflows_enabled
      CROSS JOIN LATERAL public.wf_fee_reminder_rungs(i.due_at) r
     WHERE i.due_at IS NOT NULL
       AND r.at <= p_now AND r.at > p_now - interval '36 hours'
       AND r.at >= i.issued_at
     ORDER BY r.at, i.id
     LIMIT v_limit
  LOOP
    v_scanned := v_scanned + 1;
    IF public.wf_fee_invoice_settled(v_row.id) THEN
      v_skipped_paid := v_skipped_paid + 1;
      CONTINUE;
    END IF;
    PERFORM public.wf_emit_event(
      v_row.school_id,
      CASE v_row.class WHEN 'week_start' THEN 'fees.reminder_week_start' WHEN 'week_end' THEN 'fees.reminder_week_end'
        WHEN 'due_day' THEN 'fees.reminder_due_day' WHEN 'overdue' THEN 'fees.reminder_overdue' ELSE 'fees.reminder_escalation' END,
      'cg_fee_invoice',
      'fees.reminder:' || v_row.id::text || ':' || v_row.rung,
      v_row.id::text,
      jsonb_build_object('invoice_id', v_row.id, 'amount_kobo', v_row.amount_kobo,
                         'due_at', to_char(v_row.due_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD'),
                         'offset_days', v_row.offset_days));
  END LOOP;
  SELECT count(*) INTO v_after FROM public.wf_event WHERE event_type LIKE 'fees.reminder\_%';
  v_emitted := v_after - v_before;
  RETURN jsonb_build_object('scanned', v_scanned, 'emitted', v_emitted, 'skipped_paid', v_skipped_paid);
END
$$;

-- Stop on payment: once an invoice is fully paid, every open reminder run for it ends and its drafts are cancelled
-- (wf_run_close_approvals cascades to approvals, drafts and steps).
CREATE FUNCTION public.wf_fee_reminder_stop_on_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF public.wf_fee_invoice_settled(NEW.invoice_id) THEN
    UPDATE public.wf_run r
       SET status = 'cancelled', finished_at = now(), error_code = 'fees.paid'
      FROM public.wf_event e
     WHERE r.event_id = e.id AND r.org_id = e.org_id
       AND e.event_type LIKE 'fees.reminder\_%' AND e.payload ->> 'invoice_id' = NEW.invoice_id::text
       AND r.status IN ('queued', 'running', 'waiting');
  END IF;
  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.wf_fee_reminder_rungs(timestamptz), public.wf_fee_invoice_settled(uuid),
  public.wf_fee_reminder_scan(timestamptz, integer), public.wf_fee_reminder_stop_on_payment()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wf_fee_reminder_scan(timestamptz, integer) TO service_role;

DO $$
BEGIN
  IF to_regclass('public.cg_fee_payment') IS NOT NULL THEN
    EXECUTE 'CREATE TRIGGER wf15a2_cg_fee_payment_stop AFTER INSERT ON public.cg_fee_payment FOR EACH ROW EXECUTE FUNCTION public.wf_fee_reminder_stop_on_payment()';
  END IF;
END $$;

COMMENT ON FUNCTION public.wf_fee_reminder_scan(timestamptz, integer) IS
  'WF-15a2 / ADR-136: emits due-date-relative fee reminder events (36-hour catch-up window, deduplicated). Not scheduled anywhere.';

COMMIT;
