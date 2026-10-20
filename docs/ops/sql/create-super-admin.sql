-- =============================================================================
-- SHERIVS — MAKE ONE ACCOUNT THE PLATFORM SUPER ADMIN. Paste into the SQL editor.
--
-- The app recognises a platform super admin by a row in public.super_admins
-- (public.is_super_admin() checks it; the identity resolver and app context
-- read it). id must equal the auth.users id.
--
-- 1. Sign up / sign in once with the real Sherivs company email.
-- 2. Replace BOTH placeholders below: the email, and the display name.
-- 3. Run. It refuses if the placeholder is still there or the account doesn't exist.
-- Safe to re-run (re-activates the same account).
-- =============================================================================
BEGIN;

CREATE TEMP TABLE sa_input ON COMMIT DROP AS
SELECT lower(btrim('REPLACE_WITH_COMPANY_EMAIL')) AS email,
       btrim('REPLACE_WITH_FULL_NAME')            AS full_name;

DO $guard$
DECLARE
  v_email text := (SELECT email FROM sa_input);
  v_name  text := (SELECT full_name FROM sa_input);
BEGIN
  IF v_email LIKE 'replace_with%' OR v_email NOT LIKE '%_@_%._%' THEN
    RAISE EXCEPTION 'STOP: put the real company email in place of REPLACE_WITH_COMPANY_EMAIL';
  END IF;
  IF v_name LIKE 'REPLACE_WITH%' OR length(v_name) < 2 THEN
    RAISE EXCEPTION 'STOP: put the display name in place of REPLACE_WITH_FULL_NAME';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = v_email) THEN
    RAISE EXCEPTION 'STOP: no account with that email yet; sign up first';
  END IF;
END
$guard$;

INSERT INTO public.super_admins (id, full_name, email, role, is_active)
SELECT u.id, i.full_name, i.email, 'super_admin', true
  FROM auth.users u JOIN sa_input i ON lower(u.email) = i.email
ON CONFLICT (id) DO UPDATE SET is_active = true, full_name = EXCLUDED.full_name;

COMMIT;

SELECT check_name, ok FROM (VALUES
  ('exactly one active super admin',
     (SELECT count(*) FROM public.super_admins WHERE is_active) = 1),
  ('super admin is a real auth account',
     EXISTS (SELECT 1 FROM public.super_admins s JOIN auth.users u ON u.id = s.id WHERE s.is_active))
) AS t(check_name, ok);
