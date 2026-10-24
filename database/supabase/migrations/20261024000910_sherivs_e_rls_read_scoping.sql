-- Track E (QA/Security) HIGH finding: several tables carry a PERMISSIVE `school_id = get_my_school_id()` policy
-- for ALL commands. Writes are already narrowed by RESTRICTIVE sv4_* policies, but READS are not, so any
-- signed-in student/parent/driver/alumni could read the whole school's attendance, clinic visits (health data),
-- discipline records, hostel and library records, staff payroll and staff leave.
-- Fix: RESTRICTIVE SELECT policies that keep staff access and limit everyone else to their own / linked rows.
-- Local sim-lab verified (scenarios + k6); NOT applied to prod.

-- Students the caller may see as themselves or as a parent/guardian (one evaluation per statement via initplan).
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

do $$
declare t text;
begin
  -- student-centred records: staff see the school's rows (school match still required by the permissive policy)
  foreach t in array array['attendance','clinic_visits','discipline_records','hostel_allocations','hostel_attendance','library_borrowings'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists e_read_scope on public.%I', t);
    execute format($p$create policy e_read_scope on public.%I as restrictive for select to public using (
        (select public.is_super_admin())
        or (select public.my_active_role()) = any (array['admin','principal','bursar','hq','teacher'])
        or student_id = any ((select public.my_linked_student_ids())::uuid[]))$p$, t);
  end loop;
  -- staff HR records: management and the staff member themself only
  foreach t in array array['staff_payroll','staff_leave'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists e_read_scope on public.%I', t);
    execute format($p$create policy e_read_scope on public.%I as restrictive for select to public using (
        (select public.is_super_admin())
        or (select public.my_active_role()) = any (array['admin','principal','bursar','hq'])
        or user_id = (select auth.uid()))$p$, t);
  end loop;
end $$;
