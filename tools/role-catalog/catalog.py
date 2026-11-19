"""Sherivs Nigerian education role catalog (SHERIVS-017) - single source of truth.
Generates the seed SQL (017 base, extended by M2a / ADR-113 in migration 20261117001000), its rollback,
and a TS mirror for the admin role panel/tests. Deterministic: same input, byte-identical output.
Run: python3 tools/role-catalog/catalog.py        (write)
     python3 tools/role-catalog/catalog.py --check (exit 1 if any output is stale)
"""
import json, re, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]

# code: (module, label, sensitivity, protected)
# protected = can ONLY be held through a catalog role that carries it; never added by an org toggle or custom grant.
P = {
 "self.view_own": ("self","View own profile, results, fees and timetable","internal",False),
 "children.view": ("self","View own children's records","confidential",False),
 "ai_tutor.use": ("learning","Use the AI tutor within plan limits","internal",False),
 "students.view": ("students","View student list and basic profile","internal",False),
 "students.create": ("students","Enrol / create students","internal",False),
 "students.edit": ("students","Edit student profile","internal",False),
 "students.delete": ("students","Delete or archive a student","confidential",True),
 "students.view_sensitive": ("students","View NIN, medical and guardian contact data","restricted",True),
 "students.transfer": ("students","Transfer or withdraw a student","confidential",True),
 "admissions.view": ("admissions","View applications","internal",False),
 "admissions.process": ("admissions","Screen, interview and score applicants","internal",False),
 "admissions.offer": ("admissions","Issue or revoke admission offers","confidential",True),
 "classes.manage": ("academics","Create classes, arms, sections and houses","internal",False),
 "timetable.view": ("academics","View timetables","public",False),
 "timetable.manage": ("academics","Build and publish timetables","internal",False),
 "curriculum.manage": ("academics","Manage schemes of work and course catalogue","internal",False),
 "lesson_notes.submit": ("academics","Write and submit lesson notes","internal",False),
 "lesson_notes.approve": ("academics","Review and approve lesson notes","internal",False),
 "attendance.take": ("attendance","Take attendance for assigned classes","internal",False),
 "attendance.view": ("attendance","View attendance reports","internal",False),
 "attendance.edit_past": ("attendance","Correct attendance after the day closes","confidential",True),
 "grades.enter": ("results","Enter CA and exam scores for assigned subjects","confidential",False),
 "grades.view": ("results","View results in scope","confidential",False),
 "grades.approve": ("results","Moderate / approve results before publishing","confidential",True),
 "results.publish": ("results","Publish results to students and parents","confidential",True),
 "results.unpublish": ("results","Withdraw or amend published results","restricted",True),
 "transcripts.issue": ("results","Issue transcripts, statements and certificates","restricted",True),
 "course_reg.approve": ("results","Approve course registration (level adviser)","internal",False),
 "exams.schedule": ("exams","Schedule exams, venues and seating","internal",False),
 "exams.invigilate": ("exams","Invigilate and file exam incident reports","internal",False),
 "exams.records": ("exams","Maintain official exam records (Exams & Records)","restricted",True),
 "cbt.manage": ("exams","Build question banks and run CBT sessions","confidential",False),
 "malpractice.decide": ("exams","Decide exam malpractice cases","restricted",True),
 "fees.view": ("finance","View fee bills and balances in scope","confidential",False),
 "fees.manage_plans": ("finance","Create fee plans and bills","confidential",False),
 "payments.record_cash": ("finance","Record offline / cash payments","confidential",True),
 "payments.refund": ("finance","Approve refunds","restricted",True),
 "payments.reconcile": ("finance","Reconcile Paystack and bank settlements","confidential",False),
 "wallet.view": ("finance","View the school wallet","confidential",False),
 "wallet.topup": ("finance","Top up the school wallet","confidential",True),
 "expenses.create": ("finance","Raise expenses / payment vouchers","confidential",False),
 "expenses.approve": ("finance","Approve expenses within approval limit","restricted",True),
 "budget.manage": ("finance","Prepare and manage budgets","confidential",False),
 "reports.financial": ("finance","View financial reports","confidential",False),
 "payroll.view_own": ("payroll","View own payslips","confidential",False),
 "payroll.prepare": ("payroll","Prepare payroll runs","restricted",True),
 "payroll.approve": ("payroll","Approve payroll runs","restricted",True),
 "payroll.view_all": ("payroll","View every staff salary","restricted",True),
 "hr.staff_view": ("hr","View staff directory","internal",False),
 "hr.staff_manage": ("hr","Hire, edit and exit staff records","confidential",True),
 "hr.view_sensitive": ("hr","View staff NIN, bank and next-of-kin data","restricted",True),
 "hr.leave_request": ("hr","Request leave","internal",False),
 "hr.leave_approve": ("hr","Approve leave for direct reports","internal",False),
 "hr.appraisal": ("hr","Conduct staff appraisals","confidential",False),
 "library.circulate": ("library","Issue and return library items","internal",False),
 "library.catalog": ("library","Catalogue and weed library stock","internal",False),
 "hostel.allocate": ("hostel","Allocate hostel rooms and bed spaces","internal",False),
 "hostel.roll_call": ("hostel","Take hostel roll call and exeat","internal",False),
 "health.records_view": ("health","View clinic and medical records","restricted",True),
 "health.records_edit": ("health","Record clinic visits and treatment","restricted",True),
 "counselling.notes": ("welfare","Keep confidential counselling notes","restricted",True),
 "welfare.pastoral": ("welfare","Pastoral / chaplaincy / welfare follow-up","confidential",False),
 "discipline.record": ("discipline","Record a discipline incident","internal",False),
 "discipline.decide": ("discipline","Decide suspension / expulsion","restricted",True),
 "transport.manage": ("transport","Manage routes, buses and drivers","internal",False),
 "transport.track": ("transport","Track buses live","internal",False),
 "transport.driver_trip": ("transport","Run own trip manifest and check-ins","internal",False),
 "security.gate_log": ("security","Log gate entry/exit and pick-ups","internal",False),
 "visitors.manage": ("security","Register visitors and issue gate passes","internal",False),
 "security.incident": ("security","File security incidents","confidential",False),
 "inventory.manage": ("operations","Manage stores and inventory","internal",False),
 "procurement.request": ("operations","Raise purchase requisitions","internal",False),
 "procurement.approve": ("operations","Approve purchase orders","restricted",True),
 "assets.manage": ("operations","Asset register and maintenance","internal",False),
 "works.requests": ("operations","Handle works / maintenance requests","internal",False),
 "catering.manage": ("operations","Menus, feeding and kitchen stock","internal",False),
 "comms.send_class": ("communication","Message own classes / parents in scope","internal",False),
 "comms.broadcast": ("communication","School-wide broadcast (SMS/WhatsApp/email)","confidential",True),
 "news.publish": ("communication","Publish news and events","internal",False),
 "reports.academic": ("analytics","Academic performance reports","confidential",False),
 "analytics.institution": ("analytics","Institution-wide dashboards","confidential",False),
 "regulator.read_aggregate": ("regulator","Read anonymised aggregate statistics only","internal",False),
 "audit.view": ("governance","View the audit trail","restricted",True),
 "roles.assign": ("governance","Assign roles to people","restricted",True),
 "roles.configure": ("governance","Toggle optional permissions on roles","restricted",True),
 "settings.manage": ("governance","Manage organisation settings","restricted",True),
 "ndpa.dsar": ("governance","Handle NDPA data-subject requests and breach log","restricted",True),
 "ict.support": ("ict","First-line ICT support","internal",False),
 "ict.reset_access": ("ict","Reset passwords and MFA for users","restricted",True),
 "siwes.manage": ("tertiary","Manage SIWES / IT placements and logbooks","internal",False),
 "research.manage": ("tertiary","Research grants and projects","internal",False),
 "alumni.manage": ("community","Alumni records and donations","confidential",False),
 "pta.manage": ("community","PTA levies, meetings and minutes","confidential",False),
 "governance.minutes": ("governance","Council / board papers and minutes","confidential",False),
}

# Guardrails: hardcoded, enforced in the DB, never editable by any org admin.
G = {
 "tenant_isolation": "Only ever sees data of organisations where the person holds an active role (RLS).",
 "audited": "Every action on protected permissions is written to the append-only audit chain.",
 "own_classes_only": "Teaching staff only see and grade students in classes/subjects assigned to them.",
 "self_only": "Students only see their own records.",
 "own_children_only": "Parents only see children linked to them.",
 "no_self_payroll_approval": "Cannot approve a payroll line for yourself or one you prepared.",
 "no_self_expense_approval": "Cannot approve an expense you raised; amount must be within the approval limit.",
 "no_self_role_grant": "Cannot assign roles to yourself or toggle permissions on a role you hold.",
 "no_published_result_edit": "Cannot change a published result; amendments go through results.unpublish with a reason.",
 "aggregate_only": "Regulators and external bodies only see anonymised aggregates, never person-level data.",
 "no_sensitive_by_default": "Restricted personal data (NIN, bank, biometrics, health) is masked unless the role carries the restricted permission.",
 "auditor_independence": "Auditors are read-only and cannot hold any role that creates or approves money movements.",
 "driver_own_trip": "Drivers and attendants only see their own trip manifest.",
}

# Templates: mandatory perms, optional perms (default on/off), scope, sensitivity ceiling, approval limit (NGN, None = none), guardrails
def T(m, o_on=(), o_off=(), scope="org", sens="internal", limit=None, g=()):
    return dict(m=list(m), on=list(o_on), off=list(o_off), scope=scope, sens=sens, limit=limit, g=["tenant_isolation","audited",*g])
STAFF = ["self.view_own","payroll.view_own","hr.leave_request","hr.staff_view","timetable.view"]
TPL = {
 "regulator": T(["regulator.read_aggregate"],["timetable.view"],["reports.academic"],"org","internal",None,["aggregate_only"]),
 "regulator_inspector": T(["regulator.read_aggregate","attendance.view"],["reports.academic"],["lesson_notes.approve"],"org","internal",None,["aggregate_only"]),
 "governance_board": T(["governance.minutes","analytics.institution","reports.financial"],["reports.academic","audit.view"],[],"org","confidential",None,["auditor_independence"]),
 "proprietor": T(["analytics.institution","reports.financial","reports.academic","governance.minutes","audit.view",*STAFF],["roles.assign","settings.manage","wallet.view","expenses.approve","payroll.approve"],["wallet.topup"],"org","restricted",50_000_000,["no_self_role_grant","no_self_payroll_approval","no_self_expense_approval"]),
 "head_of_institution": T(["roles.assign","roles.configure","settings.manage","analytics.institution","reports.academic","audit.view","results.publish","students.view","hr.staff_manage",*STAFF],["expenses.approve","admissions.offer","discipline.decide","comms.broadcast","students.view_sensitive","reports.financial","lesson_notes.approve","grades.approve","payroll.approve","wallet.topup"],["results.unpublish","payroll.view_all"],"org","restricted",5_000_000,["no_self_role_grant","no_self_payroll_approval","no_self_expense_approval","no_published_result_edit"]),
 "deputy_academic": T(["reports.academic","grades.approve","lesson_notes.approve","timetable.manage","students.view",*STAFF],["exams.schedule","results.publish","curriculum.manage","classes.manage","comms.broadcast","hr.leave_approve","hr.appraisal"],["admissions.offer"],"org","confidential",500_000,["no_published_result_edit"]),
 "deputy_admin": T(["students.view","discipline.record","attendance.view",*STAFF],["discipline.decide","visitors.manage","hr.leave_approve","works.requests","comms.broadcast","students.edit","expenses.create"],["students.view_sensitive"],"org","confidential",500_000),
 "admissions": T(["admissions.view","admissions.process","students.view",*STAFF],["students.create","comms.send_class"],["admissions.offer"],"org","confidential"),
 "registrar": T(["admissions.view","students.view","students.edit","transcripts.issue","exams.records","governance.minutes",*STAFF],["admissions.offer","students.transfer","hr.staff_manage","students.view_sensitive","comms.broadcast","results.publish"],["results.unpublish"],"org","restricted",1_000_000,["no_published_result_edit"]),
 "exams_records": T(["exams.records","grades.view","exams.schedule",*STAFF],["transcripts.issue","results.publish","cbt.manage"],["results.unpublish"],"org","restricted",None,["no_published_result_edit"]),
 "exams_officer": T(["exams.schedule","exams.invigilate","grades.view",*STAFF],["cbt.manage","attendance.view"],["malpractice.decide"],"department","confidential",None,["no_published_result_edit"]),
 "cbt": T(["cbt.manage","exams.schedule",*STAFF],["exams.invigilate","ict.support"],[],"org","confidential"),
 "dean": T(["reports.academic","grades.approve","course_reg.approve","students.view",*STAFF],["lesson_notes.approve","hr.leave_approve","hr.appraisal","comms.send_class","malpractice.decide"],["discipline.decide"],"faculty","confidential",500_000,["no_published_result_edit"]),
 "hod": T(["reports.academic","grades.approve","lesson_notes.approve","students.view","attendance.view",*STAFF],["timetable.manage","course_reg.approve","curriculum.manage","hr.leave_approve","hr.appraisal","comms.send_class"],["exams.schedule"],"department","confidential",200_000,["no_published_result_edit"]),
 "level_adviser": T(["course_reg.approve","grades.view","students.view",*STAFF],["comms.send_class","attendance.view"],[],"class","confidential",None,["own_classes_only"]),
 "teacher": T(["attendance.take","grades.enter","lesson_notes.submit","students.view",*STAFF],["comms.send_class","ai_tutor.use","cbt.manage","discipline.record"],["timetable.manage"],"class","confidential",None,["own_classes_only","no_published_result_edit","no_sensitive_by_default"]),
 "form_teacher": T(["attendance.take","grades.enter","grades.view","lesson_notes.submit","students.view","discipline.record",*STAFF],["comms.send_class","fees.view","ai_tutor.use"],["students.view_sensitive"],"class","confidential",None,["own_classes_only","no_published_result_edit","no_sensitive_by_default"]),
 "teaching_support": T(["attendance.take","students.view",*STAFF],["lesson_notes.submit","comms.send_class"],[],"class","internal",None,["own_classes_only","no_sensitive_by_default"]),
 "early_years_carer": T(["attendance.take","students.view",*STAFF],["comms.send_class","health.records_view"],[],"class","confidential",None,["own_classes_only","no_sensitive_by_default"]),
 "lab_workshop": T(["inventory.manage",*STAFF],["attendance.take","assets.manage"],[],"department","internal"),
 "bursar": T(["fees.view","fees.manage_plans","payments.reconcile","reports.financial","wallet.view","budget.manage",*STAFF],["expenses.approve","payroll.approve","payments.refund","wallet.topup","payroll.view_all"],["expenses.create","payments.record_cash"],"org","restricted",2_000_000,["no_self_payroll_approval","no_self_expense_approval","no_sensitive_by_default"]),
 "accountant": T(["fees.view","payments.reconcile","reports.financial","expenses.create",*STAFF],["payments.record_cash","budget.manage","wallet.view"],["payroll.prepare"],"org","confidential",None,["no_self_expense_approval"]),
 "cashier": T(["fees.view","payments.record_cash",*STAFF],["wallet.view"],[],"campus","confidential",None,["no_self_expense_approval"]),
 "payroll": T(["payroll.prepare","payroll.view_all","hr.view_sensitive",*STAFF],["reports.financial"],[],"org","restricted",None,["no_self_payroll_approval"]),
 "auditor": T(["audit.view","reports.financial","fees.view","payroll.view_all",*STAFF],["reports.academic","analytics.institution"],[],"org","restricted",None,["auditor_independence"]),
 "procurement": T(["procurement.request","inventory.manage",*STAFF],["procurement.approve","assets.manage"],[],"org","internal",1_000_000,["no_self_expense_approval"]),
 "store": T(["inventory.manage",*STAFF],["procurement.request","assets.manage"],[],"campus","internal"),
 "hr": T(["hr.staff_manage","hr.view_sensitive","hr.leave_approve","hr.appraisal",*STAFF],["payroll.prepare","roles.assign"],[],"org","restricted",None,["no_self_role_grant","no_self_payroll_approval"]),
 "admin_officer": T([*STAFF,"students.view"],["visitors.manage","comms.send_class","works.requests","news.publish"],["students.edit"],"org","internal"),
 "pr": T(["news.publish",*STAFF],["comms.broadcast","alumni.manage"],[],"org","internal"),
 "legal": T(["governance.minutes",*STAFF],["audit.view","discipline.decide"],[],"org","confidential"),
 "librarian": T(["library.circulate","library.catalog","students.view",*STAFF],["procurement.request"],[],"org","internal"),
 "library_staff": T(["library.circulate",*STAFF],["library.catalog"],[],"campus","internal"),
 "hostel_head": T(["hostel.allocate","hostel.roll_call","students.view",*STAFF],["discipline.record","health.records_view","comms.send_class","welfare.pastoral"],[],"campus","confidential",None,["no_sensitive_by_default"]),
 "house_staff": T(["hostel.roll_call","students.view","welfare.pastoral",*STAFF],["discipline.record","comms.send_class","hostel.allocate"],[],"class","confidential",None,["own_classes_only","no_sensitive_by_default"]),
 "health": T(["health.records_view","health.records_edit","students.view",*STAFF],["comms.send_class","inventory.manage"],[],"org","restricted"),
 "counsellor": T(["counselling.notes","welfare.pastoral","students.view",*STAFF],["grades.view","attendance.view","discipline.record"],[],"org","restricted"),
 "chaplaincy": T(["welfare.pastoral",*STAFF],["comms.send_class","news.publish"],[],"org","internal",None,["no_sensitive_by_default"]),
 "student_affairs": T(["students.view","welfare.pastoral","discipline.record",*STAFF],["discipline.decide","hostel.allocate","comms.broadcast","news.publish"],[],"org","confidential"),
 "security_head": T(["security.gate_log","visitors.manage","security.incident",*STAFF],["transport.track","attendance.view"],[],"org","confidential"),
 "security_staff": T(["security.gate_log","visitors.manage",*STAFF],["security.incident"],[],"campus","internal",None,["no_sensitive_by_default"]),
 "transport_head": T(["transport.manage","transport.track",*STAFF],["comms.send_class"],[],"org","internal"),
 "driver": T(["transport.driver_trip",*STAFF],["transport.track"],[],"self","internal",None,["driver_own_trip","no_sensitive_by_default"]),
 "works": T(["works.requests","assets.manage",*STAFF],["procurement.request","inventory.manage"],[],"campus","internal"),
 "support_staff": T(STAFF,["works.requests"],[],"self","internal",None,["no_sensitive_by_default"]),
 "catering": T(["catering.manage",*STAFF],["inventory.manage","procurement.request"],[],"campus","internal"),
 "ict_head": T(["ict.support","ict.reset_access",*STAFF],["settings.manage","cbt.manage","audit.view"],[],"org","restricted",None,["no_self_role_grant"]),
 "ict_staff": T(["ict.support",*STAFF],["cbt.manage"],["ict.reset_access"],"campus","internal"),
 "data_protection": T(["ndpa.dsar","audit.view",*STAFF],["students.view_sensitive","hr.view_sensitive"],[],"org","restricted",None,["auditor_independence"]),
 "siwes": T(["siwes.manage","students.view",*STAFF],["comms.send_class"],[],"faculty","confidential"),
 "research": T(["research.manage",*STAFF],["reports.academic"],[],"faculty","internal"),
 "alumni": T(["alumni.manage",*STAFF],["comms.broadcast","news.publish"],[],"org","confidential"),
 "pta": T(["pta.manage","children.view"],["comms.send_class"],[],"org","confidential",None,["own_children_only"]),
 "parent": T(["children.view","fees.view"],["comms.send_class"],[],"self","confidential",None,["own_children_only"]),
 "student": T(["self.view_own","timetable.view"],["ai_tutor.use"],[],"self","internal",None,["self_only"]),
 "student_leader": T(["self.view_own","timetable.view"],["ai_tutor.use","news.publish"],[],"self","internal",None,["self_only"]),
}

# =============================================================================
# M2a catalogue extension (mission E-006, ADR-113). Master brief section 6, 7.5 and Appendix A-D.
# Everything below EXTENDS the SHERIVS-017 data above; nothing above is edited, so the 572
# original roles keep their codes, names, categories and (except the explicit REMAP list)
# their templates.
# =============================================================================

# ---- New permissions (Appendix C). (P) in the brief -> protected=True. "(restricted)" -> sensitivity restricted.
LEGACY_PERMS = list(P); LEGACY_GUARDRAILS = list(G)
P.update({
 "role_pack.manage": ("governance","Install, upgrade and configure role packs","restricted",True),
 "roles.custom_create": ("governance","Draft custom roles from a base template","confidential",False),
 "roles.custom_approve": ("governance","Approve a custom role drafted by someone else","restricted",True),
 "access_review.run": ("governance","Run periodic access-review campaigns","confidential",False),
 "delegation.grant": ("governance","Delegate a role temporarily (acting / leave cover)","restricted",True),
 "onboarding.review": ("platform","Review an onboarding plan (Sherivs internal)","confidential",False),
 "onboarding.provision": ("platform","Provision a tenant from an approved plan (Sherivs internal)","restricted",True),
 "website.edit": ("communication","Edit public website drafts","internal",False),
 "website.publish": ("communication","Publish the public website","confidential",True),
 "admissions.configure": ("admissions","Configure admission cycles, forms and fees","internal",False),
 "admissions.screen": ("admissions","Schedule and run applicant screening","internal",False),
 "admissions.score": ("admissions","Score applicants","confidential",False),
 "applicant.self": ("self","Applicant: own application only","internal",False),
 "report_card.remark": ("results","Write report-card remarks for own class","confidential",False),
 "course_reg.submit": ("self","Submit own course registration","internal",False),
 "results.moderate": ("results","Moderate results (moderation stage)","confidential",False),
 "senate.approve_results": ("results","Record senate / academic board result decisions (cannot alter scores)","restricted",True),
 "records.certify": ("results","Certify records, statements and true copies","restricted",True),
 "matriculation.manage": ("students","Manage matriculation and matric numbers","confidential",False),
 "daily_care_log": ("care","Early-years daily care log (meals, naps, milestones; parent-visible)","confidential",False),
 "iep.manage": ("welfare","Individual education plans","restricted",False),
 "memorisation.progress": ("learning","Record memorisation (hifz) progress","internal",False),
 "practical.log": ("academics","Record practical / workshop / field sessions","internal",False),
 "safety.checklist": ("operations","Complete lab, workshop and farm safety checklists","internal",False),
 "logbook.submit": ("self","Submit own SIWES / TP / clinical logbook entries","internal",False),
 "competency.assess": ("results","Assess practical competencies","confidential",False),
 "research.ethics_approve": ("tertiary","Approve research ethics applications (committee)","confidential",True),
 "tp.posting_manage": ("tertiary","Manage teaching-practice postings","internal",False),
 "tp.assess": ("tertiary","Assess teaching-practice students","confidential",False),
 "clinical.posting_manage": ("clinical","Manage clinical postings and sites","internal",False),
 "clinical.log_sign": ("clinical","Sign off clinical logbook entries (no patient data)","confidential",True),
 "farm.records": ("farm","Farm unit records (crops, livestock, inputs)","internal",False),
 "farm.produce_record": ("farm","Record farm produce batches","internal",False),
 "farm.produce_sell": ("farm","Sell farm produce and receive payment","confidential",False),
 "exam_body.export": ("exams","Export candidate registration files for exam bodies","confidential",False),
 "exam_body.import": ("exams","Import exam-body results (CSV / manual, no scraping)","restricted",True),
 "credential.verify": ("hr","Record verification of a licence or credential","confidential",False),
 "consent.give": ("self","Give or withdraw consent for own child / self","confidential",False),
 "consent.manage": ("governance","Manage consent purposes and records","restricted",True),
 "exeat.confirm": ("self","Confirm an exeat / leave-out for own child","internal",False),
 "device.manage": ("ict","Manage devices","internal",False),
 "elections.manage": ("community","Run student union / association elections","internal",False),
 "board.resolution_vote": ("governance","Vote on board / council resolutions","confidential",False),
 "dsr.process": ("governance","Process data-subject requests","restricted",True),
 "breach.log": ("governance","Record and notify personal-data breaches","restricted",True),
 "ropa.manage": ("governance","Maintain the record of processing activities","confidential",False),
 "audit.export": ("governance","Export audit samples","restricted",True),
 "audit.finding_raise": ("governance","Raise audit findings","confidential",False),
 "safeguarding.case_view": ("welfare","View safeguarding cases","restricted",False),
 "safeguarding.case_manage": ("welfare","Manage safeguarding cases","restricted",True),
 "break_glass.invoke": ("governance","Time-boxed emergency access (break-glass)","restricted",True),
 "returns.submit": ("regulator","Submit institution returns to an authority","confidential",True),
 "returns.validate": ("regulator","Validate returns (warnings never auto-become findings)","internal",False),
 "returns.review": ("regulator","Review submitted returns","internal",False),
 "returns.consolidate": ("regulator","Consolidate returns across a jurisdiction","internal",False),
 "circular.issue": ("regulator","Issue circulars to institutions","confidential",True),
 "action.assign": ("regulator","Assign corrective actions","internal",False),
 "inspection.conduct": ("regulator","Conduct inspections (offline checklists)","confidential",False),
 "inspection.report": ("regulator","Write inspection reports (institution right of reply)","confidential",False),
 "accreditation.review": ("regulator","Review institution-submitted accreditation evidence","confidential",False),
 "posting.manage": ("regulator","Manage teacher postings and deployment","restricted",True),
 "recruitment.manage": ("regulator","Manage authority recruitment","confidential",False),
 "promotion.case_manage": ("regulator","Manage discipline / promotion cases (never auto-decided)","restricted",True),
 "mandate.verify": ("platform","Verify an authority's mandate evidence (Sherivs internal)","restricted",True),
 "twin.use": ("ai","Use the personal AI twin","internal",False),
 "agent.approve": ("ai","Approve an AI agent action (passkey)","restricted",True),
})

G["no_patient_data"] = "Clinical work records procedures, competencies and sign-offs only; patient-identifiable data is never stored."

# ---- New permissions offered to EXISTING templates (Appendix B). Always OPTIONAL and OFF by default,
# so nobody who already holds one of these roles gains anything until an organisation turns it on.
OPT_ADD = {
 "proprietor": ["role_pack.manage","website.publish","admissions.configure"],
 "governance_board": ["board.resolution_vote"],
 "form_teacher": ["report_card.remark"],
 "early_years_carer": ["daily_care_log"],
 "lab_workshop": ["practical.log","safety.checklist"],
 "research": ["research.ethics_approve"],
 "admissions": ["admissions.configure","admissions.screen","admissions.score"],
 "registrar": ["records.certify","matriculation.manage"],
 "auditor": ["audit.export","audit.finding_raise"],
 "hr": ["credential.verify"],
 "pr": ["website.edit"],
 "ict_head": ["device.manage"],
 "ict_staff": ["device.manage"],
 "data_protection": ["dsr.process","breach.log","consent.manage","ropa.manage"],
 "parent": ["consent.give","exeat.confirm"],
 "student": ["course_reg.submit","logbook.submit"],
 "student_leader": ["elections.manage"],
 "regulator": ["returns.review","returns.consolidate","circular.issue","action.assign"],
 "regulator_inspector": ["inspection.conduct","inspection.report"],
}
for _k, _ps in OPT_ADD.items():
    TPL[_k]["off"] += [p for p in _ps if p not in TPL[_k]["off"]]

# ---- New templates. spec: "appendix_b" = permissions and nav taken from Appendix B;
# "appendix_a" = named (star) in Appendix A only, permissions chosen from existing codes (see ADR-113).
TEACH = ["attendance.take","attendance.view","grades.enter","grades.view","lesson_notes.submit","comms.send_class","students.view"]
NEW_TPL = {
 # B1 executive and governance
 "senior_master": T(["discipline.record","welfare.pastoral","attendance.view","students.view",*STAFF],["comms.send_class"],[],"org","confidential",None,["no_sensitive_by_default"]),
 "provost": T(["grades.approve","course_reg.approve","reports.academic","research.manage",*STAFF],["hr.leave_approve","hr.appraisal"],[],"faculty","confidential",500_000,["no_published_result_edit"]),
 "pg_dean": T(["grades.approve","course_reg.approve","reports.academic","research.manage",*STAFF],["hr.leave_approve","hr.appraisal"],[],"faculty","confidential",500_000,["no_published_result_edit"]),
 "sub_dean": T(["grades.approve","course_reg.approve","reports.academic","research.manage",*STAFF],[],[],"faculty","confidential",None,["no_published_result_edit"]),
 "senate_secretary": T(["senate.approve_results","results.publish","transcripts.issue",*STAFF],[],[],"org","restricted",None,["no_published_result_edit"]),
 # B2 academic and teaching
 "lecturer": T([*TEACH,*STAFF],["ai_tutor.use"],["cbt.manage"],"class","confidential",None,["own_classes_only","no_published_result_edit","no_sensitive_by_default"]),
 "health_lecturer": T([*TEACH,*STAFF],["ai_tutor.use"],["cbt.manage","competency.assess"],"class","confidential",None,["own_classes_only","no_published_result_edit","no_sensitive_by_default","no_patient_data"]),
 "exam_centre_coordinator": T(["exams.records","exam_body.export",*STAFF],[],["exam_body.import"],"org","restricted",None,["no_published_result_edit","no_sensitive_by_default"]),
 "sen_teacher": T([*TEACH,"iep.manage",*STAFF],["ai_tutor.use"],["cbt.manage"],"class","restricted",None,["own_classes_only","no_published_result_edit","no_sensitive_by_default"]),
 "technologist": T(["inventory.manage","practical.log","safety.checklist","attendance.take",*STAFF],["assets.manage"],[],"department","internal"),
 "technical_instructor": T(["inventory.manage","practical.log","safety.checklist","attendance.take",*STAFF],["assets.manage"],[],"department","internal"),
 "teaching_practice": T(["tp.posting_manage","tp.assess","students.view",*STAFF],["comms.send_class"],[],"faculty","confidential",None,["no_sensitive_by_default"]),
 "clinical_instructor": T(["clinical.posting_manage","clinical.log_sign","competency.assess",*STAFF],[],[],"class","confidential",None,["no_patient_data","no_sensitive_by_default"]),
 "clinical_posting_coordinator": T(["clinical.posting_manage","clinical.log_sign","competency.assess",*STAFF],[],[],"faculty","confidential",None,["no_patient_data","no_sensitive_by_default"]),
 "clinical_preceptor": T(["clinical.log_sign","competency.assess"],[],["clinical.posting_manage"],"class","confidential",None,["no_patient_data","own_classes_only","no_sensitive_by_default"]),
 "farm_manager": T(["farm.records","practical.log","inventory.manage","farm.produce_record",*STAFF],["safety.checklist","procurement.request"],[],"department","internal"),
 "farm_unit_supervisor": T(["farm.records","practical.log","inventory.manage","farm.produce_record",*STAFF],["safety.checklist"],[],"department","internal"),
 "field_instructor": T(["farm.records","practical.log","inventory.manage","farm.produce_record",*STAFF],["safety.checklist","attendance.take"],[],"department","internal"),
 "research_director": T(["research.manage","research.ethics_approve",*STAFF],["reports.academic"],[],"org","confidential"),
 "ethics_secretary": T(["research.manage","research.ethics_approve",*STAFF],[],[],"org","confidential"),
 "quranic_facilitator": T(["attendance.take","memorisation.progress","comms.send_class",*STAFF],[],[],"class","internal",None,["own_classes_only","no_sensitive_by_default"]),
 # B3 administration and finance
 "produce_sales": T(["payments.record_cash","farm.produce_sell",*STAFF],[],[],"campus","confidential",None,["no_self_expense_approval"]),
 # B4 welfare and operations
 "welfare_officer": T(["welfare.pastoral","students.view",*STAFF],["comms.send_class","catering.manage"],[],"org","confidential",None,["no_sensitive_by_default"]),
 "gate_officer": T(["security.gate_log"],[],[],"campus","internal",None,["no_sensitive_by_default"]),
 # B6 oversight desks (roles on these templates ship disabled, mandate_status unverified)
 "emis_officer": T(["returns.validate","returns.consolidate","regulator.read_aggregate"],[],[],"org","internal",None,["aggregate_only"]),
 "posting_officer": T(["posting.manage","hr.staff_view"],[],[],"org","confidential",None,["no_sensitive_by_default"]),
 "recruitment_officer": T(["recruitment.manage","hr.staff_view"],[],[],"org","confidential",None,["no_sensitive_by_default"]),
 "promotions_officer": T(["promotion.case_manage","hr.staff_view"],[],[],"org","confidential",None,["no_sensitive_by_default"]),
 "teacher_records_officer": T(["hr.staff_view"],[],["credential.verify"],"org","confidential",None,["no_sensitive_by_default"]),
 "lgea_secretary": T(["regulator.read_aggregate","inspection.conduct","returns.review"],[],[],"org","internal",None,["aggregate_only"]),
 "school_support_officer": T(["regulator.read_aggregate","inspection.conduct","returns.review"],[],[],"org","internal",None,["aggregate_only"]),
 "private_school_accreditor": T(["accreditation.review"],["regulator.read_aggregate"],[],"org","confidential",None,["aggregate_only"]),
 "accreditation_officer": T(["accreditation.review"],["regulator.read_aggregate"],[],"org","confidential",None,["aggregate_only"]),
 "exam_body_liaison": T(["exam_body.export","exam_body.import"],[],[],"org","restricted",None,["no_sensitive_by_default"]),
 "licence_verifier": T(["credential.verify"],[],[],"org","confidential",None,["no_sensitive_by_default"]),
 "licensing_officer": T(["credential.verify","exam_body.export"],[],[],"org","confidential",None,["no_sensitive_by_default"]),
 # Named (star) in Appendix A without an Appendix B specification
 "sports_director": T(["students.view","news.publish",*STAFF],["comms.send_class","inventory.manage"],[],"org","internal"),
 "enterprise_director": T(["research.manage",*STAFF],["reports.academic","news.publish"],[],"org","internal"),
 "academic_planning": T(["reports.academic","curriculum.manage","analytics.institution",*STAFF],[],[],"org","confidential"),
 "affiliation_liaison": T(["reports.academic","students.view","grades.view",*STAFF],[],[],"org","confidential",None,["no_published_result_edit"]),
 "tp_mentor_external": T(["tp.assess"],[],[],"class","confidential",None,["own_classes_only","no_sensitive_by_default"]),
 "farm_attendant_task": T(["farm.records","self.view_own"],[],[],"self","internal",None,["no_sensitive_by_default"]),
 "deputy_technical": T(["reports.academic","timetable.manage","practical.log","safety.checklist","students.view",*STAFF],["lesson_notes.approve","hr.leave_approve"],[],"org","confidential",500_000),
 "nsq_assessor": T(["competency.assess","practical.log",*STAFF],[],[],"department","confidential"),
 "group_finance": T(["reports.financial","budget.manage","fees.view","wallet.view",*STAFF],[],[],"org","restricted",None,["no_self_expense_approval","no_sensitive_by_default"]),
 "group_academic": T(["reports.academic","analytics.institution","curriculum.manage",*STAFF],[],[],"org","confidential"),
 "group_hr": T(["hr.staff_manage","hr.view_sensitive","hr.leave_approve","hr.appraisal",*STAFF],["credential.verify"],[],"org","restricted",None,["no_self_role_grant","no_self_payroll_approval"]),
 "me_officer": T(["regulator.read_aggregate","returns.review"],[],[],"org","internal",None,["aggregate_only"]),
 "policy_desk": T(["circular.issue","regulator.read_aggregate"],[],[],"org","confidential",None,["aggregate_only"]),
 "scholarship_officer": T(["regulator.read_aggregate"],["credential.verify"],[],"org","internal",None,["aggregate_only"]),
 "state_exams_officer": T(["regulator.read_aggregate","exam_body.export","exam_body.import"],[],[],"org","restricted",None,["no_sensitive_by_default"]),
 "projects_officer": T(["regulator.read_aggregate","action.assign"],[],[],"org","internal",None,["aggregate_only"]),
}
APPENDIX_A_ONLY = {"sports_director","enterprise_director","academic_planning","affiliation_liaison","tp_mentor_external","farm_attendant_task","deputy_technical","nsq_assessor","group_finance","group_academic","group_hr","me_officer","policy_desk","scholarship_officer","state_exams_officer","projects_officer"}
assert not set(NEW_TPL) & set(TPL)
LEGACY_TEMPLATES = list(TPL)
TPL.update(NEW_TPL)

# ---- workspace_mode (section 6.2) and the three primary nav sections per template.
TASK_SURFACE_TPL = {"driver","gate_officer","security_staff","farm_attendant_task","tp_mentor_external"}
NO_LOGIN_TPL = {"support_staff"}
# nav source: "b" = Appendix B, "d" = derived here (Appendix B gives none for that template; see ADR-113)
NAV = {
 "regulator": ("b","Jurisdiction","Returns","Actions"),
 "regulator_inspector": ("b","Schedule","Inspections","Reports"),
 "governance_board": ("b","Meetings","Reports","Resolutions"),
 "proprietor": ("b","Overview","Approvals","Finance"),
 "head_of_institution": ("b","Institution","Approvals","People"),
 "deputy_academic": ("b","Academics","Timetable","Results"),
 "deputy_admin": ("b","Operations","Staff","Facilities"),
 "admissions": ("b","Applications","Screening","Offers"),
 "registrar": ("b","Student Records","Requests","Certification"),
 "exams_records": ("b","Exam Timetable","Results Pipeline","Records"),
 "exams_officer": ("b","Exam Timetable","Results Pipeline","Records"),
 "cbt": ("b","Question Banks","Sessions","Marking"),
 "dean": ("b","Faculty","Results","Staff"),
 "hod": ("b","Department","Approvals","Performance"),
 "level_adviser": ("b","My Students","Course Registration","Academic Standing"),
 "teacher": ("b","My Classes","Gradebook","Lesson Notes"),
 "form_teacher": ("b","My Class","Attendance","Report Cards"),
 "teaching_support": ("d","My Classes","Attendance","Materials"),
 "early_years_carer": ("b","My Room","Daily Log","Parents"),
 "lab_workshop": ("b","Practicals","Inventory","Safety"),
 "bursar": ("b","Fees","Reconciliation","Expenses"),
 "accountant": ("b","Ledger","Payables","Reports"),
 "cashier": ("b","Receive Payment","Receipts","Day Close"),
 "payroll": ("b","Payroll Run","Deductions","Payslips"),
 "auditor": ("b","Audit Trail","Samples","Findings"),
 "procurement": ("b","Requests","Purchase Orders","Stores"),
 "store": ("b","Requests","Purchase Orders","Stores"),
 "hr": ("b","Staff","Leave","Appraisals"),
 "admin_officer": ("b","Front Office","Records","Communications"),
 "pr": ("d","News","Website","Media"),
 "legal": ("d","Matters","Documents","Council Papers"),
 "librarian": ("b","Catalogue","Circulation","Members"),
 "library_staff": ("b","Catalogue","Circulation","Members"),
 "hostel_head": ("b","Rooms","Roll Call","Exeats"),
 "house_staff": ("b","Rooms","Roll Call","Exeats"),
 "health": ("b","Visits","Records","Referrals"),
 "counsellor": ("b","Caseload","Sessions","Referrals"),
 "chaplaincy": ("b","Cases","Programmes","Student Bodies"),
 "student_affairs": ("b","Cases","Programmes","Student Bodies"),
 "security_head": ("b","Incidents","Visitors","Patrols"),
 "transport_head": ("b","Routes","Live Buses","Riders"),
 "works": ("b","Requests","Schedules","Inventory"),
 "catering": ("b","Requests","Schedules","Inventory"),
 "ict_head": ("b","Tickets","Access Resets","Devices"),
 "ict_staff": ("b","Tickets","Access Resets","Devices"),
 "data_protection": ("b","Requests","Breaches","Registers"),
 "siwes": ("b","Placements","Logbooks","Employers"),
 "research": ("b","Projects","Grants","Ethics"),
 "alumni": ("b","Members","Levies/Dues","Events"),
 "pta": ("b","Members","Levies/Dues","Events"),
 "parent": ("b","My Children","Fees","Messages"),
 "student": ("b","Today","Results","Learning"),
 "student_leader": ("b","Members","Levies/Dues","Events"),
 "senior_master": ("b","Discipline","Welfare","Duty roster"),
 "provost": ("b","Faculty","Results","Staff"),
 "pg_dean": ("b","Faculty","Results","Staff"),
 "sub_dean": ("b","Faculty","Results","Staff"),
 "senate_secretary": ("b","Senate business","Results approval","Graduation lists"),
 "lecturer": ("b","Courses","Scores","Materials"),
 "health_lecturer": ("b","Courses","Scores","Materials"),
 "exam_centre_coordinator": ("b","Candidates","Registration Exports","Results Import"),
 "sen_teacher": ("d","My Learners","Education Plans","Progress"),
 "technologist": ("b","Practicals","Inventory","Safety"),
 "technical_instructor": ("b","Practicals","Inventory","Safety"),
 "teaching_practice": ("b","Postings","Assessments","Schools"),
 "clinical_instructor": ("b","Postings","Logbooks","Competencies"),
 "clinical_posting_coordinator": ("b","Postings","Logbooks","Competencies"),
 "clinical_preceptor": ("b","Postings","Logbooks","Competencies"),
 "farm_manager": ("b","Farm Units","Practicals","Produce"),
 "farm_unit_supervisor": ("b","Farm Units","Practicals","Produce"),
 "field_instructor": ("b","Farm Units","Practicals","Produce"),
 "research_director": ("b","Projects","Grants","Ethics"),
 "ethics_secretary": ("b","Projects","Grants","Ethics"),
 "quranic_facilitator": ("b","My Halqa","Progress","Parents"),
 "produce_sales": ("d","Produce Sales","Receipts","Day Close"),
 "welfare_officer": ("b","Cases","Programmes","Student Bodies"),
 "emis_officer": ("b","Returns Calendar","Validation","Exports"),
 "posting_officer": ("b","Establishment","Postings","Cases"),
 "recruitment_officer": ("b","Establishment","Postings","Cases"),
 "promotions_officer": ("b","Establishment","Postings","Cases"),
 "teacher_records_officer": ("b","Establishment","Postings","Cases"),
 "lgea_secretary": ("d","Schools","Returns","Inspections"),
 "school_support_officer": ("d","Schools","Returns","Inspections"),
 "private_school_accreditor": ("b","Applications","Visits","Certificates"),
 "accreditation_officer": ("d","Submissions","Reviews","Programme Data"),
 "exam_body_liaison": ("d","Centres","Candidate Registrations","Results Import"),
 "licence_verifier": ("d","Verification Requests","Licences","Expiry Alerts"),
 "licensing_officer": ("d","Indexing","Exam Registration","Licences"),
 "sports_director": ("d","Teams","Fixtures","Facilities"),
 "enterprise_director": ("d","Ventures","Consultancy","Training"),
 "academic_planning": ("d","Programmes","Accreditation","Planning Data"),
 "affiliation_liaison": ("d","Affiliate Programmes","Students","Results"),
 "deputy_technical": ("d","Workshops","Trades","Assessments"),
 "nsq_assessor": ("d","Candidates","Assessments","Certification"),
 "group_finance": ("d","Group Finance","Campuses","Budgets"),
 "group_academic": ("d","Campuses","Curriculum","Results"),
 "group_hr": ("d","Staff","Leave","Appraisals"),
 "me_officer": ("d","Indicators","Returns","Reports"),
 "policy_desk": ("d","Circulars","Policies","Acknowledgements"),
 "scholarship_officer": ("d","Schemes","Applications","Reports"),
 "state_exams_officer": ("d","Exams Calendar","Candidate Registration","Results"),
 "projects_officer": ("d","Projects","Milestones","Evidence"),
}
# Things the brief marks [VERIFY] are carried as data, never asserted.
TPL_VERIFY = {
 "licence_verifier": "TRCN verification API availability [VERIFY]; manual verification field until confirmed",
 "siwes": "ITF documentation formats [VERIFY]",
}
for k, t in TPL.items():
    t["mode"] = "task_surface" if k in TASK_SURFACE_TPL else "none" if k in NO_LOGIN_TPL else "full"
    if t["mode"] == "full":
        src, *nav = NAV[k]
        t["nav"] = nav; t["nav_src"] = {"b":"appendix_b","d":"derived"}[src]
    else:
        assert k not in NAV, k
        t["nav"] = []; t["nav_src"] = "none"
    t["spec"] = "sherivs_017" if k in LEGACY_TEMPLATES else "appendix_a" if k in APPENDIX_A_ONLY else "appendix_b"
    t["verify"] = TPL_VERIFY.get(k)
assert set(NAV) <= set(TPL), set(NAV) - set(TPL)


for t in TPL.values():  # keep lists disjoint and known
    t["on"] = [p for p in t["on"] if p not in t["m"]]; t["off"] = [p for p in t["off"] if p not in t["m"] and p not in t["on"]]
    for p in t["m"]+t["on"]+t["off"]: assert p in P, p

K12 = ["nursery","primary","secondary"]; BOARD=["boarding"]; FAITH=["faith"]; POLY=["polytechnic"]; COE=["college_of_education"]; UNI=["university"]; TER=POLY+COE+UNI; ALL=K12+TER; GOV=["government"]
ROLES = []
def R(category, tpl, inst, *names):
    for n in names: ROLES.append((n, category, tpl, inst))

# ---- Government & agencies
R("Federal Ministry of Education","regulator",GOV,"Honourable Minister of Education","Minister of State for Education","Permanent Secretary (Education)","Director, Basic and Secondary Education","Director, Tertiary Education","Director, Technology and Science Education","Director, Educational Planning, Research and Development","Director, Policy Planning","Director, Human Resources (Ministry)","Director, Finance and Accounts (Ministry)","Director, Federal Inspectorate Service","Federal Inspector of Education","Director, Special Needs Education","Director, Education Support Services","Director, Federal Unity Colleges","Desk Officer, Unity Schools","Education Data / EMIS Officer","Statistician (Education)")
R("State Ministry of Education","regulator",GOV,"Honourable Commissioner for Education","Permanent Secretary (State Education)","Director, Schools Services","Director, Private Schools Registration","Director, Quality Assurance (State)","Director, Examinations (State)","Director, Planning, Research and Statistics (State)","State Inspector of Education","Zonal Education Officer","Tutor-General / Permanent Secretary (Education District)","Private Schools Monitoring Officer","State Examinations Board Officer")
R("SUBEB / UBEC / LGEA","regulator",GOV,"Executive Chairman, SUBEB","Permanent Member, SUBEB","Director, Academic Services (SUBEB)","Director, Social Mobilisation (SUBEB)","Director, Quality Assurance (SUBEB)","UBEC Executive Secretary","UBEC Desk Officer","Education Secretary (LGEA)","LGEA Supervisor","Head of Schools Services (LGEA)","School Support Officer (LGEA)","Basic Education Inspector")
R("Regulators & commissions","regulator",GOV,"NUC Executive Secretary","NUC Accreditation Officer","NUC Desk Officer","NBTE Executive Secretary","NBTE Programme Accreditation Officer","NBTE Desk Officer","NCCE Executive Secretary","NCCE Accreditation Officer","NCCE Desk Officer","TRCN Registrar","TRCN Compliance Officer","NERDC Curriculum Officer","NDPC Compliance Officer (liaison)","NELFUND Desk Officer","TETFund Desk Officer","Scholarship Board Officer")
R("Exam councils","regulator",GOV,"WAEC Liaison Officer","NECO Liaison Officer","NABTEB Liaison Officer","JAMB Liaison / CBT Centre Officer","Exam Council Supervisor (external)","External Examiner","External Moderator")
R("Quality assurance","regulator_inspector",GOV,"Quality Assurance Evaluator","School Inspector","Monitoring and Evaluation Officer")

# ---- Proprietor, governance, group HQ
R("Proprietor & governance","proprietor",ALL,"Proprietor","Proprietress","Founder / Chairman (Private Institution)","Group Managing Director (Schools Group)","Group Executive Director","Chief Executive Officer (Schools Group)")
R("Proprietor & governance","governance_board",ALL,"Board of Governors Chairman","Board of Governors Member","School Management Board Member","Visitor (University)","Pro-Chancellor / Chairman of Council","Governing Council Member","Council Secretary","Trustee (Faith / Mission School)","Mission Education Secretary","Diocesan / Mission Education Director","Proprietor's Representative")
R("Group HQ","auditor",ALL,"Group Internal Audit Head","Group Compliance Officer")
R("Group HQ","head_of_institution",ALL,"Group Director of Education","Group Head of Academics","Campus Director","Campus Manager")

# ---- K-12 leadership
R("Nursery & primary leadership","head_of_institution",["nursery","primary"],"Head Teacher","Head Mistress / Head Master (Primary)","Head of Nursery / Early Years","Head of Primary Section","School Administrator (Private)","Director of Studies (Private)")
R("Nursery & primary leadership","deputy_academic",["nursery","primary"],"Assistant Head Teacher","Deputy Head Teacher (Academics)","Early Years Coordinator","Key Stage Coordinator")
R("Nursery & primary leadership","deputy_admin",["nursery","primary"],"Deputy Head Teacher (Administration)")
R("Secondary leadership","head_of_institution",["secondary"],"Principal","Principal (Senior School)","Principal (Junior School)","Head of School / Executive Principal","Director (Private School)")
R("Secondary leadership","deputy_academic",["secondary"],"Vice Principal (Academics)","Dean of Studies","Director of Studies","Head of Curriculum","Academic Coordinator","Senior Master / Senior Mistress (Academics)")
R("Secondary leadership","deputy_admin",["secondary"],"Vice Principal (Administration)","Vice Principal (Special Duties)","Vice Principal (Student Affairs)","Senior Master / Senior Mistress (Administration)","Dean of Students (Secondary)","Discipline Master / Mistress","Head of Junior School","Head of Senior School")
R("Secondary leadership","exams_officer",["secondary"],"Examinations Officer","WAEC / NECO Coordinator","Continuous Assessment Officer")
R("Secondary leadership","cbt",["secondary"],"CBT Coordinator (School)")
R("Secondary leadership","admissions",K12,"Admissions Officer (School)","Admissions Coordinator","Registrar (Private School)","Records Officer (School)")

# ---- K-12 teaching
R("K-12 teaching","teacher",K12,"Subject Teacher","Class Teacher (Primary)","Specialist Teacher","Mathematics Teacher","English Language Teacher","Science Teacher","Basic Science and Technology Teacher","Social Studies / Civic Education Teacher","Agricultural Science Teacher","Computer Studies / ICT Teacher","French Teacher","Arabic Teacher","Hausa / Igbo / Yoruba Language Teacher","CRS Teacher","IRS Teacher","Fine Arts / Creative Arts Teacher","Music Teacher","Physical and Health Education Teacher","Home Economics Teacher","Business Studies Teacher","Technical Drawing Teacher","Further Mathematics Teacher","Physics Teacher","Chemistry Teacher","Biology Teacher","Economics Teacher","Literature-in-English Teacher","Government Teacher","Geography Teacher","History Teacher","Commerce Teacher","Financial Accounting Teacher","Data Processing Teacher","Special Needs / Inclusive Education Teacher","Montessori Teacher","Coding / Robotics Instructor","Quranic / Tahfiz Teacher","Coach (Sports)","Clubs and Societies Patron","Corps Member Teacher (NYSC)","Part-time / Lesson Teacher")
R("K-12 teaching","form_teacher",K12,"Form Master / Form Mistress","Form Tutor","Class Teacher (Secondary)","Year Head / Year Tutor","Class Coordinator")
R("K-12 teaching","hod",K12,"Head of Department (School)","Head of Science Department","Head of Arts Department","Head of Commercial Department","Head of Languages","Head of Mathematics","Head of Computer Studies Department","Head of Vocational Studies","Subject Coordinator","Sports Director / Games Master")
R("K-12 teaching","teaching_support",K12,"Teaching Assistant","Classroom Assistant","Learning Support Assistant","Student Teacher (Teaching Practice)","SIWES Intern (School)")
R("K-12 teaching","early_years_carer",["nursery"],"Caregiver / Nanny (Creche)","Nursery Assistant","Playgroup Facilitator","Creche Supervisor")
R("K-12 teaching","lab_workshop",K12,"Laboratory Technician (School)","Laboratory Attendant","Workshop Attendant","ICT Lab Attendant")

# ---- Boarding & faith & welfare
R("Boarding","hostel_head",BOARD,"Boarding Master","Boarding Mistress","Director of Boarding","Senior House Master","Senior House Mistress")
R("Boarding","house_staff",BOARD,"House Master","House Mistress","House Parent","Assistant House Master / Mistress","Dormitory Supervisor","Prep Supervisor","Matron","Assistant Matron","Exeat Officer")
R("Faith & pastoral","chaplaincy",FAITH+K12+TER,"Chaplain","Assistant Chaplain","School Imam","Assistant Imam","Islamic Studies Coordinator","Christian Religious Coordinator","Mosque Committee Coordinator","Chapel Prefect Coordinator","Rev. Sister / Brother (Mission School)","Spiritual Director","Alfa / Mallam (Islamiyya)","Islamiyya Head Teacher")
R("Welfare","counsellor",ALL,"Guidance Counsellor","School Counsellor","Student Counsellor (Tertiary)","Special Needs Coordinator","Child Protection / Safeguarding Lead","School Psychologist")
R("Health","health",ALL,"School Nurse","Nursing Sister","School Doctor / Medical Officer","Director, Health Services","Chief Medical Director (University Clinic)","Pharmacist (Clinic)","Clinic Attendant / First Aider","Health Records Officer","Laboratory Scientist (Clinic)","Dental Officer","Mental Health Officer")

# ---- Admin & support (all)
R("Bursary & finance","bursar",ALL,"Bursar","Deputy Bursar","Director of Finance","Chief Finance Officer (Schools Group)","Finance Manager (School)")
R("Bursary & finance","accountant",ALL,"Accountant","Chief Accountant","Senior Accountant","Accounts Officer","Fees Accountant","Budget Officer","Revenue Officer","Expenditure Control Officer","Final Accounts Officer","Treasury Officer","Account Clerk")
R("Bursary & finance","cashier",ALL,"Cashier","Fees Officer","Fees Collection Clerk","Bank Liaison Officer","Accounts Assistant")
R("Bursary & finance","payroll",ALL,"Payroll Officer","Head of Salaries and Wages","Pension Desk Officer","Tax (PAYE) Officer","Salaries Clerk")
R("Bursary & finance","auditor",ALL,"Internal Auditor","Chief Internal Auditor","Audit Officer","Pre-payment Audit Officer","External Auditor (read-only)")
R("Procurement & stores","procurement",ALL,"Procurement Officer","Head of Procurement","Purchasing Officer")
R("Procurement & stores","store",ALL,"Store Keeper","Store Officer","Inventory Officer","Assets Officer","Uniform / Bookshop Manager","Bookshop Attendant")
R("HR & establishment","hr",ALL,"HR Manager","Director of Human Resources","HR Officer","Establishment Officer","Deputy Registrar (Establishment)","Staff Welfare Officer","Training and Development Officer","Recruitment Officer","Pensions and Records Officer (HR)")
R("Administration","admin_officer",ALL,"Administrative Officer","School Secretary","Personal Assistant to Head","Confidential Secretary","Front Desk Officer / Receptionist","Clerical Officer","Typist / Data Entry Clerk","Office Assistant","Messenger","Protocol Officer","Customer Care / Parent Relations Officer","Records Clerk")
R("Administration","pr",ALL,"Public Relations Officer","Information Officer","Media and Communications Officer","Social Media Manager","Marketing / Admissions Marketing Officer","Events Coordinator")
R("Administration","legal",ALL,"Legal Officer","Legal Adviser","Council Legal Secretary")
R("Data protection","data_protection",ALL,"Data Protection Officer (DPO)","Information Governance Officer","Compliance Officer")
R("Library","librarian",ALL,"Librarian","University Librarian","Polytechnic Librarian","College Librarian","Deputy Librarian","Head of Cataloguing","Head of Readers' Services","e-Library / Systems Librarian","School Librarian")
R("Library","library_staff",ALL,"Library Officer","Library Assistant","Library Attendant","Bindery Officer","Archivist")
R("Security","security_head",ALL,"Chief Security Officer","Head of Security","Security Supervisor","Safety Officer / HSE Officer")
R("Security","security_staff",ALL,"Security Guard","Gate Keeper","Patrol Officer","CCTV Operator","Fire Safety Officer","Community Vigilance Liaison")
R("Transport","transport_head",ALL,"Transport Officer","Head of Transport","Fleet Manager")
R("Transport","driver",ALL,"School Bus Driver","Driver","Bus Attendant / Escort","Dispatch Rider")
R("Works & maintenance","works",ALL,"Director of Works and Services","Works Superintendent","Maintenance Officer","Facility Manager","Electrician","Plumber","Carpenter","Mechanic","Generator / Power Plant Operator","Water Works Operator","Estate Officer","Horticulturist / Landscape Officer")
R("Support","support_staff",ALL,"Cleaner","Janitor","Gardener / Groundsman","Laundry Attendant","Porter","Hall Porter","Cook","Steward","Labourer")
R("Catering","catering",ALL,"Catering Manager","Kitchen Supervisor","Dietician / Nutrition Officer","Cafeteria Manager","School Feeding Programme Coordinator")
R("ICT","ict_head",ALL,"Director of ICT / MIS","Head of ICT","Systems Administrator","Network Administrator","Database Administrator","Information Security Officer")
R("ICT","ict_staff",ALL,"ICT Officer","IT Support Officer","Web / Portal Administrator","Data Officer","Programmer / Analyst","Technician (ICT)")
R("Community","pta",K12,"PTA Chairman","PTA Vice Chairman","PTA Secretary","PTA Treasurer","PTA Financial Secretary","PTA Class Representative","SBMC Member (School-Based Management Committee)")
R("Community","parent",ALL,"Parent","Guardian","Sponsor","Foster Parent / Carer")
R("Community","student",ALL,"Student","Pupil","Undergraduate","Postgraduate Student","Part-time / Sandwich Student","Distance Learning Student","Pre-degree / JUPEB Student","Exchange Student")
R("Community","student_leader",ALL,"Head Boy","Head Girl","Senior Prefect","Assistant Head Boy / Head Girl","Labour Prefect","Sports Prefect","Library Prefect","Chapel / Mosque Prefect","Dining Hall Prefect","Social Prefect","House Captain","Class Captain / Class Monitor","Class Representative (Tertiary)","Course Representative","Student Union President","Student Union Executive","Hall Chairman","Departmental Association President")
R("Community","alumni",ALL,"Alumni Relations Officer","Old Students' Association President","Advancement / Endowment Officer","Development Office Director")

# ---- Tertiary principal officers & academics
R("University principal officers","head_of_institution",UNI,"Vice-Chancellor","Acting Vice-Chancellor")
R("University principal officers","deputy_academic",UNI,"Deputy Vice-Chancellor (Academic)","Deputy Vice-Chancellor (Research, Innovation and Development)","Director, Academic Planning","Director, Quality Assurance (University)","Director, Centre for Distance Learning","Director, General Studies","Director, Pre-degree / Foundation Studies","Director, Entrepreneurship Centre","Director, Sandwich / Part-time Programmes")
R("University principal officers","deputy_admin",UNI,"Deputy Vice-Chancellor (Administration)","Deputy Vice-Chancellor (Management Services)")
R("Polytechnic principal officers","head_of_institution",POLY,"Rector","Acting Rector")
R("Polytechnic principal officers","deputy_academic",POLY,"Deputy Rector (Academics)","Director, Academic Planning (Polytechnic)","Director, Quality Assurance (Polytechnic)","Director, Consultancy Services","Director, Centre for Continuing Education")
R("Polytechnic principal officers","deputy_admin",POLY,"Deputy Rector (Administration)")
R("College of Education principal officers","head_of_institution",COE,"Provost","Acting Provost")
R("College of Education principal officers","deputy_academic",COE,"Deputy Provost (Academics)","Director, Degree Programmes (affiliation)","Director, Teaching Practice","Director, General Studies (COE)")
R("College of Education principal officers","deputy_admin",COE,"Deputy Provost (Administration)")
R("Registry","registrar",TER,"Registrar","Deputy Registrar","Deputy Registrar (Academic)","Deputy Registrar (Council Affairs)","Principal Assistant Registrar","Senior Assistant Registrar","Assistant Registrar","Faculty Officer","School Officer (Polytechnic)","Departmental Administrative Officer","Senate / Academic Board Secretary","Convocation Officer")
R("Registry","admissions",TER,"Admissions Officer (Tertiary)","Director, Admissions","JAMB / CAPS Admissions Desk Officer","Matriculation Officer","Post-UTME Screening Officer")
R("Exams & records","exams_records",TER,"Deputy Registrar (Exams and Records)","Head, Exams and Records","Exams and Records Officer","Transcript Officer","Certificate / Verification Officer","Results Processing Officer")
R("Exams & records","exams_officer",TER,"Departmental Exams Officer","Faculty Exams Officer","Chief Invigilator","Invigilator","Exam Malpractice Committee Secretary")
R("Exams & records","cbt",TER,"CBT Centre Manager","CBT Technical Officer","Directorate of CBT Director")
R("Faculties & schools","dean",TER,"Dean of Faculty","Dean of School (Polytechnic)","Dean of College","Provost of College (University)","Dean, Postgraduate School","Provost, Postgraduate College","Sub-Dean","Deputy Dean","Associate Dean")
R("Departments","hod",TER,"Head of Department (HOD)","Acting Head of Department","Programme Coordinator","Postgraduate Coordinator","Unit Head","Head of Unit (Polytechnic)","Director of Institute / Centre","Clinical Coordinator","Curriculum / Accreditation Coordinator")
R("Departments","level_adviser",TER,"Level Adviser","Course Adviser","Academic Adviser","Year Coordinator","Project Supervisor","Postgraduate Supervisor","Staff Adviser (Student Association)")
R("Academic staff","teacher",TER,"Graduate Assistant","Assistant Lecturer","Lecturer II","Lecturer I","Senior Lecturer","Reader / Associate Professor","Professor","Emeritus Professor","Visiting / Adjunct Lecturer","Sabbatical Lecturer","Assistant Lecturer (Polytechnic)","Lecturer III (Polytechnic)","Principal Lecturer","Chief Lecturer","Instructor (Polytechnic)","Senior Instructor","Principal Instructor","Chief Instructor","Technologist","Senior Technologist","Chief Technologist","Teaching Practice Supervisor","Clinical Lecturer / Consultant","Tutor (Distance Learning)","Facilitator (Open and Distance Learning)","Demonstrator / Laboratory Instructor")
R("Academic staff","lab_workshop",TER,"Laboratory Technologist","Laboratory Assistant","Workshop Technician","Studio Technician","Farm Manager (Teaching and Research Farm)","Farm Attendant","Museum / Herbarium Curator")
R("Research","research",TER,"Director, Research and Development","Research Fellow","Senior Research Fellow","Research Grants Officer","Ethics Committee Secretary","Intellectual Property / Tech Transfer Officer","Journal Editor")
R("Student affairs","student_affairs",TER,"Dean of Student Affairs","Deputy Dean of Student Affairs","Student Affairs Officer","Hall Warden","Hall Master / Hall Mistress","Hall Supervisor","Sports Director (Tertiary)","Sports Coach (Tertiary)","Students' Disciplinary Committee Secretary","Students with Disabilities Desk Officer","International Students Officer","Scholarship and Bursary Desk Officer","NYSC Mobilisation Officer","NELFUND / Student Loans Desk Officer")
R("Student affairs","hostel_head",TER,"Hostel Manager","Hall Administrator","Accommodation Officer")
R("SIWES & industry","siwes",TER,"Director, SIWES / Industrial Training","SIWES Coordinator (Institution)","Departmental SIWES / IT Coordinator","Industrial Liaison Officer","Industry-based Supervisor (external)","Career Services / Placement Officer","Teaching Practice Coordinator")


# =============================================================================
# M2a: institution types (section 6.1), Appendix A title mapping, oversight defaults.
# =============================================================================
LEGACY_ROLE_COUNT = len(ROLES)
LEGACY_ROLES = {n: (c, t, list(i)) for n, c, t, i in ROLES}

# code: (label, group, oversight, modifier, parent legacy type, family expansion, code source, verify note)
#  group: basic | tertiary | government | regulator | modifier | legacy
#  family: legacy types whose ORIGINAL (SHERIVS-017) roles also apply to this type, or "tertiary_generic"
#  code source: "brief" = written in section 6.1; "derived" = section 6.1 names the body but gives no code
I = {}
def IT(code, label, group, oversight=False, modifier=False, parent=None, family=(), src="brief", verify=None):
    assert code not in I, code
    I[code] = dict(label=label, group=group, oversight=oversight, modifier=modifier, parent=parent, family=list(family) if not isinstance(family, str) else family, src=src, verify=verify, legacy=False)
# legacy SHERIVS-017 types (kept; still used by every original role)
for c, l, o, m in [("government","Government and agencies (legacy umbrella)",True,False),("nursery","Nursery (legacy)",False,False),("primary","Primary (legacy)",False,False),
                   ("secondary","Secondary (legacy)",False,False),("polytechnic","Polytechnic (legacy)",False,False),("college_of_education","College of Education (legacy)",False,False),
                   ("university","University (legacy)",False,False),("boarding","Boarding (modifier)",False,True),("faith","Faith / mission (legacy)",False,False)]:
    IT(c, l, "legacy", o, m); I[c]["legacy"] = True
# basic and secondary
IT("nursery_ecce","Nursery / ECCE","basic",parent="nursery",family=["nursery"])
IT("public_primary","Public primary","basic",parent="primary",family=["primary"])
IT("private_primary","Private primary","basic",parent="primary",family=["primary"])
IT("public_jss","Public junior secondary","basic",parent="secondary",family=["secondary"])
IT("public_sss","Public senior secondary","basic",parent="secondary",family=["secondary"])
IT("private_secondary","Private secondary","basic",parent="secondary",family=["secondary"])
IT("unity_college","Federal unity college","basic",parent="secondary",family=["secondary"])
IT("technical_college","Technical college","basic",parent="secondary",family=["secondary"])
IT("science_technical_college","Science and technical college","basic",parent="secondary",family=["secondary"])
IT("special_needs_school","Special needs school","basic",family=["primary","secondary"])
IT("islamiyya_sangaya","Islamiyya / Tsangaya / integrated Qur'anic school","basic",parent="faith")
IT("mission_school","Mission school","basic",family=["primary","secondary","faith"])
IT("multi_shift","Multi-shift (modifier)","modifier",modifier=True)
IT("multi_campus_group","Multi-campus group / franchise","basic")
IT("military_school","Military / para-military school","basic",src="derived",verify="named as a gap in section 6.1; no Appendix A titles yet, so no roles are mapped")
IT("adult_literacy_centre","Adult literacy centre","basic",src="derived",verify="named as a gap in section 6.1; no Appendix A titles yet, so no roles are mapped")
# tertiary
for own in ("federal","state","private"):
    IT(f"university_{own}",f"University ({own})","tertiary",parent="university",family=["university"])
for own in ("federal","state","private"):
    IT(f"polytechnic_{own}",f"Polytechnic ({own})","tertiary",parent="polytechnic",family=["polytechnic"])
IT("monotechnic","Monotechnic (specialised)","tertiary",parent="polytechnic",family=["polytechnic"])
for own in ("federal","state","private"):
    IT(f"college_of_education_{own}",f"College of Education ({own})","tertiary",parent="college_of_education",family=["college_of_education"])
IT("college_of_health_technology","College of Health Technology","tertiary",family="tertiary_generic")
IT("college_of_nursing_midwifery","College of Nursing and Midwifery","tertiary",family="tertiary_generic")
IT("college_of_agriculture","College of Agriculture","tertiary",family="tertiary_generic")
IT("innovation_enterprise_institution","Innovation Enterprise Institution (IEI)","tertiary",family="tertiary_generic")
IT("vocational_enterprise_institution","Vocational Enterprise Institution (VEI)","tertiary",family="tertiary_generic")
IT("distance_learning_centre","Distance learning centre","tertiary",family="tertiary_generic")
# government and agencies (oversight)
VERIFY_STATE = "name varies by state [VERIFY each name per state]"
for c, l, v in [("federal_ministry_of_education","Federal Ministry of Education",None),("state_ministry_of_education","State Ministry of Education",None),
                ("ministry_of_higher_education","State Ministry of Higher Education (where separate)",None),("ubec","UBEC",None),("subeb","SUBEB",None),("lgea","LGEA",None),
                ("teaching_service_commission","Teaching Service Commission (TESCOM / PPSMB-type)",VERIFY_STATE),("secondary_education_board","Secondary education board (e.g. SSSEB)",VERIFY_STATE),
                ("arabic_islamic_education_board","Arabic and Islamic education board (e.g. BOSASEB)",VERIFY_STATE),("tvet_board","TVET board",None),("scholarship_board","Scholarship board",None),
                ("agency_for_mass_literacy","Agency for mass literacy",None)]:
    IT(c, l, "government", oversight=True, parent="government", verify=v)
# regulators and exam bodies (integration points; tenants only by MoU). Section 6.1 names them without codes.
for c, l, v in [("nuc","NUC",None),("nbte","NBTE",None),("ncce","NCCE",None),("nmcn","NMCN (nursing and midwifery)",None),
                ("chprbn","CHPRBN-type health board","[VERIFY] board name and remit"),("mlscn","MLSCN-type health board","[VERIFY] board name and remit"),
                ("trcn","TRCN",None),("waec","WAEC",None),("neco","NECO",None),("nabteb","NABTEB",None),("jamb","JAMB",None),("nbais","NBAIS",None)]:
    IT(c, l, "regulator", oversight=True, parent="government", src="derived", verify=v)
OVERSIGHT_TYPES = {c for c, d in I.items() if d["oversight"]}
PUBLIC_OWNED = {"public_primary","public_jss","public_sss","unity_college","university_federal","university_state","polytechnic_federal","polytechnic_state","college_of_education_federal","college_of_education_state"}
GENERIC_TER_CATS = {"Registry","Exams & records","Student affairs","SIWES & industry"}

BASIC_NEW = ["nursery_ecce","public_primary","private_primary","special_needs_school","mission_school"]
SEC_NEW = ["public_jss","public_sss","private_secondary","unity_college","technical_college","science_technical_college"]
UNI_NEW = ["university_federal","university_state","university_private"]
POLY_NEW = ["polytechnic_federal","polytechnic_state","polytechnic_private","monotechnic"]
COE_NEW = ["college_of_education_federal","college_of_education_state","college_of_education_private"]
HEALTH = ["college_of_health_technology","college_of_nursing_midwifery"]
AGRIC = ["college_of_agriculture"]
TVET = ["technical_college","science_technical_college","innovation_enterprise_institution","vocational_enterprise_institution"]
MINISTRIES = ["federal_ministry_of_education","state_ministry_of_education","ministry_of_higher_education"]
STATE_MIN = ["state_ministry_of_education","ministry_of_higher_education"]
BOARDS = ["teaching_service_commission","secondary_education_board"]
HEALTH_BOARDS = ["nmcn","chprbn","mlscn"]

# ---- Original titles whose Appendix A mapping names a NEW (star) template. The migration refuses to
# apply if any of these roles has an active assignment (a remap changes what the holder can do).
REMAP = {
 "Sub-Dean": ("dean","sub_dean"),
 "Dean, Postgraduate School": ("dean","pg_dean"),
 "Provost of College (University)": ("dean","provost"),
 "Ethics Committee Secretary": ("research","ethics_secretary"),
 "Senate / Academic Board Secretary": ("registrar","senate_secretary"),
 "Sports Director (Tertiary)": ("student_affairs","sports_director"),
 "Teaching Practice Coordinator": ("siwes","teaching_practice"),
 "Teaching Practice Supervisor": ("teacher","teaching_practice"),
 "Director, Teaching Practice": ("deputy_academic","teaching_practice"),
 "Farm Manager (Teaching and Research Farm)": ("lab_workshop","farm_manager"),
 "Deputy Vice-Chancellor (Research, Innovation and Development)": ("deputy_academic","research_director"),
 "Director, Academic Planning": ("deputy_academic","academic_planning"),
 "Director, Academic Planning (Polytechnic)": ("deputy_academic","academic_planning"),
 "Director, Consultancy Services": ("deputy_academic","enterprise_director"),
 "Director, Entrepreneurship Centre": ("deputy_academic","enterprise_director"),
 "Director, Degree Programmes (affiliation)": ("deputy_academic","affiliation_liaison"),
 "Technologist": ("teacher","technologist"),
 "Senior Technologist": ("teacher","technologist"),
 "Chief Technologist": ("teacher","technologist"),
 "Education Data / EMIS Officer": ("regulator","emis_officer"),
 "Monitoring and Evaluation Officer": ("regulator_inspector","me_officer"),
 "Education Secretary (LGEA)": ("regulator","lgea_secretary"),
 "LGEA Supervisor": ("regulator","school_support_officer"),
 "School Support Officer (LGEA)": ("regulator","school_support_officer"),
 "Scholarship Board Officer": ("regulator","scholarship_officer"),
 "NUC Accreditation Officer": ("regulator","accreditation_officer"),
 "NBTE Programme Accreditation Officer": ("regulator","accreditation_officer"),
 "NCCE Accreditation Officer": ("regulator","accreditation_officer"),
 "WAEC Liaison Officer": ("regulator","exam_body_liaison"),
 "NECO Liaison Officer": ("regulator","exam_body_liaison"),
 "NABTEB Liaison Officer": ("regulator","exam_body_liaison"),
}

# ---- Original titles that also belong to a new type which family expansion cannot infer.
EXTRA = {}
def X(types, *names):
    for n in names:
        assert n in LEGACY_ROLES, n
        EXTRA.setdefault(n, []); EXTRA[n] += [t for t in types if t not in EXTRA[n]]
X(["federal_ministry_of_education"], *[n for n, (c, _, _) in LEGACY_ROLES.items() if c == "Federal Ministry of Education"])
X(STATE_MIN, *[n for n, (c, _, _) in LEGACY_ROLES.items() if c == "State Ministry of Education"])
for n, (c, _, _) in LEGACY_ROLES.items():
    if c == "SUBEB / UBEC / LGEA":
        X([t for t, key in (("ubec","UBEC"),("subeb","SUBEB"),("lgea","LGEA")) if key in n] or ["ubec","subeb","lgea"], n)
    if c == "Regulators & commissions" or c == "Exam councils":
        for key, t in (("NUC","nuc"),("NBTE","nbte"),("NCCE","ncce"),("TRCN","trcn"),("WAEC","waec"),("NECO","neco"),("NABTEB","nabteb"),("JAMB","jamb")):
            if n.startswith(key + " "): X([t], n)
X(["scholarship_board"], "Scholarship Board Officer")
X(MINISTRIES + ["subeb"] + BOARDS, "Quality Assurance Evaluator", "School Inspector", "Monitoring and Evaluation Officer")
X(["multi_campus_group"], "Group Managing Director (Schools Group)", "Group Executive Director", "Chief Executive Officer (Schools Group)",
  "Group Internal Audit Head", "Group Compliance Officer", "Campus Director", "Campus Manager", "Chief Finance Officer (Schools Group)")
X(["islamiyya_sangaya"], "Parent", "Guardian", "Alfa / Mallam (Islamiyya)", "Islamiyya Head Teacher")
X(["distance_learning_centre"], "Tutor (Distance Learning)", "Facilitator (Open and Distance Learning)", "Director, Centre for Distance Learning")

# ---- Per-role workspace_mode overrides (section 6.2: messengers and general guards get no login).
ROLE_MODE = {"Messenger": "none", "Security Guard": "none"}

# ---- New titles from Appendix A only (new institution types). Parent legacy types are added automatically.
NEW_ROLES = []
def N(category, tpl, types, *names):
    for n in names: NEW_ROLES.append((n, category, tpl, list(types)))
# A1 nursery / ECCE and primary
N("Nursery & primary leadership","early_years_carer",["nursery_ecce"],"ECCE Lead Caregiver / Teacher")
N("K-12 teaching","sen_teacher",BASIC_NEW,"Special Needs Teacher")
N("Data protection","data_protection",BASIC_NEW,"Data Protection Focal Person")
N("Community","parent",BASIC_NEW,"Verified Caregiver / Fee Payer")
N("Security","gate_officer",BASIC_NEW+SEC_NEW+UNI_NEW+POLY_NEW,"Gate / Visitor Officer")
# A2 secondary, unity, technical, boarding
N("Secondary leadership","senior_master",SEC_NEW,"Senior Master / Senior Mistress")
N("Secondary leadership","exam_centre_coordinator",SEC_NEW,"Exam Centre Coordinator (WAEC / NECO / NABTEB)")
N("K-12 teaching","technical_instructor",["technical_college","science_technical_college"],"Technical Instructor")
N("Boarding","house_staff",["boarding"],"Hostel Porter (Roll Call)")
# A3 Islamiyya / Tsangaya
N("Islamiyya & Tsangaya","proprietor",["islamiyya_sangaya"],"Proprietor / Mudir (Islamiyya)")
N("Islamiyya & Tsangaya","head_of_institution",["islamiyya_sangaya"],"Mudir / Headteacher (Islamiyya)")
N("Islamiyya & Tsangaya","quranic_facilitator",["islamiyya_sangaya"],"Mallam / Ustaz (Learning Facilitator)")
N("Islamiyya & Tsangaya","teacher",["islamiyya_sangaya"],"Integrated Subject Teacher")
N("Islamiyya & Tsangaya","admin_officer",["islamiyya_sangaya"],"Records / Admin Officer (Islamiyya)")
N("Islamiyya & Tsangaya","bursar",["islamiyya_sangaya"],"Bursar (Islamiyya)")
N("Islamiyya & Tsangaya","welfare_officer",["islamiyya_sangaya"],"Welfare Officer (Almajiri Welfare and Feeding)")
N("Islamiyya & Tsangaya","regulator_inspector",["arabic_islamic_education_board"],"Board Desk Officer (Islamiyya Oversight)")
# A4 universities
N("Research","research",UNI_NEW,"Research Supervisor")
# A5 polytechnics and monotechnics
N("Academic staff","lab_workshop",POLY_NEW+TVET,"Workshop / Laboratory Superintendent")
N("Academic staff","lab_workshop",["monotechnic"],"Field Survey Practical Coordinator","Flight Training Coordinator","Fisheries Practical Coordinator")
# A6 colleges of education
N("Academic staff","lecturer",COE_NEW+AGRIC,"College Lecturer")
N("College of Education principal officers","affiliation_liaison",COE_NEW,"Degree Affiliation Liaison Officer")
N("Academic staff","tp_mentor_external",COE_NEW,"Cooperating-School Mentor Teacher (TP)")
# A7 colleges of health technology / nursing and midwifery
N("Health college principal officers","head_of_institution",HEALTH,"Provost / Principal (Health College)")
N("Health college principal officers","deputy_academic",HEALTH,"Deputy Provost (Health College)")
N("Clinical education","hod",HEALTH,"Head of Programme / School (Health)")
N("Clinical education","health_lecturer",HEALTH,"Nurse Tutor / Health Lecturer")
N("Clinical education","clinical_instructor",HEALTH,"Clinical Instructor")
N("Clinical education","clinical_preceptor",HEALTH,"Clinical Preceptor (Hospital Site, External)")
N("Clinical education","clinical_posting_coordinator",HEALTH,"Clinical Posting Coordinator")
N("Clinical education","lab_workshop",HEALTH,"Skills / Simulation Lab Coordinator")
N("Exams & records","licensing_officer",HEALTH,"Indexing and Licensing Officer")
# A8 colleges of agriculture
N("Agriculture college principal officers","head_of_institution",AGRIC,"Provost (College of Agriculture)")
N("Agriculture college principal officers","deputy_academic",AGRIC,"Deputy Provost (College of Agriculture)")
N("Farm & practicals","hod",AGRIC,"Dean / Head of Department (Agriculture)")
N("Farm & practicals","farm_manager",AGRIC,"Farm Manager")
N("Farm & practicals","farm_unit_supervisor",AGRIC,"Farm Unit Supervisor (Crops, Livestock, Poultry, Fishery)")
N("Farm & practicals","field_instructor",AGRIC,"Practical / Fieldwork Instructor")
N("Farm & practicals","produce_sales",AGRIC,"Produce Sales and Stores Officer")
N("Farm & practicals","health",AGRIC,"Veterinary Officer")
N("Farm & practicals","siwes",AGRIC,"Farm Practice Coordinator")
N("Farm & practicals","farm_attendant_task",AGRIC,"Farm Attendant (Daily Log)")
N("Support","support_staff",AGRIC,"Casual Farm Labourer")
# A9 TVET: technical colleges, IEIs, VEIs
N("TVET","head_of_institution",["innovation_enterprise_institution","vocational_enterprise_institution"],"Head / Principal (IEI / VEI)")
N("TVET","deputy_technical",TVET,"Vice Principal (Technical)")
N("TVET","technical_instructor",TVET,"Trade / Workshop Instructor")
N("TVET","nsq_assessor",TVET,"NSQ / Assessment Centre Manager")
N("TVET","siwes",TVET,"Industry Placement Officer")
N("TVET","exams_officer",TVET,"NABTEB Exams Officer")
N("TVET","student",TVET,"Trainee")
# A10 multi-campus groups
N("Group HQ","group_finance",["multi_campus_group"],"Group Finance Controller")
N("Group HQ","group_academic",["multi_campus_group"],"Group Academic Director")
N("Group HQ","group_hr",["multi_campus_group"],"Group HR Manager")
# A11 Federal Ministry of Education (oversight)
N("Federal Ministry of Education","policy_desk",["federal_ministry_of_education"],"Circulars / Policy Desk Officer")
N("Federal Ministry of Education","scholarship_officer",["federal_ministry_of_education"],"Scholarship Desk Officer (Ministry)")
# A12 State Ministry of Education / Higher Education (oversight)
N("State Ministry of Education","private_school_accreditor",STATE_MIN,"Private School Registration / Accreditation Officer")
N("State Ministry of Education","emis_officer",STATE_MIN,"EMIS Officer (State)")
N("State Ministry of Education","state_exams_officer",STATE_MIN,"Exams Development Centre Officer")
# A13 UBEC / SUBEB / LGEA (oversight)
N("SUBEB / UBEC / LGEA","emis_officer",["subeb"],"Director, Planning, Research and Statistics (SUBEB)")
N("SUBEB / UBEC / LGEA","regulator_inspector",["subeb"],"SUBEB Quality Assurance Officer")
N("SUBEB / UBEC / LGEA","posting_officer",["subeb"],"Teacher Deployment / Postings Officer")
N("SUBEB / UBEC / LGEA","projects_officer",["subeb"],"UBE Intervention / Projects Officer")
N("SUBEB / UBEC / LGEA","emis_officer",["lgea"],"LGEA EMIS Focal Person")
# A14 Teaching Service Commission and secondary education boards (oversight)
N("Teaching service & boards","regulator",BOARDS,"Chairman, Teaching Service Commission / Board","Commissioner / Board Member (Teaching Service)")
N("Teaching service & boards","posting_officer",BOARDS,"Director, Establishment and Postings")
N("Teaching service & boards","recruitment_officer",BOARDS,"Recruitment Officer (Teaching Service)")
N("Teaching service & boards","promotions_officer",BOARDS,"Discipline / Promotions Officer")
N("Teaching service & boards","teacher_records_officer",BOARDS,"Teacher Records Officer")
N("Teaching service & boards","emis_officer",BOARDS,"Board EMIS Officer")
# A15 regulators and exam bodies (integration desks; tenants only by MoU)
N("Regulators & commissions","accreditation_officer",["nuc","nbte","ncce"]+HEALTH_BOARDS,"Accreditation Desk Officer")
N("Regulators & commissions","licensing_officer",HEALTH_BOARDS,"Licensing Exam Registration Officer")
N("Exam councils","exam_body_liaison",["waec","neco","nabteb","nbais"],"Exam Centre Liaison")
N("Exam councils","admissions",["jamb"],"JAMB Admissions Liaison (CAPS)")
N("Regulators & commissions","licence_verifier",["trcn"],"Teacher Licence Verification Desk Officer")
ROLE_MODE["Hostel Porter (Roll Call)"] = "task_surface"
ROLE_VERIFY = {
 "Teacher Licence Verification Desk Officer": "TRCN verification API [VERIFY]",
 "Board Desk Officer (Islamiyya Oversight)": "authority desk, mandate unverified; board name varies by state [VERIFY]",
}
for n, *_ in NEW_ROLES:
    assert n not in LEGACY_ROLES, n
ROLES += NEW_ROLES

def _order(types):
    s = set(types); return [c for c in I if c in s]

def resolve_role(n, cat, tpl, inst, legacy):
    types = list(inst)
    if legacy:
        for t, d in I.items():
            if d["legacy"]: continue
            fam = d["family"]
            if fam == "tertiary_generic":
                hit = set(ALL) <= set(inst) or (set(TER) <= set(inst) and cat in GENERIC_TER_CATS)
            else:
                hit = bool(set(fam) & set(inst))
            if hit and not (tpl == "proprietor" and t in PUBLIC_OWNED):
                types.append(t)
        types += EXTRA.get(n, [])
        if n in REMAP:
            old, new = REMAP[n]; assert tpl == old, (n, tpl, old); tpl = new
    else:
        types += [I[t]["parent"] for t in inst if I[t]["parent"]]
    for t in types: assert t in I, (n, t)
    types = _order(types)
    oversight = all(t in OVERSIGHT_TYPES for t in types)
    assert oversight or not (set(types) & OVERSIGHT_TYPES), (n, types)  # never mixed
    mode = ROLE_MODE.get(n, TPL[tpl]["mode"])
    if mode == "full" and TPL[tpl]["mode"] != "full":
        raise AssertionError(n)
    return dict(name=n, category=cat, template=tpl, types=types, mode=mode, oversight=oversight,
                enabled=not oversight, mandate="unverified" if oversight else "not_required",
                previous=REMAP[n][0] if legacy and n in REMAP else None, verify=ROLE_VERIFY.get(n), legacy=legacy)
assert set(REMAP) <= set(LEGACY_ROLES)
assert set(ROLE_MODE) <= {n for n, *_ in ROLES}


seen=set()
for n,*_ in ROLES:
    assert n not in seen, n; seen.add(n)

def code(n): return "ng." + re.sub(r"[^a-z0-9]+","_",n.lower()).strip("_")
RESOLVED = [resolve_role(n, c, t, i, idx < LEGACY_ROLE_COUNT) for idx, (n, c, t, i) in enumerate(ROLES)]
SOD_ROLE_TEMPLATES = [("auditor","bursar"),("auditor","accountant"),("auditor","cashier"),("auditor","payroll"),("auditor","procurement"),("data_protection","ict_head"),("payroll","bursar"),("cashier","auditor"),
                      ("auditor","produce_sales")]  # M2a: auditor_independence also covers produce cash
SOD_ROLE_TEMPLATES = sorted(set(tuple(sorted(p)) for p in SOD_ROLE_TEMPLATES))
LEGACY_SOD_PAIRS = [("auditor","bursar"),("auditor","accountant"),("auditor","cashier"),("auditor","payroll"),("auditor","procurement"),("data_protection","ict_head"),("bursar","payroll")]
# (a, b, description, optional-per-pack, basis). Rules are per record/batch (who did step a may not do step b on the same item).
SOD_PERM = [("payroll.prepare","payroll.approve","Preparer and approver of the same payroll line must be different people",False,"sherivs_017"),
            ("expenses.create","expenses.approve","Raiser and approver of the same expense must be different people",False,"sherivs_017"),
            ("payments.record_cash","payments.reconcile","Cash recorded by a person is reconciled by someone else",False,"sherivs_017"),
            ("procurement.request","procurement.approve","Requester cannot approve own purchase order",False,"sherivs_017"),
            ("farm.produce_record","farm.produce_sell","Whoever records a produce batch cannot sell it or receive its cash",False,"appendix_c"),
            ("roles.custom_create","roles.custom_approve","The creator of a custom role cannot approve the same role",False,"appendix_c"),
            ("admissions.score","admissions.offer","Whoever scores an applicant does not issue that applicant's offer (optional per pack)",True,"appendix_c"),
            ("returns.submit","returns.review","A return is reviewed across the institution/authority boundary, never by its submitter",False,"appendix_c"),
            ("research.manage","research.ethics_approve","An ethics approver cannot approve an application they submitted (the applicant holds research.manage on that project)",False,"appendix_c")]
for a, b, *_ in SOD_PERM: assert a in P and b in P, (a, b)
for a, b in SOD_ROLE_TEMPLATES: assert a in TPL and b in TPL, (a, b)
for t in TPL.values():
    for p in t["m"]+t["on"]+t["off"]: assert p in P, p
    assert len(set(t["m"]+t["on"]+t["off"])) == len(t["m"]+t["on"]+t["off"])
    for g in t["g"]: assert g in G, g
NEW_PERMS = [c for c in P if c not in LEGACY_PERMS]
NEW_TEMPLATES = [k for k in TPL if k not in LEGACY_TEMPLATES]
NEW_GUARDRAILS = [g for g in G if g not in LEGACY_GUARDRAILS]
MIGRATION = "database/supabase/migrations/20261117001000_sherivs_m2a_role_catalog_extension.sql"
ROLLBACK = "database/supabase/rollbacks/20261117001000_sherivs_m2a_role_catalog_extension.sql"

def q(s): return "'" + s.replace("'","''") + "'"
def arr(xs): return "ARRAY[" + ",".join(q(x) for x in xs) + "]::text[]" if xs else "'{}'::text[]"
def b(x): return "true" if x else "false"

def sql():
    out=["-- >>> generated by tools/role-catalog/catalog.py (do not hand-edit) >>>"]
    out.append("INSERT INTO public.permission_catalog (code, module, label, sensitivity, protected) VALUES\n" + ",\n".join(f"  ({q(c)},{q(m)},{q(l)},{q(s)},{b(p)})" for c,(m,l,s,p) in P.items()) + "\nON CONFLICT (code) DO UPDATE SET module=EXCLUDED.module, label=EXCLUDED.label, sensitivity=EXCLUDED.sensitivity, protected=EXCLUDED.protected;")
    out.append("INSERT INTO public.role_guardrail_catalog (code, description) VALUES\n" + ",\n".join(f"  ({q(c)},{q(d)})" for c,d in G.items()) + "\nON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description;")
    out.append("INSERT INTO public.role_templates (code, default_scope, data_sensitivity, approval_limit_ngn, guardrails, workspace_mode, nav_sections) VALUES\n" + ",\n".join(f"  ({q(k)},{q(t['scope'])},{q(t['sens'])},{t['limit'] if t['limit'] is not None else 'NULL'},{arr(t['g'])},{q(t['mode'])},{arr(t['nav'])})" for k,t in TPL.items()) + "\nON CONFLICT (code) DO UPDATE SET default_scope=EXCLUDED.default_scope, data_sensitivity=EXCLUDED.data_sensitivity, approval_limit_ngn=EXCLUDED.approval_limit_ngn, guardrails=EXCLUDED.guardrails, workspace_mode=EXCLUDED.workspace_mode, nav_sections=EXCLUDED.nav_sections;")
    tp=[]
    for k,t in TPL.items():
        tp += [f"({q(k)},{q(p)},'mandatory',true)" for p in t["m"]] + [f"({q(k)},{q(p)},'optional',true)" for p in t["on"]] + [f"({q(k)},{q(p)},'optional',false)" for p in t["off"]]
    # Existing rows keep their default_on: later applied migrations govern it (M07 turned the
    # bursar's payments.record_cash off; the cashier alone records cash). New rows get the default.
    out.append("INSERT INTO public.role_template_permissions (template_code, permission_code, kind, default_on) VALUES\n  " + ",\n  ".join(tp) + "\nON CONFLICT (template_code, permission_code) DO UPDATE SET kind=EXCLUDED.kind, default_on=public.role_template_permissions.default_on;")
    # Roles that M009-B1 moved to the read-only executive template stay there until their
    # authority link is verified; the catalogue never re-grants full executive templates.
    out.append("INSERT INTO public.role_catalog (code, name, category, template_code, institution_types, workspace_mode, default_enabled, mandate_status, requires_verified_authority_link) VALUES\n" + ",\n".join(f"  ({q(code(r['name']))},{q(r['name'])},{q(r['category'])},{q(r['template'])},{arr(r['types'])},{q(r['mode'])},{b(r['enabled'])},{q(r['mandate'])},{b(r['oversight'])})" for r in RESOLVED) + "\nON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, template_code=CASE WHEN public.role_catalog.template_code = 'm009_tertiary_executive_read_only' THEN public.role_catalog.template_code ELSE EXCLUDED.template_code END, institution_types=EXCLUDED.institution_types, workspace_mode=EXCLUDED.workspace_mode, default_enabled=EXCLUDED.default_enabled, mandate_status=EXCLUDED.mandate_status, requires_verified_authority_link=(public.role_catalog.requires_verified_authority_link OR EXCLUDED.requires_verified_authority_link);")
    out.append("INSERT INTO public.sod_template_conflicts (template_a, template_b) VALUES\n" + ",\n".join(f"  ({q(a)},{q(b_)})" for a,b_ in SOD_ROLE_TEMPLATES) + "\nON CONFLICT DO NOTHING;")
    out.append("INSERT INTO public.sod_permission_rules (permission_a, permission_b, description) VALUES\n" + ",\n".join(f"  ({q(a)},{q(b_)},{q(d)})" for a,b_,d,*_ in SOD_PERM) + "\nON CONFLICT DO NOTHING;")
    out.append("-- <<< generated <<<")
    return "\n".join(out)

def in_list(xs): return "(" + ",".join(q(x) for x in xs) + ")"

def migration(seed):
    remapped = [code(r["name"]) for r in RESOLVED if r["previous"]]
    return f"""-- NOT APPLIED. Needs the founder's written approval for this file; applied from merged master only.
-- M2a (mission E-006, ADR-113): Nigerian role catalogue extension. Catalogue data only, never tenant data.
-- Generated by tools/role-catalog/catalog.py from the same data as
-- frontend/src/lib/scholar/roles/ng-role-catalog.generated.ts. Do not hand-edit; regenerate.
-- Requires SHERIVS-017 (20261024000240). Adds three catalogue columns to role_templates / role_catalog
-- (workspace_mode, nav_sections, default_enabled, mandate_status) and upserts the extended seed.
-- No table, function, grant or policy is created; the existing 017 catalogue grants (SELECT for
-- authenticated and service_role, no writes for API roles) cover the new columns.
-- Oversight roles (government, agency, regulator and exam-body types) ship default_enabled = false,
-- mandate_status = 'unverified' and requires_verified_authority_link = true (the M009 B-1/B-5 gate).
-- {len(remapped)} original titles move to a new template (ADR-113, REMAP). The guard below refuses to run if
-- any of them has an active assignment, because a remap changes what the holder can do.
-- Rollback: {ROLLBACK}

DO $guard$
BEGIN
  IF to_regclass('public.role_catalog') IS NULL OR to_regclass('public.role_templates') IS NULL THEN
    RAISE EXCEPTION 'M2a requires the SHERIVS-017 role catalogue (20261024000240)';
  END IF;
  IF to_regclass('public.user_role_assignments') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.user_role_assignments a
        WHERE a.status = 'active'
          AND a.role_code IN {in_list(remapped)}) THEN
    RAISE EXCEPTION 'M2a: a remapped catalogue role has active assignments; review ADR-113 REMAP with the founder before applying'
      USING ERRCODE = '55000';
  END IF;
END
$guard$;

ALTER TABLE public.role_templates
  ADD COLUMN IF NOT EXISTS workspace_mode text NOT NULL DEFAULT 'full'
    CONSTRAINT role_templates_workspace_mode_chk CHECK (workspace_mode IN ('full','task_surface','none')),
  ADD COLUMN IF NOT EXISTS nav_sections text[] NOT NULL DEFAULT '{{}}';
ALTER TABLE public.role_catalog
  ADD COLUMN IF NOT EXISTS workspace_mode text NOT NULL DEFAULT 'full'
    CONSTRAINT role_catalog_workspace_mode_chk CHECK (workspace_mode IN ('full','task_surface','none')),
  ADD COLUMN IF NOT EXISTS default_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS mandate_status text NOT NULL DEFAULT 'not_required'
    CONSTRAINT role_catalog_mandate_status_chk CHECK (mandate_status IN ('not_required','unverified','verified')),
  -- Same definition as M009 B-1 (20261103145000); a no-op where B-1 is applied.
  ADD COLUMN IF NOT EXISTS requires_verified_authority_link boolean NOT NULL DEFAULT false;

{seed}
"""

def rollback():
    legacy = [r for r in RESOLVED if r["legacy"]]
    new_codes = [code(r["name"]) for r in RESOLVED if not r["legacy"]]
    vals = ",\n".join(f"  ({q(code(r['name']))},{q(LEGACY_ROLES[r['name']][1])},{arr(LEGACY_ROLES[r['name']][2])})" for r in legacy)
    new_sod_pairs = [p for p in SOD_ROLE_TEMPLATES if p not in [tuple(sorted(x)) for x in LEGACY_SOD_PAIRS]]
    new_sod_perm = [(a, b_) for a, b_, _, _, basis in SOD_PERM if basis != "sherivs_017"]
    pairs = lambda ps: ",".join(f"({q(a)},{q(b_)})" for a, b_ in ps)
    return f"""-- Rollback for {MIGRATION}
-- Generated by tools/role-catalog/catalog.py. Restores the SHERIVS-017 catalogue exactly:
-- original templates and institution types of the 572 original roles, and removes every row
-- the extension added. Fails (and changes nothing) if a new role, template or permission is in use
-- (foreign keys from assignments, custom roles, settings or grants), so nothing is lost silently.
-- The 017 guards forbid deleting templates and mandatory template permissions; they are disabled
-- only inside this transaction and re-enabled before COMMIT.
-- requires_verified_authority_link is owned by M009 B-1 and is not dropped.
BEGIN;
ALTER TABLE public.role_templates DISABLE TRIGGER trg_role_templates_guard;
ALTER TABLE public.role_template_permissions DISABLE TRIGGER trg_role_template_permissions_guard;

UPDATE public.role_catalog r SET template_code = CASE WHEN r.template_code = 'm009_tertiary_executive_read_only' THEN r.template_code ELSE v.template_code END,  -- M009-B1 owns these
       institution_types = v.institution_types
  FROM (VALUES
{vals}
  ) AS v(code, template_code, institution_types)
 WHERE r.code = v.code AND r.org_id IS NULL;
DELETE FROM public.role_catalog WHERE org_id IS NULL AND code IN {in_list(new_codes)};
DELETE FROM public.sod_template_conflicts WHERE (template_a, template_b) IN ({pairs(new_sod_pairs)});
DELETE FROM public.sod_permission_rules WHERE (permission_a, permission_b) IN ({pairs(new_sod_perm)});
DELETE FROM public.role_template_permissions WHERE template_code IN {in_list(NEW_TEMPLATES)} OR permission_code IN {in_list(NEW_PERMS)};
DELETE FROM public.role_templates WHERE code IN {in_list(NEW_TEMPLATES)};
DELETE FROM public.permission_catalog WHERE code IN {in_list(NEW_PERMS)};
DELETE FROM public.role_guardrail_catalog WHERE code IN {in_list(NEW_GUARDRAILS)};

ALTER TABLE public.role_template_permissions ENABLE TRIGGER trg_role_template_permissions_guard;
ALTER TABLE public.role_templates ENABLE TRIGGER trg_role_templates_guard;
ALTER TABLE public.role_catalog DROP COLUMN IF EXISTS workspace_mode, DROP COLUMN IF EXISTS default_enabled, DROP COLUMN IF EXISTS mandate_status;
ALTER TABLE public.role_templates DROP COLUMN IF EXISTS workspace_mode, DROP COLUMN IF EXISTS nav_sections;
COMMIT;
"""

def stats():
    mand = sum(len(t["m"]) for t in TPL.values()); opt = sum(len(t["on"])+len(t["off"]) for t in TPL.values())
    roles_m = sum(len(TPL[r["template"]]["m"]) for r in RESOLVED); roles_o = sum(len(TPL[r["template"]]["on"])+len(TPL[r["template"]]["off"]) for r in RESOLVED)
    return dict(roles=len(RESOLVED), categories=len({r["category"] for r in RESOLVED}), templates=len(TPL), permissions=len(P), protected=sum(1 for v in P.values() if v[3]),
                guardrails=len(G), template_mandatory=mand, template_optional=opt, role_mandatory_grants=roles_m, role_optional_grants=roles_o,
                sod_role_pairs=len(SOD_ROLE_TEMPLATES), sod_permission_rules=len(SOD_PERM),
                institution_types=len(I), oversight_institution_types=len(OVERSIGHT_TYPES), oversight_roles=sum(1 for r in RESOLVED if r["oversight"]),
                remapped_roles=sum(1 for r in RESOLVED if r["previous"]),
                workspace_full=sum(1 for r in RESOLVED if r["mode"]=="full"), workspace_task_surface=sum(1 for r in RESOLVED if r["mode"]=="task_surface"), workspace_none=sum(1 for r in RESOLVED if r["mode"]=="none"))

def ts():
    j = lambda x: json.dumps(x, ensure_ascii=False)
    out = "/* generated by tools/role-catalog/catalog.py - do not hand-edit */\n"
    out += "export type NgWorkspaceMode = \"full\" | \"task_surface\" | \"none\";\n"
    out += "export const NG_ROLE_CATALOG_STATS = " + j(stats()) + " as const;\n"
    out += "export const NG_PERMISSIONS: Record<string, { module: string; label: string; sensitivity: string; protected: boolean }> = " + j({c:dict(module=m,label=l,sensitivity=s,protected=p) for c,(m,l,s,p) in P.items()}) + ";\n"
    out += "export const NG_GUARDRAILS: Record<string, string> = " + j(G) + ";\n"
    out += ("export const NG_INSTITUTION_TYPES: Record<string, { label: string; group: string; oversight: boolean; modifier: boolean; legacy: boolean; parent: string | null; "
            "family: string[] | \"tertiary_generic\"; codeSource: \"brief\" | \"derived\"; verify: string | null }> = "
            + j({c:dict(label=d["label"],group=d["group"],oversight=d["oversight"],modifier=d["modifier"],legacy=d["legacy"],parent=d["parent"],family=d["family"],codeSource=d["src"],verify=d["verify"]) for c,d in I.items()}) + ";\n")
    out += ("export const NG_ROLE_TEMPLATES: Record<string, { mandatory: string[]; optionalOn: string[]; optionalOff: string[]; scope: string; sensitivity: string; approvalLimitNgn: number | null; guardrails: string[]; "
            "workspaceMode: NgWorkspaceMode; nav: string[]; navSource: \"appendix_b\" | \"derived\" | \"none\"; specSource: \"sherivs_017\" | \"appendix_b\" | \"appendix_a\"; verify: string | null }> = "
            + j({k:dict(mandatory=t["m"],optionalOn=t["on"],optionalOff=t["off"],scope=t["scope"],sensitivity=t["sens"],approvalLimitNgn=t["limit"],guardrails=t["g"],
                        workspaceMode=t["mode"],nav=t["nav"],navSource=t["nav_src"],specSource=t["spec"],verify=t["verify"]) for k,t in TPL.items()}) + ";\n")
    out += ("export const NG_ROLES: { code: string; name: string; category: string; template: string; institutionTypes: string[]; workspaceMode: NgWorkspaceMode; "
            "defaultEnabled: boolean; mandateStatus: \"not_required\" | \"unverified\"; oversight: boolean; previousTemplate: string | null; verify: string | null }[] = "
            + j([dict(code=code(r["name"]),name=r["name"],category=r["category"],template=r["template"],institutionTypes=r["types"],workspaceMode=r["mode"],
                      defaultEnabled=r["enabled"],mandateStatus=r["mandate"],oversight=r["oversight"],previousTemplate=r["previous"],verify=r["verify"]) for r in RESOLVED]) + ";\n")
    out += "export const NG_SOD_ROLE_PAIRS: [string, string][] = " + j([list(p) for p in SOD_ROLE_TEMPLATES]) + ";\n"
    out += ("export const NG_SOD_PERMISSION_RULES: { a: string; b: string; description: string; optionalPerPack: boolean; basis: \"sherivs_017\" | \"appendix_c\" }[] = "
            + j([dict(a=a,b=b_,description=d,optionalPerPack=o,basis=s) for a,b_,d,o,s in SOD_PERM]) + ";\n")
    return out

def outputs():
    seed = sql() + "\n"
    return {"tools/role-catalog/seed.generated.sql": seed,
            MIGRATION: migration(seed.rstrip("\n")),
            ROLLBACK: rollback(),
            "frontend/src/lib/scholar/roles/ng-role-catalog.generated.ts": ts()}

if __name__ == "__main__":
    import sys
    outs = outputs()
    if "--check" in sys.argv:
        stale = [p for p, s in outs.items() if not (ROOT/p).exists() or (ROOT/p).read_text() != s]
        if stale:
            print("STALE: " + ", ".join(stale) + " (run python3 tools/role-catalog/catalog.py)"); sys.exit(1)
        print("UP TO DATE"); sys.exit(0)
    for p, s in outs.items(): (ROOT/p).write_text(s)
    print(json.dumps(stats()))
