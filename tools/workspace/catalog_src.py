# Source of truth for the workspace item catalog. Run: python3 tools/workspace/catalog_src.py
# Emits frontend/src/lib/sherivs-ws/catalog.data.ts (UI + tests) and the SQL seed block in the migration.
import json, re, pathlib
I = []
def add(kind, k, icon, to, any_=(), all_=(), feature=None, size="m", en="", ha="", yo="", ig="", pcm="", families=(), scope=(), policy=None):
    # scope: assigned-scope dimensions that unlock the item (campus/shift/section/level...); empty = not scope-bound.
    # policy: a school workspace policy (POLICIES below) that must be on for the item to appear.
    I.append(dict(key=k, kind=kind, icon=icon, to=to, any=list(any_), all=list(all_), feature=feature, size=size, families=list(families),
                  scopeDims=list(scope), policy=policy,
                  label=dict(en=en, ha=ha or en, yo=yo or en, ig=ig or en, pcm=pcm or en)))
# ---- navigation ----
N = lambda *a, **kw: add("nav", *a, **kw)
N("nav.home","home","/workspace",en="Home",ha="Gida",yo="Ilé",ig="Ụlọ",pcm="Home")
N("nav.students","users","/admin/students",["students.view"],en="Students",ha="Ɗalibai",yo="Akẹ́kọ̀ọ́",ig="Ụmụ akwụkwọ",pcm="Students")
N("nav.my_classes","book-open","/teacher/dashboard",["attendance.take","grades.enter"],en="My classes",ha="Ajujuwana",yo="Kíláàsì mi",ig="Klas m",pcm="My class dem")
N("nav.attendance","check-square","/teacher/attendance",["attendance.take","attendance.view"],en="Attendance",ha="Halarta",yo="Ìwọlé",ig="Ọbịbịa",pcm="Attendance")
N("nav.gradebook","clipboard","/teacher/gradebook",["grades.enter","grades.view"],en="Gradebook",ha="Littafin maki",yo="Ìwé máàkì",ig="Akwụkwọ akara",pcm="Mark book")
N("nav.lesson_notes","file-text","/teacher/lesson-notes",["lesson_notes.submit","lesson_notes.approve"],en="Lesson notes",ha="Bayanan darasi",yo="Àkọsílẹ̀ ẹ̀kọ́",ig="Ndetu nkuzi",pcm="Lesson note")
N("nav.exams","award","/admin/examinations",["exams.schedule","exams.records","grades.approve"],en="Exams & results",ha="Jarrabawa",yo="Ìdánwò",ig="Ule",pcm="Exam & result")
N("nav.cbt","monitor","/admin/exams",["cbt.manage"],feature="cbt",en="CBT",pcm="CBT")
N("nav.admissions","user-plus","/admin/admissions",["admissions.view","admissions.process"],en="Admissions",ha="Shiga makaranta",yo="Ìgbaniwọlé",ig="Nnabata",pcm="Admission")
N("nav.fees","banknote","/bursar/dashboard",["fees.view","payments.reconcile","payments.record_cash"],en="Fees & payments",ha="Kuɗin makaranta",yo="Owó ilé-ìwé",ig="Ụgwọ akwụkwọ",pcm="School fees")
N("nav.wallet","wallet","/admin/wallet",["wallet.view"],feature="wallet",en="Wallet",ha="Walat",yo="Àpò owó",ig="Akpa ego",pcm="Wallet")
N("nav.payroll","briefcase","/admin/hr-payroll",["payroll.prepare","payroll.approve","payroll.view_all"],feature="payroll",en="HR & payroll",ha="Albashi",yo="Owó oṣù",ig="Ụgwọ ọnwa",pcm="Salary")
N("nav.my_pay","receipt","/settings",["payroll.view_own"],feature="payroll",en="My payslips",ha="Takardar albashi",yo="Ìwé owó oṣù",ig="Akwụkwọ ụgwọ m",pcm="My payslip")
N("nav.library","library","/admin/library",["library.circulate","library.catalog"],feature="library",en="Library",ha="Ɗakin karatu",yo="Ilé-ìkàwé",ig="Ọba akwụkwọ",pcm="Library")
N("nav.hostel","bed","/admin/hostel",["hostel.allocate","hostel.roll_call"],feature="hostel",en="Hostel",ha="Masauki",yo="Ilé gbígbé",ig="Ụlọ obibi",pcm="Hostel")
N("nav.health","heart-pulse","/admin/health",["health.records_view"],feature="health",en="Sick bay",ha="Asibiti",yo="Ilé ìwòsàn",ig="Ụlọ ọgwụ",pcm="Sick bay")
N("nav.transport","bus","/admin/bus-management",["transport.manage","transport.track","transport.driver_trip"],feature="transport",en="Transport",ha="Sufuri",yo="Ìrìnnà",ig="Njem",pcm="Bus")
N("nav.visitors","shield","/admin/visitors",["visitors.manage","security.gate_log"],en="Gate & visitors",ha="Baƙi",yo="Àlejò",ig="Ọbịa",pcm="Gate & visitor")
N("nav.staff","id-card","/admin/hr",["hr.staff_view","hr.staff_manage"],en="Staff",ha="Ma'aikata",yo="Òṣìṣẹ́",ig="Ndị ọrụ",pcm="Staff")
N("nav.reports","bar-chart","/admin/analytics",["analytics.institution","reports.academic","reports.financial"],en="Reports",ha="Rahotanni",yo="Ìjábọ̀",ig="Akụkọ",pcm="Report")
N("nav.roles","key","/admin/roles",["roles.assign","roles.configure"],en="Roles & access",ha="Matsayi",yo="Ipa",ig="Ọrụ",pcm="Roles")
N("nav.settings","settings","/admin/settings",["settings.manage"],en="School settings",ha="Saituna",yo="Ètò",ig="Ntọala",pcm="Settings")
N("nav.workspace_policies","sliders","/workspace/settings",["settings.manage"],en="Workspace rules",ha="Dokokin wurin aiki",yo="Òfin ibi iṣẹ́",ig="Iwu ebe ọrụ",pcm="Workspace rules")
N("nav.children","baby","/parent/children",["children.view"],en="My children",ha="'Ya'yana",yo="Àwọn ọmọ mi",ig="Ụmụ m",pcm="My pikin dem")
N("nav.my_results","star","/student/grades",["self.view_own"],en="My results",ha="Sakamakona",yo="Èsì mi",ig="Nsonaazụ m",pcm="My result",families=["student"],policy="students.results_online")
N("nav.ai_tutor","sparkles","/student/ai-tutor",["ai_tutor.use"],feature="ai",en="AI tutor",ha="Malamin AI",yo="Olùkọ́ AI",ig="Onye nkuzi AI",pcm="AI teacher",policy="students.ai_tutor")
N("nav.messages","message","/messages",[],en="Messages",ha="Saƙonni",yo="Ìfiránṣẹ́",ig="Ozi",pcm="Message")
N("nav.gov","landmark","/gov-dashboard",["regulator.read_aggregate"],en="Oversight",ha="Sa ido",yo="Àbojútó",ig="Nlekọta",pcm="Oversight")
# ---- home widgets ----
W = lambda *a, **kw: add("widget", *a, **kw)
W("w.today_classes","calendar","/teacher/timetable",["timetable.view"],size="m",en="Today's lessons",ha="Darussan yau",yo="Ẹ̀kọ́ òní",ig="Nkuzi taa",pcm="Today lesson")
W("w.attendance_todo","check-square","/teacher/attendance",["attendance.take"],size="s",en="Registers to mark",ha="Rajistar halarta",yo="Ìforúkọsílẹ̀",ig="Ndekọ ọbịbịa",pcm="Register wey remain")
W("w.grading_queue","clipboard","/teacher/gradebook",["grades.enter"],size="s",en="Scores to enter",ha="Maki da za a shigar",yo="Máàkì láti tẹ̀",ig="Akara a ga-etinye",pcm="Score wey remain")
W("w.lesson_note_status","file-text","/teacher/lesson-notes",["lesson_notes.submit"],size="s",en="Lesson note status",pcm="Lesson note status")
W("w.lesson_note_approvals","file-check","/admin/lesson-plans",["lesson_notes.approve"],size="s",en="Notes awaiting approval",pcm="Note wey dey wait")
W("w.cbt_sessions","monitor","/admin/exams",["cbt.manage"],feature="cbt",size="m",en="CBT sessions",pcm="CBT session")
W("w.form_class","users","/teacher/class-intelligence",["attendance.take","welfare.pastoral"],size="l",en="My form class",ha="Ajina",yo="Kíláàsì mi",ig="Klas m",pcm="My form class")
W("w.at_risk","alert-triangle","/admin/early-warning",["reports.academic","welfare.pastoral"],size="m",en="Students at risk",ha="Ɗalibai cikin haɗari",yo="Akẹ́kọ̀ọ́ nínú ewu",ig="Ụmụ akwụkwọ nọ n'ihe egwu",pcm="Students wey dey risk")
W("w.dept_performance","bar-chart","/admin/analytics",["reports.academic"],size="l",en="Department performance",pcm="Department performance")
W("w.results_pipeline","award","/admin/report-cards",["grades.approve","results.publish"],size="l",en="Results pipeline",ha="Sakamakon jarrabawa",yo="Èsì ìdánwò",ig="Nsonaazụ ule",pcm="Result pipeline")
W("w.exam_timetable","calendar-clock","/admin/examinations",["exams.schedule"],size="m",en="Exam timetable",pcm="Exam timetable")
W("w.malpractice","gavel","/admin/examinations",["malpractice.decide"],size="s",en="Malpractice cases",pcm="Malpractice case")
W("w.fee_collection","banknote","/bursar/dashboard",["fees.view","reports.financial"],size="l",en="Fee collection",ha="Karɓar kuɗi",yo="Owó tí a gbà",ig="Nchịkọta ụgwọ",pcm="Fees wey don enter")
W("w.reconciliation","scale","/bursar/reconciliation",["payments.reconcile"],size="m",en="To reconcile",pcm="To reconcile")
W("w.defaulters","user-x","/admin/fees-defaulters",["fees.view"],size="m",en="Outstanding fees",ha="Bashin kuɗi",yo="Gbèsè owó",ig="Ụgwọ fọdụrụ",pcm="Fees wey remain")
W("w.expense_approvals","receipt","/admin/expenses",["expenses.approve"],size="s",en="Expenses to approve",pcm="Expense to approve")
W("w.wallet_balance","wallet","/admin/wallet",["wallet.view"],feature="wallet",size="s",en="Wallet balance",ha="Ragowar walat",yo="Owó inú àpò",ig="Ego dị n'akpa",pcm="Wallet balance")
W("w.payroll_run","briefcase","/admin/hr-payroll",["payroll.prepare","payroll.approve"],feature="payroll",size="m",en="Payroll run",ha="Albashin wata",yo="Owó oṣù",ig="Ụgwọ ọnwa",pcm="Salary run")
W("w.leave_requests","plane","/admin/hr",["hr.leave_approve"],size="s",en="Leave requests",pcm="Leave request")
W("w.staff_attendance","id-card","/admin/hr",["hr.staff_view"],size="s",en="Staff present",pcm="Staff wey come")
W("w.admissions_funnel","user-plus","/admin/admissions-funnel",["admissions.view"],size="m",en="Admissions funnel",pcm="Admission funnel")
W("w.enrolment","users","/admin/students",["students.view","analytics.institution"],all_=["analytics.institution"],size="s",en="Enrolment",ha="Yawan ɗalibai",yo="Iye akẹ́kọ̀ọ́",ig="Ọnụọgụ ụmụ akwụkwọ",pcm="Total students")
W("w.school_health","activity","/admin/analytics",["analytics.institution"],size="l",en="School at a glance",ha="Makaranta a taƙaice",yo="Ilé-ìwé ní ṣókí",ig="Ụlọ akwụkwọ n'otu anya",pcm="School for one look")
W("w.cashflow","trending-up","/admin/financial-reports",["reports.financial"],size="m",en="Cash flow",pcm="Cash flow")
W("w.governance","landmark","/admin/audit",["governance.minutes","audit.view"],size="s",en="Board & audit",pcm="Board & audit")
W("w.library_loans","library","/admin/library",["library.circulate"],feature="library",size="m",en="Loans due",pcm="Book wey due")
W("w.hostel_roll","bed","/admin/hostel",["hostel.roll_call"],feature="hostel",size="m",en="Tonight's roll call",ha="Kiran suna na dare",yo="Ìpè orúkọ alẹ́",ig="Ọkpụkpọ aha abalị",pcm="Night roll call")
W("w.hostel_beds","bed-double","/admin/hostel",["hostel.allocate"],feature="hostel",size="s",en="Bed space",pcm="Bed space")
W("w.sick_bay","heart-pulse","/admin/health",["health.records_view"],feature="health",size="m",en="Sick bay today",ha="Marasa lafiya yau",yo="Aláìsàn òní",ig="Ndị ọrịa taa",pcm="Sick bay today")
W("w.bus_live","bus","/admin/bus-management",["transport.track","transport.manage"],feature="transport",size="m",en="Buses on route",ha="Motoci a hanya",yo="Bọ́ọ̀sì lójú ọ̀nà",ig="Ụgbọ ala n'ụzọ",pcm="Bus wey dey road")
W("w.my_trip","navigation","/driver",["transport.driver_trip"],feature="transport",size="l",en="My trip",pcm="My trip")
W("w.gate_log","shield","/admin/visitors",["security.gate_log","visitors.manage"],size="m",en="Gate today",ha="Kofa yau",yo="Ẹnu ọ̀nà òní",ig="Ọnụ ụzọ taa",pcm="Gate today")
W("w.incidents","siren","/admin/visitors",["security.incident"],size="s",en="Open incidents",pcm="Wahala wey open")
W("w.children_summary","baby","/parent/children",["children.view"],size="l",en="My children",ha="'Ya'yana",yo="Àwọn ọmọ mi",ig="Ụmụ m",pcm="My pikin dem")
W("w.child_fees","banknote","/parent/fees",["children.view"],size="m",en="Fees due",ha="Kuɗin da ake bi",yo="Owó tó yẹ",ig="Ụgwọ ruru",pcm="Fees wey due",policy="parents.fees_online")
W("w.child_bus","bus","/parent/bus-tracking",["children.view"],feature="transport",size="s",en="School bus",pcm="School bus",policy="parents.bus_tracking")
W("w.my_timetable","calendar","/student/timetable",["self.view_own"],size="m",en="My timetable",ha="Jadawalina",yo="Àtòjọ mi",ig="Usoro m",pcm="My timetable",families=["student"])
W("w.my_results","star","/student/grades",["self.view_own"],size="m",en="My results",ha="Sakamakona",yo="Èsì mi",ig="Nsonaazụ m",pcm="My result",families=["student"],policy="students.results_online")
W("w.my_cbt","monitor","/student/cbt",["self.view_own"],feature="cbt",size="s",en="Upcoming tests",pcm="Test wey dey come",families=["student"])
W("w.ai_tutor","sparkles","/student/ai-tutor",["ai_tutor.use"],feature="ai",size="m",en="Ask the AI tutor",pcm="Ask AI teacher",policy="students.ai_tutor")
W("w.ai_lesson_helper","sparkles","/teacher/ai-assistant",["lesson_notes.submit"],all_=["lesson_notes.submit"],feature="ai",size="s",en="AI lesson helper",pcm="AI lesson helper",policy="staff.ai_helper")
W("w.gov_overview","landmark","/gov-dashboard",["regulator.read_aggregate"],size="l",en="Schools overview",ha="Taƙaitaccen makarantu",yo="Àkópọ̀ ilé-ìwé",ig="Nchịkọta ụlọ akwụkwọ",pcm="Schools overview")
W("w.gov_compliance","clipboard-check","/gov-dashboard",["regulator.read_aggregate"],size="m",en="Compliance & inspections",pcm="Compliance")
# scope-bound widgets: appear only for people the admin scoped to that dimension, so two people with the same
# role see different homes (a campus head vs a whole-school principal; a morning-shift vs afternoon-shift supervisor).
W("w.campus_overview","building","/admin/students",["students.view","attendance.view","analytics.institution"],size="l",scope=["campus"],en="My campus today",ha="Harabata yau",yo="Ọgbà mi lónìí",ig="Ogige m taa",pcm="My campus today")
W("w.shift_overview","clock","/teacher/attendance",["attendance.view","attendance.take"],size="m",scope=["shift"],en="My shift",ha="Lokacin aikina",yo="Ìyípadà iṣẹ́ mi",ig="Oge ọrụ m",pcm="My shift")
W("w.section_overview","layers","/admin/students",["students.view","reports.academic","welfare.pastoral"],size="m",scope=["section"],en="My section",ha="Sashena",yo="Ẹ̀ka mi",ig="Ngalaba m",pcm="My section")
W("w.level_overview","graduation-cap","/teacher/gradebook",["grades.enter","grades.view","grades.approve","reports.academic"],size="m",scope=["level","class","subject"],en="My levels, classes & subjects",ha="Matakaina",yo="Ìpele mi",ig="Ọkwa m",pcm="My level dem")
W("w.house_overview","flag","/admin/discipline",["welfare.pastoral","discipline.decide","hostel.roll_call"],size="s",scope=["house","hostel"],en="My house / hostel",ha="Gidana",yo="Ilé mi",ig="Ụlọ m",pcm="My house")
W("w.announcements","megaphone","/messages",[],size="m",en="Announcements",ha="Sanarwa",yo="Ìkéde",ig="Ọkwa",pcm="Announcement")
# ---- quick actions ----
A = lambda *a, **kw: add("action", *a, **kw)
A("a.take_attendance","check-square","/teacher/attendance",["attendance.take"],en="Take attendance",ha="Ɗauki halarta",yo="Pe orúkọ",ig="Were ọbịbịa",pcm="Mark register")
A("a.enter_scores","clipboard","/teacher/gradebook",["grades.enter"],en="Enter scores",ha="Shigar da maki",yo="Tẹ máàkì",ig="Tinye akara",pcm="Enter score")
A("a.submit_note","file-text","/teacher/lesson-notes",["lesson_notes.submit"],en="Submit lesson note",pcm="Submit lesson note")
A("a.message_parents","message","/messages",["comms.send_class"],feature="sms",en="Message parents",ha="Aika saƙo ga iyaye",yo="Fi ọ̀rọ̀ ránṣẹ́ sí òbí",ig="Zigara ndị nne na nna ozi",pcm="Message parents",policy="staff.message_parents")
A("a.broadcast","megaphone","/admin/broadcast",["comms.broadcast"],feature="sms",en="Broadcast",pcm="Broadcast")
A("a.record_cash","banknote","/bursar/receipts",["payments.record_cash"],en="Record cash payment",ha="Rubuta biyan kuɗi",yo="Kọ owó tí a san",ig="Dee ego akwụrụ",pcm="Record cash")
A("a.issue_receipt","receipt","/bursar/receipts",["fees.view"],all_=["payments.record_cash"],en="Issue receipt",pcm="Give receipt")
A("a.enrol_student","user-plus","/admin/students",["students.create"],en="Enrol student",ha="Yi rajistar ɗalibi",yo="Forúkọ akẹ́kọ̀ọ́ sílẹ̀",ig="Debanye nwa akwụkwọ",pcm="Register student")
A("a.publish_results","award","/admin/report-cards",["results.publish"],en="Publish results",ha="Fitar da sakamako",yo="Gbé èsì jáde",ig="Bipụta nsonaazụ",pcm="Publish result")
A("a.schedule_exam","calendar-clock","/admin/examinations",["exams.schedule"],en="Schedule exam",pcm="Schedule exam")
A("a.new_cbt","monitor","/admin/exams",["cbt.manage"],feature="cbt",en="New CBT test",pcm="New CBT test")
A("a.approve_payroll","briefcase","/admin/hr-payroll",["payroll.approve"],feature="payroll",en="Approve payroll",pcm="Approve salary")
A("a.prepare_payroll","briefcase","/admin/hr-payroll",["payroll.prepare"],feature="payroll",en="Prepare payroll",pcm="Prepare salary")
A("a.request_leave","plane","/settings",["hr.leave_request"],en="Request leave",ha="Nemi hutu",yo="Béèrè ìsinmi",ig="Rịọ ezumike",pcm="Ask for leave")
A("a.issue_book","library","/admin/library",["library.circulate"],feature="library",en="Issue a book",pcm="Give book")
A("a.roll_call","bed","/admin/hostel",["hostel.roll_call"],feature="hostel",en="Start roll call",pcm="Start roll call")
A("a.log_visit","heart-pulse","/admin/health",["health.records_edit"],feature="health",en="Log sick-bay visit",pcm="Log sick bay visit")
A("a.start_trip","navigation","/driver",["transport.driver_trip"],feature="transport",en="Start trip",pcm="Start trip")
A("a.sign_in_visitor","shield","/admin/visitors",["visitors.manage","security.gate_log"],en="Sign in visitor",ha="Shigar da baƙo",yo="Forúkọ àlejò",ig="Debanye ọbịa",pcm="Sign in visitor")
A("a.report_incident","siren","/admin/visitors",["security.incident"],en="Report incident",pcm="Report wahala")
A("a.pay_fees","banknote","/parent/fees",["children.view"],en="Pay school fees",ha="Biya kuɗin makaranta",yo="San owó ilé-ìwé",ig="Kwụọ ụgwọ akwụkwọ",pcm="Pay school fees",policy="parents.fees_online")
A("a.topup_wallet","wallet","/admin/wallet",["wallet.topup"],feature="wallet",en="Top up wallet",pcm="Top up wallet")
A("a.assign_role","key","/admin/roles",["roles.assign"],en="Assign a role",pcm="Assign role")
A("a.ask_tutor","sparkles","/student/ai-tutor",["ai_tutor.use"],feature="ai",en="Ask AI tutor",pcm="Ask AI teacher",policy="students.ai_tutor")
A("a.gov_inspect","clipboard-check","/gov-dashboard",["regulator.read_aggregate"],en="Plan inspection",pcm="Plan inspection")
# ---- inbox streams ----
X = lambda *a, **kw: add("inbox", *a, **kw)
X("i.approvals","inbox","/notifications",["lesson_notes.approve","expenses.approve","payroll.approve","hr.leave_approve","grades.approve","procurement.approve"],en="Approvals",ha="Amincewa",yo="Ìfọwọ́sí",ig="Nkwado",pcm="Approval")
X("i.messages","message","/messages",[],en="Messages",ha="Saƙonni",yo="Ìfiránṣẹ́",ig="Ozi",pcm="Message")
X("i.alerts","bell","/notifications",[],en="Alerts",ha="Faɗakarwa",yo="Ìkìlọ̀",ig="Ịdọ aka na ntị",pcm="Alert")
X("i.payments","banknote","/bursar/reconciliation",["payments.reconcile"],en="Payment exceptions",pcm="Payment wahala")
X("i.safeguarding","shield-alert","/admin/discipline",["welfare.pastoral","discipline.decide"],en="Safeguarding",pcm="Safeguarding")

# School workspace policies: the admin decides; defaults below. A policy can only HIDE items (never grant).
POLICIES = [
 ("workspace.personalise", True, "Staff, parents and students can personalise their home screen"),
 ("students.ai_tutor", True, "Students can use the AI tutor"),
 ("students.results_online", True, "Students see their results in the app once published"),
 ("staff.ai_helper", True, "Teachers can use the AI lesson helper"),
 ("staff.message_parents", True, "Teachers can message parents of their classes"),
 ("parents.fees_online", True, "Parents see fees due and can pay in the app"),
 ("parents.bus_tracking", True, "Parents can see live school bus location"),
]
FAM = {  # family -> (template codes, priority, default widget order, default actions)
 "proprietor": (["proprietor","governance_board"],10,["w.school_health","w.fee_collection","w.cashflow","w.enrolment","w.payroll_run","w.governance","w.at_risk","w.announcements"],["a.approve_payroll","a.broadcast","a.assign_role"]),
 "principal": (["head_of_institution","deputy_academic","deputy_admin","student_affairs"],20,["w.school_health","w.results_pipeline","w.lesson_note_approvals","w.at_risk","w.staff_attendance","w.fee_collection","w.leave_requests","w.gate_log","w.announcements"],["a.publish_results","a.broadcast","a.enrol_student","a.assign_role"]),
 "bursar": (["bursar","accountant","cashier","auditor","procurement","store"],30,["w.fee_collection","w.reconciliation","w.defaulters","w.wallet_balance","w.expense_approvals","w.cashflow","w.payroll_run"],["a.record_cash","a.issue_receipt","a.topup_wallet"]),
 "registrar": (["registrar","admissions","admin_officer","data_protection"],40,["w.admissions_funnel","w.enrolment","w.results_pipeline","w.announcements"],["a.enrol_student","a.publish_results"]),
 "exams": (["exams_officer","exams_records","cbt"],45,["w.results_pipeline","w.exam_timetable","w.cbt_sessions","w.malpractice"],["a.schedule_exam","a.new_cbt","a.publish_results"]),
 "hod": (["hod","dean","level_adviser"],50,["w.dept_performance","w.lesson_note_approvals","w.results_pipeline","w.at_risk","w.today_classes"],["a.enter_scores","a.message_parents"]),
 "form_teacher": (["form_teacher"],55,["w.form_class","w.attendance_todo","w.at_risk"],["a.take_attendance","a.message_parents"]),
 "teacher": (["teacher","teaching_support","lab_workshop","early_years_carer","siwes","research"],60,["w.today_classes","w.attendance_todo","w.grading_queue","w.lesson_note_status","w.cbt_sessions","w.ai_lesson_helper","w.announcements"],["a.take_attendance","a.enter_scores","a.submit_note","a.new_cbt","a.request_leave"]),
 "hr": (["hr","payroll"],35,["w.payroll_run","w.staff_attendance","w.leave_requests","w.announcements"],["a.prepare_payroll","a.approve_payroll"]),
 "nurse": (["health","counsellor","chaplaincy"],70,["w.sick_bay","w.at_risk","w.announcements"],["a.log_visit"]),
 "librarian": (["librarian","library_staff"],72,["w.library_loans","w.announcements"],["a.issue_book"]),
 "hostel": (["hostel_head","house_staff"],74,["w.hostel_roll","w.hostel_beds","w.sick_bay","w.announcements"],["a.roll_call"]),
 "transport": (["transport_head","driver"],76,["w.my_trip","w.bus_live","w.announcements"],["a.start_trip"]),
 "security": (["security_head","security_staff"],78,["w.gate_log","w.incidents"],["a.sign_in_visitor","a.report_incident"]),
 "parent": (["parent","pta"],90,["w.children_summary","w.child_fees","w.child_bus","w.announcements"],["a.pay_fees"]),
 "student": (["student","student_leader","alumni"],95,["w.my_timetable","w.my_results","w.my_cbt","w.ai_tutor","w.announcements"],["a.ask_tutor"]),
 "gov": (["regulator","regulator_inspector"],5,["w.gov_overview","w.gov_compliance"],["a.gov_inspect"]),
 "staff": ([],99,["w.announcements"],["a.request_leave"]),
}
keys={i["key"] for i in I}
assert all(i["policy"] in {p[0] for p in POLICIES} for i in I if i["policy"]),"unknown policy"
for f,(t,p,w,a) in FAM.items():
    for k in w+a: assert k in keys,(f,k)
fam=[dict(family=f,templates=t,priority=p,widgets=w,actions=a) for f,(t,p,w,a) in FAM.items()]
root=pathlib.Path(__file__).resolve().parents[2]
(root/"frontend/src/lib/sherivs-ws/catalog.data.ts").write_text("// generated by tools/workspace/catalog_src.py (do not hand-edit)\nconst data = "+json.dumps(dict(items=I,families=fam,policies=[dict(key=k,default=d,label=l) for k,d,l in POLICIES]),ensure_ascii=False,indent=1)+";\nexport default data;\n")
q=lambda s:"NULL" if s is None else "'"+s.replace("'","''")+"'"
arr=lambda l:"ARRAY["+",".join(q(x) for x in l)+"]::text[]"
rows=",\n".join(f"  ({q(i['key'])},{q(i['kind'])},{q(i['to'])},{arr(i['any'])},{arr(i['all'])},{q(i['feature'])},{q(i['size'])},{q(i['label']['en'])},{arr(i['families'])},{n})" for n,i in enumerate(I))
frows=",\n".join(f"  ({q(f['family'])},{arr(f['templates'])},{f['priority']},{arr(f['widgets'])},{arr(f['actions'])})" for f in fam)
seed=f"""-- >>> generated by tools/workspace/catalog_src.py (do not hand-edit) >>>
INSERT INTO public.workspace_item_catalog (key, kind, route, any_permissions, all_permissions, feature, size, label_en, families, sort) VALUES
{rows}
ON CONFLICT (key) DO UPDATE SET kind=EXCLUDED.kind, route=EXCLUDED.route, any_permissions=EXCLUDED.any_permissions,
  all_permissions=EXCLUDED.all_permissions, feature=EXCLUDED.feature, size=EXCLUDED.size, label_en=EXCLUDED.label_en, families=EXCLUDED.families, sort=EXCLUDED.sort;
INSERT INTO public.workspace_family_layouts (family, template_codes, priority, widgets, actions) VALUES
{frows}
ON CONFLICT (family) DO UPDATE SET template_codes=EXCLUDED.template_codes, priority=EXCLUDED.priority, widgets=EXCLUDED.widgets, actions=EXCLUDED.actions;
-- <<< generated <<<"""
mig=next((root/"database/supabase/migrations").glob("*_sherivs_ux1_workspace_manifest.sql"),None)
if mig:
    s=mig.read_text(); s=re.sub(r"-- >>> generated by tools/workspace.*?-- <<< generated <<<",lambda m:seed,s,flags=re.S); mig.write_text(s)
(root/"tools/workspace/seed.generated.sql").write_text(seed+"\n")
# UX2 block: scope dimensions, policy gates and the policy catalog.
upd=",\n".join(f"  ({q(i['key'])},{arr(i['scopeDims'])},{q(i['policy'])})" for i in I if i['scopeDims'] or i['policy'])
prow=",\n".join(f"  ({q(k)},{'true' if d else 'false'},{q(l)},{n})" for n,(k,d,l) in enumerate(POLICIES))
seed2=f"""-- >>> generated ux2 by tools/workspace/catalog_src.py (do not hand-edit) >>>
UPDATE public.workspace_item_catalog c SET scope_dims = '{{}}', policy = NULL WHERE cardinality(c.scope_dims) > 0 OR c.policy IS NOT NULL;
UPDATE public.workspace_item_catalog c SET scope_dims = v.d, policy = v.p FROM (VALUES
{upd}
) v(k, d, p) WHERE c.key = v.k;
INSERT INTO public.workspace_policy_catalog (key, default_on, label_en, sort) VALUES
{prow}
ON CONFLICT (key) DO UPDATE SET default_on=EXCLUDED.default_on, label_en=EXCLUDED.label_en, sort=EXCLUDED.sort;
-- <<< generated ux2 <<<"""
mig2=next((root/"database/supabase/migrations").glob("*_sherivs_ux2_scope_policy_workspace.sql"),None)
if mig2:
    s2=mig2.read_text(); s2=re.sub(r"-- >>> generated ux2 by tools/workspace.*?-- <<< generated ux2 <<<",lambda m:seed2,s2,flags=re.S); mig2.write_text(s2)
(root/"tools/workspace/seed-ux2.generated.sql").write_text(seed2+"\n")
print(len(I),"items",len(fam),"families")

# Role template permissions (mandatory/optional/default_on) extracted from the SHERIVS-017 seed, for previews/tests.
s17=next((root/"database/supabase/migrations").glob("*_sherivs_017_role_permission_catalog.sql")).read_text()
blk=s17[s17.index("INSERT INTO public.role_template_permissions"):]
blk=blk[:blk.index(";")]
tp={}
for t,p,k,d in re.findall(r"\('([a-z_]+)','([a-z_]+\.[a-z_]+)','(mandatory|optional)',(true|false)\)",blk):
    tp.setdefault(t,[]).append([p,k[0],d=="true"])
(root/"frontend/src/lib/sherivs-ws/role-templates.data.ts").write_text("// generated by tools/workspace/catalog_src.py from the SHERIVS-017 seed (do not hand-edit)\n// [permission, m=mandatory|o=optional, default_on]\nconst templates: Record<string, [string, string, boolean][]> = "+json.dumps(tp)+";\nexport default templates;\n")
print(len(tp),"templates")
