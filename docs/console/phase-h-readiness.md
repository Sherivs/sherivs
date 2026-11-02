# SV1-CONSOLE Phase H — Tests, evidence, and deployment readiness

**Snapshot:** 2026-11-01
**Version target:** V1 organizational capability envelope
**Scope:** Test and evidence changes only. No migration, production database, or runtime authorization changes were made.

## Deliverables 11–15

### 11. Files changed

- `tests/e2e/phase-h-console-screenshots.spec.ts` — captures the synthetic console at 1440×900 and 390×844 and checks for horizontal overflow.
- `tests/sql/internal-console-store.sql` — adds invitation replay and personal-workspace/recent-access privacy checks.
- `tests/sql/control-plane-engines.sql` — adds role-change membership reconciliation, personal-workspace preservation, and suspension checks.
- `docs/console/phase-h-readiness.md` — this evidence and readiness report.
- `docs/console/evidence/phase-h-console-platform-owner-1440.png`
- `docs/console/evidence/phase-h-console-platform-owner-390.png`

The SQL scripts are disposable local-stack harnesses wrapped in `BEGIN`/`ROLLBACK`; they use synthetic identities. They are test sources, not evidence of database execution.

### 12. Test results

| Validation | Result |
|---|---|
| Focused Vitest: onboarding invitation/provisioning, console, lifecycle, metrics, and audit suites | **Pass** — 6 files, 144 tests |
| `npm run typecheck` | **Pass** |
| ESLint on the changed Playwright spec | **Pass** |
| `npm run verify` | **Pass** — typecheck, 532 unit-test files (10,110 passed; 22 skipped), registry/drift/neutrality/secret checks, and production build |
| Focused synthetic console Playwright test | **Pass** — both configured Chromium projects; screenshot dimensions 1440×900 and 390×844 |
| Broader existing console role-simulation journey | **Incomplete** — the mobile run failed on `/console/organizations/fixture-org-active`; server-side Supabase fixture variables were absent, so this is not a successful backend browser verification |
| SQL harness execution | **Not run** — no local Supabase endpoint responded on `127.0.0.1:54322`; no production endpoint was used |
| GitHub Verify workflow | **Not green** — runs #252 and #254 concluded `action_required`, with zero jobs and no failed-job logs |

Existing test sources are distinguished below from tests that were executed. An SQL harness being present or changed does not mean the database behavior was verified.

### 13. Browser screenshots

The screenshots come from the local Playwright visual fixture, not a production or authenticated staff session:

- [1440×900 desktop](evidence/phase-h-console-platform-owner-1440.png)
- [390×844 mobile](evidence/phase-h-console-platform-owner-390.png)

They show the explicit local-fixture banner and are visual evidence only; they do not prove backend authorization, database state, deployment, or production behavior.

### 14. Deferred capabilities and evidence

The linked implementation PRs for phases B, C, D, F, and G (#237–241) remain open drafts. The owner directed Phase H to start, but the dependencies are not merged into this checkout. Items dependent on those changes remain explicitly partial or unverified.

| Capability | Designed | Implemented | Unit | Integration | Browser | DB verified | Deployed | Prod verified | Evidence / remaining work |
|---|---|---|---|---|---|---|---|---|---|
| Provisioning | Yes | Partial | Pass — `onboarding-provisioning-engine.test.ts` | Not run | Not run | No | No | No evidence | Existing provisioning engine and lifecycle code; atomic database behavior remains unverified. |
| Role mapping | Yes | Yes, existing mappings | Pass — `organization-lifecycle.test.ts`, `internal-console.test.ts` | Not run | Owner home only; synthetic fixture | No | No | No evidence | Uses existing platform role/capability authorities; no second role engine. |
| Invitation idempotency | Yes | Partial | Existing invitation unit suite passes; replay SQL case added, not run | Not run | Not run | No | No | No evidence | SQL case checks that a repeated claim is rejected without duplicating personal workspace state. Phase B #237 remains open. |
| Role changes | Yes | Partial | Mapping/state unit tests pass; role-change SQL case added, not run | Not run | Not run | No | No | No evidence | Current sync function is covered by new harness assertions; transactional reconciliation is pending #237. |
| Membership reconciliation | Yes | Partial | No direct executed reconciliation test | SQL source added, not run | Not run | No | No | No evidence | New harness checks old role membership removal, new membership creation, and preservation of personal workspace. |
| Suspension | Yes | Partial | Lifecycle/status model tests pass; server/DB check not executed | SQL source added, not run | Not run | No | No | No evidence | New harness checks a suspended staff identity loses a platform capability. |
| Personal privacy | Yes | Yes, existing policy and UI filter | Pass — `internal-console.test.ts` | SQL source added, not run | Not run | No | No | No evidence | Harness checks platform-admin reads cannot access another user's personal workspace or recent items. |
| Organization-to-school linking | Yes | Partial | Structural lifecycle/migration assertions pass | Not run | Not run | No | No | No evidence | Retry-safe atomic linking and cross-scope proof are pending Phase D #239. |
| Tenant isolation | Yes | Yes, existing RLS controls | Existing unit/security assertions | Existing SQL sources not run | Not run | No | No | No evidence | No live or local database RLS result is claimed. |
| Metrics | Yes | Partial | Pass — `h3-046-metrics-registry.test.ts` | Not run | Not run | No | No | No evidence | Console metric authorization/catalogue work remains pending Phase F #240. |
| Audit | Yes | Partial | Pass — `h3-048-audit-surface.test.ts` | Not run | Not run | No | No | No evidence | Existing audit contracts are tested; the full console correlation/before-after contract is not verified. |
| Navigation | Yes | Yes, existing capability filtering | Pass — `internal-console.test.ts` and `workspace-navigation.test.ts` | Not run | Owner home only; synthetic fixture | No | No | No evidence | Browser coverage uses the local visual fixture only; the broader role journey did not complete. |
| Unauthorized requests | Yes | Partial | Pass — host/route denial checks in `internal-console.test.ts` | Existing SQL denial sources not run | Not verified | No | No | No evidence | Known Support assignment-scope finding remains in `security-findings.md` (SF-3) and is owned by pending Phase B #237; deployment is blocked until resolved and retested. |

### 15. Deployment readiness

**Status: NOT READY.**

- Phase H has not been deployed. Existing historical deployment records in other progress documents are not independent verification of this change.
- No production database was accessed or changed; no production-verified claim is made.
- The new SQL assertions have not run because no disposable local Supabase database was available.
- GitHub Verify runs #252 and #254 were `action_required` with zero jobs and no failed-job logs. A green remote workflow is not evidenced.
- Phases B–G are not merged. In particular, Support organization assignment scoping remains a documented authorization gap.
- Do not deploy or close the phase until the pending implementation dependencies land, the SQL harnesses run against a disposable non-production stack, the authorization gap is fixed and covered, and the Verify workflow completes green.

No secrets, production credentials, live user records, or production database operations were used.
