-- ROLLOUT STEP 0 (docs/ops/ROLLOUT-SHERIVS-001-005.md). Renumbered twice: originally
-- 20261020000010, then 20261020000120 (.sql.phase2), now 20261015000005 so it can ship
-- FIRST and still sort BEFORE every SHERIVS release migration (db push refuses
-- out-of-order history). It must go out only after the app release that reads
-- public.schools with explicit column lists (SCHOOL_CLIENT_COLUMNS) is live: an app
-- that still selects schools.* would get 42501 on those reads.
-- =============================================================================
-- SHERIVS-002 — public.schools: close the plaintext paystack_secret_key read
-- =============================================================================
-- Status: AUTHORED, NOT APPLIED outside the local disposable stack used for the
-- SHERIVS-002 cross-tenant harness (tests/integration/sherivs-002-cross-tenant.local.sql).
-- Do not apply to a hosted/linked project without the coordinator's serialized
-- canonical apply and an explicit human authorization record.
--
-- Finding (harness run 1): the policy "Anyone can read active schools" lets
-- anon and authenticated read EVERY column of every active school, including
-- the legacy plaintext column paystack_secret_key. The earlier hardening
-- migration 20260819000000 issued REVOKE SELECT (paystack_secret_key) but that
-- is a no-op while a TABLE-level SELECT grant exists (a column revoke cannot
-- subtract from a table grant), so the secret stayed readable.
--
-- Fix: replace the table-level SELECT grant with a column-level grant that
-- covers every current column EXCEPT paystack_secret_key. The grant list is
-- generated from information_schema.columns so it cannot drift from the real
-- table. RLS policies are unchanged (the public site still reads active
-- schools; the secret column is simply not selectable by client roles).
--
-- Consequences / operating rules:
--   * UPDATE privileges are NOT touched.
--   * Browser/anon clients must select explicit columns. `select("*")` (which
--     PostgREST expands to table.*) now fails with 42501 for client roles.
--     Server code using service_role / supabaseAdmin is unaffected.
--   * NEW COLUMNS ADDED LATER ARE NOT READABLE BY anon/authenticated until a
--     migration grants them explicitly: GRANT SELECT (col) ON public.schools
--     TO anon, authenticated;  Never grant secret columns.
--
-- Idempotent: REVOKE then regrant is a complete re-assertion.
-- =============================================================================

DO $schools_column_privilege$
DECLARE
  v_cols text;
BEGIN
  IF to_regclass('public.schools') IS NULL THEN
    RAISE EXCEPTION 'public.schools missing; cannot assert column privileges';
  END IF;

  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'schools'
     AND column_name <> 'paystack_secret_key';

  IF v_cols IS NULL OR position('id' IN v_cols) = 0 THEN
    RAISE EXCEPTION 'public.schools column list could not be resolved';
  END IF;

  -- Removes the table-level grant and any column-level SELECT grants.
  REVOKE SELECT ON public.schools FROM anon, authenticated;

  EXECUTE format('GRANT SELECT (%s) ON public.schools TO anon, authenticated', v_cols);
END
$schools_column_privilege$;

-- Post-apply verification (expect false / false, then true / true):
--   SELECT has_column_privilege('anon','public.schools','paystack_secret_key','SELECT'),
--          has_column_privilege('authenticated','public.schools','paystack_secret_key','SELECT');
--   SELECT has_column_privilege('anon','public.schools','name','SELECT'),
--          has_column_privilege('authenticated','public.schools','name','SELECT');
