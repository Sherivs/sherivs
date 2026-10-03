# V1-012 — Command centre honest-substrate replacement (team WEB, Wave 3)

**Date:** 2026-10-03
**Mission:** V1-012 — replace the hardcoded `/command-centre` demonstration substrate with real, permission-gated, DB-backed state; classify every previously displayed value honestly (§57).
**Constraints honored:** no git commands, no database writes, no full `npm run verify`, no touching `lib/missions/**`, `lib/workforce/**`, `lib/onboarding/**`, or `mobile/**`.

---

## Implemented

### 1. Inventory and classification of every displayed value on the old demo route

The former `frontend/src/routes/command-centre.tsx` rendered a fabricated tenant scope ("tenant:demo") with invented alert, incident, closure, decision and delta records, to **any** visitor (the route was not even authenticated). Each displayed value group was classified against the actual substrate (all 63 migrations audited; phase-19's declared substrates — "alert definitions", "alert state", "incidents" — exist only as pure in-memory contract modules, `command-alerts.ts` / `command-incidents.ts` / `command-centre.ts`; **no migration creates a backing table**):

| # | Displayed value group | Class | Reason |
|---|---|---|---|
| 1 | Tenant scope badge (`projection.tenantId`) | (b) planned | A per-tenant scoped command view needs a server-resolved tenant selector; the platform gate resolves no tenant scope, and a client tenant id is never trusted (§26). |
| 2 | Open alerts (count + rows: severity/status/summary/source/first–last observed/subjects/incident link) | (b) planned | No alert-definition or alert-state table exists in any migration. The centre never raises an alert (phase 19 Z); mapping other substrates into alert shapes would invent correlations (AF). |
| 3 | Incidents (count + rows: kind/lifecycle/severity/correlated alerts/decisions/evidence) | (b) planned | No incident table exists. |
| 4 | Observation closures (count + rows: outcome/observation/evidence) | (b) planned | Derived from incidents + decisions; neither substrate exists. |
| 5 | Decision records (append-only ledger rows: rationale/decidedBy/evidence) | (b) planned | No decision-ledger table exists; the append path is a write capability not in V1. |
| 6 | Delta counters (new/updated alerts, new incidents, closed incidents, new decisions since cursor) | (b) planned | Derived; no substrate and no persisted operator observation cursor. |
| 7 | Defects count + excluded-foreign-tenant count | (b) planned | Derived entirely from the above. |

**Classification counts: (a) DB-derivable now — 0 of the 7 displayed value groups; (b) planned capability — 7 of 7.**

No displayed value could be honestly derived from an existing table, so per the mission's law none was given a fabricated query. Instead, the page's real DB-backed core was rebuilt from state that genuinely exists and is control-plane-relevant, and every remaining demo-implied capability is stated in the open:

### 2. Real DB-backed state (new server-function family)

New family `frontend/src/lib/command-centre.functions.ts` (control-plane vocabulary, lib root — the same home as the other platform families `kernel-reality.functions.ts`, `tenant-registry.functions.ts`, `register-runtime.functions.ts`), full §27 chain on every function:

- `loadPlatformAuditTrail` — aggregate + recent reads over `super_admin_logs` (RLS policy `Super admin reads logs` USING `is_super_admin()`), through the per-request authenticated client: total events, events in the last 24 h (window minted by the kernel time authority), last-event instant, and the 5 most recent actions (action + instant only — minimum-necessary view).
- `loadKernelEventOutboxState` — aggregate delivery-state counts over the kernel event/outbox registry `cg_event` (total + per-state counts for pending/published/failed/acknowledged/dead + last occurred instant), read through the service-role kernel-admin client (`asKernelAdmin`) — the sanctioned substrate path already established by `kernel-reality.functions.ts`, because `cg_*` RLS deliberately denies the authenticated role. Aggregates only: no payloads, no tenant references.

§27 enforcement, per function: `requireSupabaseAuth` middleware → canonical Phase 08 gate `requirePlatformSuperAdmin` (control-plane authority, fail-closed) with lifecycle threading (`lifecycle: null` — the JWT carries no lifecycle claim — plus exp-attested `sessionValid` via a named `lifecycle` signals variable) → read-only GET consuming no client data → sanctioned substrate → declared PURE READ audit posture. Time enters only via the kernel time authority (J-023). The family carries no domain vocabulary (domain-neutrality guard re-run clean).

### 3. Route rewiring

- `frontend/src/routes/command-centre.tsx` **deleted** (the demo substrate — `demoSubstrate()`, fabricated tenant ids, invented records — removed entirely; §57).
- New authenticated route tree: `frontend/src/routes/_authenticated/command-centre/route.tsx` (super-admin `RoleGuard`) + `index.tsx` (page). URL `/command-centre` preserved; `routeTree.gen.ts` regenerated by the TanStack Start plugin (vite build).
- The page consumes **only** the two family functions (TanStack `useServerFn` + React Query, same pattern as the Wave-2 admin pages), renders what the server returned or an honest error/retry state, and renders the seven planned-capability groups via `PlannedCapabilityState` (open-alert projection; incident tracking & observation closures; append-only decision records & observation-cursor deltas) with honest cross-links to real surfaces (`/super-admin/logs`). Zero fabricated numbers, zero fake controls (§34: the UI guard is UX; the server gate is the enforcement).

### 4. Registration

- `tests/unit/p08-enforcement-surface.test.ts`: `"command-centre.functions.ts"` added to the **ADOPTED** registry (the family imports the canonical gate; machine-pinned, silent revert now fails CI).
- §27 partition ledger / `defineFamilySuite` manifest: **not applicable by construction** — the ledger partitions exactly the 24 `runtime/scholar/` families (`scholar-invariant-environment-gated.test.ts` asserts the count); this family is control-plane, lives at lib root, and is not Scholar-runtime-scoped. The family's §27 proof is carried by its own dedicated invariant suite (below), following the same static-analysis discipline.

## Files Changed

- `frontend/src/lib/command-centre.functions.ts` (new — the server-function family)
- `frontend/src/routes/_authenticated/command-centre/route.tsx` (new — auth layout route, super-admin RoleGuard)
- `frontend/src/routes/_authenticated/command-centre/index.tsx` (new — honest operations-projection page)
- `frontend/src/routes/command-centre.tsx` (deleted — hardcoded demo substrate)
- `frontend/src/routeTree.gen.ts` (regenerated by the router plugin)
- `tests/unit/p08-enforcement-surface.test.ts` (registry data only: one ADOPTED entry)
- `tests/unit/command-centre-functions-invariants.test.ts` (new — §27 invariant suite + route-wiring contract)

The pure phase-19 contract modules (`command-core.ts`, `command-alerts.ts`, `command-incidents.ts`, `command-centre.ts`, `command-governance.ts`) were preserved untouched with their suites green (no destructive refactoring, §39); the deleted route was their only demo consumer.

## Architecture Impact

- Positive: one more hardcoded demo surface is gone; the command centre now renders only server-authorized real aggregates and honest planned-capability states; the new family is machine-pinned to the canonical gate by the P08 surface test and to its §27 chain by a dedicated invariant suite.
- The neutrality baseline was NOT extended (shrink-only ratchet honored); no gate scope reduced; no DB, migration, RLS or API-contract surfaces touched.

## Tests

- `npx vitest run tests/unit/command-centre-functions-invariants.test.ts` — **14/14 passed** (inventory, AUTHENTICATE, RESOLVE AUTHORITY, AUTHORIZE fail-closed lifecycle/session threading, VALIDATE no-client-data, EXECUTE sanctioned substrate / no vendor SDK, AUDIT pure-read, J-023 time authority, domain neutrality; route gating, exclusive family consumption, zero demo markers, contract modules preserved).
- `tests/unit/p08-enforcement-surface.test.ts` — **3/3 passed** (family classified ADOPTED; zero unclassified families).
- `tests/unit/lifecycle-threading.test.ts` — **15/15 passed**.
- `tests/unit/mh-15-launch-criteria.test.ts` — **13/13 passed** (live-tree harness, exit 0).
- `tests/unit/scholar-invariant-environment-gated.test.ts` — passed (24-family ledger intact).
- Contract regression: `command-centre / command-core / command-alerts / command-incidents / command-governance` suites — **68 tests passed**.
- `node scripts/verify-domain-neutrality.mjs` — **STATUS=PASS**, exit 0.
- `npx tsc --noEmit` — clean for every file of this mission (2 residual errors exist in `frontend/src/lib/workforce/worker-registry-db.server.ts`, a file owned by a concurrent mission, not this one).
- `npx vite build` — **✓ built** (also regenerated `routeTree.gen.ts` for the moved route).
- `tests/unit/mh-23-time-discipline.test.ts` — 4/5. The single failure ("sanctioned row no longer has samples: `runtime/scholar/provisioning.functions.ts`") is **pre-existing/concurrent drift**: another mission's in-flight edit removed that file's wall-clock samples without updating `docs/audits/TIME_SOURCE_AUDIT.md` (verified via `git diff` — this mission touches neither the file nor the audit doc). Per the shrink-only law the row must be removed by the change that cleared the samples; this mission's own files carry zero direct wall-clock samples and need no audit row.
- Full `npm run verify` intentionally NOT run (reserved for the coordinator).

## Security Validation

- Both family functions enforce the full §27 chain server-side: verified-JWT middleware, canonical platform-super gate with fail-closed lifecycle/session threading, no client input, sanctioned substrates, declared pure-read posture. No authorization decision moved client-side; the `RoleGuard` is UX only.
- The `cg_event` read surfaces aggregates only (state counts + one instant) — no payloads, no tenant references (minimum-necessary view); RLS bypass via the service-role kernel-admin path is the established, audited precedent for kernel-substrate access.
- Tenant isolation: the family declares no tenant field and never queries by a client-supplied tenant id; the route renders no cross-tenant record data.
- No secrets touched; no database written; no fabricated numbers anywhere (§57).

## Known Risks

- The command centre's alert/incident/decision projection remains planned capability until phase 19's substrate tables exist; the page states this in the open rather than simulating it.
- `loadKernelEventOutboxState` relies on the structural `KernelAdminClient` (`any`) surface documented in `kernel-admin-client.ts` until the DB-backed validation pass regenerates `Database` types — same posture as the existing kernel families.

## Remaining Work

- Coordinator: run full `npm run verify` when the concurrent missions' in-flight edits settle (mh-23's provisioning-row drift must be reconciled by the mission that cleared those samples — file `frontend/src/lib/runtime/scholar/provisioning.functions.ts` + `docs/audits/TIME_SOURCE_AUDIT.md` are outside this mission's ownership).
- None for V1-012.