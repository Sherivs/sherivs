-- =============================================================================
-- SHERIVS-015 — Privacy lockdown + RLS speed + integrity (24 Oct 2026).
-- Found by the Sherivs Simulation Lab (tools/sim-lab), validated there first.
--  1. RLS performance: helpers wrapped in scalar sub-selects (initplan, once
--     per query instead of once per row) + the indexes the policies need.
--  2. Published results are locked: teachers may only update/delete
--     unpublished rows.
--  3. Score sanity: CA + exam within 0..100 (NOT VALID: existing rows are not
--     re-checked until VALIDATE CONSTRAINT is run after a data review).
--  4. PRIVACY LOCKDOWN (critical): anon/authenticated lose column SELECT on
--     users.nin, account_number, salary, face_biometric, phone. Those fields
--     are served only by public.users_private_fields(uuid[]), which returns
--     a field only when the caller is entitled to it:
--       own record ............ every field
--       same-tenant admin/principal ... phone, account_number, salary
--       same-tenant bursar ............ phone, account_number
--       same-tenant hq ................ phone, salary
--       platform super admin .......... phone, account_number, salary
--     nin and face_biometric are never returned for anyone but the owner.
--     (SECURITY DEFINER is required: an INVOKER function cannot read a column
--     the caller has no privilege on. search_path is pinned to '' and every
--     row is re-filtered by the same tenant rule as the users RLS policy.)
--  5. Drop the legacy plaintext schools.paystack_secret_key column (keys live
--     in the vault / provider_credentials). Fails closed if any row still
--     holds a value.
-- NOTE: columns added to public.users later are NOT auto-readable by
-- anon/authenticated; grant them explicitly in their migration.
-- Rollback: database/supabase/rollbacks/20261024000220_sherivs_015_privacy_lockdown_rls_speed.sql
-- =============================================================================
BEGIN;

CREATE INDEX IF NOT EXISTS idx_students_user_id ON public.students (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_students_parent_id ON public.students (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_grades_school_published ON public.grades (school_id, is_published);
CREATE INDEX IF NOT EXISTS idx_grades_teacher ON public.grades (teacher_id);

DROP POLICY IF EXISTS grades_admin_all ON public.grades;
CREATE POLICY grades_admin_all ON public.grades FOR ALL TO authenticated
  USING ((school_id = (SELECT public.get_my_school_id()) AND (SELECT public.is_school_admin())) OR (SELECT public.is_super_admin()))
  WITH CHECK ((school_id = (SELECT public.get_my_school_id()) AND (SELECT public.is_school_admin())) OR (SELECT public.is_super_admin()));

DROP POLICY IF EXISTS grades_teacher_read ON public.grades;
CREATE POLICY grades_teacher_read ON public.grades FOR SELECT TO authenticated
  USING (school_id = (SELECT public.get_my_school_id()) AND (SELECT public.get_my_role()) = 'teacher');

DROP POLICY IF EXISTS grades_teacher_write ON public.grades;
CREATE POLICY grades_teacher_write ON public.grades FOR INSERT TO authenticated
  WITH CHECK (school_id = (SELECT public.get_my_school_id()) AND (SELECT public.get_my_role()) = 'teacher'
              AND teacher_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS grades_teacher_update ON public.grades;
CREATE POLICY grades_teacher_update ON public.grades FOR UPDATE TO authenticated
  USING (school_id = (SELECT public.get_my_school_id()) AND teacher_id = (SELECT auth.uid()) AND is_published IS NOT TRUE)
  WITH CHECK (school_id = (SELECT public.get_my_school_id()) AND teacher_id = (SELECT auth.uid()) AND is_published IS NOT TRUE);

DROP POLICY IF EXISTS grades_teacher_delete ON public.grades;
CREATE POLICY grades_teacher_delete ON public.grades FOR DELETE TO authenticated
  USING (school_id = (SELECT public.get_my_school_id()) AND teacher_id = (SELECT auth.uid()) AND is_published IS NOT TRUE);

DROP POLICY IF EXISTS grades_student_read ON public.grades;
CREATE POLICY grades_student_read ON public.grades FOR SELECT TO authenticated
  USING (is_published = true AND student_id = ANY (ARRAY(SELECT s.id FROM public.students s WHERE s.user_id = (SELECT auth.uid()))));

DROP POLICY IF EXISTS grades_parent_read ON public.grades;
CREATE POLICY grades_parent_read ON public.grades FOR SELECT TO authenticated
  USING (is_published = true AND student_id = ANY (ARRAY(SELECT m.student_id FROM public.parent_student_map m WHERE m.parent_id = (SELECT auth.uid()))));

ALTER TABLE public.grades DROP CONSTRAINT IF EXISTS grades_score_range;
ALTER TABLE public.grades ADD CONSTRAINT grades_score_range CHECK (
  (ca_score IS NULL OR ca_score >= 0) AND (exam_score IS NULL OR exam_score >= 0)
  AND coalesce(ca_score, 0) + coalesce(exam_score, 0) <= 100) NOT VALID;

-- students / fees policies: same logic, helpers wrapped as initplans (generated from the live policy text).
DROP POLICY IF EXISTS "students_read" ON public.students;
CREATE POLICY "students_read" ON public.students AS PERMISSIVE FOR SELECT TO authenticated
  USING (((SELECT public.is_super_admin()) OR ((school_id = (SELECT public.get_my_school_id())) AND (((SELECT public.my_active_role()) = ANY (ARRAY['admin'::text, 'principal'::text, 'bursar'::text, 'hq'::text, 'teacher'::text, 'driver'::text])) OR is_linked_to_student(id)))));

DROP POLICY IF EXISTS "students_write" ON public.students;
CREATE POLICY "students_write" ON public.students AS PERMISSIVE FOR ALL TO authenticated
  USING (((SELECT public.is_super_admin()) OR ((school_id = (SELECT public.get_my_school_id())) AND (((SELECT public.my_active_role()) = ANY (ARRAY['admin'::text, 'principal'::text])) OR (SELECT public.can_manage_admissions())))))
  WITH CHECK (((SELECT public.is_super_admin()) OR ((school_id = (SELECT public.get_my_school_id())) AND (((SELECT public.my_active_role()) = ANY (ARRAY['admin'::text, 'principal'::text])) OR (SELECT public.can_manage_admissions())))));

DROP POLICY IF EXISTS "fees_read" ON public.fees;
CREATE POLICY "fees_read" ON public.fees AS PERMISSIVE FOR SELECT TO authenticated
  USING (((SELECT public.is_super_admin()) OR ((school_id = (SELECT public.get_my_school_id())) AND (((SELECT public.my_active_role()) = ANY (ARRAY['admin'::text, 'principal'::text, 'bursar'::text, 'hq'::text, 'teacher'::text])) OR is_linked_to_student(student_id)))));

DROP POLICY IF EXISTS "fees_write" ON public.fees;
CREATE POLICY "fees_write" ON public.fees AS PERMISSIVE FOR ALL TO authenticated
  USING (((SELECT public.is_super_admin()) OR ((school_id = (SELECT public.get_my_school_id())) AND ((SELECT public.my_active_role()) = ANY (ARRAY['admin'::text, 'principal'::text, 'bursar'::text])))))
  WITH CHECK (((SELECT public.is_super_admin()) OR ((school_id = (SELECT public.get_my_school_id())) AND ((SELECT public.my_active_role()) = ANY (ARRAY['admin'::text, 'principal'::text, 'bursar'::text])))));

-- 4. Privacy lockdown ---------------------------------------------------------
REVOKE SELECT ON public.users FROM PUBLIC, anon, authenticated;
REVOKE SELECT (nin, account_number, salary, face_biometric, phone) ON public.users FROM PUBLIC, anon, authenticated;
DO $lock$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'users'
     AND column_name NOT IN ('nin', 'account_number', 'salary', 'face_biometric', 'phone');
  EXECUTE format('GRANT SELECT (%s) ON public.users TO anon, authenticated', cols);
END
$lock$;

CREATE OR REPLACE FUNCTION public.users_private_fields(p_ids uuid[])
RETURNS TABLE (id uuid, phone text, nin text, account_number text, salary numeric, face_biometric jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  WITH me AS (
    SELECT auth.uid() AS uid,
           public.get_my_school_id() AS tenant,
           coalesce(public.my_active_role(), public.get_my_role()) AS r,
           coalesce(public.is_super_admin(), false) AS sa
  )
  SELECT u.id,
    CASE WHEN u.id = me.uid OR me.sa OR (u.school_id = me.tenant AND me.r IN ('admin','principal','bursar','hq')) THEN u.phone END,
    CASE WHEN u.id = me.uid THEN u.nin END,
    CASE WHEN u.id = me.uid OR me.sa OR (u.school_id = me.tenant AND me.r IN ('admin','principal','bursar')) THEN u.account_number END,
    CASE WHEN u.id = me.uid OR me.sa OR (u.school_id = me.tenant AND me.r IN ('admin','principal','hq')) THEN u.salary::numeric END,
    CASE WHEN u.id = me.uid THEN u.face_biometric END
  FROM public.users u CROSS JOIN me
  WHERE me.uid IS NOT NULL
    AND u.id = ANY (p_ids)
    AND (u.id = me.uid OR me.sa OR u.school_id = me.tenant);
$fn$;
REVOKE ALL ON FUNCTION public.users_private_fields(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.users_private_fields(uuid[]) TO authenticated, service_role;
COMMENT ON FUNCTION public.users_private_fields(uuid[]) IS
  'SHERIVS-015: role-authorized access to sensitive user fields (phone/account/salary for entitled same-tenant roles; nin/face only to the owner).';

-- 5. Drop legacy plaintext provider secret column -------------------------------
DO $drop$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'schools' AND column_name = 'paystack_secret_key') THEN
    IF EXISTS (SELECT 1 FROM public.schools WHERE coalesce(paystack_secret_key, '') <> '') THEN
      RAISE EXCEPTION 'SHERIVS-015: schools.paystack_secret_key still holds values; move them to the vault first';
    END IF;
    ALTER TABLE public.schools DROP COLUMN paystack_secret_key;
  END IF;
END
$drop$;

COMMIT;
