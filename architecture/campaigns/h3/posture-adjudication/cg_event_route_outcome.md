# Posture Adjudication — `cg_event_route_outcome`

- Team: H3-037 (Posture Adjudication Engineer, routing/evidence family, Squad D)
- Mission: D-037 (H3 wave campaign, `architecture/campaigns/H3-WAVE-CAMPAIGN.md`)
- Date: 2026-10-03
- Adjudication type: ZERO-POLICY-BY-DESIGN (append-only audit surface; no policy proposed)

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20261002000007_coregrid_v1_event_routing.sql` (§4, `CREATE TABLE IF NOT EXISTS public.cg_event_route_outcome`; append-only routing outcome audit — one row per event × subscription evaluation with the closed outcome vocabulary `queued | denied | duplicate | late | overload | suspended`, the gate's denial record, the gated delivery, and the backpressure record; **NO foreign key to the subscription** so the audit trail survives unsubscribe).
- **Rollback:** `database/supabase/rollbacks/20261002000007_coregrid_v1_event_routing.sql`.
- **Writing server path:** the service-role substrate adapter `frontend/src/lib/adapters/event-routing-store.adapter.ts` — exports `EVENT_ROUTE_OUTCOME_TABLE = "cg_event_route_outcome"`, appends via `saveOutcomes` with a deterministic content-derived id (`outcomeId` = `eout:` + sha256 of the canonical outcome JSON, making duplicate appends idempotent no-ops). The adapter implements the pure contract `frontend/src/lib/kernel/event-routing.ts` (V1CAP-043 / J-021 / MISSION-R-63).
- **Reading server path:** the same adapter (`loadOutcomes` — outcome audit trail for one subscription). No client-facing read path exists in V1; consumers are the adapter suite and the telemetry/failure batteries (`tests/unit/adapter-event-routing-store.test.ts`, `tests/unit/mh-27-substrate-telemetry.test.ts`, `tests/failure/mh-30-failure-battery.test.ts`).
- **rg evidence of writers:** `rg -l "EVENT_ROUTE_OUTCOME_TABLE|cg_event_route_outcome"` resolves to the migration, its rollback, the adapter, the posture registry + battery, the battery ratification doc, and the tests above — no frontend/API route or edge function reads or writes this table directly.

## EVIDENCE

1. **Battery scope (READ-ONLY confirmation).** `node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope` (offline, exit 0, no credentials, no database) reports:
   `cg_event_route_outcome posture=zero-policy forceRls=false policies=0 tenantColumn=n/a source=20261002000007_coregrid_v1_event_routing.sql postureSource=rls-table-postures-substrate.json`
2. **Posture registry entry.** `scripts/verification/rls-table-postures-substrate.json` declares `"name": "cg_event_route_outcome", "posture": "zero-policy"` with `auditAppendOnly: true`, `clientWritePolicy: "NONE — append-only routing outcome audit (Constitution §28): no client INSERT/UPDATE/DELETE policy is ever authored; every evaluation stays an unwritable, unerazable record; reads remain service-role only"`, and rationale "nothing silently dropped means nothing client-rewritable either"; the table appears in `batteryExpectations.zeroPolicyTables` and NOT in `batteryExpectations.policyBackedTables`.
3. **Migration posture.** The source migration §5 enables RLS with ZERO policies and revokes all anon/authenticated privileges for all four routing tables including `cg_event_route_outcome`; the migration's own header declares "ZERO policies authored (deny-by-default strongest form)" and "no UPDATE or DELETE path is authored" for the outcome audit.
4. **Unit test pin.** `tests/unit/h3-037-posture-adjudication.test.ts` asserts this adjudication's internal consistency.

## DECISION

**ZERO-POLICY-BY-DESIGN — upheld, with the strongest tier of justification: this is an append-only audit surface.** The declared posture (RLS enabled, zero policies, zero anon/authenticated privileges) is the correct V1 posture for `cg_event_route_outcome`. No client-facing policy of any command kind is legitimate in V1 and none is proposed.

## RATIONALE

- **Append-only audit law (Constitution §28, per AGENTS).** Every routing evaluation — queued, denied, duplicate, late, overload, suspended — must remain "an unwritable, unerazable record". The migration deliberately omits any FK to the subscription so the audit survives unsubscribe, and the adapter's deterministic `outcomeId` makes re-runs idempotent appends, never rewrites. A client INSERT/UPDATE/DELETE policy would create a tampering surface over the very records whose purpose is tamper-evidence; therefore the absence of every client policy is the security property, not a gap.
- **Nothing silently dropped ⇒ nothing client-rewritable either.** The audit's whole value (observable delivery decisions, denial reasons, backpressure records) depends on integrity: only the service-role router may append. Deny-by-default with zero policies is the strongest-form derivation — no policy expression anywhere can evaluate true, so no identity can read through any transport; reads remain service-role only.
- **No client consumption need in V1.** Subscriber-facing delivery is served by the gated delivery view carried on `cg_event_route_queue` rows / `cg_event_route_subscription` declarations (the policy-backed pair), never by reading the raw outcome audit. Any future "my delivery history" surface belongs behind a §27 server function.
- **`forceRls=false` is correct by posture law** (FORCE cannot strengthen a no-policy posture), and the migration's §5 documents the deliberate absence of policies with the forward law: policies may be authored by a follow-up migration under explicit authorization, never silently.

## CONSTITUTION SECTIONS

- §13 (multi-tenancy: tenant-scoped rows; service-role-only access carries tenant context)
- §16 (layered authorization: client decision is DENY for every command; the operative gate is the zero-policy deny)
- §17 (database security: RLS enabled — enforcement is not application-code-only)
- §26 (API governance: client-supplied identity never reaches this table)
- §28 (database law: immutable audit records — the table's core design purpose)
- §29 (observability: every evaluation observable — with integrity preserved by deny-by-default)
- §35 (realtime security: no unauthorized broadcast; the audit is the proof that nothing was silently dropped)
- §45 (V1 execution boundary)

## PROPOSED-POLICY-IF-ANY

**NONE for V1.** If a future phase authorizes a tenant-facing delivery-audit viewer, the PROPOSED direction is a **read-only, tenant-scoped SELECT policy behind a §27 server function** (tenant filter via `public.get_my_tenant_id()` plus a subscription-ownership predicate), arriving as a follow-up migration + posture JSON update + a battery cross-tenant probe stage. WRITE policies remain permanently prohibited for this table: the append-only audit ledger must never gain a client INSERT/UPDATE/DELETE policy (Constitution §28).