-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- Renumbered from 20261117000100 to 20261117002000 on 2026-11-17: after the latest version applied in production.
-- M0B: pin an empty search_path on the three policy helper functions.
-- Origin: Claude Code agent, mission E-003 (M0 follow-up 2 of the 17 Nov 2026 engineering prompt).
-- Today they run with search_path = public (read-only query on production, 2026-11-17). Row-level
-- security policies on most tables call them, and anonymous visitors may execute them, so they
-- should not resolve any name through a search path. Their bodies already name every relation
-- with its schema; they are restated here unchanged so the result does not depend on what was
-- there before. CREATE OR REPLACE keeps each function's owner and privileges.
-- Body md5 before (pg_get_functiondef): get_my_role 80adec9e…, get_my_school_id 8600b5a9…,
-- is_school_admin 7dbad227….

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    (SELECT m.role
       FROM public.organization_memberships m
      WHERE m.user_id = u.id AND m.is_active = true
      ORDER BY m.is_primary DESC, m.created_at ASC
      LIMIT 1),
    u.role)
  FROM public.users u
  WHERE u.id = auth.uid() AND u.is_active = true;
$function$;

CREATE OR REPLACE FUNCTION public.get_my_school_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    (SELECT m.school_id
       FROM public.organization_memberships m
      WHERE m.user_id = u.id AND m.is_active = true
      ORDER BY m.is_primary DESC, m.created_at ASC
      LIMIT 1),
    u.school_id)
  FROM public.users u
  WHERE u.id = auth.uid() AND u.is_active = true;
$function$;

CREATE OR REPLACE FUNCTION public.is_school_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $function$ SELECT COALESCE(public.get_my_role() IN ('admin', 'principal'), false) $function$;

-- Verification after an apply (read-only; expected: three rows, each search_path=""):
--   SELECT proname, proconfig[1] FROM pg_proc WHERE pronamespace = 'public'::regnamespace
--    AND proname IN ('get_my_role', 'get_my_school_id', 'is_school_admin');
