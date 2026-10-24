-- =============================================================================
-- SHERIVS-017 — Nigerian education role & permission catalog (NOT APPLIED TO PRODUCTION).
-- Validated on the isolated sim stack (tools/sim-lab). Owner approval required before prod.
--  * Catalog roles (system, from tools/role-catalog/catalog.py) -> role template ->
--    MANDATORY permissions (locked, DB-enforced) + OPTIONAL permissions (org toggles),
--    default scope, data-sensitivity ceiling, approval limit, hardcoded guardrails.
--  * Custom roles per organisation inherit the base role's template (all mandatory
--    permissions and guardrails) and can add NON-protected permissions/context.
--  * Protected permissions can only be held through a catalog role that declares them;
--    no org toggle, custom grant or custom role can introduce one.
--  * A user can hold many roles; effective permissions = union. Separation-of-duty is
--    enforced on assignment (conflicting role pairs) and on action (payroll, expenses).
--  * Every role/permission change is written to audit_logs (bridged to audit_chain, 016).
--  * All writes go through SECURITY DEFINER RPCs; tables are read-only to API roles.
-- Rollback: database/supabase/rollbacks/20261024000240_sherivs_017_role_permission_catalog.sql
-- =============================================================================
BEGIN;

-- 1. Catalog tables ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permission_catalog (
  code text PRIMARY KEY, module text NOT NULL, label text NOT NULL,
  sensitivity text NOT NULL CHECK (sensitivity IN ('public','internal','confidential','restricted')),
  protected boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS public.role_guardrail_catalog (code text PRIMARY KEY, description text NOT NULL);
CREATE TABLE IF NOT EXISTS public.role_templates (
  code text PRIMARY KEY,
  default_scope text NOT NULL CHECK (default_scope IN ('org','campus','faculty','department','class','self')),
  data_sensitivity text NOT NULL CHECK (data_sensitivity IN ('public','internal','confidential','restricted')),
  approval_limit_ngn numeric(14,2),
  guardrails text[] NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS public.role_template_permissions (
  template_code text NOT NULL REFERENCES public.role_templates(code),
  permission_code text NOT NULL REFERENCES public.permission_catalog(code),
  kind text NOT NULL CHECK (kind IN ('mandatory','optional')),
  default_on boolean NOT NULL DEFAULT true,
  PRIMARY KEY (template_code, permission_code));
CREATE TABLE IF NOT EXISTS public.role_catalog (
  code text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  template_code text NOT NULL REFERENCES public.role_templates(code),
  institution_types text[] NOT NULL DEFAULT '{}',
  org_id uuid REFERENCES public.schools(id) ON DELETE CASCADE,       -- NULL = system catalog role
  base_role_code text REFERENCES public.role_catalog(code),          -- custom roles only
  description text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((org_id IS NULL AND base_role_code IS NULL) OR (org_id IS NOT NULL AND base_role_code IS NOT NULL)));
CREATE INDEX IF NOT EXISTS role_catalog_org_idx ON public.role_catalog (org_id) WHERE org_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.sod_template_conflicts (
  template_a text NOT NULL REFERENCES public.role_templates(code), template_b text NOT NULL REFERENCES public.role_templates(code),
  PRIMARY KEY (template_a, template_b));
CREATE TABLE IF NOT EXISTS public.sod_permission_rules (
  permission_a text NOT NULL REFERENCES public.permission_catalog(code), permission_b text NOT NULL REFERENCES public.permission_catalog(code),
  description text NOT NULL, PRIMARY KEY (permission_a, permission_b));

-- 2. Per-organisation configuration and assignments -----------------------------------
CREATE TABLE IF NOT EXISTS public.org_role_permission_settings (
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES public.role_catalog(code) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES public.permission_catalog(code),
  enabled boolean NOT NULL,
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, role_code, permission_code));
CREATE TABLE IF NOT EXISTS public.org_role_custom_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES public.role_catalog(code) ON DELETE CASCADE,
  permission_code text REFERENCES public.permission_catalog(code),
  custom_key text,                       -- organisation-defined permission/context key
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (permission_code IS NOT NULL OR custom_key IS NOT NULL));
CREATE TABLE IF NOT EXISTS public.user_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES public.role_catalog(code),
  scope_type text NOT NULL DEFAULT 'org' CHECK (scope_type IN ('org','campus','faculty','department','class','self')),
  scope_ref text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  assigned_by uuid, started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz, ended_by uuid);
CREATE UNIQUE INDEX IF NOT EXISTS user_role_assignments_active_uniq
  ON public.user_role_assignments (org_id, user_id, role_code, scope_type, coalesce(scope_ref, '')) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS user_role_assignments_user_idx ON public.user_role_assignments (user_id, org_id) WHERE status = 'active';


-- Seed (generated) ------------------------------------------------------------------
-- >>> generated by tools/role-catalog/catalog.py (do not hand-edit) >>>
INSERT INTO public.permission_catalog (code, module, label, sensitivity, protected) VALUES
  ('self.view_own','self','View own profile, results, fees and timetable','internal',false),
  ('children.view','self','View own children''s records','confidential',false),
  ('ai_tutor.use','learning','Use the AI tutor within plan limits','internal',false),
  ('students.view','students','View student list and basic profile','internal',false),
  ('students.create','students','Enrol / create students','internal',false),
  ('students.edit','students','Edit student profile','internal',false),
  ('students.delete','students','Delete or archive a student','confidential',true),
  ('students.view_sensitive','students','View NIN, medical and guardian contact data','restricted',true),
  ('students.transfer','students','Transfer or withdraw a student','confidential',true),
  ('admissions.view','admissions','View applications','internal',false),
  ('admissions.process','admissions','Screen, interview and score applicants','internal',false),
  ('admissions.offer','admissions','Issue or revoke admission offers','confidential',true),
  ('classes.manage','academics','Create classes, arms, sections and houses','internal',false),
  ('timetable.view','academics','View timetables','public',false),
  ('timetable.manage','academics','Build and publish timetables','internal',false),
  ('curriculum.manage','academics','Manage schemes of work and course catalogue','internal',false),
  ('lesson_notes.submit','academics','Write and submit lesson notes','internal',false),
  ('lesson_notes.approve','academics','Review and approve lesson notes','internal',false),
  ('attendance.take','attendance','Take attendance for assigned classes','internal',false),
  ('attendance.view','attendance','View attendance reports','internal',false),
  ('attendance.edit_past','attendance','Correct attendance after the day closes','confidential',true),
  ('grades.enter','results','Enter CA and exam scores for assigned subjects','confidential',false),
  ('grades.view','results','View results in scope','confidential',false),
  ('grades.approve','results','Moderate / approve results before publishing','confidential',true),
  ('results.publish','results','Publish results to students and parents','confidential',true),
  ('results.unpublish','results','Withdraw or amend published results','restricted',true),
  ('transcripts.issue','results','Issue transcripts, statements and certificates','restricted',true),
  ('course_reg.approve','results','Approve course registration (level adviser)','internal',false),
  ('exams.schedule','exams','Schedule exams, venues and seating','internal',false),
  ('exams.invigilate','exams','Invigilate and file exam incident reports','internal',false),
  ('exams.records','exams','Maintain official exam records (Exams & Records)','restricted',true),
  ('cbt.manage','exams','Build question banks and run CBT sessions','confidential',false),
  ('malpractice.decide','exams','Decide exam malpractice cases','restricted',true),
  ('fees.view','finance','View fee bills and balances in scope','confidential',false),
  ('fees.manage_plans','finance','Create fee plans and bills','confidential',false),
  ('payments.record_cash','finance','Record offline / cash payments','confidential',true),
  ('payments.refund','finance','Approve refunds','restricted',true),
  ('payments.reconcile','finance','Reconcile Paystack and bank settlements','confidential',false),
  ('wallet.view','finance','View the school wallet','confidential',false),
  ('wallet.topup','finance','Top up the school wallet','confidential',true),
  ('expenses.create','finance','Raise expenses / payment vouchers','confidential',false),
  ('expenses.approve','finance','Approve expenses within approval limit','restricted',true),
  ('budget.manage','finance','Prepare and manage budgets','confidential',false),
  ('reports.financial','finance','View financial reports','confidential',false),
  ('payroll.view_own','payroll','View own payslips','confidential',false),
  ('payroll.prepare','payroll','Prepare payroll runs','restricted',true),
  ('payroll.approve','payroll','Approve payroll runs','restricted',true),
  ('payroll.view_all','payroll','View every staff salary','restricted',true),
  ('hr.staff_view','hr','View staff directory','internal',false),
  ('hr.staff_manage','hr','Hire, edit and exit staff records','confidential',true),
  ('hr.view_sensitive','hr','View staff NIN, bank and next-of-kin data','restricted',true),
  ('hr.leave_request','hr','Request leave','internal',false),
  ('hr.leave_approve','hr','Approve leave for direct reports','internal',false),
  ('hr.appraisal','hr','Conduct staff appraisals','confidential',false),
  ('library.circulate','library','Issue and return library items','internal',false),
  ('library.catalog','library','Catalogue and weed library stock','internal',false),
  ('hostel.allocate','hostel','Allocate hostel rooms and bed spaces','internal',false),
  ('hostel.roll_call','hostel','Take hostel roll call and exeat','internal',false),
  ('health.records_view','health','View clinic and medical records','restricted',true),
  ('health.records_edit','health','Record clinic visits and treatment','restricted',true),
  ('counselling.notes','welfare','Keep confidential counselling notes','restricted',true),
  ('welfare.pastoral','welfare','Pastoral / chaplaincy / welfare follow-up','confidential',false),
  ('discipline.record','discipline','Record a discipline incident','internal',false),
  ('discipline.decide','discipline','Decide suspension / expulsion','restricted',true),
  ('transport.manage','transport','Manage routes, buses and drivers','internal',false),
  ('transport.track','transport','Track buses live','internal',false),
  ('transport.driver_trip','transport','Run own trip manifest and check-ins','internal',false),
  ('security.gate_log','security','Log gate entry/exit and pick-ups','internal',false),
  ('visitors.manage','security','Register visitors and issue gate passes','internal',false),
  ('security.incident','security','File security incidents','confidential',false),
  ('inventory.manage','operations','Manage stores and inventory','internal',false),
  ('procurement.request','operations','Raise purchase requisitions','internal',false),
  ('procurement.approve','operations','Approve purchase orders','restricted',true),
  ('assets.manage','operations','Asset register and maintenance','internal',false),
  ('works.requests','operations','Handle works / maintenance requests','internal',false),
  ('catering.manage','operations','Menus, feeding and kitchen stock','internal',false),
  ('comms.send_class','communication','Message own classes / parents in scope','internal',false),
  ('comms.broadcast','communication','School-wide broadcast (SMS/WhatsApp/email)','confidential',true),
  ('news.publish','communication','Publish news and events','internal',false),
  ('reports.academic','analytics','Academic performance reports','confidential',false),
  ('analytics.institution','analytics','Institution-wide dashboards','confidential',false),
  ('regulator.read_aggregate','regulator','Read anonymised aggregate statistics only','internal',false),
  ('audit.view','governance','View the audit trail','restricted',true),
  ('roles.assign','governance','Assign roles to people','restricted',true),
  ('roles.configure','governance','Toggle optional permissions on roles','restricted',true),
  ('settings.manage','governance','Manage organisation settings','restricted',true),
  ('ndpa.dsar','governance','Handle NDPA data-subject requests and breach log','restricted',true),
  ('ict.support','ict','First-line ICT support','internal',false),
  ('ict.reset_access','ict','Reset passwords and MFA for users','restricted',true),
  ('siwes.manage','tertiary','Manage SIWES / IT placements and logbooks','internal',false),
  ('research.manage','tertiary','Research grants and projects','internal',false),
  ('alumni.manage','community','Alumni records and donations','confidential',false),
  ('pta.manage','community','PTA levies, meetings and minutes','confidential',false),
  ('governance.minutes','governance','Council / board papers and minutes','confidential',false)
ON CONFLICT (code) DO UPDATE SET module=EXCLUDED.module, label=EXCLUDED.label, sensitivity=EXCLUDED.sensitivity, protected=EXCLUDED.protected;
INSERT INTO public.role_guardrail_catalog (code, description) VALUES
  ('tenant_isolation','Only ever sees data of organisations where the person holds an active role (RLS).'),
  ('audited','Every action on protected permissions is written to the append-only audit chain.'),
  ('own_classes_only','Teaching staff only see and grade students in classes/subjects assigned to them.'),
  ('self_only','Students only see their own records.'),
  ('own_children_only','Parents only see children linked to them.'),
  ('no_self_payroll_approval','Cannot approve a payroll line for yourself or one you prepared.'),
  ('no_self_expense_approval','Cannot approve an expense you raised; amount must be within the approval limit.'),
  ('no_self_role_grant','Cannot assign roles to yourself or toggle permissions on a role you hold.'),
  ('no_published_result_edit','Cannot change a published result; amendments go through results.unpublish with a reason.'),
  ('aggregate_only','Regulators and external bodies only see anonymised aggregates, never person-level data.'),
  ('no_sensitive_by_default','Restricted personal data (NIN, bank, biometrics, health) is masked unless the role carries the restricted permission.'),
  ('auditor_independence','Auditors are read-only and cannot hold any role that creates or approves money movements.'),
  ('driver_own_trip','Drivers and attendants only see their own trip manifest.')
ON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description;
INSERT INTO public.role_templates (code, default_scope, data_sensitivity, approval_limit_ngn, guardrails) VALUES
  ('regulator','org','internal',NULL,ARRAY['tenant_isolation','audited','aggregate_only']::text[]),
  ('regulator_inspector','org','internal',NULL,ARRAY['tenant_isolation','audited','aggregate_only']::text[]),
  ('governance_board','org','confidential',NULL,ARRAY['tenant_isolation','audited','auditor_independence']::text[]),
  ('proprietor','org','restricted',50000000,ARRAY['tenant_isolation','audited','no_self_role_grant','no_self_payroll_approval','no_self_expense_approval']::text[]),
  ('head_of_institution','org','restricted',5000000,ARRAY['tenant_isolation','audited','no_self_role_grant','no_self_payroll_approval','no_self_expense_approval','no_published_result_edit']::text[]),
  ('deputy_academic','org','confidential',500000,ARRAY['tenant_isolation','audited','no_published_result_edit']::text[]),
  ('deputy_admin','org','confidential',500000,ARRAY['tenant_isolation','audited']::text[]),
  ('admissions','org','confidential',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('registrar','org','restricted',1000000,ARRAY['tenant_isolation','audited','no_published_result_edit']::text[]),
  ('exams_records','org','restricted',NULL,ARRAY['tenant_isolation','audited','no_published_result_edit']::text[]),
  ('exams_officer','department','confidential',NULL,ARRAY['tenant_isolation','audited','no_published_result_edit']::text[]),
  ('cbt','org','confidential',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('dean','faculty','confidential',500000,ARRAY['tenant_isolation','audited','no_published_result_edit']::text[]),
  ('hod','department','confidential',200000,ARRAY['tenant_isolation','audited','no_published_result_edit']::text[]),
  ('level_adviser','class','confidential',NULL,ARRAY['tenant_isolation','audited','own_classes_only']::text[]),
  ('teacher','class','confidential',NULL,ARRAY['tenant_isolation','audited','own_classes_only','no_published_result_edit','no_sensitive_by_default']::text[]),
  ('form_teacher','class','confidential',NULL,ARRAY['tenant_isolation','audited','own_classes_only','no_published_result_edit','no_sensitive_by_default']::text[]),
  ('teaching_support','class','internal',NULL,ARRAY['tenant_isolation','audited','own_classes_only','no_sensitive_by_default']::text[]),
  ('early_years_carer','class','confidential',NULL,ARRAY['tenant_isolation','audited','own_classes_only','no_sensitive_by_default']::text[]),
  ('lab_workshop','department','internal',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('bursar','org','restricted',2000000,ARRAY['tenant_isolation','audited','no_self_payroll_approval','no_self_expense_approval','no_sensitive_by_default']::text[]),
  ('accountant','org','confidential',NULL,ARRAY['tenant_isolation','audited','no_self_expense_approval']::text[]),
  ('cashier','campus','confidential',NULL,ARRAY['tenant_isolation','audited','no_self_expense_approval']::text[]),
  ('payroll','org','restricted',NULL,ARRAY['tenant_isolation','audited','no_self_payroll_approval']::text[]),
  ('auditor','org','restricted',NULL,ARRAY['tenant_isolation','audited','auditor_independence']::text[]),
  ('procurement','org','internal',1000000,ARRAY['tenant_isolation','audited','no_self_expense_approval']::text[]),
  ('store','campus','internal',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('hr','org','restricted',NULL,ARRAY['tenant_isolation','audited','no_self_role_grant','no_self_payroll_approval']::text[]),
  ('admin_officer','org','internal',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('pr','org','internal',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('legal','org','confidential',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('librarian','org','internal',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('library_staff','campus','internal',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('hostel_head','campus','confidential',NULL,ARRAY['tenant_isolation','audited','no_sensitive_by_default']::text[]),
  ('house_staff','class','confidential',NULL,ARRAY['tenant_isolation','audited','own_classes_only','no_sensitive_by_default']::text[]),
  ('health','org','restricted',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('counsellor','org','restricted',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('chaplaincy','org','internal',NULL,ARRAY['tenant_isolation','audited','no_sensitive_by_default']::text[]),
  ('student_affairs','org','confidential',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('security_head','org','confidential',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('security_staff','campus','internal',NULL,ARRAY['tenant_isolation','audited','no_sensitive_by_default']::text[]),
  ('transport_head','org','internal',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('driver','self','internal',NULL,ARRAY['tenant_isolation','audited','driver_own_trip','no_sensitive_by_default']::text[]),
  ('works','campus','internal',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('support_staff','self','internal',NULL,ARRAY['tenant_isolation','audited','no_sensitive_by_default']::text[]),
  ('catering','campus','internal',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('ict_head','org','restricted',NULL,ARRAY['tenant_isolation','audited','no_self_role_grant']::text[]),
  ('ict_staff','campus','internal',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('data_protection','org','restricted',NULL,ARRAY['tenant_isolation','audited','auditor_independence']::text[]),
  ('siwes','faculty','confidential',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('research','faculty','internal',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('alumni','org','confidential',NULL,ARRAY['tenant_isolation','audited']::text[]),
  ('pta','org','confidential',NULL,ARRAY['tenant_isolation','audited','own_children_only']::text[]),
  ('parent','self','confidential',NULL,ARRAY['tenant_isolation','audited','own_children_only']::text[]),
  ('student','self','internal',NULL,ARRAY['tenant_isolation','audited','self_only']::text[]),
  ('student_leader','self','internal',NULL,ARRAY['tenant_isolation','audited','self_only']::text[])
ON CONFLICT (code) DO UPDATE SET default_scope=EXCLUDED.default_scope, data_sensitivity=EXCLUDED.data_sensitivity, approval_limit_ngn=EXCLUDED.approval_limit_ngn, guardrails=EXCLUDED.guardrails;
INSERT INTO public.role_template_permissions (template_code, permission_code, kind, default_on) VALUES
  ('regulator','regulator.read_aggregate','mandatory',true),
  ('regulator','timetable.view','optional',true),
  ('regulator','reports.academic','optional',false),
  ('regulator_inspector','regulator.read_aggregate','mandatory',true),
  ('regulator_inspector','attendance.view','mandatory',true),
  ('regulator_inspector','reports.academic','optional',true),
  ('regulator_inspector','lesson_notes.approve','optional',false),
  ('governance_board','governance.minutes','mandatory',true),
  ('governance_board','analytics.institution','mandatory',true),
  ('governance_board','reports.financial','mandatory',true),
  ('governance_board','reports.academic','optional',true),
  ('governance_board','audit.view','optional',true),
  ('proprietor','analytics.institution','mandatory',true),
  ('proprietor','reports.financial','mandatory',true),
  ('proprietor','reports.academic','mandatory',true),
  ('proprietor','governance.minutes','mandatory',true),
  ('proprietor','audit.view','mandatory',true),
  ('proprietor','self.view_own','mandatory',true),
  ('proprietor','payroll.view_own','mandatory',true),
  ('proprietor','hr.leave_request','mandatory',true),
  ('proprietor','hr.staff_view','mandatory',true),
  ('proprietor','timetable.view','mandatory',true),
  ('proprietor','roles.assign','optional',true),
  ('proprietor','settings.manage','optional',true),
  ('proprietor','wallet.view','optional',true),
  ('proprietor','expenses.approve','optional',true),
  ('proprietor','payroll.approve','optional',true),
  ('proprietor','wallet.topup','optional',false),
  ('head_of_institution','roles.assign','mandatory',true),
  ('head_of_institution','roles.configure','mandatory',true),
  ('head_of_institution','settings.manage','mandatory',true),
  ('head_of_institution','analytics.institution','mandatory',true),
  ('head_of_institution','reports.academic','mandatory',true),
  ('head_of_institution','audit.view','mandatory',true),
  ('head_of_institution','results.publish','mandatory',true),
  ('head_of_institution','students.view','mandatory',true),
  ('head_of_institution','hr.staff_manage','mandatory',true),
  ('head_of_institution','self.view_own','mandatory',true),
  ('head_of_institution','payroll.view_own','mandatory',true),
  ('head_of_institution','hr.leave_request','mandatory',true),
  ('head_of_institution','hr.staff_view','mandatory',true),
  ('head_of_institution','timetable.view','mandatory',true),
  ('head_of_institution','expenses.approve','optional',true),
  ('head_of_institution','admissions.offer','optional',true),
  ('head_of_institution','discipline.decide','optional',true),
  ('head_of_institution','comms.broadcast','optional',true),
  ('head_of_institution','students.view_sensitive','optional',true),
  ('head_of_institution','reports.financial','optional',true),
  ('head_of_institution','lesson_notes.approve','optional',true),
  ('head_of_institution','grades.approve','optional',true),
  ('head_of_institution','payroll.approve','optional',true),
  ('head_of_institution','wallet.topup','optional',true),
  ('head_of_institution','results.unpublish','optional',false),
  ('head_of_institution','payroll.view_all','optional',false),
  ('deputy_academic','reports.academic','mandatory',true),
  ('deputy_academic','grades.approve','mandatory',true),
  ('deputy_academic','lesson_notes.approve','mandatory',true),
  ('deputy_academic','timetable.manage','mandatory',true),
  ('deputy_academic','students.view','mandatory',true),
  ('deputy_academic','self.view_own','mandatory',true),
  ('deputy_academic','payroll.view_own','mandatory',true),
  ('deputy_academic','hr.leave_request','mandatory',true),
  ('deputy_academic','hr.staff_view','mandatory',true),
  ('deputy_academic','timetable.view','mandatory',true),
  ('deputy_academic','exams.schedule','optional',true),
  ('deputy_academic','results.publish','optional',true),
  ('deputy_academic','curriculum.manage','optional',true),
  ('deputy_academic','classes.manage','optional',true),
  ('deputy_academic','comms.broadcast','optional',true),
  ('deputy_academic','hr.leave_approve','optional',true),
  ('deputy_academic','hr.appraisal','optional',true),
  ('deputy_academic','admissions.offer','optional',false),
  ('deputy_admin','students.view','mandatory',true),
  ('deputy_admin','discipline.record','mandatory',true),
  ('deputy_admin','attendance.view','mandatory',true),
  ('deputy_admin','self.view_own','mandatory',true),
  ('deputy_admin','payroll.view_own','mandatory',true),
  ('deputy_admin','hr.leave_request','mandatory',true),
  ('deputy_admin','hr.staff_view','mandatory',true),
  ('deputy_admin','timetable.view','mandatory',true),
  ('deputy_admin','discipline.decide','optional',true),
  ('deputy_admin','visitors.manage','optional',true),
  ('deputy_admin','hr.leave_approve','optional',true),
  ('deputy_admin','works.requests','optional',true),
  ('deputy_admin','comms.broadcast','optional',true),
  ('deputy_admin','students.edit','optional',true),
  ('deputy_admin','expenses.create','optional',true),
  ('deputy_admin','students.view_sensitive','optional',false),
  ('admissions','admissions.view','mandatory',true),
  ('admissions','admissions.process','mandatory',true),
  ('admissions','students.view','mandatory',true),
  ('admissions','self.view_own','mandatory',true),
  ('admissions','payroll.view_own','mandatory',true),
  ('admissions','hr.leave_request','mandatory',true),
  ('admissions','hr.staff_view','mandatory',true),
  ('admissions','timetable.view','mandatory',true),
  ('admissions','students.create','optional',true),
  ('admissions','comms.send_class','optional',true),
  ('admissions','admissions.offer','optional',false),
  ('registrar','admissions.view','mandatory',true),
  ('registrar','students.view','mandatory',true),
  ('registrar','students.edit','mandatory',true),
  ('registrar','transcripts.issue','mandatory',true),
  ('registrar','exams.records','mandatory',true),
  ('registrar','governance.minutes','mandatory',true),
  ('registrar','self.view_own','mandatory',true),
  ('registrar','payroll.view_own','mandatory',true),
  ('registrar','hr.leave_request','mandatory',true),
  ('registrar','hr.staff_view','mandatory',true),
  ('registrar','timetable.view','mandatory',true),
  ('registrar','admissions.offer','optional',true),
  ('registrar','students.transfer','optional',true),
  ('registrar','hr.staff_manage','optional',true),
  ('registrar','students.view_sensitive','optional',true),
  ('registrar','comms.broadcast','optional',true),
  ('registrar','results.publish','optional',true),
  ('registrar','results.unpublish','optional',false),
  ('exams_records','exams.records','mandatory',true),
  ('exams_records','grades.view','mandatory',true),
  ('exams_records','exams.schedule','mandatory',true),
  ('exams_records','self.view_own','mandatory',true),
  ('exams_records','payroll.view_own','mandatory',true),
  ('exams_records','hr.leave_request','mandatory',true),
  ('exams_records','hr.staff_view','mandatory',true),
  ('exams_records','timetable.view','mandatory',true),
  ('exams_records','transcripts.issue','optional',true),
  ('exams_records','results.publish','optional',true),
  ('exams_records','cbt.manage','optional',true),
  ('exams_records','results.unpublish','optional',false),
  ('exams_officer','exams.schedule','mandatory',true),
  ('exams_officer','exams.invigilate','mandatory',true),
  ('exams_officer','grades.view','mandatory',true),
  ('exams_officer','self.view_own','mandatory',true),
  ('exams_officer','payroll.view_own','mandatory',true),
  ('exams_officer','hr.leave_request','mandatory',true),
  ('exams_officer','hr.staff_view','mandatory',true),
  ('exams_officer','timetable.view','mandatory',true),
  ('exams_officer','cbt.manage','optional',true),
  ('exams_officer','attendance.view','optional',true),
  ('exams_officer','malpractice.decide','optional',false),
  ('cbt','cbt.manage','mandatory',true),
  ('cbt','exams.schedule','mandatory',true),
  ('cbt','self.view_own','mandatory',true),
  ('cbt','payroll.view_own','mandatory',true),
  ('cbt','hr.leave_request','mandatory',true),
  ('cbt','hr.staff_view','mandatory',true),
  ('cbt','timetable.view','mandatory',true),
  ('cbt','exams.invigilate','optional',true),
  ('cbt','ict.support','optional',true),
  ('dean','reports.academic','mandatory',true),
  ('dean','grades.approve','mandatory',true),
  ('dean','course_reg.approve','mandatory',true),
  ('dean','students.view','mandatory',true),
  ('dean','self.view_own','mandatory',true),
  ('dean','payroll.view_own','mandatory',true),
  ('dean','hr.leave_request','mandatory',true),
  ('dean','hr.staff_view','mandatory',true),
  ('dean','timetable.view','mandatory',true),
  ('dean','lesson_notes.approve','optional',true),
  ('dean','hr.leave_approve','optional',true),
  ('dean','hr.appraisal','optional',true),
  ('dean','comms.send_class','optional',true),
  ('dean','malpractice.decide','optional',true),
  ('dean','discipline.decide','optional',false),
  ('hod','reports.academic','mandatory',true),
  ('hod','grades.approve','mandatory',true),
  ('hod','lesson_notes.approve','mandatory',true),
  ('hod','students.view','mandatory',true),
  ('hod','attendance.view','mandatory',true),
  ('hod','self.view_own','mandatory',true),
  ('hod','payroll.view_own','mandatory',true),
  ('hod','hr.leave_request','mandatory',true),
  ('hod','hr.staff_view','mandatory',true),
  ('hod','timetable.view','mandatory',true),
  ('hod','timetable.manage','optional',true),
  ('hod','course_reg.approve','optional',true),
  ('hod','curriculum.manage','optional',true),
  ('hod','hr.leave_approve','optional',true),
  ('hod','hr.appraisal','optional',true),
  ('hod','comms.send_class','optional',true),
  ('hod','exams.schedule','optional',false),
  ('level_adviser','course_reg.approve','mandatory',true),
  ('level_adviser','grades.view','mandatory',true),
  ('level_adviser','students.view','mandatory',true),
  ('level_adviser','self.view_own','mandatory',true),
  ('level_adviser','payroll.view_own','mandatory',true),
  ('level_adviser','hr.leave_request','mandatory',true),
  ('level_adviser','hr.staff_view','mandatory',true),
  ('level_adviser','timetable.view','mandatory',true),
  ('level_adviser','comms.send_class','optional',true),
  ('level_adviser','attendance.view','optional',true),
  ('teacher','attendance.take','mandatory',true),
  ('teacher','grades.enter','mandatory',true),
  ('teacher','lesson_notes.submit','mandatory',true),
  ('teacher','students.view','mandatory',true),
  ('teacher','self.view_own','mandatory',true),
  ('teacher','payroll.view_own','mandatory',true),
  ('teacher','hr.leave_request','mandatory',true),
  ('teacher','hr.staff_view','mandatory',true),
  ('teacher','timetable.view','mandatory',true),
  ('teacher','comms.send_class','optional',true),
  ('teacher','ai_tutor.use','optional',true),
  ('teacher','cbt.manage','optional',true),
  ('teacher','discipline.record','optional',true),
  ('teacher','timetable.manage','optional',false),
  ('form_teacher','attendance.take','mandatory',true),
  ('form_teacher','grades.enter','mandatory',true),
  ('form_teacher','grades.view','mandatory',true),
  ('form_teacher','lesson_notes.submit','mandatory',true),
  ('form_teacher','students.view','mandatory',true),
  ('form_teacher','discipline.record','mandatory',true),
  ('form_teacher','self.view_own','mandatory',true),
  ('form_teacher','payroll.view_own','mandatory',true),
  ('form_teacher','hr.leave_request','mandatory',true),
  ('form_teacher','hr.staff_view','mandatory',true),
  ('form_teacher','timetable.view','mandatory',true),
  ('form_teacher','comms.send_class','optional',true),
  ('form_teacher','fees.view','optional',true),
  ('form_teacher','ai_tutor.use','optional',true),
  ('form_teacher','students.view_sensitive','optional',false),
  ('teaching_support','attendance.take','mandatory',true),
  ('teaching_support','students.view','mandatory',true),
  ('teaching_support','self.view_own','mandatory',true),
  ('teaching_support','payroll.view_own','mandatory',true),
  ('teaching_support','hr.leave_request','mandatory',true),
  ('teaching_support','hr.staff_view','mandatory',true),
  ('teaching_support','timetable.view','mandatory',true),
  ('teaching_support','lesson_notes.submit','optional',true),
  ('teaching_support','comms.send_class','optional',true),
  ('early_years_carer','attendance.take','mandatory',true),
  ('early_years_carer','students.view','mandatory',true),
  ('early_years_carer','self.view_own','mandatory',true),
  ('early_years_carer','payroll.view_own','mandatory',true),
  ('early_years_carer','hr.leave_request','mandatory',true),
  ('early_years_carer','hr.staff_view','mandatory',true),
  ('early_years_carer','timetable.view','mandatory',true),
  ('early_years_carer','comms.send_class','optional',true),
  ('early_years_carer','health.records_view','optional',true),
  ('lab_workshop','inventory.manage','mandatory',true),
  ('lab_workshop','self.view_own','mandatory',true),
  ('lab_workshop','payroll.view_own','mandatory',true),
  ('lab_workshop','hr.leave_request','mandatory',true),
  ('lab_workshop','hr.staff_view','mandatory',true),
  ('lab_workshop','timetable.view','mandatory',true),
  ('lab_workshop','attendance.take','optional',true),
  ('lab_workshop','assets.manage','optional',true),
  ('bursar','fees.view','mandatory',true),
  ('bursar','fees.manage_plans','mandatory',true),
  ('bursar','payments.reconcile','mandatory',true),
  ('bursar','reports.financial','mandatory',true),
  ('bursar','wallet.view','mandatory',true),
  ('bursar','budget.manage','mandatory',true),
  ('bursar','self.view_own','mandatory',true),
  ('bursar','payroll.view_own','mandatory',true),
  ('bursar','hr.leave_request','mandatory',true),
  ('bursar','hr.staff_view','mandatory',true),
  ('bursar','timetable.view','mandatory',true),
  ('bursar','payments.record_cash','optional',true),
  ('bursar','expenses.approve','optional',true),
  ('bursar','payroll.approve','optional',true),
  ('bursar','payments.refund','optional',true),
  ('bursar','wallet.topup','optional',true),
  ('bursar','payroll.view_all','optional',true),
  ('bursar','expenses.create','optional',false),
  ('accountant','fees.view','mandatory',true),
  ('accountant','payments.reconcile','mandatory',true),
  ('accountant','reports.financial','mandatory',true),
  ('accountant','expenses.create','mandatory',true),
  ('accountant','self.view_own','mandatory',true),
  ('accountant','payroll.view_own','mandatory',true),
  ('accountant','hr.leave_request','mandatory',true),
  ('accountant','hr.staff_view','mandatory',true),
  ('accountant','timetable.view','mandatory',true),
  ('accountant','payments.record_cash','optional',true),
  ('accountant','budget.manage','optional',true),
  ('accountant','wallet.view','optional',true),
  ('accountant','payroll.prepare','optional',false),
  ('cashier','fees.view','mandatory',true),
  ('cashier','payments.record_cash','mandatory',true),
  ('cashier','self.view_own','mandatory',true),
  ('cashier','payroll.view_own','mandatory',true),
  ('cashier','hr.leave_request','mandatory',true),
  ('cashier','hr.staff_view','mandatory',true),
  ('cashier','timetable.view','mandatory',true),
  ('cashier','wallet.view','optional',true),
  ('payroll','payroll.prepare','mandatory',true),
  ('payroll','payroll.view_all','mandatory',true),
  ('payroll','hr.view_sensitive','mandatory',true),
  ('payroll','self.view_own','mandatory',true),
  ('payroll','payroll.view_own','mandatory',true),
  ('payroll','hr.leave_request','mandatory',true),
  ('payroll','hr.staff_view','mandatory',true),
  ('payroll','timetable.view','mandatory',true),
  ('payroll','reports.financial','optional',true),
  ('auditor','audit.view','mandatory',true),
  ('auditor','reports.financial','mandatory',true),
  ('auditor','fees.view','mandatory',true),
  ('auditor','payroll.view_all','mandatory',true),
  ('auditor','self.view_own','mandatory',true),
  ('auditor','payroll.view_own','mandatory',true),
  ('auditor','hr.leave_request','mandatory',true),
  ('auditor','hr.staff_view','mandatory',true),
  ('auditor','timetable.view','mandatory',true),
  ('auditor','reports.academic','optional',true),
  ('auditor','analytics.institution','optional',true),
  ('procurement','procurement.request','mandatory',true),
  ('procurement','inventory.manage','mandatory',true),
  ('procurement','self.view_own','mandatory',true),
  ('procurement','payroll.view_own','mandatory',true),
  ('procurement','hr.leave_request','mandatory',true),
  ('procurement','hr.staff_view','mandatory',true),
  ('procurement','timetable.view','mandatory',true),
  ('procurement','procurement.approve','optional',true),
  ('procurement','assets.manage','optional',true),
  ('store','inventory.manage','mandatory',true),
  ('store','self.view_own','mandatory',true),
  ('store','payroll.view_own','mandatory',true),
  ('store','hr.leave_request','mandatory',true),
  ('store','hr.staff_view','mandatory',true),
  ('store','timetable.view','mandatory',true),
  ('store','procurement.request','optional',true),
  ('store','assets.manage','optional',true),
  ('hr','hr.staff_manage','mandatory',true),
  ('hr','hr.view_sensitive','mandatory',true),
  ('hr','hr.leave_approve','mandatory',true),
  ('hr','hr.appraisal','mandatory',true),
  ('hr','self.view_own','mandatory',true),
  ('hr','payroll.view_own','mandatory',true),
  ('hr','hr.leave_request','mandatory',true),
  ('hr','hr.staff_view','mandatory',true),
  ('hr','timetable.view','mandatory',true),
  ('hr','payroll.prepare','optional',true),
  ('hr','roles.assign','optional',true),
  ('admin_officer','self.view_own','mandatory',true),
  ('admin_officer','payroll.view_own','mandatory',true),
  ('admin_officer','hr.leave_request','mandatory',true),
  ('admin_officer','hr.staff_view','mandatory',true),
  ('admin_officer','timetable.view','mandatory',true),
  ('admin_officer','students.view','mandatory',true),
  ('admin_officer','visitors.manage','optional',true),
  ('admin_officer','comms.send_class','optional',true),
  ('admin_officer','works.requests','optional',true),
  ('admin_officer','news.publish','optional',true),
  ('admin_officer','students.edit','optional',false),
  ('pr','news.publish','mandatory',true),
  ('pr','self.view_own','mandatory',true),
  ('pr','payroll.view_own','mandatory',true),
  ('pr','hr.leave_request','mandatory',true),
  ('pr','hr.staff_view','mandatory',true),
  ('pr','timetable.view','mandatory',true),
  ('pr','comms.broadcast','optional',true),
  ('pr','alumni.manage','optional',true),
  ('legal','governance.minutes','mandatory',true),
  ('legal','self.view_own','mandatory',true),
  ('legal','payroll.view_own','mandatory',true),
  ('legal','hr.leave_request','mandatory',true),
  ('legal','hr.staff_view','mandatory',true),
  ('legal','timetable.view','mandatory',true),
  ('legal','audit.view','optional',true),
  ('legal','discipline.decide','optional',true),
  ('librarian','library.circulate','mandatory',true),
  ('librarian','library.catalog','mandatory',true),
  ('librarian','students.view','mandatory',true),
  ('librarian','self.view_own','mandatory',true),
  ('librarian','payroll.view_own','mandatory',true),
  ('librarian','hr.leave_request','mandatory',true),
  ('librarian','hr.staff_view','mandatory',true),
  ('librarian','timetable.view','mandatory',true),
  ('librarian','procurement.request','optional',true),
  ('library_staff','library.circulate','mandatory',true),
  ('library_staff','self.view_own','mandatory',true),
  ('library_staff','payroll.view_own','mandatory',true),
  ('library_staff','hr.leave_request','mandatory',true),
  ('library_staff','hr.staff_view','mandatory',true),
  ('library_staff','timetable.view','mandatory',true),
  ('library_staff','library.catalog','optional',true),
  ('hostel_head','hostel.allocate','mandatory',true),
  ('hostel_head','hostel.roll_call','mandatory',true),
  ('hostel_head','students.view','mandatory',true),
  ('hostel_head','self.view_own','mandatory',true),
  ('hostel_head','payroll.view_own','mandatory',true),
  ('hostel_head','hr.leave_request','mandatory',true),
  ('hostel_head','hr.staff_view','mandatory',true),
  ('hostel_head','timetable.view','mandatory',true),
  ('hostel_head','discipline.record','optional',true),
  ('hostel_head','health.records_view','optional',true),
  ('hostel_head','comms.send_class','optional',true),
  ('hostel_head','welfare.pastoral','optional',true),
  ('house_staff','hostel.roll_call','mandatory',true),
  ('house_staff','students.view','mandatory',true),
  ('house_staff','welfare.pastoral','mandatory',true),
  ('house_staff','self.view_own','mandatory',true),
  ('house_staff','payroll.view_own','mandatory',true),
  ('house_staff','hr.leave_request','mandatory',true),
  ('house_staff','hr.staff_view','mandatory',true),
  ('house_staff','timetable.view','mandatory',true),
  ('house_staff','discipline.record','optional',true),
  ('house_staff','comms.send_class','optional',true),
  ('house_staff','hostel.allocate','optional',true),
  ('health','health.records_view','mandatory',true),
  ('health','health.records_edit','mandatory',true),
  ('health','students.view','mandatory',true),
  ('health','self.view_own','mandatory',true),
  ('health','payroll.view_own','mandatory',true),
  ('health','hr.leave_request','mandatory',true),
  ('health','hr.staff_view','mandatory',true),
  ('health','timetable.view','mandatory',true),
  ('health','comms.send_class','optional',true),
  ('health','inventory.manage','optional',true),
  ('counsellor','counselling.notes','mandatory',true),
  ('counsellor','welfare.pastoral','mandatory',true),
  ('counsellor','students.view','mandatory',true),
  ('counsellor','self.view_own','mandatory',true),
  ('counsellor','payroll.view_own','mandatory',true),
  ('counsellor','hr.leave_request','mandatory',true),
  ('counsellor','hr.staff_view','mandatory',true),
  ('counsellor','timetable.view','mandatory',true),
  ('counsellor','grades.view','optional',true),
  ('counsellor','attendance.view','optional',true),
  ('counsellor','discipline.record','optional',true),
  ('chaplaincy','welfare.pastoral','mandatory',true),
  ('chaplaincy','self.view_own','mandatory',true),
  ('chaplaincy','payroll.view_own','mandatory',true),
  ('chaplaincy','hr.leave_request','mandatory',true),
  ('chaplaincy','hr.staff_view','mandatory',true),
  ('chaplaincy','timetable.view','mandatory',true),
  ('chaplaincy','comms.send_class','optional',true),
  ('chaplaincy','news.publish','optional',true),
  ('student_affairs','students.view','mandatory',true),
  ('student_affairs','welfare.pastoral','mandatory',true),
  ('student_affairs','discipline.record','mandatory',true),
  ('student_affairs','self.view_own','mandatory',true),
  ('student_affairs','payroll.view_own','mandatory',true),
  ('student_affairs','hr.leave_request','mandatory',true),
  ('student_affairs','hr.staff_view','mandatory',true),
  ('student_affairs','timetable.view','mandatory',true),
  ('student_affairs','discipline.decide','optional',true),
  ('student_affairs','hostel.allocate','optional',true),
  ('student_affairs','comms.broadcast','optional',true),
  ('student_affairs','news.publish','optional',true),
  ('security_head','security.gate_log','mandatory',true),
  ('security_head','visitors.manage','mandatory',true),
  ('security_head','security.incident','mandatory',true),
  ('security_head','self.view_own','mandatory',true),
  ('security_head','payroll.view_own','mandatory',true),
  ('security_head','hr.leave_request','mandatory',true),
  ('security_head','hr.staff_view','mandatory',true),
  ('security_head','timetable.view','mandatory',true),
  ('security_head','transport.track','optional',true),
  ('security_head','attendance.view','optional',true),
  ('security_staff','security.gate_log','mandatory',true),
  ('security_staff','visitors.manage','mandatory',true),
  ('security_staff','self.view_own','mandatory',true),
  ('security_staff','payroll.view_own','mandatory',true),
  ('security_staff','hr.leave_request','mandatory',true),
  ('security_staff','hr.staff_view','mandatory',true),
  ('security_staff','timetable.view','mandatory',true),
  ('security_staff','security.incident','optional',true),
  ('transport_head','transport.manage','mandatory',true),
  ('transport_head','transport.track','mandatory',true),
  ('transport_head','self.view_own','mandatory',true),
  ('transport_head','payroll.view_own','mandatory',true),
  ('transport_head','hr.leave_request','mandatory',true),
  ('transport_head','hr.staff_view','mandatory',true),
  ('transport_head','timetable.view','mandatory',true),
  ('transport_head','comms.send_class','optional',true),
  ('driver','transport.driver_trip','mandatory',true),
  ('driver','self.view_own','mandatory',true),
  ('driver','payroll.view_own','mandatory',true),
  ('driver','hr.leave_request','mandatory',true),
  ('driver','hr.staff_view','mandatory',true),
  ('driver','timetable.view','mandatory',true),
  ('driver','transport.track','optional',true),
  ('works','works.requests','mandatory',true),
  ('works','assets.manage','mandatory',true),
  ('works','self.view_own','mandatory',true),
  ('works','payroll.view_own','mandatory',true),
  ('works','hr.leave_request','mandatory',true),
  ('works','hr.staff_view','mandatory',true),
  ('works','timetable.view','mandatory',true),
  ('works','procurement.request','optional',true),
  ('works','inventory.manage','optional',true),
  ('support_staff','self.view_own','mandatory',true),
  ('support_staff','payroll.view_own','mandatory',true),
  ('support_staff','hr.leave_request','mandatory',true),
  ('support_staff','hr.staff_view','mandatory',true),
  ('support_staff','timetable.view','mandatory',true),
  ('support_staff','works.requests','optional',true),
  ('catering','catering.manage','mandatory',true),
  ('catering','self.view_own','mandatory',true),
  ('catering','payroll.view_own','mandatory',true),
  ('catering','hr.leave_request','mandatory',true),
  ('catering','hr.staff_view','mandatory',true),
  ('catering','timetable.view','mandatory',true),
  ('catering','inventory.manage','optional',true),
  ('catering','procurement.request','optional',true),
  ('ict_head','ict.support','mandatory',true),
  ('ict_head','ict.reset_access','mandatory',true),
  ('ict_head','self.view_own','mandatory',true),
  ('ict_head','payroll.view_own','mandatory',true),
  ('ict_head','hr.leave_request','mandatory',true),
  ('ict_head','hr.staff_view','mandatory',true),
  ('ict_head','timetable.view','mandatory',true),
  ('ict_head','settings.manage','optional',true),
  ('ict_head','cbt.manage','optional',true),
  ('ict_head','audit.view','optional',true),
  ('ict_staff','ict.support','mandatory',true),
  ('ict_staff','self.view_own','mandatory',true),
  ('ict_staff','payroll.view_own','mandatory',true),
  ('ict_staff','hr.leave_request','mandatory',true),
  ('ict_staff','hr.staff_view','mandatory',true),
  ('ict_staff','timetable.view','mandatory',true),
  ('ict_staff','cbt.manage','optional',true),
  ('ict_staff','ict.reset_access','optional',false),
  ('data_protection','ndpa.dsar','mandatory',true),
  ('data_protection','audit.view','mandatory',true),
  ('data_protection','self.view_own','mandatory',true),
  ('data_protection','payroll.view_own','mandatory',true),
  ('data_protection','hr.leave_request','mandatory',true),
  ('data_protection','hr.staff_view','mandatory',true),
  ('data_protection','timetable.view','mandatory',true),
  ('data_protection','students.view_sensitive','optional',true),
  ('data_protection','hr.view_sensitive','optional',true),
  ('siwes','siwes.manage','mandatory',true),
  ('siwes','students.view','mandatory',true),
  ('siwes','self.view_own','mandatory',true),
  ('siwes','payroll.view_own','mandatory',true),
  ('siwes','hr.leave_request','mandatory',true),
  ('siwes','hr.staff_view','mandatory',true),
  ('siwes','timetable.view','mandatory',true),
  ('siwes','comms.send_class','optional',true),
  ('research','research.manage','mandatory',true),
  ('research','self.view_own','mandatory',true),
  ('research','payroll.view_own','mandatory',true),
  ('research','hr.leave_request','mandatory',true),
  ('research','hr.staff_view','mandatory',true),
  ('research','timetable.view','mandatory',true),
  ('research','reports.academic','optional',true),
  ('alumni','alumni.manage','mandatory',true),
  ('alumni','self.view_own','mandatory',true),
  ('alumni','payroll.view_own','mandatory',true),
  ('alumni','hr.leave_request','mandatory',true),
  ('alumni','hr.staff_view','mandatory',true),
  ('alumni','timetable.view','mandatory',true),
  ('alumni','comms.broadcast','optional',true),
  ('alumni','news.publish','optional',true),
  ('pta','pta.manage','mandatory',true),
  ('pta','children.view','mandatory',true),
  ('pta','comms.send_class','optional',true),
  ('parent','children.view','mandatory',true),
  ('parent','fees.view','mandatory',true),
  ('parent','comms.send_class','optional',true),
  ('student','self.view_own','mandatory',true),
  ('student','timetable.view','mandatory',true),
  ('student','ai_tutor.use','optional',true),
  ('student_leader','self.view_own','mandatory',true),
  ('student_leader','timetable.view','mandatory',true),
  ('student_leader','ai_tutor.use','optional',true),
  ('student_leader','news.publish','optional',true)
ON CONFLICT (template_code, permission_code) DO UPDATE SET kind=EXCLUDED.kind, default_on=EXCLUDED.default_on;
INSERT INTO public.role_catalog (code, name, category, template_code, institution_types) VALUES
  ('ng.honourable_minister_of_education','Honourable Minister of Education','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.minister_of_state_for_education','Minister of State for Education','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.permanent_secretary_education','Permanent Secretary (Education)','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_basic_and_secondary_education','Director, Basic and Secondary Education','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_tertiary_education','Director, Tertiary Education','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_technology_and_science_education','Director, Technology and Science Education','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_educational_planning_research_and_development','Director, Educational Planning, Research and Development','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_policy_planning','Director, Policy Planning','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_human_resources_ministry','Director, Human Resources (Ministry)','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_finance_and_accounts_ministry','Director, Finance and Accounts (Ministry)','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_federal_inspectorate_service','Director, Federal Inspectorate Service','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.federal_inspector_of_education','Federal Inspector of Education','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_special_needs_education','Director, Special Needs Education','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_education_support_services','Director, Education Support Services','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_federal_unity_colleges','Director, Federal Unity Colleges','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.desk_officer_unity_schools','Desk Officer, Unity Schools','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.education_data_emis_officer','Education Data / EMIS Officer','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.statistician_education','Statistician (Education)','Federal Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.honourable_commissioner_for_education','Honourable Commissioner for Education','State Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.permanent_secretary_state_education','Permanent Secretary (State Education)','State Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_schools_services','Director, Schools Services','State Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_private_schools_registration','Director, Private Schools Registration','State Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_quality_assurance_state','Director, Quality Assurance (State)','State Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_examinations_state','Director, Examinations (State)','State Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.director_planning_research_and_statistics_state','Director, Planning, Research and Statistics (State)','State Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.state_inspector_of_education','State Inspector of Education','State Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.zonal_education_officer','Zonal Education Officer','State Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.tutor_general_permanent_secretary_education_district','Tutor-General / Permanent Secretary (Education District)','State Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.private_schools_monitoring_officer','Private Schools Monitoring Officer','State Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.state_examinations_board_officer','State Examinations Board Officer','State Ministry of Education','regulator',ARRAY['government']::text[]),
  ('ng.executive_chairman_subeb','Executive Chairman, SUBEB','SUBEB / UBEC / LGEA','regulator',ARRAY['government']::text[]),
  ('ng.permanent_member_subeb','Permanent Member, SUBEB','SUBEB / UBEC / LGEA','regulator',ARRAY['government']::text[]),
  ('ng.director_academic_services_subeb','Director, Academic Services (SUBEB)','SUBEB / UBEC / LGEA','regulator',ARRAY['government']::text[]),
  ('ng.director_social_mobilisation_subeb','Director, Social Mobilisation (SUBEB)','SUBEB / UBEC / LGEA','regulator',ARRAY['government']::text[]),
  ('ng.director_quality_assurance_subeb','Director, Quality Assurance (SUBEB)','SUBEB / UBEC / LGEA','regulator',ARRAY['government']::text[]),
  ('ng.ubec_executive_secretary','UBEC Executive Secretary','SUBEB / UBEC / LGEA','regulator',ARRAY['government']::text[]),
  ('ng.ubec_desk_officer','UBEC Desk Officer','SUBEB / UBEC / LGEA','regulator',ARRAY['government']::text[]),
  ('ng.education_secretary_lgea','Education Secretary (LGEA)','SUBEB / UBEC / LGEA','regulator',ARRAY['government']::text[]),
  ('ng.lgea_supervisor','LGEA Supervisor','SUBEB / UBEC / LGEA','regulator',ARRAY['government']::text[]),
  ('ng.head_of_schools_services_lgea','Head of Schools Services (LGEA)','SUBEB / UBEC / LGEA','regulator',ARRAY['government']::text[]),
  ('ng.school_support_officer_lgea','School Support Officer (LGEA)','SUBEB / UBEC / LGEA','regulator',ARRAY['government']::text[]),
  ('ng.basic_education_inspector','Basic Education Inspector','SUBEB / UBEC / LGEA','regulator',ARRAY['government']::text[]),
  ('ng.nuc_executive_secretary','NUC Executive Secretary','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.nuc_accreditation_officer','NUC Accreditation Officer','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.nuc_desk_officer','NUC Desk Officer','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.nbte_executive_secretary','NBTE Executive Secretary','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.nbte_programme_accreditation_officer','NBTE Programme Accreditation Officer','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.nbte_desk_officer','NBTE Desk Officer','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.ncce_executive_secretary','NCCE Executive Secretary','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.ncce_accreditation_officer','NCCE Accreditation Officer','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.ncce_desk_officer','NCCE Desk Officer','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.trcn_registrar','TRCN Registrar','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.trcn_compliance_officer','TRCN Compliance Officer','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.nerdc_curriculum_officer','NERDC Curriculum Officer','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.ndpc_compliance_officer_liaison','NDPC Compliance Officer (liaison)','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.nelfund_desk_officer','NELFUND Desk Officer','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.tetfund_desk_officer','TETFund Desk Officer','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.scholarship_board_officer','Scholarship Board Officer','Regulators & commissions','regulator',ARRAY['government']::text[]),
  ('ng.waec_liaison_officer','WAEC Liaison Officer','Exam councils','regulator',ARRAY['government']::text[]),
  ('ng.neco_liaison_officer','NECO Liaison Officer','Exam councils','regulator',ARRAY['government']::text[]),
  ('ng.nabteb_liaison_officer','NABTEB Liaison Officer','Exam councils','regulator',ARRAY['government']::text[]),
  ('ng.jamb_liaison_cbt_centre_officer','JAMB Liaison / CBT Centre Officer','Exam councils','regulator',ARRAY['government']::text[]),
  ('ng.exam_council_supervisor_external','Exam Council Supervisor (external)','Exam councils','regulator',ARRAY['government']::text[]),
  ('ng.external_examiner','External Examiner','Exam councils','regulator',ARRAY['government']::text[]),
  ('ng.external_moderator','External Moderator','Exam councils','regulator',ARRAY['government']::text[]),
  ('ng.quality_assurance_evaluator','Quality Assurance Evaluator','Quality assurance','regulator_inspector',ARRAY['government']::text[]),
  ('ng.school_inspector','School Inspector','Quality assurance','regulator_inspector',ARRAY['government']::text[]),
  ('ng.monitoring_and_evaluation_officer','Monitoring and Evaluation Officer','Quality assurance','regulator_inspector',ARRAY['government']::text[]),
  ('ng.proprietor','Proprietor','Proprietor & governance','proprietor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.proprietress','Proprietress','Proprietor & governance','proprietor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.founder_chairman_private_institution','Founder / Chairman (Private Institution)','Proprietor & governance','proprietor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.group_managing_director_schools_group','Group Managing Director (Schools Group)','Proprietor & governance','proprietor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.group_executive_director','Group Executive Director','Proprietor & governance','proprietor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.chief_executive_officer_schools_group','Chief Executive Officer (Schools Group)','Proprietor & governance','proprietor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.board_of_governors_chairman','Board of Governors Chairman','Proprietor & governance','governance_board',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.board_of_governors_member','Board of Governors Member','Proprietor & governance','governance_board',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.school_management_board_member','School Management Board Member','Proprietor & governance','governance_board',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.visitor_university','Visitor (University)','Proprietor & governance','governance_board',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.pro_chancellor_chairman_of_council','Pro-Chancellor / Chairman of Council','Proprietor & governance','governance_board',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.governing_council_member','Governing Council Member','Proprietor & governance','governance_board',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.council_secretary','Council Secretary','Proprietor & governance','governance_board',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.trustee_faith_mission_school','Trustee (Faith / Mission School)','Proprietor & governance','governance_board',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.mission_education_secretary','Mission Education Secretary','Proprietor & governance','governance_board',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.diocesan_mission_education_director','Diocesan / Mission Education Director','Proprietor & governance','governance_board',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.proprietor_s_representative','Proprietor''s Representative','Proprietor & governance','governance_board',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.group_internal_audit_head','Group Internal Audit Head','Group HQ','auditor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.group_compliance_officer','Group Compliance Officer','Group HQ','auditor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.group_director_of_education','Group Director of Education','Group HQ','head_of_institution',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.group_head_of_academics','Group Head of Academics','Group HQ','head_of_institution',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.campus_director','Campus Director','Group HQ','head_of_institution',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.campus_manager','Campus Manager','Group HQ','head_of_institution',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.head_teacher','Head Teacher','Nursery & primary leadership','head_of_institution',ARRAY['nursery','primary']::text[]),
  ('ng.head_mistress_head_master_primary','Head Mistress / Head Master (Primary)','Nursery & primary leadership','head_of_institution',ARRAY['nursery','primary']::text[]),
  ('ng.head_of_nursery_early_years','Head of Nursery / Early Years','Nursery & primary leadership','head_of_institution',ARRAY['nursery','primary']::text[]),
  ('ng.head_of_primary_section','Head of Primary Section','Nursery & primary leadership','head_of_institution',ARRAY['nursery','primary']::text[]),
  ('ng.school_administrator_private','School Administrator (Private)','Nursery & primary leadership','head_of_institution',ARRAY['nursery','primary']::text[]),
  ('ng.director_of_studies_private','Director of Studies (Private)','Nursery & primary leadership','head_of_institution',ARRAY['nursery','primary']::text[]),
  ('ng.assistant_head_teacher','Assistant Head Teacher','Nursery & primary leadership','deputy_academic',ARRAY['nursery','primary']::text[]),
  ('ng.deputy_head_teacher_academics','Deputy Head Teacher (Academics)','Nursery & primary leadership','deputy_academic',ARRAY['nursery','primary']::text[]),
  ('ng.early_years_coordinator','Early Years Coordinator','Nursery & primary leadership','deputy_academic',ARRAY['nursery','primary']::text[]),
  ('ng.key_stage_coordinator','Key Stage Coordinator','Nursery & primary leadership','deputy_academic',ARRAY['nursery','primary']::text[]),
  ('ng.deputy_head_teacher_administration','Deputy Head Teacher (Administration)','Nursery & primary leadership','deputy_admin',ARRAY['nursery','primary']::text[]),
  ('ng.principal','Principal','Secondary leadership','head_of_institution',ARRAY['secondary']::text[]),
  ('ng.principal_senior_school','Principal (Senior School)','Secondary leadership','head_of_institution',ARRAY['secondary']::text[]),
  ('ng.principal_junior_school','Principal (Junior School)','Secondary leadership','head_of_institution',ARRAY['secondary']::text[]),
  ('ng.head_of_school_executive_principal','Head of School / Executive Principal','Secondary leadership','head_of_institution',ARRAY['secondary']::text[]),
  ('ng.director_private_school','Director (Private School)','Secondary leadership','head_of_institution',ARRAY['secondary']::text[]),
  ('ng.vice_principal_academics','Vice Principal (Academics)','Secondary leadership','deputy_academic',ARRAY['secondary']::text[]),
  ('ng.dean_of_studies','Dean of Studies','Secondary leadership','deputy_academic',ARRAY['secondary']::text[]),
  ('ng.director_of_studies','Director of Studies','Secondary leadership','deputy_academic',ARRAY['secondary']::text[]),
  ('ng.head_of_curriculum','Head of Curriculum','Secondary leadership','deputy_academic',ARRAY['secondary']::text[]),
  ('ng.academic_coordinator','Academic Coordinator','Secondary leadership','deputy_academic',ARRAY['secondary']::text[]),
  ('ng.senior_master_senior_mistress_academics','Senior Master / Senior Mistress (Academics)','Secondary leadership','deputy_academic',ARRAY['secondary']::text[]),
  ('ng.vice_principal_administration','Vice Principal (Administration)','Secondary leadership','deputy_admin',ARRAY['secondary']::text[]),
  ('ng.vice_principal_special_duties','Vice Principal (Special Duties)','Secondary leadership','deputy_admin',ARRAY['secondary']::text[]),
  ('ng.vice_principal_student_affairs','Vice Principal (Student Affairs)','Secondary leadership','deputy_admin',ARRAY['secondary']::text[]),
  ('ng.senior_master_senior_mistress_administration','Senior Master / Senior Mistress (Administration)','Secondary leadership','deputy_admin',ARRAY['secondary']::text[]),
  ('ng.dean_of_students_secondary','Dean of Students (Secondary)','Secondary leadership','deputy_admin',ARRAY['secondary']::text[]),
  ('ng.discipline_master_mistress','Discipline Master / Mistress','Secondary leadership','deputy_admin',ARRAY['secondary']::text[]),
  ('ng.head_of_junior_school','Head of Junior School','Secondary leadership','deputy_admin',ARRAY['secondary']::text[]),
  ('ng.head_of_senior_school','Head of Senior School','Secondary leadership','deputy_admin',ARRAY['secondary']::text[]),
  ('ng.examinations_officer','Examinations Officer','Secondary leadership','exams_officer',ARRAY['secondary']::text[]),
  ('ng.waec_neco_coordinator','WAEC / NECO Coordinator','Secondary leadership','exams_officer',ARRAY['secondary']::text[]),
  ('ng.continuous_assessment_officer','Continuous Assessment Officer','Secondary leadership','exams_officer',ARRAY['secondary']::text[]),
  ('ng.cbt_coordinator_school','CBT Coordinator (School)','Secondary leadership','cbt',ARRAY['secondary']::text[]),
  ('ng.admissions_officer_school','Admissions Officer (School)','Secondary leadership','admissions',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.admissions_coordinator','Admissions Coordinator','Secondary leadership','admissions',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.registrar_private_school','Registrar (Private School)','Secondary leadership','admissions',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.records_officer_school','Records Officer (School)','Secondary leadership','admissions',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.subject_teacher','Subject Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.class_teacher_primary','Class Teacher (Primary)','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.specialist_teacher','Specialist Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.mathematics_teacher','Mathematics Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.english_language_teacher','English Language Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.science_teacher','Science Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.basic_science_and_technology_teacher','Basic Science and Technology Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.social_studies_civic_education_teacher','Social Studies / Civic Education Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.agricultural_science_teacher','Agricultural Science Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.computer_studies_ict_teacher','Computer Studies / ICT Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.french_teacher','French Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.arabic_teacher','Arabic Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.hausa_igbo_yoruba_language_teacher','Hausa / Igbo / Yoruba Language Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.crs_teacher','CRS Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.irs_teacher','IRS Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.fine_arts_creative_arts_teacher','Fine Arts / Creative Arts Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.music_teacher','Music Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.physical_and_health_education_teacher','Physical and Health Education Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.home_economics_teacher','Home Economics Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.business_studies_teacher','Business Studies Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.technical_drawing_teacher','Technical Drawing Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.further_mathematics_teacher','Further Mathematics Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.physics_teacher','Physics Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.chemistry_teacher','Chemistry Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.biology_teacher','Biology Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.economics_teacher','Economics Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.literature_in_english_teacher','Literature-in-English Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.government_teacher','Government Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.geography_teacher','Geography Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.history_teacher','History Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.commerce_teacher','Commerce Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.financial_accounting_teacher','Financial Accounting Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.data_processing_teacher','Data Processing Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.special_needs_inclusive_education_teacher','Special Needs / Inclusive Education Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.montessori_teacher','Montessori Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.coding_robotics_instructor','Coding / Robotics Instructor','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.quranic_tahfiz_teacher','Quranic / Tahfiz Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.coach_sports','Coach (Sports)','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.clubs_and_societies_patron','Clubs and Societies Patron','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.corps_member_teacher_nysc','Corps Member Teacher (NYSC)','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.part_time_lesson_teacher','Part-time / Lesson Teacher','K-12 teaching','teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.form_master_form_mistress','Form Master / Form Mistress','K-12 teaching','form_teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.form_tutor','Form Tutor','K-12 teaching','form_teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.class_teacher_secondary','Class Teacher (Secondary)','K-12 teaching','form_teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.year_head_year_tutor','Year Head / Year Tutor','K-12 teaching','form_teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.class_coordinator','Class Coordinator','K-12 teaching','form_teacher',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.head_of_department_school','Head of Department (School)','K-12 teaching','hod',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.head_of_science_department','Head of Science Department','K-12 teaching','hod',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.head_of_arts_department','Head of Arts Department','K-12 teaching','hod',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.head_of_commercial_department','Head of Commercial Department','K-12 teaching','hod',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.head_of_languages','Head of Languages','K-12 teaching','hod',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.head_of_mathematics','Head of Mathematics','K-12 teaching','hod',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.head_of_computer_studies_department','Head of Computer Studies Department','K-12 teaching','hod',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.head_of_vocational_studies','Head of Vocational Studies','K-12 teaching','hod',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.subject_coordinator','Subject Coordinator','K-12 teaching','hod',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.sports_director_games_master','Sports Director / Games Master','K-12 teaching','hod',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.teaching_assistant','Teaching Assistant','K-12 teaching','teaching_support',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.classroom_assistant','Classroom Assistant','K-12 teaching','teaching_support',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.learning_support_assistant','Learning Support Assistant','K-12 teaching','teaching_support',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.student_teacher_teaching_practice','Student Teacher (Teaching Practice)','K-12 teaching','teaching_support',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.siwes_intern_school','SIWES Intern (School)','K-12 teaching','teaching_support',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.caregiver_nanny_creche','Caregiver / Nanny (Creche)','K-12 teaching','early_years_carer',ARRAY['nursery']::text[]),
  ('ng.nursery_assistant','Nursery Assistant','K-12 teaching','early_years_carer',ARRAY['nursery']::text[]),
  ('ng.playgroup_facilitator','Playgroup Facilitator','K-12 teaching','early_years_carer',ARRAY['nursery']::text[]),
  ('ng.creche_supervisor','Creche Supervisor','K-12 teaching','early_years_carer',ARRAY['nursery']::text[]),
  ('ng.laboratory_technician_school','Laboratory Technician (School)','K-12 teaching','lab_workshop',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.laboratory_attendant','Laboratory Attendant','K-12 teaching','lab_workshop',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.workshop_attendant','Workshop Attendant','K-12 teaching','lab_workshop',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.ict_lab_attendant','ICT Lab Attendant','K-12 teaching','lab_workshop',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.boarding_master','Boarding Master','Boarding','hostel_head',ARRAY['boarding']::text[]),
  ('ng.boarding_mistress','Boarding Mistress','Boarding','hostel_head',ARRAY['boarding']::text[]),
  ('ng.director_of_boarding','Director of Boarding','Boarding','hostel_head',ARRAY['boarding']::text[]),
  ('ng.senior_house_master','Senior House Master','Boarding','hostel_head',ARRAY['boarding']::text[]),
  ('ng.senior_house_mistress','Senior House Mistress','Boarding','hostel_head',ARRAY['boarding']::text[]),
  ('ng.house_master','House Master','Boarding','house_staff',ARRAY['boarding']::text[]),
  ('ng.house_mistress','House Mistress','Boarding','house_staff',ARRAY['boarding']::text[]),
  ('ng.house_parent','House Parent','Boarding','house_staff',ARRAY['boarding']::text[]),
  ('ng.assistant_house_master_mistress','Assistant House Master / Mistress','Boarding','house_staff',ARRAY['boarding']::text[]),
  ('ng.dormitory_supervisor','Dormitory Supervisor','Boarding','house_staff',ARRAY['boarding']::text[]),
  ('ng.prep_supervisor','Prep Supervisor','Boarding','house_staff',ARRAY['boarding']::text[]),
  ('ng.matron','Matron','Boarding','house_staff',ARRAY['boarding']::text[]),
  ('ng.assistant_matron','Assistant Matron','Boarding','house_staff',ARRAY['boarding']::text[]),
  ('ng.exeat_officer','Exeat Officer','Boarding','house_staff',ARRAY['boarding']::text[]),
  ('ng.chaplain','Chaplain','Faith & pastoral','chaplaincy',ARRAY['faith','nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.assistant_chaplain','Assistant Chaplain','Faith & pastoral','chaplaincy',ARRAY['faith','nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.school_imam','School Imam','Faith & pastoral','chaplaincy',ARRAY['faith','nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.assistant_imam','Assistant Imam','Faith & pastoral','chaplaincy',ARRAY['faith','nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.islamic_studies_coordinator','Islamic Studies Coordinator','Faith & pastoral','chaplaincy',ARRAY['faith','nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.christian_religious_coordinator','Christian Religious Coordinator','Faith & pastoral','chaplaincy',ARRAY['faith','nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.mosque_committee_coordinator','Mosque Committee Coordinator','Faith & pastoral','chaplaincy',ARRAY['faith','nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.chapel_prefect_coordinator','Chapel Prefect Coordinator','Faith & pastoral','chaplaincy',ARRAY['faith','nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.rev_sister_brother_mission_school','Rev. Sister / Brother (Mission School)','Faith & pastoral','chaplaincy',ARRAY['faith','nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.spiritual_director','Spiritual Director','Faith & pastoral','chaplaincy',ARRAY['faith','nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.alfa_mallam_islamiyya','Alfa / Mallam (Islamiyya)','Faith & pastoral','chaplaincy',ARRAY['faith','nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.islamiyya_head_teacher','Islamiyya Head Teacher','Faith & pastoral','chaplaincy',ARRAY['faith','nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.guidance_counsellor','Guidance Counsellor','Welfare','counsellor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.school_counsellor','School Counsellor','Welfare','counsellor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.student_counsellor_tertiary','Student Counsellor (Tertiary)','Welfare','counsellor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.special_needs_coordinator','Special Needs Coordinator','Welfare','counsellor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.child_protection_safeguarding_lead','Child Protection / Safeguarding Lead','Welfare','counsellor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.school_psychologist','School Psychologist','Welfare','counsellor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.school_nurse','School Nurse','Health','health',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.nursing_sister','Nursing Sister','Health','health',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.school_doctor_medical_officer','School Doctor / Medical Officer','Health','health',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.director_health_services','Director, Health Services','Health','health',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.chief_medical_director_university_clinic','Chief Medical Director (University Clinic)','Health','health',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.pharmacist_clinic','Pharmacist (Clinic)','Health','health',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.clinic_attendant_first_aider','Clinic Attendant / First Aider','Health','health',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.health_records_officer','Health Records Officer','Health','health',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.laboratory_scientist_clinic','Laboratory Scientist (Clinic)','Health','health',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.dental_officer','Dental Officer','Health','health',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.mental_health_officer','Mental Health Officer','Health','health',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.bursar','Bursar','Bursary & finance','bursar',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.deputy_bursar','Deputy Bursar','Bursary & finance','bursar',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.director_of_finance','Director of Finance','Bursary & finance','bursar',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.chief_finance_officer_schools_group','Chief Finance Officer (Schools Group)','Bursary & finance','bursar',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.finance_manager_school','Finance Manager (School)','Bursary & finance','bursar',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.accountant','Accountant','Bursary & finance','accountant',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.chief_accountant','Chief Accountant','Bursary & finance','accountant',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.senior_accountant','Senior Accountant','Bursary & finance','accountant',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.accounts_officer','Accounts Officer','Bursary & finance','accountant',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.fees_accountant','Fees Accountant','Bursary & finance','accountant',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.budget_officer','Budget Officer','Bursary & finance','accountant',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.revenue_officer','Revenue Officer','Bursary & finance','accountant',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.expenditure_control_officer','Expenditure Control Officer','Bursary & finance','accountant',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.final_accounts_officer','Final Accounts Officer','Bursary & finance','accountant',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.treasury_officer','Treasury Officer','Bursary & finance','accountant',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.account_clerk','Account Clerk','Bursary & finance','accountant',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.cashier','Cashier','Bursary & finance','cashier',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.fees_officer','Fees Officer','Bursary & finance','cashier',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.fees_collection_clerk','Fees Collection Clerk','Bursary & finance','cashier',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.bank_liaison_officer','Bank Liaison Officer','Bursary & finance','cashier',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.accounts_assistant','Accounts Assistant','Bursary & finance','cashier',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.payroll_officer','Payroll Officer','Bursary & finance','payroll',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.head_of_salaries_and_wages','Head of Salaries and Wages','Bursary & finance','payroll',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.pension_desk_officer','Pension Desk Officer','Bursary & finance','payroll',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.tax_paye_officer','Tax (PAYE) Officer','Bursary & finance','payroll',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.salaries_clerk','Salaries Clerk','Bursary & finance','payroll',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.internal_auditor','Internal Auditor','Bursary & finance','auditor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.chief_internal_auditor','Chief Internal Auditor','Bursary & finance','auditor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.audit_officer','Audit Officer','Bursary & finance','auditor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.pre_payment_audit_officer','Pre-payment Audit Officer','Bursary & finance','auditor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.external_auditor_read_only','External Auditor (read-only)','Bursary & finance','auditor',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.procurement_officer','Procurement Officer','Procurement & stores','procurement',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.head_of_procurement','Head of Procurement','Procurement & stores','procurement',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.purchasing_officer','Purchasing Officer','Procurement & stores','procurement',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.store_keeper','Store Keeper','Procurement & stores','store',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.store_officer','Store Officer','Procurement & stores','store',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.inventory_officer','Inventory Officer','Procurement & stores','store',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.assets_officer','Assets Officer','Procurement & stores','store',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.uniform_bookshop_manager','Uniform / Bookshop Manager','Procurement & stores','store',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.bookshop_attendant','Bookshop Attendant','Procurement & stores','store',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.hr_manager','HR Manager','HR & establishment','hr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.director_of_human_resources','Director of Human Resources','HR & establishment','hr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.hr_officer','HR Officer','HR & establishment','hr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.establishment_officer','Establishment Officer','HR & establishment','hr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.deputy_registrar_establishment','Deputy Registrar (Establishment)','HR & establishment','hr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.staff_welfare_officer','Staff Welfare Officer','HR & establishment','hr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.training_and_development_officer','Training and Development Officer','HR & establishment','hr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.recruitment_officer','Recruitment Officer','HR & establishment','hr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.pensions_and_records_officer_hr','Pensions and Records Officer (HR)','HR & establishment','hr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.administrative_officer','Administrative Officer','Administration','admin_officer',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.school_secretary','School Secretary','Administration','admin_officer',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.personal_assistant_to_head','Personal Assistant to Head','Administration','admin_officer',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.confidential_secretary','Confidential Secretary','Administration','admin_officer',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.front_desk_officer_receptionist','Front Desk Officer / Receptionist','Administration','admin_officer',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.clerical_officer','Clerical Officer','Administration','admin_officer',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.typist_data_entry_clerk','Typist / Data Entry Clerk','Administration','admin_officer',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.office_assistant','Office Assistant','Administration','admin_officer',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.messenger','Messenger','Administration','admin_officer',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.protocol_officer','Protocol Officer','Administration','admin_officer',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.customer_care_parent_relations_officer','Customer Care / Parent Relations Officer','Administration','admin_officer',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.records_clerk','Records Clerk','Administration','admin_officer',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.public_relations_officer','Public Relations Officer','Administration','pr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.information_officer','Information Officer','Administration','pr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.media_and_communications_officer','Media and Communications Officer','Administration','pr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.social_media_manager','Social Media Manager','Administration','pr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.marketing_admissions_marketing_officer','Marketing / Admissions Marketing Officer','Administration','pr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.events_coordinator','Events Coordinator','Administration','pr',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.legal_officer','Legal Officer','Administration','legal',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.legal_adviser','Legal Adviser','Administration','legal',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.council_legal_secretary','Council Legal Secretary','Administration','legal',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.data_protection_officer_dpo','Data Protection Officer (DPO)','Data protection','data_protection',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.information_governance_officer','Information Governance Officer','Data protection','data_protection',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.compliance_officer','Compliance Officer','Data protection','data_protection',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.librarian','Librarian','Library','librarian',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.university_librarian','University Librarian','Library','librarian',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.polytechnic_librarian','Polytechnic Librarian','Library','librarian',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.college_librarian','College Librarian','Library','librarian',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.deputy_librarian','Deputy Librarian','Library','librarian',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.head_of_cataloguing','Head of Cataloguing','Library','librarian',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.head_of_readers_services','Head of Readers'' Services','Library','librarian',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.e_library_systems_librarian','e-Library / Systems Librarian','Library','librarian',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.school_librarian','School Librarian','Library','librarian',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.library_officer','Library Officer','Library','library_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.library_assistant','Library Assistant','Library','library_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.library_attendant','Library Attendant','Library','library_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.bindery_officer','Bindery Officer','Library','library_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.archivist','Archivist','Library','library_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.chief_security_officer','Chief Security Officer','Security','security_head',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.head_of_security','Head of Security','Security','security_head',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.security_supervisor','Security Supervisor','Security','security_head',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.safety_officer_hse_officer','Safety Officer / HSE Officer','Security','security_head',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.security_guard','Security Guard','Security','security_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.gate_keeper','Gate Keeper','Security','security_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.patrol_officer','Patrol Officer','Security','security_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.cctv_operator','CCTV Operator','Security','security_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.fire_safety_officer','Fire Safety Officer','Security','security_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.community_vigilance_liaison','Community Vigilance Liaison','Security','security_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.transport_officer','Transport Officer','Transport','transport_head',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.head_of_transport','Head of Transport','Transport','transport_head',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.fleet_manager','Fleet Manager','Transport','transport_head',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.school_bus_driver','School Bus Driver','Transport','driver',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.driver','Driver','Transport','driver',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.bus_attendant_escort','Bus Attendant / Escort','Transport','driver',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.dispatch_rider','Dispatch Rider','Transport','driver',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.director_of_works_and_services','Director of Works and Services','Works & maintenance','works',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.works_superintendent','Works Superintendent','Works & maintenance','works',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.maintenance_officer','Maintenance Officer','Works & maintenance','works',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.facility_manager','Facility Manager','Works & maintenance','works',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.electrician','Electrician','Works & maintenance','works',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.plumber','Plumber','Works & maintenance','works',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.carpenter','Carpenter','Works & maintenance','works',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.mechanic','Mechanic','Works & maintenance','works',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.generator_power_plant_operator','Generator / Power Plant Operator','Works & maintenance','works',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.water_works_operator','Water Works Operator','Works & maintenance','works',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.estate_officer','Estate Officer','Works & maintenance','works',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.horticulturist_landscape_officer','Horticulturist / Landscape Officer','Works & maintenance','works',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.cleaner','Cleaner','Support','support_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.janitor','Janitor','Support','support_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.gardener_groundsman','Gardener / Groundsman','Support','support_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.laundry_attendant','Laundry Attendant','Support','support_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.porter','Porter','Support','support_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.hall_porter','Hall Porter','Support','support_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.cook','Cook','Support','support_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.steward','Steward','Support','support_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.labourer','Labourer','Support','support_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.catering_manager','Catering Manager','Catering','catering',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.kitchen_supervisor','Kitchen Supervisor','Catering','catering',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.dietician_nutrition_officer','Dietician / Nutrition Officer','Catering','catering',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.cafeteria_manager','Cafeteria Manager','Catering','catering',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.school_feeding_programme_coordinator','School Feeding Programme Coordinator','Catering','catering',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.director_of_ict_mis','Director of ICT / MIS','ICT','ict_head',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.head_of_ict','Head of ICT','ICT','ict_head',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.systems_administrator','Systems Administrator','ICT','ict_head',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.network_administrator','Network Administrator','ICT','ict_head',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.database_administrator','Database Administrator','ICT','ict_head',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.information_security_officer','Information Security Officer','ICT','ict_head',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.ict_officer','ICT Officer','ICT','ict_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.it_support_officer','IT Support Officer','ICT','ict_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.web_portal_administrator','Web / Portal Administrator','ICT','ict_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.data_officer','Data Officer','ICT','ict_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.programmer_analyst','Programmer / Analyst','ICT','ict_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.technician_ict','Technician (ICT)','ICT','ict_staff',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.pta_chairman','PTA Chairman','Community','pta',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.pta_vice_chairman','PTA Vice Chairman','Community','pta',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.pta_secretary','PTA Secretary','Community','pta',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.pta_treasurer','PTA Treasurer','Community','pta',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.pta_financial_secretary','PTA Financial Secretary','Community','pta',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.pta_class_representative','PTA Class Representative','Community','pta',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.sbmc_member_school_based_management_committee','SBMC Member (School-Based Management Committee)','Community','pta',ARRAY['nursery','primary','secondary']::text[]),
  ('ng.parent','Parent','Community','parent',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.guardian','Guardian','Community','parent',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.sponsor','Sponsor','Community','parent',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.foster_parent_carer','Foster Parent / Carer','Community','parent',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.student','Student','Community','student',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.pupil','Pupil','Community','student',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.undergraduate','Undergraduate','Community','student',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.postgraduate_student','Postgraduate Student','Community','student',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.part_time_sandwich_student','Part-time / Sandwich Student','Community','student',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.distance_learning_student','Distance Learning Student','Community','student',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.pre_degree_jupeb_student','Pre-degree / JUPEB Student','Community','student',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.exchange_student','Exchange Student','Community','student',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.head_boy','Head Boy','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.head_girl','Head Girl','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.senior_prefect','Senior Prefect','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.assistant_head_boy_head_girl','Assistant Head Boy / Head Girl','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.labour_prefect','Labour Prefect','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.sports_prefect','Sports Prefect','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.library_prefect','Library Prefect','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.chapel_mosque_prefect','Chapel / Mosque Prefect','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.dining_hall_prefect','Dining Hall Prefect','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.social_prefect','Social Prefect','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.house_captain','House Captain','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.class_captain_class_monitor','Class Captain / Class Monitor','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.class_representative_tertiary','Class Representative (Tertiary)','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.course_representative','Course Representative','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.student_union_president','Student Union President','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.student_union_executive','Student Union Executive','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.hall_chairman','Hall Chairman','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.departmental_association_president','Departmental Association President','Community','student_leader',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.alumni_relations_officer','Alumni Relations Officer','Community','alumni',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.old_students_association_president','Old Students'' Association President','Community','alumni',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.advancement_endowment_officer','Advancement / Endowment Officer','Community','alumni',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.development_office_director','Development Office Director','Community','alumni',ARRAY['nursery','primary','secondary','polytechnic','college_of_education','university']::text[]),
  ('ng.vice_chancellor','Vice-Chancellor','University principal officers','head_of_institution',ARRAY['university']::text[]),
  ('ng.acting_vice_chancellor','Acting Vice-Chancellor','University principal officers','head_of_institution',ARRAY['university']::text[]),
  ('ng.deputy_vice_chancellor_academic','Deputy Vice-Chancellor (Academic)','University principal officers','deputy_academic',ARRAY['university']::text[]),
  ('ng.deputy_vice_chancellor_research_innovation_and_development','Deputy Vice-Chancellor (Research, Innovation and Development)','University principal officers','deputy_academic',ARRAY['university']::text[]),
  ('ng.director_academic_planning','Director, Academic Planning','University principal officers','deputy_academic',ARRAY['university']::text[]),
  ('ng.director_quality_assurance_university','Director, Quality Assurance (University)','University principal officers','deputy_academic',ARRAY['university']::text[]),
  ('ng.director_centre_for_distance_learning','Director, Centre for Distance Learning','University principal officers','deputy_academic',ARRAY['university']::text[]),
  ('ng.director_general_studies','Director, General Studies','University principal officers','deputy_academic',ARRAY['university']::text[]),
  ('ng.director_pre_degree_foundation_studies','Director, Pre-degree / Foundation Studies','University principal officers','deputy_academic',ARRAY['university']::text[]),
  ('ng.director_entrepreneurship_centre','Director, Entrepreneurship Centre','University principal officers','deputy_academic',ARRAY['university']::text[]),
  ('ng.director_sandwich_part_time_programmes','Director, Sandwich / Part-time Programmes','University principal officers','deputy_academic',ARRAY['university']::text[]),
  ('ng.deputy_vice_chancellor_administration','Deputy Vice-Chancellor (Administration)','University principal officers','deputy_admin',ARRAY['university']::text[]),
  ('ng.deputy_vice_chancellor_management_services','Deputy Vice-Chancellor (Management Services)','University principal officers','deputy_admin',ARRAY['university']::text[]),
  ('ng.rector','Rector','Polytechnic principal officers','head_of_institution',ARRAY['polytechnic']::text[]),
  ('ng.acting_rector','Acting Rector','Polytechnic principal officers','head_of_institution',ARRAY['polytechnic']::text[]),
  ('ng.deputy_rector_academics','Deputy Rector (Academics)','Polytechnic principal officers','deputy_academic',ARRAY['polytechnic']::text[]),
  ('ng.director_academic_planning_polytechnic','Director, Academic Planning (Polytechnic)','Polytechnic principal officers','deputy_academic',ARRAY['polytechnic']::text[]),
  ('ng.director_quality_assurance_polytechnic','Director, Quality Assurance (Polytechnic)','Polytechnic principal officers','deputy_academic',ARRAY['polytechnic']::text[]),
  ('ng.director_consultancy_services','Director, Consultancy Services','Polytechnic principal officers','deputy_academic',ARRAY['polytechnic']::text[]),
  ('ng.director_centre_for_continuing_education','Director, Centre for Continuing Education','Polytechnic principal officers','deputy_academic',ARRAY['polytechnic']::text[]),
  ('ng.deputy_rector_administration','Deputy Rector (Administration)','Polytechnic principal officers','deputy_admin',ARRAY['polytechnic']::text[]),
  ('ng.provost','Provost','College of Education principal officers','head_of_institution',ARRAY['college_of_education']::text[]),
  ('ng.acting_provost','Acting Provost','College of Education principal officers','head_of_institution',ARRAY['college_of_education']::text[]),
  ('ng.deputy_provost_academics','Deputy Provost (Academics)','College of Education principal officers','deputy_academic',ARRAY['college_of_education']::text[]),
  ('ng.director_degree_programmes_affiliation','Director, Degree Programmes (affiliation)','College of Education principal officers','deputy_academic',ARRAY['college_of_education']::text[]),
  ('ng.director_teaching_practice','Director, Teaching Practice','College of Education principal officers','deputy_academic',ARRAY['college_of_education']::text[]),
  ('ng.director_general_studies_coe','Director, General Studies (COE)','College of Education principal officers','deputy_academic',ARRAY['college_of_education']::text[]),
  ('ng.deputy_provost_administration','Deputy Provost (Administration)','College of Education principal officers','deputy_admin',ARRAY['college_of_education']::text[]),
  ('ng.registrar','Registrar','Registry','registrar',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.deputy_registrar','Deputy Registrar','Registry','registrar',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.deputy_registrar_academic','Deputy Registrar (Academic)','Registry','registrar',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.deputy_registrar_council_affairs','Deputy Registrar (Council Affairs)','Registry','registrar',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.principal_assistant_registrar','Principal Assistant Registrar','Registry','registrar',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.senior_assistant_registrar','Senior Assistant Registrar','Registry','registrar',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.assistant_registrar','Assistant Registrar','Registry','registrar',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.faculty_officer','Faculty Officer','Registry','registrar',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.school_officer_polytechnic','School Officer (Polytechnic)','Registry','registrar',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.departmental_administrative_officer','Departmental Administrative Officer','Registry','registrar',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.senate_academic_board_secretary','Senate / Academic Board Secretary','Registry','registrar',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.convocation_officer','Convocation Officer','Registry','registrar',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.admissions_officer_tertiary','Admissions Officer (Tertiary)','Registry','admissions',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.director_admissions','Director, Admissions','Registry','admissions',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.jamb_caps_admissions_desk_officer','JAMB / CAPS Admissions Desk Officer','Registry','admissions',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.matriculation_officer','Matriculation Officer','Registry','admissions',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.post_utme_screening_officer','Post-UTME Screening Officer','Registry','admissions',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.deputy_registrar_exams_and_records','Deputy Registrar (Exams and Records)','Exams & records','exams_records',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.head_exams_and_records','Head, Exams and Records','Exams & records','exams_records',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.exams_and_records_officer','Exams and Records Officer','Exams & records','exams_records',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.transcript_officer','Transcript Officer','Exams & records','exams_records',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.certificate_verification_officer','Certificate / Verification Officer','Exams & records','exams_records',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.results_processing_officer','Results Processing Officer','Exams & records','exams_records',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.departmental_exams_officer','Departmental Exams Officer','Exams & records','exams_officer',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.faculty_exams_officer','Faculty Exams Officer','Exams & records','exams_officer',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.chief_invigilator','Chief Invigilator','Exams & records','exams_officer',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.invigilator','Invigilator','Exams & records','exams_officer',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.exam_malpractice_committee_secretary','Exam Malpractice Committee Secretary','Exams & records','exams_officer',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.cbt_centre_manager','CBT Centre Manager','Exams & records','cbt',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.cbt_technical_officer','CBT Technical Officer','Exams & records','cbt',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.directorate_of_cbt_director','Directorate of CBT Director','Exams & records','cbt',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.dean_of_faculty','Dean of Faculty','Faculties & schools','dean',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.dean_of_school_polytechnic','Dean of School (Polytechnic)','Faculties & schools','dean',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.dean_of_college','Dean of College','Faculties & schools','dean',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.provost_of_college_university','Provost of College (University)','Faculties & schools','dean',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.dean_postgraduate_school','Dean, Postgraduate School','Faculties & schools','dean',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.provost_postgraduate_college','Provost, Postgraduate College','Faculties & schools','dean',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.sub_dean','Sub-Dean','Faculties & schools','dean',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.deputy_dean','Deputy Dean','Faculties & schools','dean',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.associate_dean','Associate Dean','Faculties & schools','dean',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.head_of_department_hod','Head of Department (HOD)','Departments','hod',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.acting_head_of_department','Acting Head of Department','Departments','hod',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.programme_coordinator','Programme Coordinator','Departments','hod',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.postgraduate_coordinator','Postgraduate Coordinator','Departments','hod',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.unit_head','Unit Head','Departments','hod',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.head_of_unit_polytechnic','Head of Unit (Polytechnic)','Departments','hod',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.director_of_institute_centre','Director of Institute / Centre','Departments','hod',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.clinical_coordinator','Clinical Coordinator','Departments','hod',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.curriculum_accreditation_coordinator','Curriculum / Accreditation Coordinator','Departments','hod',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.level_adviser','Level Adviser','Departments','level_adviser',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.course_adviser','Course Adviser','Departments','level_adviser',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.academic_adviser','Academic Adviser','Departments','level_adviser',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.year_coordinator','Year Coordinator','Departments','level_adviser',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.project_supervisor','Project Supervisor','Departments','level_adviser',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.postgraduate_supervisor','Postgraduate Supervisor','Departments','level_adviser',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.staff_adviser_student_association','Staff Adviser (Student Association)','Departments','level_adviser',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.graduate_assistant','Graduate Assistant','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.assistant_lecturer','Assistant Lecturer','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.lecturer_ii','Lecturer II','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.lecturer_i','Lecturer I','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.senior_lecturer','Senior Lecturer','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.reader_associate_professor','Reader / Associate Professor','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.professor','Professor','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.emeritus_professor','Emeritus Professor','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.visiting_adjunct_lecturer','Visiting / Adjunct Lecturer','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.sabbatical_lecturer','Sabbatical Lecturer','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.assistant_lecturer_polytechnic','Assistant Lecturer (Polytechnic)','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.lecturer_iii_polytechnic','Lecturer III (Polytechnic)','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.principal_lecturer','Principal Lecturer','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.chief_lecturer','Chief Lecturer','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.instructor_polytechnic','Instructor (Polytechnic)','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.senior_instructor','Senior Instructor','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.principal_instructor','Principal Instructor','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.chief_instructor','Chief Instructor','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.technologist','Technologist','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.senior_technologist','Senior Technologist','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.chief_technologist','Chief Technologist','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.teaching_practice_supervisor','Teaching Practice Supervisor','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.clinical_lecturer_consultant','Clinical Lecturer / Consultant','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.tutor_distance_learning','Tutor (Distance Learning)','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.facilitator_open_and_distance_learning','Facilitator (Open and Distance Learning)','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.demonstrator_laboratory_instructor','Demonstrator / Laboratory Instructor','Academic staff','teacher',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.laboratory_technologist','Laboratory Technologist','Academic staff','lab_workshop',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.laboratory_assistant','Laboratory Assistant','Academic staff','lab_workshop',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.workshop_technician','Workshop Technician','Academic staff','lab_workshop',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.studio_technician','Studio Technician','Academic staff','lab_workshop',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.farm_manager_teaching_and_research_farm','Farm Manager (Teaching and Research Farm)','Academic staff','lab_workshop',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.farm_attendant','Farm Attendant','Academic staff','lab_workshop',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.museum_herbarium_curator','Museum / Herbarium Curator','Academic staff','lab_workshop',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.director_research_and_development','Director, Research and Development','Research','research',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.research_fellow','Research Fellow','Research','research',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.senior_research_fellow','Senior Research Fellow','Research','research',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.research_grants_officer','Research Grants Officer','Research','research',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.ethics_committee_secretary','Ethics Committee Secretary','Research','research',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.intellectual_property_tech_transfer_officer','Intellectual Property / Tech Transfer Officer','Research','research',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.journal_editor','Journal Editor','Research','research',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.dean_of_student_affairs','Dean of Student Affairs','Student affairs','student_affairs',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.deputy_dean_of_student_affairs','Deputy Dean of Student Affairs','Student affairs','student_affairs',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.student_affairs_officer','Student Affairs Officer','Student affairs','student_affairs',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.hall_warden','Hall Warden','Student affairs','student_affairs',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.hall_master_hall_mistress','Hall Master / Hall Mistress','Student affairs','student_affairs',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.hall_supervisor','Hall Supervisor','Student affairs','student_affairs',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.sports_director_tertiary','Sports Director (Tertiary)','Student affairs','student_affairs',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.sports_coach_tertiary','Sports Coach (Tertiary)','Student affairs','student_affairs',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.students_disciplinary_committee_secretary','Students'' Disciplinary Committee Secretary','Student affairs','student_affairs',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.students_with_disabilities_desk_officer','Students with Disabilities Desk Officer','Student affairs','student_affairs',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.international_students_officer','International Students Officer','Student affairs','student_affairs',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.scholarship_and_bursary_desk_officer','Scholarship and Bursary Desk Officer','Student affairs','student_affairs',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.nysc_mobilisation_officer','NYSC Mobilisation Officer','Student affairs','student_affairs',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.nelfund_student_loans_desk_officer','NELFUND / Student Loans Desk Officer','Student affairs','student_affairs',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.hostel_manager','Hostel Manager','Student affairs','hostel_head',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.hall_administrator','Hall Administrator','Student affairs','hostel_head',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.accommodation_officer','Accommodation Officer','Student affairs','hostel_head',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.director_siwes_industrial_training','Director, SIWES / Industrial Training','SIWES & industry','siwes',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.siwes_coordinator_institution','SIWES Coordinator (Institution)','SIWES & industry','siwes',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.departmental_siwes_it_coordinator','Departmental SIWES / IT Coordinator','SIWES & industry','siwes',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.industrial_liaison_officer','Industrial Liaison Officer','SIWES & industry','siwes',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.industry_based_supervisor_external','Industry-based Supervisor (external)','SIWES & industry','siwes',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.career_services_placement_officer','Career Services / Placement Officer','SIWES & industry','siwes',ARRAY['polytechnic','college_of_education','university']::text[]),
  ('ng.teaching_practice_coordinator','Teaching Practice Coordinator','SIWES & industry','siwes',ARRAY['polytechnic','college_of_education','university']::text[])
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, template_code=EXCLUDED.template_code, institution_types=EXCLUDED.institution_types;
INSERT INTO public.sod_template_conflicts (template_a, template_b) VALUES
  ('accountant','auditor'),
  ('auditor','bursar'),
  ('auditor','cashier'),
  ('auditor','payroll'),
  ('auditor','procurement'),
  ('bursar','payroll'),
  ('data_protection','ict_head')
ON CONFLICT DO NOTHING;
INSERT INTO public.sod_permission_rules (permission_a, permission_b, description) VALUES
  ('payroll.prepare','payroll.approve','Preparer and approver of the same payroll line must be different people'),
  ('expenses.create','expenses.approve','Raiser and approver of the same expense must be different people'),
  ('payments.record_cash','payments.reconcile','Cash recorded by a person is reconciled by someone else'),
  ('procurement.request','procurement.approve','Requester cannot approve own purchase order')
ON CONFLICT DO NOTHING;
-- <<< generated <<<

-- 3. Lock the catalog: API roles never write; even the owner cannot weaken a mandatory row ----
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.permission_catalog, public.role_guardrail_catalog, public.role_templates,
  public.role_template_permissions, public.role_catalog, public.sod_template_conflicts, public.sod_permission_rules,
  public.org_role_permission_settings, public.org_role_custom_grants, public.user_role_assignments
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.permission_catalog, public.role_guardrail_catalog, public.role_templates, public.role_template_permissions,
  public.role_catalog, public.sod_template_conflicts, public.sod_permission_rules, public.org_role_permission_settings,
  public.org_role_custom_grants, public.user_role_assignments TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.role_catalog_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'role_template_permissions' THEN
    IF TG_OP = 'DELETE' AND OLD.kind = 'mandatory' THEN RAISE EXCEPTION 'mandatory permission % on % cannot be removed', OLD.permission_code, OLD.template_code USING ERRCODE = '42501'; END IF;
    IF TG_OP = 'UPDATE' AND OLD.kind = 'mandatory' AND (NEW.kind <> 'mandatory' OR NEW.permission_code <> OLD.permission_code OR NEW.template_code <> OLD.template_code) THEN
      RAISE EXCEPTION 'mandatory permission % on % cannot be downgraded', OLD.permission_code, OLD.template_code USING ERRCODE = '42501'; END IF;
  ELSIF TG_TABLE_NAME = 'role_templates' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'role templates cannot be deleted' USING ERRCODE = '42501'; END IF;
    IF NOT (OLD.guardrails <@ NEW.guardrails) THEN RAISE EXCEPTION 'guardrails on % cannot be removed', OLD.code USING ERRCODE = '42501'; END IF;
  ELSIF TG_TABLE_NAME = 'role_catalog' THEN
    IF TG_OP = 'UPDATE' AND OLD.org_id IS NOT NULL AND NEW.template_code <> OLD.template_code THEN
      RAISE EXCEPTION 'a custom role keeps its base role template' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS trg_role_template_permissions_guard ON public.role_template_permissions;
CREATE TRIGGER trg_role_template_permissions_guard BEFORE UPDATE OR DELETE ON public.role_template_permissions FOR EACH ROW EXECUTE FUNCTION public.role_catalog_guard();
DROP TRIGGER IF EXISTS trg_role_templates_guard ON public.role_templates;
CREATE TRIGGER trg_role_templates_guard BEFORE UPDATE OR DELETE ON public.role_templates FOR EACH ROW EXECUTE FUNCTION public.role_catalog_guard();
DROP TRIGGER IF EXISTS trg_role_catalog_guard ON public.role_catalog;
CREATE TRIGGER trg_role_catalog_guard BEFORE UPDATE ON public.role_catalog FOR EACH ROW EXECUTE FUNCTION public.role_catalog_guard();

-- Org settings may only toggle the role's declared OPTIONAL permissions.
CREATE OR REPLACE FUNCTION public.org_role_settings_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_kind text;
BEGIN
  SELECT tp.kind INTO v_kind FROM public.role_catalog r JOIN public.role_template_permissions tp ON tp.template_code = r.template_code
   WHERE r.code = NEW.role_code AND tp.permission_code = NEW.permission_code;
  IF v_kind = 'mandatory' THEN RAISE EXCEPTION 'permission % is mandatory for role % and cannot be toggled', NEW.permission_code, NEW.role_code USING ERRCODE = '42501'; END IF;
  IF v_kind IS NULL THEN RAISE EXCEPTION 'permission % is not an optional permission of role %', NEW.permission_code, NEW.role_code USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.role_catalog r WHERE r.code = NEW.role_code AND r.org_id IS NOT NULL AND r.org_id <> NEW.org_id) THEN
    RAISE EXCEPTION 'custom role belongs to another organisation' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_org_role_settings_guard ON public.org_role_permission_settings;
CREATE TRIGGER trg_org_role_settings_guard BEFORE INSERT OR UPDATE ON public.org_role_permission_settings FOR EACH ROW EXECUTE FUNCTION public.org_role_settings_guard();

-- Custom grants can never carry a protected permission.
CREATE OR REPLACE FUNCTION public.org_role_custom_grants_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.permission_code IS NOT NULL AND EXISTS (SELECT 1 FROM public.permission_catalog p WHERE p.code = NEW.permission_code AND p.protected) THEN
    RAISE EXCEPTION 'protected permission % can only be held through a catalog role that carries it', NEW.permission_code USING ERRCODE = '42501'; END IF;
  IF NEW.custom_key IS NOT NULL AND NEW.custom_key !~ '^custom\.[a-z0-9_.-]{2,60}$' THEN
    RAISE EXCEPTION 'custom permission keys must look like custom.<name>' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.role_catalog r WHERE r.code = NEW.role_code AND r.org_id IS NOT NULL AND r.org_id <> NEW.org_id) THEN
    RAISE EXCEPTION 'custom role belongs to another organisation' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_org_role_custom_grants_guard ON public.org_role_custom_grants;
CREATE TRIGGER trg_org_role_custom_grants_guard BEFORE INSERT OR UPDATE ON public.org_role_custom_grants FOR EACH ROW EXECUTE FUNCTION public.org_role_custom_grants_guard();

-- Assignment guard: tenant, self-grant, separation of duties.
CREATE OR REPLACE FUNCTION public.user_role_assignments_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_role public.role_catalog%ROWTYPE; v_conflict text;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  SELECT * INTO v_role FROM public.role_catalog WHERE code = NEW.role_code;
  IF v_role.org_id IS NOT NULL AND v_role.org_id <> NEW.org_id THEN RAISE EXCEPTION 'custom role belongs to another organisation' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = NEW.user_id AND u.school_id = NEW.org_id) THEN
    RAISE EXCEPTION 'user is not a member of this organisation' USING ERRCODE = '42501'; END IF;
  IF NEW.assigned_by IS NOT NULL AND NEW.assigned_by = NEW.user_id THEN
    RAISE EXCEPTION 'no_self_role_grant: you cannot assign a role to yourself' USING ERRCODE = '42501'; END IF;
  SELECT r2.name INTO v_conflict FROM public.user_role_assignments a JOIN public.role_catalog r2 ON r2.code = a.role_code
    JOIN public.sod_template_conflicts c ON (c.template_a = r2.template_code AND c.template_b = v_role.template_code)
                                         OR (c.template_b = r2.template_code AND c.template_a = v_role.template_code)
   WHERE a.org_id = NEW.org_id AND a.user_id = NEW.user_id AND a.status = 'active' AND a.id <> NEW.id LIMIT 1;
  IF v_conflict IS NOT NULL THEN
    RAISE EXCEPTION 'separation of duties: % conflicts with the existing role %', v_role.name, v_conflict USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_user_role_assignments_guard ON public.user_role_assignments;
CREATE TRIGGER trg_user_role_assignments_guard BEFORE INSERT OR UPDATE ON public.user_role_assignments FOR EACH ROW EXECUTE FUNCTION public.user_role_assignments_guard();

-- 4. Audit (append-only audit_logs, bridged to audit_chain by 016) ------------------------
CREATE OR REPLACE FUNCTION public.role_change_audit() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid; v_id uuid; v_actor uuid := auth.uid();
BEGIN
  IF TG_TABLE_NAME = 'role_catalog' THEN v_org := coalesce(NEW.org_id, OLD.org_id); IF v_org IS NULL THEN RETURN NULL; END IF;
  ELSE v_org := CASE WHEN TG_OP = 'DELETE' THEN OLD.org_id ELSE NEW.org_id END; END IF;
  IF TG_TABLE_NAME IN ('org_role_custom_grants', 'user_role_assignments') THEN v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END; END IF;
  INSERT INTO public.audit_logs (school_id, user_id, action, table_name, record_id, old_value, new_value)
  VALUES (v_org, CASE WHEN EXISTS (SELECT 1 FROM public.users WHERE id = v_actor) THEN v_actor END,
          'role.' || lower(TG_OP), TG_TABLE_NAME, v_id,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END || jsonb_build_object('actor', v_actor));
  RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['org_role_permission_settings','org_role_custom_grants','user_role_assignments','role_catalog'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.role_change_audit()', t);
  END LOOP; END $$;

-- 5. Effective permissions ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.effective_permissions(p_org uuid, p_user uuid DEFAULT NULL)
RETURNS TABLE (permission_code text, kind text, role_codes text[], scopes jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH me AS (SELECT coalesce(p_user, auth.uid()) uid),
  allowed AS (SELECT (SELECT uid FROM me) = auth.uid() OR public.can_administer_org(p_org) ok),
  a AS (SELECT ura.* FROM public.user_role_assignments ura, me, allowed
         WHERE allowed.ok AND ura.org_id = p_org AND ura.user_id = me.uid AND ura.status = 'active'),
  g AS (
    SELECT tp.permission_code, tp.kind, a.role_code, a.scope_type, a.scope_ref
      FROM a JOIN public.role_catalog r ON r.code = a.role_code
      JOIN public.role_template_permissions tp ON tp.template_code = r.template_code
      LEFT JOIN public.org_role_permission_settings s ON s.org_id = p_org AND s.role_code = a.role_code AND s.permission_code = tp.permission_code
     WHERE tp.kind = 'mandatory' OR coalesce(s.enabled, tp.default_on)
    UNION ALL
    SELECT coalesce(cg.permission_code, cg.custom_key), 'custom', a.role_code, a.scope_type, a.scope_ref
      FROM a JOIN public.org_role_custom_grants cg ON cg.org_id = p_org AND cg.role_code = a.role_code)
  SELECT permission_code, min(kind), array_agg(DISTINCT role_code ORDER BY role_code),
         jsonb_agg(DISTINCT jsonb_build_object('type', scope_type, 'ref', scope_ref))
    FROM g GROUP BY permission_code;
$$;
CREATE OR REPLACE FUNCTION public.has_permission(p_org uuid, p_permission text, p_scope_type text DEFAULT NULL, p_scope_ref text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.effective_permissions(p_org, auth.uid()) e
    WHERE e.permission_code = p_permission
      AND (p_scope_type IS NULL OR e.scopes @> '[{"type":"org"}]'::jsonb
           OR e.scopes @> jsonb_build_array(jsonb_build_object('type', p_scope_type, 'ref', p_scope_ref))));
$$;

-- Admin authority for role management: legacy org admin/principal, or a role carrying the permission.
CREATE OR REPLACE FUNCTION public.can_manage_roles(p_org uuid, p_perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.can_administer_org(p_org) OR public.has_permission(p_org, p_perm);
$$;

-- 6. RPCs (the only write path) -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.role_assign(p_org uuid, p_user uuid, p_role text, p_scope_type text DEFAULT NULL, p_scope_ref text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_scope text;
BEGIN
  IF NOT public.can_manage_roles(p_org, 'roles.assign') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() = p_user THEN RAISE EXCEPTION 'no_self_role_grant: you cannot assign a role to yourself' USING ERRCODE = '42501'; END IF;
  SELECT t.default_scope INTO v_scope FROM public.role_catalog r JOIN public.role_templates t ON t.code = r.template_code
   WHERE r.code = p_role AND (r.org_id IS NULL OR r.org_id = p_org);
  IF v_scope IS NULL THEN RAISE EXCEPTION 'unknown role %', p_role; END IF;
  INSERT INTO public.user_role_assignments (org_id, user_id, role_code, scope_type, scope_ref, assigned_by)
  VALUES (p_org, p_user, p_role, coalesce(p_scope_type, v_scope), p_scope_ref, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.role_unassign(p_assignment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.user_role_assignments%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.user_role_assignments WHERE id = p_assignment;
  IF v.id IS NULL OR NOT public.can_manage_roles(v.org_id, 'roles.assign') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  UPDATE public.user_role_assignments SET status = 'ended', ended_at = now(), ended_by = auth.uid() WHERE id = p_assignment AND status = 'active';
END $$;
CREATE OR REPLACE FUNCTION public.role_set_optional(p_org uuid, p_role text, p_permission text, p_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.can_manage_roles(p_org, 'roles.configure') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_role_assignments WHERE org_id = p_org AND user_id = auth.uid() AND role_code = p_role AND status = 'active') THEN
    RAISE EXCEPTION 'no_self_role_grant: you cannot change permissions of a role you hold' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.org_role_permission_settings (org_id, role_code, permission_code, enabled, updated_by)
  VALUES (p_org, p_role, p_permission, p_enabled, auth.uid())
  ON CONFLICT (org_id, role_code, permission_code) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now();
END $$;
CREATE OR REPLACE FUNCTION public.role_add_custom_grant(p_org uuid, p_role text, p_permission text, p_custom_key text DEFAULT NULL, p_context jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.can_manage_roles(p_org, 'roles.configure') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_role_assignments WHERE org_id = p_org AND user_id = auth.uid() AND role_code = p_role AND status = 'active') THEN
    RAISE EXCEPTION 'no_self_role_grant: you cannot change permissions of a role you hold' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.org_role_custom_grants (org_id, role_code, permission_code, custom_key, context, created_by)
  VALUES (p_org, p_role, p_permission, p_custom_key, coalesce(p_context, '{}'::jsonb), auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION public.role_remove_custom_grant(p_grant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM public.org_role_custom_grants WHERE id = p_grant;
  IF v_org IS NULL OR NOT public.can_manage_roles(v_org, 'roles.configure') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  DELETE FROM public.org_role_custom_grants WHERE id = p_grant;
END $$;
CREATE OR REPLACE FUNCTION public.role_create_custom(p_org uuid, p_base_role text, p_name text, p_description text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_base public.role_catalog%ROWTYPE; v_code text;
BEGIN
  IF NOT public.can_manage_roles(p_org, 'roles.configure') THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_base FROM public.role_catalog WHERE code = p_base_role AND (org_id IS NULL OR org_id = p_org);
  IF v_base.code IS NULL THEN RAISE EXCEPTION 'unknown base role %', p_base_role; END IF;
  IF length(trim(coalesce(p_name, ''))) < 3 THEN RAISE EXCEPTION 'role name too short' USING ERRCODE = '22023'; END IF;
  v_code := 'custom.' || replace(p_org::text, '-', '') || '.' || trim(both '_' from regexp_replace(lower(p_name), '[^a-z0-9]+', '_', 'g'));
  INSERT INTO public.role_catalog (code, name, category, template_code, institution_types, org_id, base_role_code, description, created_by)
  VALUES (v_code, trim(p_name), 'Custom', v_base.template_code, v_base.institution_types, p_org, v_base.code, p_description, auth.uid());
  RETURN v_code;
END $$;
-- Full context of a role for the admin panel: locked mandatory, optional toggles, guardrails, custom grants.
CREATE OR REPLACE FUNCTION public.role_context(p_org uuid, p_role text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN NOT (public.get_my_school_id() = p_org OR public.can_administer_org(p_org)) THEN NULL ELSE (
  SELECT jsonb_build_object(
    'role', jsonb_build_object('code', r.code, 'name', r.name, 'category', r.category, 'template', r.template_code,
                               'institution_types', r.institution_types, 'custom', r.org_id IS NOT NULL, 'base_role', r.base_role_code),
    'scope', t.default_scope, 'data_sensitivity', t.data_sensitivity, 'approval_limit_ngn', t.approval_limit_ngn,
    'guardrails', (SELECT coalesce(jsonb_agg(jsonb_build_object('code', g.code, 'description', g.description) ORDER BY g.code), '[]')
                     FROM public.role_guardrail_catalog g WHERE g.code = ANY (t.guardrails)),
    'mandatory', (SELECT coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'module', p.module, 'label', p.label, 'sensitivity', p.sensitivity, 'protected', p.protected) ORDER BY p.module, p.code), '[]')
                    FROM public.role_template_permissions tp JOIN public.permission_catalog p ON p.code = tp.permission_code
                   WHERE tp.template_code = t.code AND tp.kind = 'mandatory'),
    'optional', (SELECT coalesce(jsonb_agg(jsonb_build_object('code', p.code, 'module', p.module, 'label', p.label, 'sensitivity', p.sensitivity, 'protected', p.protected,
                                                              'default_on', tp.default_on, 'enabled', coalesce(s.enabled, tp.default_on)) ORDER BY p.module, p.code), '[]')
                   FROM public.role_template_permissions tp JOIN public.permission_catalog p ON p.code = tp.permission_code
                   LEFT JOIN public.org_role_permission_settings s ON s.org_id = p_org AND s.role_code = r.code AND s.permission_code = p.code
                  WHERE tp.template_code = t.code AND tp.kind = 'optional'),
    'custom_grants', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', cg.id, 'permission', cg.permission_code, 'custom_key', cg.custom_key, 'context', cg.context)), '[]')
                        FROM public.org_role_custom_grants cg WHERE cg.org_id = p_org AND cg.role_code = r.code),
    'sod_conflicts', (SELECT coalesce(jsonb_agg(DISTINCT CASE WHEN c.template_a = t.code THEN c.template_b ELSE c.template_a END), '[]')
                        FROM public.sod_template_conflicts c WHERE t.code IN (c.template_a, c.template_b)))
    FROM public.role_catalog r JOIN public.role_templates t ON t.code = r.template_code
   WHERE r.code = p_role AND (r.org_id IS NULL OR r.org_id = p_org)) END;
$$;
REVOKE ALL ON FUNCTION public.effective_permissions(uuid, uuid), public.has_permission(uuid, text, text, text), public.can_manage_roles(uuid, text),
  public.role_assign(uuid, uuid, text, text, text), public.role_unassign(uuid), public.role_set_optional(uuid, text, text, boolean),
  public.role_add_custom_grant(uuid, text, text, text, jsonb), public.role_remove_custom_grant(uuid), public.role_create_custom(uuid, text, text, text),
  public.role_context(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.effective_permissions(uuid, uuid), public.has_permission(uuid, text, text, text), public.can_manage_roles(uuid, text),
  public.role_assign(uuid, uuid, text, text, text), public.role_unassign(uuid), public.role_set_optional(uuid, text, text, boolean),
  public.role_add_custom_grant(uuid, text, text, text, jsonb), public.role_remove_custom_grant(uuid), public.role_create_custom(uuid, text, text, text),
  public.role_context(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.role_catalog_guard(), public.org_role_settings_guard(), public.org_role_custom_grants_guard(),
  public.user_role_assignments_guard(), public.role_change_audit() FROM PUBLIC, anon, authenticated;

-- 7. RLS -------------------------------------------------------------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['permission_catalog','role_guardrail_catalog','role_templates','role_template_permissions','role_catalog',
    'sod_template_conflicts','sod_permission_rules','org_role_permission_settings','org_role_custom_grants','user_role_assignments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP; END $$;
DROP POLICY IF EXISTS catalog_read ON public.permission_catalog;            CREATE POLICY catalog_read ON public.permission_catalog FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS catalog_read ON public.role_guardrail_catalog;        CREATE POLICY catalog_read ON public.role_guardrail_catalog FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS catalog_read ON public.role_templates;                CREATE POLICY catalog_read ON public.role_templates FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS catalog_read ON public.role_template_permissions;     CREATE POLICY catalog_read ON public.role_template_permissions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS catalog_read ON public.sod_template_conflicts;        CREATE POLICY catalog_read ON public.sod_template_conflicts FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS catalog_read ON public.sod_permission_rules;          CREATE POLICY catalog_read ON public.sod_permission_rules FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS catalog_read ON public.role_catalog;
CREATE POLICY catalog_read ON public.role_catalog FOR SELECT TO authenticated
  USING (org_id IS NULL OR org_id = (SELECT public.get_my_school_id()) OR (SELECT public.is_super_admin()));
DROP POLICY IF EXISTS org_read ON public.org_role_permission_settings;
CREATE POLICY org_read ON public.org_role_permission_settings FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id()) OR (SELECT public.is_super_admin()));
DROP POLICY IF EXISTS org_read ON public.org_role_custom_grants;
CREATE POLICY org_read ON public.org_role_custom_grants FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_my_school_id()) OR (SELECT public.is_super_admin()));
DROP POLICY IF EXISTS own_or_admin_read ON public.user_role_assignments;
CREATE POLICY own_or_admin_read ON public.user_role_assignments FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.can_administer_org(org_id));

-- 8. Action-level guardrails (separation of duties) -------------------------------------------
ALTER TABLE public.staff_payroll ADD COLUMN IF NOT EXISTS prepared_by uuid REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.staff_payroll ALTER COLUMN prepared_by SET DEFAULT auth.uid();
CREATE OR REPLACE FUNCTION public.staff_payroll_sod_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW.prepared_by := OLD.prepared_by; END IF;   -- preparer is immutable
  IF NEW.status IN ('approved', 'paid') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.approved_by IS DISTINCT FROM NEW.approved_by) THEN
    IF v_actor IS NOT NULL THEN NEW.approved_by := v_actor; END IF;
    IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.user_id THEN
      RAISE EXCEPTION 'no_self_payroll_approval: you cannot approve your own payroll line' USING ERRCODE = '42501'; END IF;
    IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.prepared_by THEN
      RAISE EXCEPTION 'no_self_payroll_approval: preparer and approver must be different people' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_staff_payroll_sod ON public.staff_payroll;
CREATE TRIGGER trg_staff_payroll_sod BEFORE INSERT OR UPDATE ON public.staff_payroll FOR EACH ROW EXECUTE FUNCTION public.staff_payroll_sod_guard();

CREATE OR REPLACE FUNCTION public.school_expenses_sod_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_actor uuid := auth.uid(); v_limit numeric; v_has_roles boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN NEW.created_by := OLD.created_by; END IF;
  IF NEW.approved_by IS NOT NULL AND (TG_OP = 'INSERT' OR OLD.approved_by IS DISTINCT FROM NEW.approved_by OR OLD.amount IS DISTINCT FROM NEW.amount) THEN
    IF v_actor IS NOT NULL THEN NEW.approved_by := v_actor; END IF;
    IF NEW.approved_by = NEW.created_by THEN
      RAISE EXCEPTION 'no_self_expense_approval: you cannot approve an expense you raised' USING ERRCODE = '42501'; END IF;
    SELECT bool_or(true), max(t.approval_limit_ngn) INTO v_has_roles, v_limit
      FROM public.user_role_assignments a JOIN public.role_catalog r ON r.code = a.role_code JOIN public.role_templates t ON t.code = r.template_code
     WHERE a.org_id = NEW.school_id AND a.user_id = NEW.approved_by AND a.status = 'active'
       AND EXISTS (SELECT 1 FROM public.effective_permissions(NEW.school_id, NEW.approved_by) e WHERE e.permission_code = 'expenses.approve');
    IF coalesce(v_has_roles, false) AND NEW.amount > coalesce(v_limit, 0) THEN
      RAISE EXCEPTION 'approval limit exceeded: % > %', NEW.amount, coalesce(v_limit, 0) USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_school_expenses_sod ON public.school_expenses;
CREATE TRIGGER trg_school_expenses_sod BEFORE INSERT OR UPDATE ON public.school_expenses FOR EACH ROW EXECUTE FUNCTION public.school_expenses_sod_guard();

COMMIT;
