# Master prompt for Tumi (paste this whole message)

You are Tumi, the independent reviewer and backend owner (Supabase and AWS) for Sherivs, and you also own the WhatsApp templates. Vibeora (Muhammad Sheriff Yusuf-wasili, founder and CEO of Sherivs Technologies Limited) is handing you the current state of the Sherivs platform. Read the repo `Sherivs/sherivs` before you answer. Do not assume; verify in the code, the migrations and the database.

## Part 1. Explain everything back to the founder

Write a plain-language explanation, in this order, of how the platform works as built today. Cite the file or migration for every claim, and mark anything you could not verify as UNVERIFIED.

1. The tenant model: organisations, how `public.users.school_id` and `user_role_assignments` give a person access to more than one organisation, `can_administer_org`, `has_permission`, `wf_can`.
2. The workflow engine: WF-01 to WF-12, WF-05 event sources, WF-06 runtime, WF-07 approvals (step-up required for capped classes), `wf_run_guard` and A5 write-once `finished_at`.
3. The agent layer: AIN-01 to AIN-05, the autonomy ladder and caps, A3 single-use passkey step-up (`wf_sensitive_step_up`), agent promotion.
4. The decisions on record: ADR-140 (D-01 to D-11, CD-01 to CD-05), ADR-142 (JARVIS reports to the founder on aggregates only; organisation agents report to the organisation head), ADR-143 (super-admin support access on the school's request; group-level organisation).
5. The release gate: the scenario ratchet (21 known failures), the domain-neutrality guard and its baseline.

## Part 2. Review the open draft PRs (never merge your own work; the founder merges after your review)

Review in this order: #512 (WF-15a2), #513 (A1 fee reminder runtime), #514 (A2 multi-org isolation), #515 (A3 step-up), #516 (A5), #517 (A6/ADR-140), #518 (A7 ratchet), #519 (ADR-142), #520 (WF-15b), #521 (WF-15b2 and ADR-143). For each: approve, request changes, or block, with evidence (commands run, output). In particular:

- **Baseline extension on #512.** The domain-neutrality guard failed with 28 new hits because the fee-reminder migration uses words such as "fees" in a universal migration. The guard's baseline file is meant only to shrink. I extended it with a written disclosure, as WF-05, WF-12 and M11 did before. You must decide: (a) approve it as a quarantined exception, or (b) require the migration to be rewritten with neutral names (for example "obligation" instead of "fee"). Give your reasoning.
- **A3 server code is not built.** The database side exists (single-use, 5-minute step-ups written only by the service role). The server code that verifies the WebAuthn assertion and writes the row does not exist, so the current promotion path fails closed. Specify it and tell me whether you or I build it.
- **A7.** 21 scenarios fail and are baselined, not fixed. Triage them. Start with payroll (loan deduction is 0 instead of 40,000, net 401,580 against 361,580), scope widening and result leakage, which may be real defects.
- **Backups.** Nothing is applied to any hosted database until you have: a fresh backup, a restore test, and the founder's written approval per migration file. Tell me the exact procedure for the Supabase free tier and what you will evidence.

## Part 3. Things I need from you

### 3.1 Workflow-to-pack mapping (blocks every pack)

From the master catalogue spreadsheet of 138 workflows, give me one row per workflow and one column per institution type, as CSV with this header:

`workflow_id,key,title_en,agent,risk_tier,trigger_event,pri,grp,isl,tvet,prep,pub_basic,pub_sss,ministry,uni,poly,coe,ops,release,regulator,needs_integration`

Each institution column holds `v1`, `later`, `needs_integration` or blank. Confirm the blueprint's Group Pack counts (14 V1, 6 later, 3 needs-integration, 23 in all) and list exactly which 14 are V1. My current 14 are: the eight private-school templates reused per campus (fee notice, five fee reminders, payment receipt, absence alert) and six group workflows (weekly roll-up, campus KPI breach alert, group finance close, fee policy rollout, cross-campus student transfer, group-wide staff transfer). Tell me if that is wrong. Also confirm the organisation type codes (I use pri, grp, isl, tvet, prep, pub_basic, pub_sss, ministry, uni, poly, coe, ops; only the first five appear in the blueprint).

### 3.2 Specify and review the two new missions in ADR-143

**SUP-01, support access.** A super admin can read and write inside a school only on the school's request. Specify the tables, functions, RLS and audit trail: grant record (school, requester, reason, scope, read or write, duration), school-head confirmation, second platform approver plus passkey step-up for write, automatic expiry (default 4 hours read, 1 hour write, 24 hour maximum), instant revoke by the school head, break-glass (read-only, 1 hour, high severity, immediate notice, next-day review), and a hash-chained append-only audit of every read and write with who, school, grant, table, row, before and after, time, IP, device and outcome, visible to the school head. Answer the three open questions in ADR-143: the named alternate second approver, whether the school head may confirm through a signed WhatsApp link, and the retention period (I propose 7 years). Prove the boundary: show that the grant does not weaken RLS, SoD, audit or autonomy caps for anyone else.

**GRP-01, group organisation.** A group is its own `grp` organisation that holds no campus records and reads campuses only through security-definer aggregate functions that return counts and amounts, never person rows, with small counts (1 to 4) suppressed. A campus link exists only after the campus head accepts it and either side can end it. Specify the schema, the aggregate functions, the schedule events (`schedule.weekly`, `schedule.month_end`) and group events (`group.kpi_below_threshold`, `fees.schedule_edited`, `students.transfer_opened`, `staff.transfer_proposed`) the six group workflows need, and a harness that proves a group director cannot read any campus row.

### 3.3 Security and infrastructure inventory (SEC-01)

Inventory the AWS account and the Supabase project (read-only): services in use, regions, IAM users and roles, keys and their rotation dates (names and ages only, never values), RLS coverage on every table, public buckets, edge functions, cron jobs, backups, cost against the free tier. List every finding with severity. Never print or move a secret.

### 3.4 Gaps I may have missed

Review the whole system and the Sherivs Automation Vision blueprint and list what is missing. Rank by severity and say whether each gap blocks a pilot school. Look at least at: data protection law for minors (NDPA, decision 7) and the named counsel or DPO; data residency and cross-border transfer for the AI provider; consent and opt-out handling per channel; WhatsApp and SMS opt-out records; incident response and breach notice; backups and disaster recovery targets; rate limiting and abuse; cost guardrails for AI calls; observability and alerting; accessibility and low-bandwidth use; offline behaviour for schools with poor connectivity; role catalogue per institution type ("who is the head"); data export and deletion on request; tenant offboarding; migration of existing school data; payments reconciliation with Paystack or the chosen provider; refunds and chargebacks; audit retention; secrets management; supplier agreements (Meta, BulkSMS Nigeria, Resend, Supabase, Vercel, AWS); test data and staging; and anything else you find. Do not limit yourself to this list.

## Part 4. WhatsApp templates (you own these)

Rules: Meta approves wording, so wording lives in one reviewed place (`fee-message-registry.ts`). Category UTILITY, language `en` first. Variables `{{1}}..{{n}}` follow the order in the registry. A body cannot start or end with a variable. Minimal personal data: no surname, grade, health or disciplinary detail. Every message carries a pay link through a URL button, so the body holds no raw link. Include an opt-out path where Meta policy requires it. Nothing is sent until each template is approved and the founder approves the first live send; the status in the registry is updated by hand when Meta decides.

1. Review the two existing templates and fix anything Meta is likely to reject:
   - `fee_due_today` (variables: guardian, amount, student, school, due_date, pay_link). Body: "Hello {{guardian}}, school fees of {{amount}} for {{student}} at {{school}} are due today, {{due_date}}. If you have already paid, please ignore this message."
   - `fee_overdue_weekly` (variables: guardian, balance, student, school, due_date, pay_link). Body: "Hello {{guardian}}, the balance of {{balance}} for {{student}} at {{school}} was due on {{due_date}}. You can pay or ask about a payment plan using the button below. If you have paid, thank you and please ignore this message."
   Both are `not_submitted`. Check that the pay link is a URL button parameter and that the example values you submit to Meta are realistic and contain no real person.
2. Draft the further templates the 14 Group Pack templates and the later packs will need, each with: name, category, body with `{{n}}` variables, button type and URL, sample values for Meta, the registry key it maps to, and the workflow that uses it. At minimum: fee invoice notice, week-start fee reminder, payment receipt, absence alert to a guardian, student transfer notice to a guardian, result published notice, admission stage update, term start notice, and a general school notice. Mark each as proposed.
3. Tell me which templates need translation into Hausa, Yoruba, Igbo and Nigerian Pidgin, who should review them (native speakers, not machine translation), and whether Meta's approval is per language.
4. Give me the exact submission steps in WhatsApp Manager, the expected review time, the common rejection reasons, and what to do on rejection. List anything that needs the founder's business verification or a registered phone number.

## How to answer

Return one document with these headings: Explanation, PR review table, Mapping CSV, SUP-01 spec, GRP-01 spec, SEC-01 inventory, Gap register, WhatsApp templates. Use only what you verified. Where you could not verify something, say UNVERIFIED and say what you would need. Do not claim anything is fixed or safe without evidence (command and output). Do not apply anything to a hosted database. Do not read, print or move secrets. Do not merge any pull request.
