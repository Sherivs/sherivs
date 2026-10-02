# CoreGrid Scholar - Remaining Work

Future implementation roadmap. Phase specifications live in
`architecture/phase-XX-*.md`; status and evidence are tracked in
`PROGRESS.md` and `architecture/registry.json`.

## Immediate follow-ups (before next release)

1. **Rotate credentials** that existed in git history (Supabase service
   role, `.mcp.json` GitHub token, Supabase keys in `.mcp.json`).
   **Still open (2026-10-02).** Rotation is an operator-side action and
   cannot be proven from the repository; git history is also not
   rewritten. The exposure surface shrank: `.mcp.json` no longer embeds
   credential material (see item 2), and AD-181 (DECISIONS.md, RATIFIED
   2026-09-03) plus `scripts/verification/secret-scan.mjs` and
   `tests/unit/foundation.test.ts` now block re-introduction.
2. ~~**Move `.mcp.json` secrets to environment variables** so the file can be
   shared safely.~~ → **DONE (verified by inspection 2026-10-02)**: the
   tracked `.mcp.json` now contains only non-secret server configuration
   (no token/key values for the GitHub or Supabase MCP servers); the
   no-credential-material rule is enforced by AD-181 (DECISIONS.md,
   RATIFIED 2026-09-03), the secret scan, and the foundation integrity
   suite.
3. **Ratify constitution** - confirm `CONSTITUTION.md` is authoritative and
   record ratification in `DECISIONS.md`. **Still open (2026-10-02)** — no
   explicit constitution-ratification record exists in `DECISIONS.md`
   (AD-181 ratifies a secrets/fixture decision, not the constitution).
4. ~~**Add CI** - build + unit tests + e2e + secret scan + RLS isolation
   check on every PR (`.codex/pull-request-policy.md`).~~ → **DONE
   (2026-10-02)**: `.github/workflows/verify.yml` runs `npm run verify`
   (typecheck + unit tests + registry/drift/neutrality gates + secret scan
   + production build) on pull_request and push to main;
   `.github/workflows/security-batteries.yml` runs the V1CAP-073 RLS
   isolation battery and the V1CAP-074 restore/recovery drill against the
   canonical database (weekly schedule + manual; live-credential-gated, so
   intentionally not on pull_request; exit 2 = BLOCKED_NO_CREDENTIAL does
   not fail the job). E2E remains a local `npm run test:e2e` (Playwright)
   — not yet a CI job.
5. ~~**Single verification command** - add `scripts/check` (PowerShell +
   bash) that runs build, unit tests, and RLS checks.~~ → **DONE, with a
   deviation (2026-10-02)**: the single command is `npm run verify`
   (typecheck + unit tests + registry/drift/neutrality/secret gates +
   build), not a `scripts/check` wrapper; a PowerShell bundle also exists
   at `scripts/verification/check.ps1` (typecheck -> unit tests -> build).
   No bash wrapper was added.
6. ~~**Fill phase 01 (Foundation)** and **phase 02 (Identity)** content in
   `architecture/`.~~ → **DONE (verified 2026-10-02)**:
   `architecture/phase-01-foundation.md` and
   `architecture/phase-02-identity.md` are populated (2,507 and 2,476
   lines respectively).

## Substrate-hardening wave findings (2026-10-02)

Recorded honestly from the 2026-10-02 hardening waves; each item cites its
evidence:

- **Retention gate is standalone.** `scripts/verify-retention-schedule.mjs`
  (exit 1 on a personal-data-bearing family without a policy ID) is not yet
  in the committed `npm run verify` chain; the schedule's own authoring
  report flags the verify-chain recommendation
  (`architecture/coregrid-mvp-architecture/RETENTION_POLICY_SCHEDULE.md`).
- **Retention durations are provisional defaults** pending operator/legal
  ruling; erasure mechanism in V1 is tombstone only (ADR-005 Option 2);
  crypto-shred is deferred to a follow-up ADR
  (`architecture/coregrid-mvp-architecture/RETENTION_POLICY_SCHEDULE.md`).
- **§27.6 audit-record gaps** in the Scholar server-function families were
  recorded as findings, never accommodated
  (`tests/unit/scholar-invariant-*.test.ts`; commit 5b22d4b).
- **CI batteries are live-credential-gated.** Both
  `.github/workflows/security-batteries.yml` jobs report
  BLOCKED_NO_CREDENTIAL (exit 2, job not failed) until the operator
  configures the repository secret store; no posture claim is made either
  way.
- **Battery table set is a maintained inventory.** The 36-table dual-posture
  proof covers the applied `cg_*` tables as of 2026-10-02
  (`architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json`); new
  `cg_*` tables must be added per the §4.4 runbook
  (`architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md`).
- **One genuine-policy beachhead.** J-005/J-006 neutral tenant-membership
  policies exist on exactly three tables (`cg_role_assignment`,
  `cg_role_grant`, `cg_org_membership` — nine tenant-scoped policies,
  FORCED RLS); the remaining `cg_*` tables hold the zero-policy
  deny-by-default posture. Broadening the policy-backed posture is future
  work (`database/supabase/migrations/20261002000013_coregrid_v1_neutral_membership_policies.sql`).

## Phase-by-phase roadmap

| Phase | Deliverable | Depends on |
| --- | --- | --- |
| 01 Foundation | CI/CD, observability, error tracking, deployment config in `infrastructure/` | now |
| 02 Identity | Platform identity model, SSO/OIDC, account lifecycle | 01 |
| 03 Multi-Tenancy | Tenant hierarchy (school -> district -> state), tenant provisioning API | 02 |
| 04 Education Reality Engine | Curriculum, assessment, learning-objective model | 03 |
| 05 Core Application Runtime | Application runtime foundation, module boundaries, shared kernel | 01, 02 |
| 06 Workspace Engine | Unified workspace for staff/student workflows | 04 |
| 07 AI Agent System | Platform agents with scopes, audit trails (see `architecture/phase-07-ai-agent-system.md`) | 02, 08 |
| 08 Security Engine | RBAC/ABAC/ReBAC/PBAC policy engine, security audit hardening | 02, 03 |
| 09 Security Trust Fabric | Trust, attestation, key management, secure communication | 08 |
| 10 Communication Platform | Messages/notifications/push as platform services | 01 |
| 11 Academic Intelligence | Academic record, assessment, and progression intelligence | 04 |
| 12 Scheduling Intelligence | Timetable and resource scheduling engine | 04, 05 |
| 13 Financial System | Extract Paystack integration, billing, invoicing | 01, 03 |
| 14 Data Platform | Data access layer, realtime contracts, backup/restore guarantees | 01 |
| 15 Hardware Integration | Biometrics, geofence, QR/face attendance as a service | 08 |
| 16 Digital Twin | Formalize digital-twin functions into an engine | 04, 14 |
| 17 Automation Engine | Workflow/automation for school operations | 01 |
| 18 Analytics Intelligence | Reporting, dashboards, data warehouse readiness | 14 |
| 19 Command Centre | Unified operations dashboard and control plane | 06, 10 |
| 20 Government Education Cloud | District/state rollups, compliance | 03, 18 |
| 21 Global Cloud Fabric | Multi-region cloud fabric and edge distribution | 14, 31 |
| 22 Mobile Platform | Mobile app (see `mobile/`) | 10, 15 |
| 23 Web Platform | Web platform ownership (current app) | now |
| 24 CoreGrid Experience & Design Intelligence | Design language, component system, accessibility, UX intelligence | 23 |
| 25 Institutional Onboarding, Administration & Workforce Identity Platform | School onboarding flows, administration console, staff identity lifecycle | 02, 03 |
| 26 AI Intelligence Layer | Gateway, model routing, evals, cost controls | 07 |
| 27 Marketplace | Third-party app/school-content marketplace | 28 |
| 28 Developer Platform | Public API, webhooks, SDKs | 01, 14 |
| 29 CoreGrid Integration | CoreGrid ecosystem protocols | 28 |
| 30 Globalization | i18n, l10n, multi-currency, regional compliance | 03, 13 |
| 31 Enterprise Scale | High availability, sharding, multi-region | 01, 14 |
| 32 Future Evolution | Long-term platform evolution governance | all |

## Backend extraction plan (ADR-002 follow-up)

Current BFF co-location in `frontend/src/`:

- `frontend/src/routes/api/**` - HTTP API routes
- `frontend/src/lib/*.functions.ts` - server functions
- `frontend/src/integrations/supabase/client.server.ts` - service-role client
- `frontend/src/server.ts`, `frontend/src/start.ts` - SSR entry

Extraction criteria (do not extract before these are met):

- A second consumer exists (mobile, marketplace, or external client).
- Load/scale testing shows the web runtime is the bottleneck.
- Observability (logging, tracing, error capture) exists for the extracted
  service.

When extracting, move modules to `backend/` per the backend extraction
criteria recorded in `DECISIONS.md` and update the build
pipeline with verification.

## Authorization roadmap (SEC-004)

- **Now:** roles + dashboard routing + RLS (current model).
- **Phase 02/03:** identity model, tenant hierarchy, claim structure.
- **Phase 08:** policy engine supporting RBAC -> ABAC -> ReBAC -> PBAC with
  RLS as the enforcement boundary.

## Known deferred items

- Rename `vibeora_*` database identifiers via forward migrations (data
  compatibility first).
- Update `PLATFORM_HOSTS` and `robots.txt` on DNS cutover to CoreGrid
  Scholar domains.
- ~~Replace deprecated `createServerFn().inputValidator()` calls~~ → **DONE 2026-09-03**: migrated to `.validator()` across 17 server-function modules (36 call sites); whole-tree typecheck 0 errors + production build PASS with zero deprecation warnings.
- ~~Fix pre-existing typecheck debt (7 x TS2322: `PageHeader` `actions`
  typed as `ReactNode` instead of an actions array) in admin routes
  (audit, examinations, extracurricular, financial-reports, inventory,
  payroll, visitors)~~ → **RESOLVED (verified 2026-09-03)**: whole-tree
  `tsc --noEmit` reports 0 errors; no TS2322 remains in the tree.
- Address `AdminDashboard` route export code-splitting warning (verify on next CI).
