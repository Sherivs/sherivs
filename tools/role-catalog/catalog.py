"""Sherivs Nigerian education role catalog (SHERIVS-017) - single source of truth.
Generates the seed SQL for migration 017 and a TS mirror for the admin role panel/tests.
Run: python3 tools/role-catalog/catalog.py
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
 "bursar": T(["fees.view","fees.manage_plans","payments.reconcile","reports.financial","wallet.view","budget.manage",*STAFF],["payments.record_cash","expenses.approve","payroll.approve","payments.refund","wallet.topup","payroll.view_all"],["expenses.create"],"org","restricted",2_000_000,["no_self_payroll_approval","no_self_expense_approval","no_sensitive_by_default"]),
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

seen=set()
for n,*_ in ROLES:
    assert n not in seen, n; seen.add(n)

def code(n): return "ng." + re.sub(r"[^a-z0-9]+","_",n.lower()).strip("_")
SOD_ROLE_TEMPLATES = [("auditor","bursar"),("auditor","accountant"),("auditor","cashier"),("auditor","payroll"),("auditor","procurement"),("data_protection","ict_head"),("payroll","bursar"),("cashier","auditor")]
SOD_ROLE_TEMPLATES = sorted(set(tuple(sorted(p)) for p in SOD_ROLE_TEMPLATES))
SOD_PERM = [("payroll.prepare","payroll.approve","Preparer and approver of the same payroll line must be different people"),
            ("expenses.create","expenses.approve","Raiser and approver of the same expense must be different people"),
            ("payments.record_cash","payments.reconcile","Cash recorded by a person is reconciled by someone else"),
            ("procurement.request","procurement.approve","Requester cannot approve own purchase order")]

def q(s): return "'" + s.replace("'","''") + "'"
def arr(xs): return "ARRAY[" + ",".join(q(x) for x in xs) + "]::text[]" if xs else "'{}'::text[]"

def sql():
    out=["-- >>> generated by tools/role-catalog/catalog.py (do not hand-edit) >>>"]
    out.append("INSERT INTO public.permission_catalog (code, module, label, sensitivity, protected) VALUES\n" + ",\n".join(f"  ({q(c)},{q(m)},{q(l)},{q(s)},{'true' if p else 'false'})" for c,(m,l,s,p) in P.items()) + "\nON CONFLICT (code) DO UPDATE SET module=EXCLUDED.module, label=EXCLUDED.label, sensitivity=EXCLUDED.sensitivity, protected=EXCLUDED.protected;")
    out.append("INSERT INTO public.role_guardrail_catalog (code, description) VALUES\n" + ",\n".join(f"  ({q(c)},{q(d)})" for c,d in G.items()) + "\nON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description;")
    out.append("INSERT INTO public.role_templates (code, default_scope, data_sensitivity, approval_limit_ngn, guardrails) VALUES\n" + ",\n".join(f"  ({q(k)},{q(t['scope'])},{q(t['sens'])},{t['limit'] if t['limit'] is not None else 'NULL'},{arr(t['g'])})" for k,t in TPL.items()) + "\nON CONFLICT (code) DO UPDATE SET default_scope=EXCLUDED.default_scope, data_sensitivity=EXCLUDED.data_sensitivity, approval_limit_ngn=EXCLUDED.approval_limit_ngn, guardrails=EXCLUDED.guardrails;")
    tp=[]
    for k,t in TPL.items():
        tp += [f"({q(k)},{q(p)},'mandatory',true)" for p in t["m"]] + [f"({q(k)},{q(p)},'optional',true)" for p in t["on"]] + [f"({q(k)},{q(p)},'optional',false)" for p in t["off"]]
    out.append("INSERT INTO public.role_template_permissions (template_code, permission_code, kind, default_on) VALUES\n  " + ",\n  ".join(tp) + "\nON CONFLICT (template_code, permission_code) DO UPDATE SET kind=EXCLUDED.kind, default_on=EXCLUDED.default_on;")
    out.append("INSERT INTO public.role_catalog (code, name, category, template_code, institution_types) VALUES\n" + ",\n".join(f"  ({q(code(n))},{q(n)},{q(c)},{q(t)},{arr(i)})" for n,c,t,i in ROLES) + "\nON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, template_code=EXCLUDED.template_code, institution_types=EXCLUDED.institution_types;")
    out.append("INSERT INTO public.sod_template_conflicts (template_a, template_b) VALUES\n" + ",\n".join(f"  ({q(a)},{q(b)})" for a,b in SOD_ROLE_TEMPLATES) + "\nON CONFLICT DO NOTHING;")
    out.append("INSERT INTO public.sod_permission_rules (permission_a, permission_b, description) VALUES\n" + ",\n".join(f"  ({q(a)},{q(b)},{q(d)})" for a,b,d in SOD_PERM) + "\nON CONFLICT DO NOTHING;")
    out.append("-- <<< generated <<<")
    return "\n".join(out)

if __name__ == "__main__":
    (ROOT/"tools/role-catalog/seed.generated.sql").write_text(sql()+"\n")
    mand = sum(len(t["m"]) for t in TPL.values()); opt = sum(len(t["on"])+len(t["off"]) for t in TPL.values())
    roles_m = sum(len(TPL[t]["m"]) for _,_,t,_ in ROLES); roles_o = sum(len(TPL[t]["on"])+len(TPL[t]["off"]) for _,_,t,_ in ROLES)
    stats = dict(roles=len(ROLES), categories=len({c for _,c,_,_ in ROLES}), templates=len(TPL), permissions=len(P), protected=sum(1 for v in P.values() if v[3]),
                 guardrails=len(G), template_mandatory=mand, template_optional=opt, role_mandatory_grants=roles_m, role_optional_grants=roles_o,
                 sod_role_pairs=len(SOD_ROLE_TEMPLATES), sod_permission_rules=len(SOD_PERM))
    ts = "/* generated by tools/role-catalog/catalog.py - do not hand-edit */\n"
    ts += "export const NG_ROLE_CATALOG_STATS = " + json.dumps(stats) + " as const;\n"
    ts += "export const NG_PERMISSIONS: Record<string, { module: string; label: string; sensitivity: string; protected: boolean }> = " + json.dumps({c:dict(module=m,label=l,sensitivity=s,protected=p) for c,(m,l,s,p) in P.items()}) + ";\n"
    ts += "export const NG_GUARDRAILS: Record<string, string> = " + json.dumps(G) + ";\n"
    ts += "export const NG_ROLE_TEMPLATES: Record<string, { mandatory: string[]; optionalOn: string[]; optionalOff: string[]; scope: string; sensitivity: string; approvalLimitNgn: number | null; guardrails: string[] }> = " + json.dumps({k:dict(mandatory=t["m"],optionalOn=t["on"],optionalOff=t["off"],scope=t["scope"],sensitivity=t["sens"],approvalLimitNgn=t["limit"],guardrails=t["g"]) for k,t in TPL.items()}) + ";\n"
    ts += "export const NG_ROLES: { code: string; name: string; category: string; template: string; institutionTypes: string[] }[] = " + json.dumps([dict(code=code(n),name=n,category=c,template=t,institutionTypes=i) for n,c,t,i in ROLES]) + ";\n"
    (ROOT/"frontend/src/lib/scholar/roles/ng-role-catalog.generated.ts").write_text(ts)
    print(json.dumps(stats))
