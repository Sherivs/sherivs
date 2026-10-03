# Posture Adjudication — `cg_event_route_cursor`

- Team: H3-037 (Posture Adjudication Engineer, routing/evidence family, Squad D)
- Mission: D-037 (H3 wave campaign, `architecture/campaigns/H3-WAVE-CAMPAIGN.md`)
- Date: 2026-10-03
- Adjudication type: ZERO-POLICY-BY-DESIGN (no policy proposed)

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20261002000007_coregrid_v1_event_routing.sql` (§3, `CREATE TABLE IF NOT EXISTS public.cg_event_route_cursor`; one-way delivery frontier per subscription — `last_event_ref`, `delivered_count`, composite FK `(subscription_id, tenant_id) → cg_event_route_subscription(id, tenant_id) ON DELETE CASCADE`).
- **Rollback:** `database/supabase/rollbacks/20261002000007_coregrid_v1_event_routing.sql`.
- **Writing server path:** the service-role substrate adapter `frontend/src/lib/adapters/event-routing-store.adapter.ts` — the ONLY place DB calls for this table appear (Constitution §24/§25). It exports `EVENT_ROUTE_CURSOR_TABLE = "cg_event_route_cursor"`, maps rows via `cursorToRow`, and persists the router's own frontier as subscriptions are delivered. The adapter implements the pure contract `frontend/src/lib/kernel/event-routing.ts` (V1CAP-043 / J-021 / MISSION-R-63).
- **Reading server path:** the same adapter (`loadCursor`/cursor reads for routing decisions). No client-facing read path exists in V1; current consumers are the adapter suite and the substrate-telemetry/failure batteries (`tests/unit/adapter-event-routing-store.test.ts`, `tests/unit/mh-27-substrate-telemetry.test.ts`, `tests/failure/mh-30-failure-battery.test.ts`).
- **rg evidence of writers:** `rg -l "EVENT_ROUTE_CURSOR_TABLE|cg_event_route_cursor"` resolves to the migration, its rollback, the adapter, the battery/posture registry, the battery ratification doc, and the tests above — no frontend/API route or edge function reads or writes this table directly.

## EVIDENCE

1. **Battery scope (READ-ONLY confirmation).** `node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope` (offline, exit 0, no credentials, no database) reports:
   `cg_event_route_cursor posture=zero-policy forceRls=false policies=0 tenantColumn=n/a source=20261002000007_coregrid_v1_event_routing.sql postureSource=rls-table-postures-substrate.json`
2. **Posture registry entry.** `scripts/verification/rls-table-postures-substrate.json` declares `"name": "cg_event_route_cursor", "posture": "zero-policy"` with rationale "one-way delivery frontier is router-owned state; unchanged deny-by-default"; the table also appears in `batteryExpectations.zeroPolicyTables` and NOT in `batteryExpectations.policyBackedTables`.
3. **Migration posture.** The source migration §5 enables RLS with ZERO policies (`ALTER TABLE public.cg_event_route_cursor ENABLE ROW LEVEL SECURITY`) and revokes all anon/authenticated privileges (`REVOKE ALL ... FROM anon, authenticated`), mirroring the substrate deny-by-default convention.
4. **Unit test pin.** `tests/unit/h3-037-posture-adjudication.test.ts` asserts this adjudication's internal consistency (posture JSON entry, battery scope membership, migration text, adapter ownership constants).

## DECISION

**ZERO-POLICY-BY-DESIGN — upheld.** The declared posture (RLS enabled, zero policies, zero anon/authenticated privileges, `forceRls` absent/false) is the correct V1 posture for `cg_event_route_cursor`. No client-facing policy is legitimate in V1 and none is proposed.

## RATIONALE

- **The table is router-owned internal state, not a client surface.** The cursor is the one-way delivery frontier of a subscription: it exists so the router can enforce "delivery never rewinds; a late event is never re-ordered into history" (migration header §3). No tenant actor has a legitimate direct SELECT/INSERT/UPDATE/DELETE against it in V1 — the delivery contract itself (V1CAP-043 / J-021) routes all consumption through server paths that enforce the consumption gate (`deliverEvent`, migration 20261002000006), never direct table reads.
- **Zero policies is the strongest deny-by-default form.** With RLS enabled and zero policies, no policy expression anywhere can evaluate true — no identity can read the table through any transport. The battery's ISOLATION_PROOF section treats this as the strongest-form derivation. `forceRls=false` is correct by posture law: FORCE cannot strengthen a no-policy posture.
- **A client policy would widen, not secure.** Any permissive policy on the cursor would either (a) expose routing-frontier state (a tenant-sensitive platform security datum, Constitution §35) or (b) allow client-written frontier mutation that could rewind delivery history — both violate the contract's fail-closed delivery semantics.
- **V1 scope discipline.** Per campaign law and Constitution §45, policies may be authored later by a follow-up migration under explicit human authorization, never silently (migration §5 states this verbatim).

## CONSTITUTION SECTIONS

- §13 (multi-tenancy: every request must have tenant context — tenant_id column + composite FK scope the row; access is service-role only)
- §16 (layered authorization: the decision here is DENY for every client identity; service-role is the sanctioned server path)
- §17 (database security: RLS is enabled — application code is not the only layer; the layer that IS operative is the zero-policy deny)
- §26 (API governance: never trust client-supplied identity/tenant — no client path exists to assert one)
- §28 (database law: prefer constraints/transactions/immutable audit — cursor state is constraint-gated and machine-owned)
- §35 (realtime security: routing/frontier state is tenant-sensitive platform security data; no unauthorized broadcast surface)
- §45 (V1 execution boundary: no V2 routing capability is implemented or implied by this adjudication)

## PROPOSED-POLICY-IF-ANY

**NONE for V1.** If a future phase (post-V1, explicit human authorization required) introduces a tenant-facing "delivery inspection" surface, the PROPOSED direction is a **server-function-mediated read contract** (§27 server function: authenticate → resolve tenant → authorize → validate → execute → audit → return permitted data), NOT a direct client RLS policy on this table. Any such change must (a) arrive as a follow-up migration plus an updated posture JSON entry, (b) extend the battery with a data-declared cross-tenant probe stage before becoming policy-backed, and (c) never permit frontier rewind (an UPDATE policy on `last_event_ref`/`delivered_count` remains prohibited by contract law).