-- Track E (load test) bottleneck fixes found with tools/sim-lab/load/flows.js at 3,000 / 5,000 VUs.
-- Local sim-lab verified; NOT applied to prod. Index builds are small at current prod volumes; on a large
-- prod table run the CREATE INDEX statements CONCURRENTLY outside a transaction instead.

-- 1) Linked-student set now matches is_linked_to_student() exactly (incl. the parent_email fallback), so policies can
--    use one initplan array instead of a per-row SECURITY DEFINER call.
create or replace function public.my_linked_student_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  -- UNION of indexed lookups (students.user_id / parent_id, parent_student_map.parent_id); the parent_email fallback only
  -- runs for parents. An OR across these inside one WHERE forced a scan of the whole school's students (36 ms at 12k).
  with me as (select auth.uid() as uid, public.get_my_school_id() as school, public.my_active_role() as role),
  ids as (
    select s.id from public.students s, me where s.user_id = me.uid
    union select s.id from public.students s, me where s.parent_id = me.uid
    union select m.student_id from public.parent_student_map m, me where m.parent_id = me.uid
    union select s.id from public.students s, me, public.users u
     where me.role = 'parent' and u.id = me.uid and u.email is not null
       and s.school_id = me.school and lower(s.parent_email) = lower(u.email))
  select coalesce(array_agg(s.id), '{}') from public.students s, me
   where me.uid is not null and s.school_id = me.school and s.id in (select id from ids)
$$;
revoke execute on function public.my_linked_student_ids() from public, anon;
grant execute on function public.my_linked_student_ids() to authenticated;

-- 2) fees_read: student/parent fee view was 1.06 s (is_linked_to_student per row over a 12k-student school) -> initplan array.
drop policy if exists fees_read on public.fees;
create policy fees_read on public.fees for select to authenticated using (
  (select public.is_super_admin())
  or (school_id = (select public.get_my_school_id())
      and ((select public.my_active_role()) = any (array['admin','principal','bursar','hq','teacher'])
           or student_id = any ((select public.my_linked_student_ids())::uuid[]))));

-- 3) Attendance: class register (class_id, date) and per-student history; school/day roll-ups.
create index if not exists idx_attendance_class_date on public.attendance (class_id, date);
create index if not exists idx_attendance_school_date on public.attendance (school_id, date);

-- Parent e-mail fallback lookup.
create index if not exists idx_students_school_parent_email on public.students (school_id, lower(parent_email)) where parent_email is not null;

-- 4) CBT: a student's attempts and a class's tests.
create index if not exists idx_cbt_attempts_student on public.cbt_attempts (student_id, test_id);
create index if not exists idx_cbt_tests_class on public.cbt_tests (class_id, closes_at);

-- 5) Per-row helper calls: wrap get_my_school_id()/is_super_admin() in scalar sub-selects (one initplan per statement)
--    so `school_id = $1` becomes index-usable. Semantics unchanged.
do $$
declare r record;
begin
  for r in select tablename, policyname, qual, with_check from pg_policies
            where schemaname = 'public'
              and (tablename, policyname) in (('attendance','tenant_all_attendance'),('clinic_visits','clinic_visits_school_isolation'),
                ('discipline_records','discipline_records_school_isolation'),('hostel_allocations','hostel_allocations_school_isolation'),
                ('hostel_attendance','hostel_attendance_school_isolation'),('hostel_rooms','hostel_rooms_school_isolation'),
                ('library_books','library_books_school_isolation'),('library_borrowings','library_borrowings_school_isolation'),
                ('staff_leave','staff_leave_school_isolation'),('staff_payroll','staff_payroll_school_isolation'),
                ('users','Same school users can see each other'))
  loop
    execute format('alter policy %I on public.%I using (%s)', r.policyname, r.tablename,
      replace(replace(r.qual, 'get_my_school_id()', '(select public.get_my_school_id())'), 'is_super_admin()', '(select public.is_super_admin())'));
  end loop;
end $$;
