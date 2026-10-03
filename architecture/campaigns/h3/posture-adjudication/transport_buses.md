# RLS Posture Adjudication — `transport_buses`

- **Mission:** D-040 (H3 wave, Squad D — Posture Adjudication Engineer, tool/transport family)
- **Adjudicated posture:** `zero-policy` (RLS enabled, zero policies, client-role privileges revoked, `relforcerowsecurity = false` — the zero-policy INFO convention), normalized by H2-03 and proven live
- **Decision date:** 2026-10-03
- **Applied state:** nothing applied by this mission. This doc records the adjudication only; J-099 merges the rationale into the posture JSONs.

## OWNERSHIP

| Question | Answer |
| --- | --- |
| Created by | `database/supabase/migrations/20260626150625_35a08443-45fd-46ae-807b-3644b44efe26.sql` (legacy domain substrate) — `CREATE TABLE IF NOT EXISTS public.transport_buses` with `school_id uuid NOT NULL REFERENCES public.schools(id)`, `driver_id uuid REFERENCES public.users(id)`; carried a campus-wide `FOR ALL USING (school_id = public.get_my_school_id() OR public.is_super_admin())` policy (the recorded 2026-09-03 finding) |
| Corrected by | `database/supabase/migrations/20260904010000_coregrid_rls_transport_and_grants.sql` — replaced the campus-wide FOR ALL with four scoped policies (`buses_school_read`, `buses_driver_or_admin_update`, `buses_school_admin_insert`, `buses_school_admin_delete`) |
| Normalized to zero-policy by | `database/supabase/migrations/20261002000014_coregrid_v2_transport_buses_rls.sql` (H2-03) — drops every permissive policy, revokes client-role privileges, service-role parity, applies a pg_policies guard that fails the apply if any permissive policy survives; rollback `database/supabase/rollbacks/20261002000014_coregrid_v2_transport_buses_rls.sql` restores the corrected legacy posture verbatim |
| Server paths that write it | `frontend/src/lib/runtime/scholar/demo-provision.functions.ts` — provisioning inserts via `supabaseAdmin` (service-role; lines 312-317); `frontend/src/lib/runtime/scholar/driver-portal.functions.ts` — location/status updates via the signed-in driver's `supabase` client, historically RLS-guarded by `driver_id = auth.uid()` |
| Server paths that read it | `frontend/src/lib/runtime/scholar/driver-portal.functions.ts` (`getMyDriverBus`: `driver_id = userId`, `is_active = true`), `frontend/src/lib/runtime/scholar/bus-tracking.functions.ts` (bus lookups + location/status writes via the authenticated client) |
| Out of scope | `school_transport` — the payments/config family's table, not read by the driver families; holds its own product-decision anon-read policy owned by another mission (per the posture file's `outOfScope`) |

## EVIDENCE

1. **Battery scope, zero-policy:** `transport_buses` is battery-scoped through the declared posture-file path, not the static cg_ registry: `scripts/verify-rls-isolation-battery.mjs` line 876 — "tables declared by posture files outside the cg_ namespace (e.g. transport_buses) are matched by name" (the `CATALOG_TABLE_FILTER` / `declaredNonCg` mechanism, lines 879-899).
2. **Posture declaration:** `scripts/verification/rls-table-postures-transport.json` — `{"name": "transport_buses", "posture": "zero-policy", ...}` with `batteryExpectations.zeroPolicyTables: ["transport_buses"]` and a verification guard stating the declared zero-policy posture is exact, not assumed.
3. **Live canonical proof:** `architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json` entry: `{"table": "transport_buses", "posture": "zero-policy (deny-by-default)", "rlsEnabled": true, "rlsForced": false, "policies": 0, "ok": true}`.
4. **Battery ratification record:** `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md` lines 401-432 — normalization proven live, `VERDICT transport_buses: PASS`; line 451 includes `transport_buses` in the 30-table zero-policy deny-by-default set.
5. **Posture-selection law (from the posture file):** "zero-policy chosen over tenant-scoped because the legacy table carries no neutral tenant reference and its only available scoping predicates are the legacy domain helpers — the predicate class J-005/J-006 bans from the policy layer; deny-by-default is the approved platform posture (RULING-2)."
6. **Mechanical pinning:** `tests/unit/mh-03-transport-rls.test.ts` pins the migration text, the five dropped policies, the revokes, and `batteryExpectations.zeroPolicyTables` equality.

## DECISION

**Zero-policy by design — CONFIRMED for V1**, as normalized by H2-03. The posture file's `consumerImpact` is accepted: driver-family self-scoped reads and caregiver tracking deny at the data plane until the owning mission re-provisions access through neutral tenant-scoped policies; service-role server paths (`supabaseAdmin` provisioning) are unaffected.

## RATIONALE

1. **No neutral tenant reference exists on the substrate.** The legacy table keys on `school_id` (a legacy domain column) — there is no J-005 `tenant_id`. The only scoping predicates available are legacy domain helpers (`get_my_school_id()`, `is_super_admin()`), which J-005/J-006 ban from the policy layer. A policy authored today would either violate the predicate law or scope on a legacy domain notion — both disallowed. Zero-policy deny-by-default (RULING-2) is the approved strongest form and resolves the queued 2026-09-03 finding in its strongest form.
2. **Client-facing reads already have a governed remediation path.** The driver-portal and bus-tracking server functions read through the signed-in user's client, so they are data-plane denials under this posture — an accepted V1 consequence recorded in the posture file, not a silent feature break. Provisioning (the write path) runs via `supabaseAdmin` service-role and is unaffected. No legitimate V1 consumer requires an interim client policy.
3. **Legacy domain posture is not a lawful client authorization layer.** The pre-normalization policies encoded domain role vocabulary (driver/school-admin) directly in the policy layer — exactly the mapping J-006 relocates to `DomainDefinition.roleMappings`. Re-adjudicating back to policy-backed without a neutral substrate would restore the banned pattern.
4. **Realtime consequence is a feature, not a gap:** row visibility follows RLS; zero policies means zero client-visible realtime events for this table (posture file `realtime.expectation`).

## CONSTITUTION SECTIONS

- §13 (multi-tenancy — scoping must use neutral tenant context; the legacy `school_id` keying is precisely why no lawful policy can be authored yet)
- §16 (layered authorization — denies at the data plane; server paths mediate any future access)
- §17 (RLS mandatory — RLS enabled, deny enforced at the database level, apply-time guard makes the posture exact)
- §26 (never trust client-supplied identity/tenant/role — the dropped policies trusted domain-derived context)
- §28 (database law — revocable grants, apply-time pg_policies guard, verbatim rollback)
- §35 (realtime security — zero client-visible events under the declared posture)
- §31 (testing standard — the battery's genuine-denial rule: 401/42501 only; invalid-key is INCONCLUSIVE)

## PROPOSED-POLICY-IF-ANY

**PROPOSED policy direction (direction only — nothing authored, nothing applied):** when the substrate gains a neutral tenant reference, convert `transport_buses` to policy-backed in ONE migration following the `20261002000013_coregrid_v1_neutral_membership_policies.sql` exemplar: FORCE RLS + `SELECT` policy `tenant_id = public.get_my_tenant_id()` for tenant members, INSERT/UPDATE restricted to `is_tenant_admin(tenant_id)` with the driver self-derivation pin (`driver_id = auth.uid()::text`) for location/status updates, DELETE excluded (retire, never erase). This matches the posture file's declared `conversionPath` ("a future policy-backed conversion must introduce a neutral tenant reference on the substrate and author FORCE RLS + declared policies in the same migration; this mission deliberately does not pre-author such policies") and would restore the driver-portal/bus-tracking read surfaces lawfully. Until that substrate change exists, the zero-policy posture stands and no interim policy is authorized.