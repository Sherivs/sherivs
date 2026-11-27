# Blueprint claim register v1 (BP-01)

Source: *Sherivs Scholar Complete Product and Fundraising Blueprint*, chapters 5 to 25. Seeded from audit 1 (26 Nov 2026), Part 2.

**Status.** Seeded from audit 1's capability scan (a name search over tables, routes and components). I did not re-run anything for this register. A row marked CODE-PRESENT means something exists, not that the claim holds end to end. Only a passing end-to-end test moves a row to VERIFIED, and none does today. Vocabulary: VERIFIED, CODE-PRESENT, IN-PR, NOT-EVIDENCED.

**Owner mission.** Names ending *(proposed)* (MOD-nn, HONESTY guard) do not exist yet. They are placeholders for Tumi to scope; they are not approved missions. `existing` means code already on master.

**Decision column.** 3 = needs the AI-route decision; 2 = needs the SMS/WhatsApp rates decision.

## Totals

| Status | Claims |
|---|---|
| VERIFIED | 0 |
| CODE-PRESENT | 20 |
| IN-PR | 27 |
| NOT-EVIDENCED | 59 |
| **Total** | **106** |

Claims blocked on decision 3: 9. On decision 2: 1.

Rule for later missions: a mission that closes a claim updates its row in the same PR, cites the passing test, and may not mark VERIFIED without it.

## Register


### Chapter 5. Governance, strategy

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-05-01 | Institution identity, mission, priorities, policies held as operating context | MOD-05 (proposed) | Governance console (none) | none | NOT-EVIDENCED |  |
| BP-05-02 | Governing bodies and committees modelled per institution | MOD-05 (proposed) | Bodies admin (none) | none | NOT-EVIDENCED |  |
| BP-05-03 | Resolutions recorded as decisions that later work can reference | MOD-05 (proposed) | Resolutions register (none) | none | NOT-EVIDENCED |  |
| BP-05-04 | A resolution can create assigned actions with owner and due date | WF stack + MOD-05 (proposed) | Tasks from resolution (none) | none | IN-PR |  |
| BP-05-05 | Leaders see authorised indicators, open issues, overdue items with evidence | MOD-20 (proposed) | Leader dashboard (none) | none | NOT-EVIDENCED |  |
| BP-05-06 | Leader AI companion prepares briefings, traces a question to source | AIN-06 + WF-11 | Companion (none) | none | NOT-EVIDENCED | 3 |

### Chapter 6. Structure, people, roles

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-06-01 | Institution structure (campuses, faculties, units, classes) modelled | existing + #460 | Org admin | none | CODE-PRESENT |  |
| BP-06-02 | Each user gets a role-aware workspace | M009 / #462 #448 #438 | Workspace shell | none | IN-PR |  |
| BP-06-03 | One person can hold several roles and switch context | M009 | Role switcher | none | IN-PR |  |
| BP-06-04 | Role change follows governed handover and access review | MOD-06 (proposed) | Role-change flow (none) | none | NOT-EVIDENCED |  |
| BP-06-05 | Guardian-to-learner relationships limit what families see | existing parent_student_map | Family view | none | CODE-PRESENT |  |

### Chapter 7. Learner lifecycle

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-07-01 | Applicants see requirements and status | #452 | Applicant portal (none) | none | IN-PR |  |
| BP-07-02 | Admissions queue with documents, eligibility checks, decision steps | #452 | Admissions queue | none | IN-PR |  |
| BP-07-03 | Admission decisions stay with the institution; AI never decides | AIN-02/03 autonomy caps | Guard | AIN harness | IN-PR |  |
| BP-07-04 | Acceptance flows to fees, enrolment, registration, orientation without re-entry | MOD-07 (proposed) | Enrolment flow (none) | none | NOT-EVIDENCED |  |
| BP-07-05 | Progression, transfers, completion update one journey | MOD-07 (proposed) | Journey record (none) | none | NOT-EVIDENCED |  |
| BP-07-06 | Alumni relationships continue after graduation | MOD-07 (proposed) | Alumni (1 table) | none | CODE-PRESENT |  |
| BP-07-07 | Legacy paper and spreadsheet records migrate stage by stage | INST-0x (roadmap) | Import tooling (none) | none | NOT-EVIDENCED |  |

### Chapter 8. Academic operations

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-08-01 | Curricula, programmes, calendars, teaching assignments modelled | academic core #460 | Academic admin | none | IN-PR |  |
| BP-08-02 | Timetable with rooms and staff availability | scheduling solver #324 | Timetable UI (none) | none | IN-PR |  |
| BP-08-03 | Authorised change shows dependencies, notifies, opens follow-up, tracks acknowledgement | WF stack + MOD-08 (proposed) | Change cascade (none) | none | IN-PR |  |
| BP-08-04 | Attendance connects to learner support and family communication | existing attendance | Follow-up rules (none) | none | CODE-PRESENT |  |
| BP-08-05 | Results traceable to source and approval | MOD-09 (proposed) | Result trace (none) | none | NOT-EVIDENCED |  |

### Chapter 9. Teaching, learning, assessment

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-09-01 | Teacher workspace brings classes, resources, assessments together | M009 | Teacher workspace | none | IN-PR |  |
| BP-09-02 | Teacher AI companion drafts lessons and feedback for educator review | AIN-06 + WF-11 | Companion (none) | none | NOT-EVIDENCED | 3 |
| BP-09-03 | Weighted assessment and grading records | #313 | Gradebook | none | IN-PR |  |
| BP-09-04 | Traceable path mark to moderation to approved result | MOD-09 (proposed) | Moderation (none) | none | NOT-EVIDENCED |  |
| BP-09-05 | Appeals and integrity workflows | MOD-09 (proposed) | Appeals (none) | none | NOT-EVIDENCED |  |
| BP-09-06 | Learner sees one coherent view of courses and deadlines | MOD-09 (proposed) | Learner course view (none) | none | NOT-EVIDENCED |  |

### Chapter 10. Welfare, safeguarding

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-10-01 | Students raise requests; concerns routed to an owner | MOD-10 (proposed) | Request flow (none) | none | NOT-EVIDENCED |  |
| BP-10-02 | Safeguarding records restricted to authorised people | existing safeguard libs | Safeguarding | none | CODE-PRESENT |  |
| BP-10-03 | Referrals, follow-up, outcomes tracked | MOD-10 (proposed) | Case tracking (none) | none | NOT-EVIDENCED |  |
| BP-10-04 | Accessibility needs reach the teachers who must meet them | MOD-10 (proposed) | Needs register (none) | none | NOT-EVIDENCED |  |
| BP-10-05 | AI never diagnoses, disciplines, expels or denies services | AIN-02/03 caps | Guard | AIN harness | IN-PR |  |

### Chapter 11. Parents and guardians

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-11-01 | Family experience limited to own learners | M009 B-4 (#283) | Family workspace | none | IN-PR |  |
| BP-11-02 | Announcements, attendance, results, fees in one family view | MOD-11 (proposed) | Family home (none) | none | NOT-EVIDENCED |  |
| BP-11-03 | Enquiries routed and followed to resolution | MOD-11 (proposed) | Enquiry tracker (none) | none | NOT-EVIDENCED |  |
| BP-11-04 | Family AI answers from official information, points to a human | AIN-06 + WF-11 | Family companion (none) | none | NOT-EVIDENCED | 3 |

### Chapter 12. Finance and stewardship

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-12-01 | Fee obligations linked to learners (invoice, ledger, receipt, refund) | existing cg_fee_* | Fees | none | CODE-PRESENT |  |
| BP-12-02 | Approvals follow configured authority and segregation of duties | M9a #463 + WF-06/07 | Approvals | WF harness | IN-PR |  |
| BP-12-03 | Budgets and expenses linked to approvals | MOD-12 (proposed) | Budgets (none) | none | NOT-EVIDENCED |  |
| BP-12-04 | Reconciliation support flags unusual items for staff | MOD-12 (proposed) + AIN | Reconciliation (none) | none | NOT-EVIDENCED | 3 |
| BP-12-05 | Statements and board finance view | MOD-12 (proposed) | Statements (none) | none | NOT-EVIDENCED |  |

### Chapter 13. Workforce and HR

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-13-01 | Employee record linked to roles and assignments | existing staff_* | Staff | none | CODE-PRESENT |  |
| BP-13-02 | Recruitment flows into onboarding | MOD-13 (proposed) | Recruitment (none) | none | NOT-EVIDENCED |  |
| BP-13-03 | Leave connects to cover and timetables | MOD-13 (proposed) | Leave and cover (none) | none | NOT-EVIDENCED |  |
| BP-13-04 | Departure triggers handover and access review | MOD-13 (proposed) | Offboarding (none) | none | NOT-EVIDENCED |  |
| BP-13-05 | HR AI companion drafts letters and onboarding plans | AIN-06 + WF-11 | Companion (none) | none | NOT-EVIDENCED | 3 |

### Chapter 14. Communication Fabric

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-14-01 | Conversation, announcement, task distinguished and linked | COMMS-03/04, #459 | Messaging | none | IN-PR |  |
| BP-14-02 | Announcement with targeting and required acknowledgement | MOD-14 (proposed) | Announcements (none) | none | NOT-EVIDENCED |  |
| BP-14-03 | Conversation can create a task | WF stack | Task from thread (none) | none | IN-PR |  |
| BP-14-04 | Enquiries routed and tracked | MOD-14 (proposed) | Enquiry routing (none) | none | NOT-EVIDENCED |  |
| BP-14-05 | Email delivery under provider rules and consent | existing Resend adapter | Email | none | CODE-PRESENT |  |
| BP-14-06 | SMS and WhatsApp delivery | INT-01 (roadmap) | SMS (none) | none | NOT-EVIDENCED | 2 |

### Chapter 15. Records, documents, knowledge

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-15-01 | Documents with ownership, versions, retention | MOD-15 (proposed) | Document register (none) | none | NOT-EVIDENCED |  |
| BP-15-02 | Policies link to procedures and workflows they govern | MOD-15 (proposed) | Policy links (none) | none | NOT-EVIDENCED |  |
| BP-15-03 | Decisions link to meetings and evidence | MOD-15 (proposed) | Decision links (none) | none | NOT-EVIDENCED |  |
| BP-15-04 | Plain-language questions answered with source shown | MOD-15 (proposed) + AIN | Sourced search (none) | none | NOT-EVIDENCED | 3 |

### Chapter 16. Procurement, resources, facilities

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-16-01 | Requests raised in context and routed through approvals | WF stack + MOD-16 (proposed) | Requisitions (none) | none | NOT-EVIDENCED |  |
| BP-16-02 | Suppliers and commitments linked to budgets | MOD-16 (proposed) | Suppliers (none) | none | NOT-EVIDENCED |  |
| BP-16-03 | Assets and inventory with location, custody, condition | existing inventory_*, asset | Inventory | none | CODE-PRESENT |  |
| BP-16-04 | Maintenance requests assigned and tracked against assets | MOD-16 (proposed) | Maintenance (none) | none | NOT-EVIDENCED |  |

### Chapter 17. Specialised operations

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-17-01 | Transport links learners to routes, vehicles, drivers | existing transport | Transport | none | CODE-PRESENT |  |
| BP-17-02 | Boarding links learners to houses and rooms | existing hostel_* | Boarding | none | CODE-PRESENT |  |
| BP-17-03 | Library and laboratory resources, bookings, loans | existing library_* | Library | none | CODE-PRESENT |  |
| BP-17-04 | Events coordinate venues, people, communication | MOD-17 (proposed) | Events (none) | none | NOT-EVIDENCED |  |
| BP-17-05 | Security coordination receives only authorised information | MOD-17 (proposed) | Security (none) | none | NOT-EVIDENCED |  |

### Chapter 18. Higher education, research, QA

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-18-01 | Postgraduate supervision and milestones tracked | MOD-18 (proposed) | Supervision (none) | none | NOT-EVIDENCED |  |
| BP-18-02 | Research projects linked to grants, budgets, outputs | MOD-18 (proposed) | Research (none) | none | NOT-EVIDENCED |  |
| BP-18-03 | Ethics and research-governance workflows | MOD-18 (proposed) | Ethics (none) | none | NOT-EVIDENCED |  |
| BP-18-04 | Accreditation evidence collected from everyday work | MOD-18 (proposed) | QA evidence (none) | none | NOT-EVIDENCED |  |
| BP-18-05 | Multi-campus governance through senates and councils | MOD-05 (proposed) + MOD-18 (proposed) | Group governance (none) | none | NOT-EVIDENCED |  |

### Chapter 19. Education ecosystem

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-19-01 | Institutional group sees across member institutions under authority | M009 B-5 (#284) | Group oversight | none | IN-PR |  |
| BP-19-02 | Ministry, regulator, examination-body configurations | MOD-19 (proposed) | Config packs (none) | none | NOT-EVIDENCED |  |
| BP-19-03 | Authorised reports prepared from operating information | MOD-19 (proposed) | Reporting (none) | none | NOT-EVIDENCED |  |
| BP-19-04 | Purpose limitation and legal basis on every exchange | existing NDPA/ROPA #315 | Policy | none | IN-PR |  |

### Chapter 20. Institutional intelligence

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-20-01 | Role dashboards with consistent definitions | MOD-20 (proposed) | Dashboards (none) | none | NOT-EVIDENCED |  |
| BP-20-02 | Every figure traceable to its source | MOD-20 (proposed) | Source tracing (none) | none | NOT-EVIDENCED |  |
| BP-20-03 | Data quality visible at point of entry | MOD-20 (proposed) | Quality view (none) | none | NOT-EVIDENCED |  |
| BP-20-04 | AI explains trends and prepares reports for review | AIN-06 + WF-11 | Explainer (none) | none | NOT-EVIDENCED | 3 |

### Chapter 21. AI companions and AI workforce

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-21-01 | Governed AI actions with approvals and history | WF-06, WF-07, WF-08 | Action runtime | WF harness + sim | IN-PR |  |
| BP-21-02 | Agents are attributable actors | WF-12 | Actor model | WF-12 harness | IN-PR |  |
| BP-21-03 | Ten-step autonomy ladder with per-task permission | AIN-01..AIN-04 | Autonomy | AIN harness | IN-PR |  |
| BP-21-04 | Everything AI does is attributable and auditable | AIN-04, AIN-05 | Console | AIN-05 harness | IN-PR |  |
| BP-21-05 | Human approval on consequential actions | WF-07, WF-08 | Approvals | WF harness | IN-PR |  |
| BP-21-06 | Companion for every role | AIN-06a/b/c | Companions (none) | none | NOT-EVIDENCED | 3 |
| BP-21-07 | AI shows sources and limits; evaluated before responsibilities expand | AIN-07 | Eval suites (none) | none | NOT-EVIDENCED | 3 |
| BP-21-08 | AI never makes high-impact decisions (admit, expel, dismiss, diagnose, grade) | AIN-02/03 | Guard | AIN harness | IN-PR |  |

### Chapter 22. One foundation, many institutions

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-22-01 | Configuration per institution type from one model | #448, #439, #334 | Reality interview | none | IN-PR |  |
| BP-22-02 | Packs for primary, secondary, college, polytechnic, university, research, group, ministry | MOD-22 (proposed) | Packs (none) | none | NOT-EVIDENCED |  |
| BP-22-03 | Institution can add programmes or merge campuses without changing platforms | MOD-22 (proposed) | Restructure (none) | none | NOT-EVIDENCED |  |

### Chapter 23. African educational reality

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-23-01 | Mobile-conscious, data-efficient | existing Data Saver, PWA | Shell | none | CODE-PRESENT |  |
| BP-23-02 | Resilient to interruption, shows staleness | offline outbox #449 | Outbox | none | IN-PR |  |
| BP-23-03 | Paper-to-digital migration part of implementation | INST-0x | Import tooling (none) | none | NOT-EVIDENCED |  |
| BP-23-04 | Accessible for disabilities and languages | i18n scaffold #437 | a11y (not audited) | none | IN-PR |  |
| BP-23-05 | Affordable entry pricing by size | PLAN-01 | Pricing (none) | none | NOT-EVIDENCED |  |

### Chapter 24. Trust, governance, security

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-24-01 | Permission by role and relationship | existing RLS forced | RLS | DB tests | CODE-PRESENT |  |
| BP-24-02 | Institutional separation (tenant isolation) | existing RLS forced | RLS | DB tests | CODE-PRESENT |  |
| BP-24-03 | Auditability of sensitive actions | existing audit chain | Audit | existing tests | CODE-PRESENT |  |
| BP-24-04 | Data minimisation, retention, NDPA handling | retention, DSR, #315 | Policy | none | CODE-PRESENT |  |
| BP-24-05 | Backup, recovery, incident response | Mission 4 (open) | Restore drill (none) | none | NOT-EVIDENCED |  |
| BP-24-06 | Certifications published only when evidenced | Honesty guard (proposed) | Claims check (none) | none | NOT-EVIDENCED |  |

### Chapter 25. Interoperability and coexistence

| ID | Claim | Owner mission | Surface | E2E test | Status | Dec. |
|---|---|---|---|---|---|---|
| BP-25-01 | Payment provider integration | existing Paystack adapter | Payments | none | CODE-PRESENT |  |
| BP-25-02 | Communication channel adapters | existing Resend/Twilio adapters | Channels | none | CODE-PRESENT |  |
| BP-25-03 | National and statutory system connectors | INT-02 | Connectors (none) | none | NOT-EVIDENCED |  |
| BP-25-04 | Import and export with authorised, purpose-limited exchange | INT-01/02 | Hub | none | CODE-PRESENT |  |

## UNVERIFIED

- Every status above is seeded from audit 1's name-search scan, not from running the product.
- Chapters 1 to 4 and 26 to 28 (positioning, market, business, fundraising) are out of scope; chapter 29 (business model) is only partly covered by PLAN-01.
- Claim granularity (106 claims) is my reading of each chapter's "How it works" and "Hard limits" text. Tumi should add or split claims after his independent audit.
- Owner missions marked (proposed) are placeholders, not approved scope.
