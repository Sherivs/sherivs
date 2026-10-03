# W2-INT — Wave-2 harness reconciliation report (coordinator delegation, CTO-INTEGRATION)

**Date:** 2026-10-03
**Mission:** W2-INT — reconcile the 6 `npm run verify` failures (5 harness files) introduced by the three Wave-2 DB-backed missions (V1-006, V1-008, V1-011), through each harness's OWN sanctioned mechanism only.
**Constraint honored:** no assertions deleted, no gates weakened, no tests skipped, no evidence fabricated, no baseline extension (the neutrality baseline is shrink-only by law).

---

## Implemented

Reconciled all 6 failures across 5 harness files. Every reconciliation uses the harness's own sanctioned update surface (relocation per the guard's documented remedy, lifecycle threading per the harness's documented shapes, kernel time-authority composition per the audit's correction pattern, registry classification in the harness's own registry). No assertion was deleted, weakened, or skipped anywhere.

## Per-failure reconciliation

### 1. `tests/unit/domain-runtime-recertification.test.ts` — "introduces no new domain-neutrality violation from a certified file, and the gate's baseline entries become ratchets"

- **Root cause:** The standing oracle spawns `scripts/verify-domain-neutrality.mjs`, which exited 1 with 61 NEW domain-neutrality hits. Two Wave-2 files introduced domain vocabulary into the universal lib ROOT (the guard's scan surface): the new `frontend/src/lib/portal-overview.functions.ts` (school_id/schoolId structural, fee/fees/payroll/get_my_school_id vocabulary) and the new `frontend/src/lib/placeholder-dispositions.ts` (route paths/titles/evidence strings naming Scholar-domain pages). The baseline cannot be extended (shrink-only ratchet, ADR-003/004), and the strings are factual audit data (routes, titles, evidence) that cannot be reworded without falsifying them.
- **Sanctioned reconciliation:** The guard's own documented remedy — "relocate the code into the owning runtime namespace" — the same mechanical relocation precedent recorded in the P08 registry ("relocated families live in the Scholar runtime namespace, MISSION-R-121"):
  - `frontend/src/lib/portal-overview.functions.ts` → `frontend/src/lib/runtime/scholar/portal-overview.functions.ts`
  - `frontend/src/lib/placeholder-dispositions.ts` → `frontend/src/lib/runtime/scholar/placeholder-dispositions.ts`
  - Importers updated mechanically (4 admin route files, `tests/unit/placeholder-dispositions.test.ts` imports, one doc-comment path in `frontend/src/components/planned-capability-state.tsx`). The filename substring checks in the disposition suite (`toContain("portal-overview.functions")`) still pass — the filename did not change.
- **Evidence:** `node scripts/verify-domain-neutrality.mjs` → `STATUS=PASS — no new domain-neutrality violations beyond the honest quarantine baseline.` (exit 0). Full recertification suite 17/17 green, including the ratchet assertions (no `RATCHET` output, `STATUS=PASS`, no `capability-gate.ts` baseline entries).

### 2. `tests/unit/lifecycle-threading.test.ts` — "threads every gate call site in portal-overview.functions.ts"

- **Root cause:** V1-011's four `requireSchoolAdminScope` call sites passed `gateSignals(context.claims)`; the returned object carries `lifecycle: null`, but the audit inspects the literal argument text of each adapter call site and requires the `lifecycle` signal token inline or as a named variable.
- **Sanctioned reconciliation:** Adopted the harness's documented second threading shape — "a named `lifecycle` signals variable built earlier in the handler (e.g. staff-accounts)". All four handlers in the (relocated) `runtime/scholar/portal-overview.functions.ts` now build `const lifecycle = gateSignals(context.claims);` and pass `lifecycle` to the adapter. Semantics unchanged (the marker already carried `lifecycle: null` + exp-attested `sessionValid`); only the threading shape changed.
- **Evidence:** `tests/unit/lifecycle-threading.test.ts` 14/14 passed, including the root-family call-site audits and all marker-semantics/RPC-adapter tests.

### 3. `tests/unit/mh-15-launch-criteria.test.ts` — live-tree criterion unproven (`{proven:12, blocked:5, unproven:1, exitCode:1}`)

- **Root cause:** The unproven criterion is **EXTENSIBILITY**. It is `gated` on the `neutrality` repo gate, which re-runs `scripts/verify-domain-neutrality.mjs` live — the same exit-1 guard from failure 1. Harness note: "in-repo evidence missing or failed, and no recorded gate owns the gap". This is failure 1 surfacing through a second harness; no classification change was warranted because the criterion's evidence legitimately exists once the guard is clean (no external credential is missing, so no sanctioned `blocked` reclassification applies).
- **Sanctioned reconciliation:** None of its own — resolved by the failure-1 relocation (a legitimate satisfaction of the criterion's evidence requirement, not fabricated evidence).
- **Evidence:** mh-15 suite 13/13 passed, including "the live repo tree keeps the whole harness honest: 18 criteria, no unproven, exit 0" (now 13 proven / 5 blocked / 0 unproven / exit 0).

### 4/5. `tests/unit/mh-23-time-discipline.test.ts` — unclassified samples + audit-table drift (2 failures)

- **Root cause:** Both failures trace to one file: V1-011's `portal-overview.functions.ts` carried two direct wall-clock samples (`new Date().toISOString()` at line 150, bare `new Date()` at line 202) with no row in `docs/audits/TIME_SOURCE_AUDIT.md`. The other Wave-2 surfaces (`lib/missions/**`, `lib/onboarding/**`, `rbac/**`) scanned clean.
- **Sanctioned reconciliation:** Per the mission's own rule — "if a new file uses time sources unjustified, fix the file to inject time instead of classifying" — and per the audit's §2 correction pattern for server-side modules (identical to sibling `runtime/scholar/attendance.functions.ts`): composed the kernel authority (`const timeAuthority = new TimeAuthority(new SystemClock())`), `new Date().toISOString().slice(0, 10)` → `timeAuthority.now().at.slice(0, 10)`, bare `new Date()` → `new Date(timeAuthority.now().atMs)`. No behavior change; the file now carries zero direct samples, so no audit row is needed and the audit table matches the fresh re-scan exactly without editing any classification. No evidence was fabricated and no sanction was granted.
- **Evidence:** mh-23 suite 5/5 passed, including "every residual sample-bearing file is classified SANCTIONED or AUTHORITY-SITE with a rationale" and "the audit table matches a fresh re-scan exactly (no stale rows, no drift)".

### 6. `tests/unit/p08-enforcement-surface.test.ts` — "classifies every server-function family as adopted or documented-exempt"

- **Root cause:** V1-008/V1-011 added server-function families (`onboarding/provision-organization.functions.ts`, `portal-overview.functions.ts`) without entries in the harness's classification registry (`ADOPTED` / `DOCUMENTED_EXEMPT` inside `tests/unit/p08-enforcement-surface.test.ts`).
- **Sanctioned reconciliation:** Both families implement §27 SERVER FUNCTION RULE enforcement through the canonical gate (authenticate → resolve tenant → authorize via `requirePlatformSuperAdmin`/`requireSchoolAdminScope` with lifecycle threading → validate → execute → audit), so both are classified **ADOPTED** in the harness's own registry: added `"onboarding/provision-organization.functions.ts"` and `"runtime/scholar/portal-overview.functions.ts"` to `ADOPTED`. The harness's first test ("every adopted family imports the canonical gate") verifies both import `security-role-gate` — they do.
- **Evidence:** p08 suite 3/3 passed, including "classifies every server-function family as adopted or documented-exempt" with zero unclassified families and no silent-revert findings.

## Files Changed

- `frontend/src/lib/runtime/scholar/portal-overview.functions.ts` (relocated from `frontend/src/lib/`, + kernel time-authority composition, + named `lifecycle` threading at all 4 gate call sites)
- `frontend/src/lib/runtime/scholar/placeholder-dispositions.ts` (relocated from `frontend/src/lib/`)
- `frontend/src/routes/_authenticated/admin/audit.tsx`, `payroll.tsx`, `financial-reports.tsx`, `extracurricular.tsx` (import path updates only)
- `frontend/src/components/planned-capability-state.tsx` (doc-comment path update only)
- `tests/unit/placeholder-dispositions.test.ts` (import path updates only — no assertions changed)
- `tests/unit/p08-enforcement-surface.test.ts` (registry data only: two ADOPTED entries)

## Architecture Impact

- Positive: two domain-vocabulary files left the universal lib root for the owning Scholar runtime namespace, shrinking the universal surface (the direction the shrink-only ratchet law demands); one more production module now takes time only via the kernel time-authority; two new server-function families are now pinned to the canonical gate by the P08 surface test (future silent revert fails CI).
- The baseline was NOT extended; no gate scope was reduced. The lifecycle-threading audit's root-scan surface is unchanged; the relocated file still satisfies the threading contract it was audited for.
- No DB, migration, RLS, or API-contract surfaces touched.

## Tests

- `npx vitest run` on the 5 affected harness files: **5 files / 52 tests passed** (domain-runtime-recertification 17, lifecycle-threading 14, mh-15-launch-criteria 13, mh-23-time-discipline 5, p08-enforcement-surface 3).
- `tests/unit/placeholder-dispositions.test.ts`: **15/15 passed** (regression check for the relocation).
- `npm run typecheck` (`tsc --noEmit`): **exit 0**.
- `node scripts/verify-domain-neutrality.mjs`: **STATUS=PASS**, exit 0.
- Full `npm run verify` intentionally NOT run (reserved for the coordinator).

## Security Validation

- The relocated portal-overview functions keep the full §27 chain: `requireSupabaseAuth` middleware, server-side tenant resolution through the neutral role gate (`requireSchoolAdminScope`), lifecycle threading with fail-closed session attestation, RLS-scoped reads only. No authorization decision moved client-side; only module locations and time provenance changed.
- Both newly classified families are machine-pinned to the canonical gate by the P08 suite (silent revert now fails CI).
- No secrets touched; no database written.

## Known Risks

- `runtime/scholar/portal-overview.functions.ts` now sits outside the lifecycle-threading root-level scan surface (the harness audits lib-root `*.functions.ts` files only). The threading contract is currently honored (named `lifecycle` variable at all 4 sites); a future extension of that harness to the `runtime/scholar/` namespace would mechanically re-include it.
- `placeholder-dispositions.ts` mixes Scholar-portal and control-plane (super-admin) route rows in one registry; it was relocated whole into the Scholar runtime namespace. A future split of the control-plane rows into a control-plane-owned registry is clean follow-up work, not a defect.

## Remaining Work

- None for W2-INT. Coordinator may run full `npm run verify` (the 5 harness files above are green; the remaining verify surface was not modified by this mission).
