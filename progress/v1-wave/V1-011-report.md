# V1-011 Report — Placeholder Pages Disposition (team WEB)

Mission: V1-011 of the CoreGrid V1 wave (V1CAP-40, §57 no-product-theatre law). Branch: `cursor/p08-foundation-loop-classification-fe86`.
Report format: AGENTS.md §42. All evidence produced by commands run in this session (see Tests / Security Validation).

## Implemented

1. **Exact placeholder enumeration (discovery corrected)** — every `frontend/src/routes/_authenticated/**` page was
   audited for the placeholder signatures (static zeros posing as data, disabled fake action buttons, invented
   metrics with no data source). Result:
   - **12 real placeholder pages** (not ~20): 7 zero-state admin pages + 5 fabricated-metrics "intelligence" pages.
   - **The 11 "super-admin placeholders" from discovery do not exist**: all 17 super-admin pages are real
     (DB-backed dashboards, server-function CRUD, or honest phase self-report surfaces that exercise real code
     and name their gaps in the open). Each is recorded in the registry as `AUDITED_REAL` with evidence so the
     program can re-verify the correction.
2. **Typed disposition registry (new, `frontend/src/lib/placeholder-dispositions.ts`)** — every audited page →
   `V1_BUILD | V2_CLASSIFIED | AUDITED_REAL` → evidence, with fail-closed self-validation
   (`validatePlaceholderDispositions()`: unique routes/files, non-empty evidence, V2 entries must state the planned
   capability and the frozen-envelope reason §45, V1 entries must cite real tables). `dispositionCounts()` is the
   program's audit summary. The full table is below.
3. **V1-BUILD pages wired to real data (new `frontend/src/lib/portal-overview.functions.ts`)** — four GET server
   functions following the established `*.functions.ts` conventions (see `tenant-registry.functions.ts` /
   `foundation-loop.functions.ts`): `requireSupabaseAuth` middleware (verified JWT, per-request client) →
   `requireSchoolAdminScope` (the neutral RBAC role-gate core in `rbac/role-gate.ts`, registry-first via
   `registerRuntimeRoleGate`, lifecycle-threaded per AGENTS §31) → tenant resolved **server-side** via
   `get_my_school_id` (never from the client, §26) → real queries over existing RLS-protected tables only:
   - `loadAuditOverview` — `audit_logs` event counts (total, today, security, last event) for `/admin/audit`.
   - `loadPayrollOverview` — `staff_payroll` current-period aggregates (staff count, payslips, gross/net,
     status buckets) for `/admin/payroll`.
   - `loadFinancialReportsOverview` — `fees` + `school_expenses` totals (billed/collected/outstanding, expense
     total, status buckets) for `/admin/financial-reports`.
   - `loadExtracurricularOverview` — `school_sports` register (counts, category breakdown, program list) for
     `/admin/extracurricular`.
   Pure aggregation helpers (`aggregateFeeRows`, `aggregateExpenseRows`, `aggregatePayrollRows`,
   `aggregateSportsPrograms`) are exported and unit-tested; pages render **only** server-function results and
   error/loading states — no number exists outside a live query result.
4. **V2-CLASSIFIED pages given an honest planned state (new `frontend/src/components/planned-capability-state.tsx`)**
   — the eight V2 pages now render an explicit "Planned capability — not in V1" state: no numbers, no disabled fake
   actions, no fabricated status claims; where real V1 surfaces serve adjacent data they are linked honestly.
   The fabricated `IntelligenceCenter` renderings (invented "94% live attendance", "412 active parents", "8.4/10
   teacher performance", etc.) are deleted from the portal and the sweep is test-enforced.
5. **Fabricated content removed along with the fake numbers** — e.g. `/admin/audit` claimed "✓ GDPR Compliance",
   "✓ Data Integrity — All records verified", "✓ No anomalies detected — AI-powered monitoring is active", and
   `/admin/visitors` claimed a "Security Status: Secure" stat; none of these corresponded to any enforcement in
   the system. Those claims are replaced by an explicit honest-state card naming what the page does not claim.
6. **Tests (new `tests/unit/placeholder-dispositions.test.ts`, 15 tests)** following the repo's node-env
   structural conventions (modeled on `tests/unit/surface-renderers.test.ts`): registry self-validation and counts;
   every entry cites existing files; V1_BUILD pages must use the audited server functions and contain no
   `<Button disabled>` fake actions, no fabricated `>0<` statics, no `₦0` literals, no static `value: "…"` stats;
   V2 pages must render `PlannedCapabilityState` (whose single source renders the honest phrase) and fabricate
   nothing; a repo sweep proves no admin route renders `IntelligenceCenter` anymore; pure aggregation helpers
   tested against fixture rows (including an honest-zero empty-table case and the unrecognised-status bucket).

## Files Changed

Created:
- `frontend/src/lib/portal-overview.functions.ts` — audited server reads + pure aggregators
- `frontend/src/lib/placeholder-dispositions.ts` — typed disposition registry (audit surface)
- `frontend/src/components/planned-capability-state.tsx` — honest V2 empty state
- `tests/unit/placeholder-dispositions.test.ts` — structural + unit proof suite

Modified (12 placeholder route pages; route paths unchanged, no `routeTree.gen.ts` edit):
- `frontend/src/routes/_authenticated/admin/audit.tsx` (V1_BUILD)
- `frontend/src/routes/_authenticated/admin/payroll.tsx` (V1_BUILD)
- `frontend/src/routes/_authenticated/admin/financial-reports.tsx` (V1_BUILD)
- `frontend/src/routes/_authenticated/admin/extracurricular.tsx` (V1_BUILD)
- `frontend/src/routes/_authenticated/admin/inventory.tsx` (V2_CLASSIFIED)
- `frontend/src/routes/_authenticated/admin/examinations.tsx` (V2_CLASSIFIED)
- `frontend/src/routes/_authenticated/admin/visitors.tsx` (V2_CLASSIFIED)
- `frontend/src/routes/_authenticated/admin/intelligence-ai.tsx` (V2_CLASSIFIED)
- `frontend/src/routes/_authenticated/admin/intelligence-operations.tsx` (V2_CLASSIFIED)
- `frontend/src/routes/_authenticated/admin/intelligence-parents.tsx` (V2_CLASSIFIED)
- `frontend/src/routes/_authenticated/admin/intelligence-students.tsx` (V2_CLASSIFIED)
- `frontend/src/routes/_authenticated/admin/intelligence-teachers.tsx` (V2_CLASSIFIED)

Not touched (per ownership): `frontend/src/routes/(site)/**`, `lib/missions/**`, `lib/onboarding/**`,
`routeTree.gen.ts`. The `IntelligenceCenter` component itself (`frontend/src/components/intelligence-center.tsx`)
is now unused by any route but was left in place (§39 — not deleted, flagged for follow-up).

## Disposition Table (the deliverable of record; mirrored in `placeholder-dispositions.ts`)

| # | Route | Page | Disposition | Evidence / Reason |
|---|-------|------|-------------|-------------------|
| 1 | `/admin/audit` | Audit & Compliance | **V1-BUILD** | `audit_logs` table (V1CAP-27) via `loadAuditOverview`; fabricated GDPR/anomaly claims removed |
| 2 | `/admin/payroll` | Payroll | **V1-BUILD** | `staff_payroll` table via `loadPayrollOverview`; disabled fake actions removed |
| 3 | `/admin/financial-reports` | Financial Reports | **V1-BUILD** | `fees` + `school_expenses` via `loadFinancialReportsOverview`; fake forecast/export removed |
| 4 | `/admin/extracurricular` | Extracurricular | **V1-BUILD** | `school_sports` via `loadExtracurricularOverview`; club/event tabs (no table) stated as planned |
| 5 | `/admin/inventory` | Inventory & Assets | **V2-CLASSIFIED** | No inventory/asset schema exists — schema gap reported |
| 6 | `/admin/examinations` | Examination Mgmt | **V2-CLASSIFIED** | No examination schema (grades live on real pages) — gap reported |
| 7 | `/admin/visitors` | Visitor Management | **V2-CLASSIFIED** | No visitor schema — gap reported |
| 8 | `/admin/intelligence-ai` | AI Command Center | **V2-CLASSIFIED** | Invented AI-ops metrics; V2 scope per capability matrix |
| 9 | `/admin/intelligence-operations` | Operations Command | **V2-CLASSIFIED** | Invented live-ops metrics; frozen V3 (§45); real pages linked |
| 10 | `/admin/intelligence-parents` | Parent Experience | **V2-CLASSIFIED** | Invented trust/sentiment metrics; frozen V3 (§45) |
| 11 | `/admin/intelligence-students` | Student Intelligence | **V2-CLASSIFIED** | Invented success/dropout metrics; frozen V3 (§45); `/admin/student-intelligence` (real) linked |
| 12 | `/admin/intelligence-teachers` | Teacher Intelligence | **V2-CLASSIFIED** | Invented burnout/performance metrics; frozen V3 (§45); `/admin/teacher-intelligence` (real) linked |
| 13–29 | `/super-admin/*` (17 pages: dashboard, schools, tenants, billing, settings, support, logs, platform-config, tiers, academic-intelligence, agent-governance, communication-steward, financial-operations, runtime-contracts, scheduling-intelligence, trust-fabric, workspace-projection) | Control-plane surfaces | **AUDITED-REAL** | All DB-backed or honest self-report surfaces; discovery's "11 super-admin placeholders" not found; evidence per entry in the registry |

Counts: **V1_BUILD 4 · V2_CLASSIFIED 8 · AUDITED_REAL 17 · total 29 entries.**

## Architecture Impact

- **§57 enforced at the code level**: the numbers a portal page shows now come only from a server-function query
  over an existing table; the honest V2 state is a typed, reusable component; the registry + tests make the
  disposition auditable rather than a claim in a report.
- **Authorization layering respected**: new reads authenticate (verified JWT), authorize (neutral RBAC role-gate
  core with runtime-declared bindings, lifecycle/session threaded), resolve tenant server-side, and lean on
  existing RLS as the database boundary (§17: application is never the only layer).
- **No new vocabulary in the platform core**: the server functions are consumers of the existing neutral
  `security-role-gate` facade; no domain vocabulary was added to `lib/rbac/**`.
- **No route/URL changes** and no `routeTree.gen.ts` edits — regeneration remains plugin-owned.

## Tests

- `npx vitest run tests/unit/placeholder-dispositions.test.ts` — **15/15 passed** (registry validation, structural
  fabrication sweeps over all 12 changed pages, aggregation unit tests).
- Neighbor suites that read these route files — `platform-neutrality` (49), `scholar-vertical-bindings` (19),
  `surface-renderers` (15) — **all green** (98 tests across 4 files total with the new suite).
- `npx eslint` on every touched file — clean.
- `npx tsc --noEmit` — the only errors are 4 pre-existing errors in `src/lib/missions/**` (another agent's
  in-flight files, owned by another mission; none reference any file changed here). Zero errors in this
  mission's files.
- Full `npm run verify` intentionally NOT run (coordinator-owned), per mission instructions. No database writes;
  no dev server run.

## Security Validation

- **Tenant boundary**: every new read resolves the tenant via the `school_admin` gate's `get_my_school_id` RPC
  inside the server function — a client-supplied tenant id is never trusted (§26), and cross-tenant reads are
  impossible (the query filters on the server-resolved scope, on top of per-table RLS).
- **Fail-closed**: an unresolvable scope, non-admin role, expired session or non-usable lifecycle denies the read
  (gate throws); the page then renders an error state — never a fabricated number.
- **No permission expansion**: read-only functions; no write path was added anywhere (the old pages' disabled
  buttons became honest text, not real unguarded writes).
- **Agents**: no agent surface touched; Invariant 12 unaffected.
- **No secrets, no `any`** (the gate's structural `SupabaseRpcClient` is the existing typed facade), strict
  TypeScript throughout.

## Known Risks

1. **Aggregate-in-Node scaling**: fee/expense totals are computed in the server function over selected rows
   (matching the established client-aggregation pattern of neighboring pages, e.g. `admin/expenses.tsx`). For
   very large tenants a SQL aggregate RPC would scale further — an optimization, not a correctness gap.
2. **`IntelligenceCenter` component is now route-orphaned** — left in place per §39; a follow-up may delete it
   (or repurpose it when V2 intelligence surfaces land).
3. **Payroll "period" uses server UTC** for the current month bucket; a payroll calendar (cutoffs, payment dates)
   is planned capability and may shift presentation later.
4. **Discovery correction**: the mission brief's "~20 placeholders incl. 11 super-admin pages" was approximate;
   the audited truth (12 placeholders, 17 audited-real super-admin pages) is in the registry with per-entry
   evidence, so the capability matrix's V1CAP-40 disposition can be closed against it.

## Remaining Work

1. Schema gaps reported for the program (required before any of these become V1-BUILD): inventory/assets,
   examinations logistics, visitors/gate logs.
2. Follow-up cleanup: delete the orphaned `intelligence-center.tsx` renderer (or fold it into future V2 work).
3. Coordinator: run full `npm run verify` (including the neutrality guard) once the parallel `lib/missions/**`
   work lands — this mission's suites are green in isolation.
