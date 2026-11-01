# Role-aware home shell

**Version target: ACTIVE-V1 organizational capability envelope.**

The shared Scholar home is composed from the authenticated identity's active organization and role, the server-resolved workspace manifest, approved responsibility assignments, granted permissions, and live workspace data. It is not a set of role-specific screens. Two people with the same role can receive different sections because each manifest is scoped to that member's grants and organizational assignment. The client never adds a section that the manifest has not admitted.

## Composition and context

- The manifest supplies permitted widgets, navigation, actions, inbox streams, and optional additions. The shell uses these for the home, drawer, and bottom navigation; permissions remain separate from role, responsibility, and organization context.
- Interactions with authorized workspace destinations are counted locally under an identity + organization + role-specific key. Authorized actions, navigation, inbox, and available add-ons are ranked together; the first four become quick actions and the next eight or fewer become additional workspace cards. Daily widgets remain a separate section. Equal counts retain manifest order; usage never adds items, and server authorization remains authoritative.
- The bottom navigation pins Home and the existing AI entry, then fills the middle three slots from the manifest's available workspace responsibilities. The drawer lists the remaining authorized destinations. Home widgets and actions are rendered only from the same authorized manifest.
- Members with multiple roles in the active organization get an **Active role** selector. Members of multiple organizations get an **Active organization** selector. Each selector contains only active membership rows. Changing context uses the existing authenticated switch operation; the active identity is unchanged, and the workspace reloads for the resolved context.
- Live widget values come from the tenant-scoped `workspace_widget_data` operation. Missing values display as “No data yet” and unavailable sources as “Unavailable”; neither is replaced with invented data. Assigned scope selection is checked against the manifest before it is applied.
- The greeting uses the member's display name and Africa/Lagos local time. No inference is presented as verified institutional truth.

## Default responsibility inputs

The following are defaults for catalog-backed V1 workspace generation, not guaranteed screens or grants. The active role template's mandatory responsibilities and default-on optional responsibilities are inputs to the server manifest. Each resulting widget, card, action, and navigation destination still requires the corresponding permission and an available catalog entry. An administrator may assign additional responsibilities, and personal widget choices can hide or reorder items where the workspace permits it.

| Role                            | Default responsibility areas used to generate the home                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Student                         | Own record, timetable, and (where enabled) AI tutor                                                                       |
| Parent                          | Linked children, fees, and in-app communications                                                                          |
| Teacher                         | Attendance, grade entry, lesson notes, students, personal staff items, and timetable                                      |
| Form teacher                    | Teacher responsibilities plus grade viewing and discipline recording                                                      |
| HOD                             | Academic reports, grade approval, lesson-note approval, students, attendance, and timetable                               |
| Principal / head                | Role and settings administration, institution analytics, academic reports, audit, results, students, staff, and timetable |
| Bursar                          | Fees, fee plans, payment reconciliation, financial reports, wallet, and budget                                            |
| Admin officer                   | Personal staff items, timetable, students, visitors, communications, works requests, and news                             |
| Proprietor / organization owner | Institution analytics, financial and academic reports, governance, audit, own payroll, leave, staff, and timetable        |
| Support staff                   | Own staff items, timetable, and (if assigned) works requests                                                              |
| Librarian                       | Library circulation and catalog, students, and own staff items                                                            |
| Nurse / health staff            | Health records, students, own staff items, and (if assigned) class communications                                         |

These are catalog responsibility areas, not hardcoded card names. For example, the teacher's available sections may include schedule, attendance, and grading, but each specific teacher's actual manifest and data scope determine what appears and what values are shown.

## Internal Console

The Control Plane is a separate, non-tenant workspace. Its role-workspace mappings cover `platform_owner`, `platform_admin`, `operations`, `engineering`, `support`, `security`, `finance`, and `sales`; specialized capability-filtered navigation is defined for the first five, with personal and shared workspaces kept separate. Console membership alone does not grant capabilities or tenant data access.

## Explicit V1 boundary

The owner-authorized V1 scope record in `docs/v1/V1-SCOPE-LOCK.md` names the bounded personal twins epic (#223) and JARVIS epic (#225). This supersedes older inventory statements that treated these named capabilities as frozen; it does not unfreeze physical/device twins, V3 Reality Intelligence, or unrelated future capabilities.

The `/home/ai` route now renders a role-named Assistant screen. Its typed client deliberately returns `unavailable` until an approved chat transport is connected; the screen does not invent replies or upload messages, attachments, or voice notes. Session-only conversation history and offline queue content are cleared when the page is closed or the active identity, organization, or role changes. T3 proposals are display-only and require human approval plus passkey step-up; that approval flow is not connected here, and this screen cannot approve or execute proposals. T4 proposals are denied by policy.

Twin-derived home insights, durable personal Twin state, the JARVIS workforce/runtime, connected streaming chat, and a persisted cross-session assistant history are not implemented or claimed by this shell change. Their delivery remains subject to their authorized phase acceptance, security, and operational gates.
