# T-D REPORT — TRANSPORT-POLICY (post-R-wave follow-up wave)

Date: 2026-10-03
Branch: `cursor/p08-foundation-loop-classification-fe86` (work done in place; no branch switch, no commit/push — per mission orders)
Status: **AUTHORED, NOT APPLIED.** No canonical access was granted by this team; the migration is unapplied and the live isolation proof is the coordinator's post-apply step (RLS battery re-run + driver e2e case lift).

---

## Implemented

1. **Driver bus-read policy migration** — `database/supabase/migrations/20261003000041_coregrid_transport_bus_reads.sql`:
   - `ALTER TABLE public.transport_buses FORCE ROW LEVEL SECURITY;` (battery §2 convention: force is re-evaluated exactly when policies are authored, mirroring the 20261002000013 exemplar).
   - `GRANT SELECT ON TABLE public.transport_buses TO authenticated;` — the single privilege that makes the policy the operative row gate. anon/PUBLIC untouched (zero privileges). No INSERT/UPDATE/DELETE of any kind. `service_role` untouched (sanctioned server-only path).
   - `CREATE POLICY transport_buses_select_driver_assigned ON public.transport_buses FOR SELECT TO authenticated USING (driver_id = auth.uid());`
   - DO-block verification guard: the apply FAILS LOUDLY unless the landed posture is exactly the declared one (exactly 1 policy with the declared name/cmd/permissiveness, authenticated = SELECT-only, zero anon/PUBLIC privileges, RLS enabled AND forced).
   - Dollar-quoted machine-readable `COMMENT ON TABLE` / `COMMENT ON POLICY` provenance strings (exemplar shape of 20261002000013 §4).

2. **Exact-inverse rollback** — `database/supabase/rollbacks/20261003000041_coregrid_transport_bus_reads.sql` (same basename): drops the policy, revokes authenticated SELECT, un-forces RLS, restores the 20261002000014 zero-policy COMMENT **verbatim**, and re-asserts the zero-policy invariant with its own DO-block guard. Genuine inverse; never resurrects the pre-20261002000014 permissive policy set.

3. **Posture registry ratchet** — `scripts/verification/rls-table-postures-transport.json` flipped: `transport_buses` zero-policy → **policy-backed** (`policies: ["transport_buses_select_driver_assigned"]`, `forceRls: true`, `tenantColumn: "driver_id"`, `privileges.authenticated = ["SELECT"]`, `policyBackedBy` → 20261003000041, `batteryExpectations` flipped to `policyBackedTables`). The zero-policy era is preserved in a `history` block (H2-03 normalization cited, its rollback superseded for this table by the T-D exact inverse).

4. **Ratchet tests extended/updated**:
   - `tests/unit/h3-031-posture-adjudication.test.ts` — EXTENDED ONLY (new describe block appended): transport posture declared policy-backed, source file path pinned (full relative path — the posture validator preserves the raw string, not the basename), `policyBackedBy`, `tenantColumn`, battery expectations.
   - `tests/unit/h3-034-posture-adjudication.test.ts` — EXTENDED ONLY (new describe block appended): `validatePostureEntry` fail-closed round-trip of the T-D entry, policy declaration pins, no re-declaration of h3-034's adjudicated tables. (One unused `@ts-expect-error` directive removed in the extension after the type surface settled.)
   - `tests/unit/mh-03-transport-rls.test.ts` — the battery-steward adoption-contract section updated to the T-D policy-backed shape (see ownership note below). Sections 1–3 (20261002000014 authored-integrity, zero-policy content pins, rollback inversion pins) are UNCHANGED — the H2-03 migration files themselves are untouched and remain the historical baseline.
   - `tests/unit/h3-040-posture-adjudication.test.ts` — its two transport-JSON pins updated to the policy-backed posture + `policyBackedBy`; the historical canonical-apply-record test retained (retitled).

5. **New dedicated posture test** — `tests/unit/td-041-transport-bus-reads.test.ts`: flow traceability (getMyDriverBus → requireSupabaseAuth → authenticated role), least-privilege statement pins (SELECT-only, no write, no anon/PUBLIC, identity-scoped predicate, no banned vocabulary), J-005/J-006 law pins, rollback exact-inverse verification (verbatim zero-policy comment restore), posture-registry ratchet via `loadPostureRegistry` + `validatePostureEntry`.

6. **E2E driver case lifted to post-apply-passable** — `tests/e2e/preview-public-site-card.spec.ts` (the one legacy spec containing the driver preview-card case): the case now provisions its own fixture data via a spec-local service-role client (`assignFixtureDriverBus` inserts an active bus assigned to the fixture driver; the row cascades away with the school cleanup, so no fixture residue), and the typed-skip fallback now names `20261003000041_coregrid_transport_bus_reads.sql` as the pending coordinator apply. **Until the coordinator applies the migration the case still types-skips (correctly); once applied it performs a real client-mediated read and can PASS.** No helpers.ts changes, no other specs touched.

## Files Changed

| File | Change |
|---|---|
| `database/supabase/migrations/20261003000041_coregrid_transport_bus_reads.sql` | NEW (authored, not applied) |
| `database/supabase/rollbacks/20261003000041_coregrid_transport_bus_reads.sql` | NEW (exact inverse) |
| `scripts/verification/rls-table-postures-transport.json` | posture flip → policy-backed + history block |
| `tests/unit/td-041-transport-bus-reads.test.ts` | NEW |
| `tests/unit/h3-031-posture-adjudication.test.ts` | extended (append-only) |
| `tests/unit/h3-034-posture-adjudication.test.ts` | extended (append-only + 1 directive removal) |
| `tests/unit/h3-040-posture-adjudication.test.ts` | 2 transport-JSON pins updated |
| `tests/unit/mh-03-transport-rls.test.ts` | posture-contract section updated (see ownership note) |
| `tests/e2e/preview-public-site-card.spec.ts` | driver case: fixture provisioning + migration-pointer typed skip |

Not touched (per file ownership): `scripts/apply-canonical-hardening.mjs`, `tests/e2e/helpers.ts`, other e2e specs, `frontend/src/**`, T-C's files.

## Architecture Impact

- **Layer**: Infrastructure (database RLS) only. Domain/application/policy layers untouched. The migration touches authorization state only — no schema invented, no data mutated, no backfill, no audit record touched.
- **Posture**: `public.transport_buses` moves from zero-policy (deny-by-default strongest form, correct for its substrate era) to policy-backed SELECT-only for one narrow surface. Every other read family (caregiver tracking, admin fleet surfaces) and every write family remains denied at the data plane.
- **Isolation argument**: a row becomes visible to an actor only when the row itself names that actor as its assigned operator (`driver_id = auth.uid()`). No client-supplied value can enter the predicate; the app-level `.eq("driver_id", …)` filter can only narrow. A foreign-campus row cannot become visible unless that campus's own administrators assigned the actor — a data-integrity concern of the admin surface, out of scope for this read gate. Unauthenticated actors hold zero privileges.

## Discovery Evidence (the WHO/WHAT derivation — AGENTS §22/§43)

- **WHO**: the driver, client-mediated. `getMyDriverBus` (`frontend/src/lib/runtime/scholar/driver-portal.functions.ts`) reads the fleet row with `.eq("driver_id", userId).eq("is_active", true)` through `requireSupabaseAuth` (`frontend/src/integrations/supabase/auth-middleware.ts`), which builds a Supabase client with the publishable key + the user's bearer JWT → the `authenticated` role → **RLS applies**. This is NOT a service-role-mediated surface, so the honesty valve "no client policy at all" does not fire: without a policy the read denies and the surface stays dead (the R1 finding).
- **WHAT**: exactly one row — the active bus assigned to the acting driver. Nothing more.
- **WHY identity-scoped rather than the J-005 tenant-equality shape** (verified read-only against the canonical project 2026-10-03, never guesswork):
  1. The legacy table carries **no neutral tenant reference** — its only row-scoping keys are the legacy campus uuid column and `driver_id` (uuid FK to users, ON DELETE SET NULL). H3-040 recorded the missing neutral reference as the basis of the zero-policy adjudication.
  2. The live neutral substrate holds **zero bindings for real sessions** (`cg_org_membership` = 0 rows, `cg_role_assignment` = 0 rows live; no app/onboarding path writes them) — a tenant-equality predicate `tenant_ref = get_my_tenant_id()` would resolve NULL for every real session and deny every row, restoring nothing.
  3. The only historically available tenant predicate is the legacy domain-helper class (20260904010000) — exactly the class J-005/J-006 ban from the policy layer, and the class the shrink-only domain-neutrality guard can never re-admit.
  4. Therefore the least-privilege expressible predicate is the assignment-identity binding `driver_id = auth.uid()` — the same sanctioned auth.uid() self-derivation the 20261002000013 grantor pin uses.

## Tests

- `npx vitest run tests/unit/td-041-transport-bus-reads.test.ts tests/unit/h3-031-posture-adjudication.test.ts tests/unit/h3-034-posture-adjudication.test.ts tests/unit/h3-040-posture-adjudication.test.ts tests/unit/h3-035-posture-adjudication.test.ts tests/unit/mh-03-transport-rls.test.ts tests/unit/mh-06-apply-marshal.test.ts` → **182/182 passed**.
- `npx vitest run tests/unit/h3-034-… tests/unit/mh-04-… tests/unit/mh-05-… tests/unit/h3-088-… tests/unit/p08-…` → **177/177 passed**.
- `npx tsc --noEmit` → clean (0 errors).
- E2E: not executed here (requires the applied migration + live project; the case types-skips by design until the coordinator applies — see Remaining Work).

## Security Validation

- **Least privilege**: SELECT-only, one table, one policy, authenticated only. No write privilege or policy of any kind; no anon/PUBLIC privilege; service_role path unchanged.
- **Predicate hygiene (J-005/J-006)**: actor re-derived inside the predicate from `auth.uid()`; no legacy domain helper, no domain role name literal, no client-trusted value, no hard-coded tenant. Domain-neutrality guard verified: **0 violations in both T-D SQL files** (see Known Risks for T-C's concurrent-file failures).
- **Fail-closed apply**: the migration's DO-block guard rejects any landing posture that deviates from the declaration; the posture JSON's `verificationGuard` mirrors this contract.
- **Rollback safety**: exact inverse; restores the zero-policy invariant with its own guard; never disables RLS; never resurrects the banned campus-wide FOR ALL policy.
- **Revoked/expired access** (AGENTS §31): a revoked/expired JWT degrades to anon → zero privileges → zero rows. A non-assigned authenticated actor sees zero rows.

## Known Risks (honesty law — all recorded, none hidden)

1. **Scope deviation from the J-005 tenant-equality exemplar**: the policy is **identity-scoped** (`driver_id = auth.uid()`), not tenant-scoped. This is a substrate constraint, not a preference: no neutral tenant reference exists on the table, the live neutral substrate holds zero bindings for real sessions, and the legacy helper class is banned. Recorded in the posture JSON's `policyScopeDeviation` (with `conversionPath`) and in the migration header. Consequence: cross-campus visibility is gated by assignment data integrity, not by tenant equality.
2. **Battery §4.4 cross-tenant probe recipe is UNDECLARED by construction**: the table's campus key is a uuid FK into a legacy domain table, and the battery's `probeAuxTables` mechanism is restricted to the `cg_` namespace; a legal `probeInsertPayload` recipe cannot be declared without inventing schema. Post-apply the battery will report `CROSS_TENANT_PROBE_STAGE_NOT_DECLARED` for this entry — recorded honestly in the posture JSON's `probeRecipeNote`. The post-apply proof paths are the battery catalog/privilege/anon-deny sections + the driver e2e case + the predicate argument. A runnable §4.4-class probe requires the neutral-substrate conversion (future mission).
3. **Ratchet-test ownership deviation (documented, bounded)**: the mission named h3-031/h3-034 as the transport posture pins; discovery showed the real zero-policy pins for `transport_buses` live in `h3-040` and in `mh-03`'s battery-steward adoption contract. Since the posture JSON is T-D-owned and those tests pin it, both were updated to follow the posture change (h3-040: 2 pins; mh-03: the posture-contract section only — its 20261002000014 content pins are untouched). h3-031/h3-034 were extended append-only as instructed.
4. **Domain-neutrality guard FAILS with 19 violations — all from T-C's concurrent `20261003000040_coregrid_school_media_bucket.sql` (STORAGE-PROVISION)**. Verified: 0 hits in both T-D SQL files. Pre-existing/concurrent, out of T-D's file ownership; reported to the coordinator for T-C remediation. Not caused by, and not fixable by, this team.
5. **Coordinator actions required post-handoff** (not done here, per ownership): (a) register `20261003000041_coregrid_transport_bus_reads.sql` in `scripts/apply-canonical-hardening.mjs` (mh-06's manifest pins will then need the migration's signature); (b) apply through the checksummed channel; (c) re-run the RLS isolation battery adopting the T-D posture file (expect `CROSS_TENANT_PROBE_STAGE_NOT_DECLARED` for this entry); (d) run `npx playwright test tests/e2e/preview-public-site-card.spec.ts` to observe the driver case lift from typed skip to real pass.
6. **E2E remains typed-skipped until apply** — by design, per mission requirement 4 ("stays a typed skip until the coordinator applies the migration").
7. **Driver UPDATE paths and remaining read families stay denied**: the driver location-push and status UPDATE flows, plus caregiver/admin read families, need their own least-privilege authorization decisions before any policy is authored (posture JSON `consumerImpact`/`conversionPath`). This migration deliberately does not touch them.

## Remaining Work

- Coordinator: register + apply 20261003000041; re-run the RLS isolation battery (live isolation proof — the coordinator's post-apply step); run the driver e2e case to confirm the lift.
- Coordinator: relay the T-C domain-neutrality findings (19 hits, 20261003000040) to team T-C.
- Future mission: neutral-substrate conversion for the legacy transport table (neutral tenant reference + campus→tenant bridge + backfill + declarable §4.4 recipe) to restore the full J-005 tenant-scoped shape.
- Future missions: least-privilege authoring for driver UPDATE paths (location push/status) and the remaining read families — each under its own WHO/WHAT derivation.