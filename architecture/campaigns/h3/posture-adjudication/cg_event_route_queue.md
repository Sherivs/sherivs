# Posture Adjudication — `cg_event_route_queue`

Team: H3-036 (Posture Adjudication Engineer, Squad D — event-routing family)
Wave: H3 (2026-10-03). Read-only adjudication; nothing applied.

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20261002000007_coregrid_v1_event_routing.sql` (§2, `CREATE TABLE IF NOT EXISTS public.cg_event_route_queue`). Rollback: `database/supabase/rollbacks/20261002000007_coregrid_v1_event_routing.sql`.
- **Owning server path:** `frontend/src/lib/adapters/event-routing-store.adapter.ts` — persistence adapter of the governed event-routing plane (V1CAP-043 / J-021 / MISSION-R-63). `EVENT_ROUTE_QUEUE_TABLE` rows are written by the router via `queueEntryToRow` (one row per enqueued gated delivery, keyed by the event's content+cause digest for dedup) and consumed by the server-side delivery loop through the injected service-role `EventRoutingDbClient`. No client-facing route reads or writes the queue.
- **Policy-layer ownership:** none authored by design — migration §4 `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL ... FROM anon, authenticated` (the sibling `cg_event_route_subscription` is the only policy-backed table of this migration); the H2-04 policy layer deliberately left the queue policy-free.

## EVIDENCE

1. `scripts/verification/rls-table-postures-substrate.json` — table entry: `"posture": "zero-policy"` with rationale "gated delivery state is routing-plane truth owned by the service-role router; tenant-scoped client access not authorized by H2-04 — unchanged deny-by-default".
2. Same file, `batteryExpectations.zeroPolicyTables` includes `cg_event_route_queue`.
3. `scripts/verify-rls-isolation-battery.mjs` — zero-policy posture proof: RLS on, zero permissive policies, zero anon/authenticated/PUBLIC privileges.
4. Migration §4: `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL` on the queue; migration header: queue rows "carry the gated view, never a second copy of the event record" and "RLS policies: ZERO policies authored (deny-by-default strongest form)".
5. Migration header: the routing layer "REUSES deliverEvent as the single authorization enforcement point and never re-implements it" — authorization happens before queueing, not at row exposure.
6. Adapter surface: queue state is internal routing-plane truth (enqueue, bounded undelivered, dedup, cursor advance); no client operation exists in the owning path.

## DECISION

**ZERO-POLICY-BY-DESIGN.** Confirmed battery-scoped zero-policy; no client-facing policy is legitimate in V1. No change is proposed; posture remains unchanged deny-by-default.

## RATIONALE

- The queue is **routing-plane truth**, not a client surface: it holds which subscriber has what undelivered, in what order, gated by which visibility/sensitivity decision. A client-readable queue policy would leak other subscribers' delivery state and the gate's per-row authorization metadata (§16: the gate already decided; the queue merely executes).
- Deliveries are gated by `deliverEvent` **before** enqueueing — the single authorization enforcement point (§35 realtime security: never broadcast unauthorized events). Adding client-facing row policies would create a second, weaker authorization path over already-gated state, in violation of the single-gate composition law the routing migration is built on.
- Queue rows are mutable by nature (pending → delivered, cursor advance, bounded-eviction); a client-facing SELECT policy over mutable gate state invites TOCTOU-style misreadings of delivery state. The adapter's service-role path is the only writer/reader, keeping the state machine closed (§27 server-function rule: authenticate → resolve tenant → authorize → validate → execute → audit → return permitted data — the "return permitted data" step is the gated delivery, not the queue).
- No V1 client path requires queue introspection ("tenant-scoped client access not authorized by H2-04"); subscribers observe delivery through their subscription outcome stream, never the queue. Deny-by-default is terminal for V1.

## CONSTITUTION SECTIONS

- **§35 REALTIME SECURITY** — never broadcast unauthorized events; queue state and its gating metadata stay server-side.
- **§28 DATABASE LAW** — database-level guarantees (RLS on, zero policies, privilege revocation) enforce the closed routing plane, not application discipline alone.
- **§27 SERVER FUNCTION RULE** — permitted data reaches subscribers through the gated delivery path, never through row exposure of internal state.
- **§16 AUTHORIZATION MODEL** — the queue executes decisions already made at the gate; it is not an authorization surface.
- **§17 DATABASE SECURITY** — RLS-on/zero-policies is the strongest deny-by-default form, battery-proven.

## PROPOSED-POLICY-IF-ANY

**None.** No client-facing policy is legitimate in V1. If a future phase requires subscriber-visible delivery diagnostics, they must be derived server-side into a separate, adjudicated read surface — never by authoring a policy on the queue itself. Until then, this document records no policy direction.
