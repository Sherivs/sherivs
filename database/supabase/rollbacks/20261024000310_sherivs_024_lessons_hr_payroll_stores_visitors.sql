-- Rollback SHERIVS-024. Drops only objects added by 024. staff_payroll rows written by payroll_compute stay (the table predates 024).
BEGIN;
DROP FUNCTION IF EXISTS public.visitor_check_out(uuid), public.visitor_check_in(uuid, text), public.visitor_preregister(text, text, text, uuid, date), public.pickup_authorise(uuid, text, text, text),
  public.asset_book_value(uuid, date), public.asset_update(uuid, text, text, uuid), public.asset_register(uuid, text, text, text, numeric, date, int, text, uuid),
  public.inventory_move(uuid, numeric, text, text, text), public.inventory_item_upsert(uuid, text, text, text, numeric, numeric),
  public.payroll_approve(uuid, int, int), public.payroll_compute(uuid, int, int), public.paye_annual(numeric, numeric, numeric, numeric, date),
  public.loan_decide(uuid, boolean), public.loan_request(numeric, numeric, text), public.salary_profile_set(uuid, numeric, numeric, numeric, numeric, numeric, boolean),
  public.appraisal_acknowledge(uuid, text), public.appraisal_review(uuid, jsonb), public.appraisal_self(uuid, jsonb), public.appraisal_open(uuid, uuid, uuid), public._scores_ok(jsonb, jsonb),
  public.lesson_note_review(uuid, boolean, text), public.lesson_note_submit(uuid, uuid), public.scheme_week_upsert(uuid, text, text, text, int, text, text[], text);
DROP TABLE IF EXISTS public.visitor_passes, public.authorised_pickups, public.asset_events, public.fixed_assets, public.inventory_moves, public.inventory_items,
  public.staff_loans, public.tax_bands, public.staff_salary_profiles, public.appraisals, public.appraisal_cycles, public.lesson_note_reviews, public.scheme_of_work;
COMMIT;
