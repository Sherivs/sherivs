-- M9B: read-only list of a student's open fee invoices, for the cash-payment picker.
-- record_cash_payment (M9B cash path) refuses when a student has more than one open invoice for the
-- term; a cashier needs to see which invoices are open and how much is outstanding. This function only
-- reads. It uses the same permission as recording cash (payments.record_cash) in the same school and
-- computes the outstanding balance the same way the ledger does (accounts_receivable debit minus credit).
CREATE OR REPLACE FUNCTION public.cash_open_invoices_for_student(
  p_school uuid, p_student uuid, p_year text DEFAULT NULL, p_term text DEFAULT NULL
) RETURNS TABLE (
  invoice_id uuid, schedule_id uuid, schedule_name text, academic_year text, term text,
  campus_id uuid, amount_kobo bigint, outstanding_kobo bigint, due_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NOT public.scholar_can(p_school, 'payments.record_cash') THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.students st WHERE st.id = p_student AND st.school_id = p_school) THEN
    RAISE EXCEPTION 'student not in this school' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT o.id, o.schedule_id, o.name, o.academic_year, o.term, o.campus_id, o.amount_kobo, o.outstanding, o.due_at
    FROM (
      SELECT i.id, i.schedule_id, s.label AS name, s.academic_year, s.term, i.campus_id, i.amount_kobo, i.due_at,
             coalesce((SELECT sum(l.debit_kobo - l.credit_kobo)
                         FROM public.cg_fee_ledger_posting p JOIN public.cg_fee_ledger_line l ON l.posting_id = p.id
                        WHERE p.invoice_id = i.id AND l.account_code = 'accounts_receivable'), 0)::bigint AS outstanding
        FROM public.cg_fee_invoice i
        JOIN public.cg_fee_schedule s ON s.id = i.schedule_id
       WHERE i.school_id = p_school AND i.subject_ref = p_student::text
         AND (p_year IS NULL OR s.academic_year = p_year)
         AND (p_term IS NULL OR s.term = p_term)
    ) o
   WHERE o.outstanding > 0
   ORDER BY o.due_at, o.id
   LIMIT 50;
END $$;
REVOKE ALL ON FUNCTION public.cash_open_invoices_for_student(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_open_invoices_for_student(uuid, uuid, text, text) TO authenticated, service_role;
