# Posture Adjudication — `cg_event_security_denial`

Team: H3-036 (Posture Adjudication Engineer, Squad D — event-security family)
Wave: H3 (2026-10-03). Read-only adjudication; nothing applied.

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20261002000006_coregrid_v1_event_security.sql` (§2, `CREATE TABLE IF NOT EXISTS public.cg_event_security_denial`). Rollback: `database/supabase/rollbacks/20261002000006_coregrid_v1_event_security.sql`.
- **Owning server path:** `frontend/src/lib/adapters/event-security-store.adapter.ts` — the persistence adapter of the event-security consumption gate (V1CAP-044 / J-022 / MISSION-R-81). Writes go exclusively through `saveEventSecurityDenial` / `denialToRow` (append `DENIAL_COLUMNS` audit rows); reads through `loadDenials(tenantId?)`, both executed by the server-side gate via the injected service-role `EventSecurityDbClient`. No client-facing route reads or writes this table.
- **Policy-layer ownership:** none authored by design — the migration enables RLS and `REVOKE ALL ... FROM anon, authenticated` (migration §4); the H2-04 policy layer (`20261002000015_coregrid_v1_substrate_policies.sql`) deliberately left the table policy-free.

## EVIDENCE

1. `scripts/verification/rls-table-postures-substrate.json` — table entry: `"posture": "zero-policy"`, `"auditAppendOnly": true`, `"clientWritePolicy": "NONE — append-only gate denial audit (Constitution §28): no client INSERT/UPDATE/DELETE policy is ever authored; rows are immutable gate decisions; reads remain service-role only"`.
2. Same file, `batteryExpectations.zeroPolicyTables` includes `cg_event_security_denial` — the battery scope proves RLS enabled + zero permissive policies + zero anon/authenticated privileges for it.
3. `scripts/verify-rls-isolation-battery.mjs` — dual-posture engine (H2-05): for zero-policy tables, `CATALOG_ENFORCEMENT` asserts `relrowsecurity = true` and zero policies; `PRIVILEGES` asserts nothing granted to anon/authenticated/PUBLIC. Zero-policy is the deny-by-default strongest form.
4. Migration §4: `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL` on this table; migration header: "RLS policies: ZERO policies authored (deny-by-default strongest form)".
5. Adapter surface (`EventSecurityStore`): denial writes are append-only ("Append one gate denial audit row. Idempotent, never retried"); there is no update or delete operation anywhere in the owning path.

## DECISION

**ZERO-POLICY-BY-DESIGN.** Confirmed battery-scoped zero-policy; no client-facing policy is legitimate in V1. No change is proposed; posture remains unchanged deny-by-default.

## RATIONALE

- Every row is a gate `DENY` decision — a security surface in itself (who attempted to consume what, why it was refused). Exposing it through any client-facing SELECT policy would leak the security gate's denial telemetry to the very actors it filters (AGENTS §16 authorization vocabulary: DENY records are audit, not content).
- The table is an **append-only audit ledger** (Constitution §28 immutable audit records): no UPDATE/DELETE policy or privilege may ever be authored, or a denial could be rewritten or erased — destroying the "fail-closed, never silently dropped" guarantee the gate is built on.
- All writes and reads flow through the service-role consumption gate, which is itself the single authorization enforcement point (`deliverEvent`); row-level policies at the client would add a second, weaker gate over data that clients must never touch directly (AGENTS §34: the UI/frontend path is not security).
- The event plane's realtime delivery is already gated per-subscriber before any queueing/routing (AGENTS §35: never broadcast unauthorized events — every denial is a first-class auditable record). A client-readable denial table would invert that posture.
- V1 has no authorized client requirement ("reads remain service-role only" per H2-04); under the layered authorization model, absence of a legitimate client path means absence of a policy — deny-by-default is the correct terminal posture, not an interim one.

## CONSTITUTION SECTIONS

- **§28 DATABASE LAW** — immutable audit records; constraints/database-level guarantees, never application logic alone; the append-only zero-policy posture IS that guarantee here.
- **§35 REALTIME SECURITY** — never broadcast unauthorized events; denials are first-class auditable records, not client-readable state.
- **§16 AUTHORIZATION MODEL** — DENY is a decision outcome whose record is audit data; visibility enforcement belongs to the consumption gate.
- **§17 DATABASE SECURITY** — RLS enabled with zero policies is the strongest deny-by-default form; the battery proves it live.
- **§26 API GOVERNANCE** — never trust client-supplied identity/tenant; no client path exists to trust one from.

## PROPOSED-POLICY-IF-ANY

**None.** No client-facing policy is legitimate in V1; the zero-policy posture is adjudicated as final-by-design for V1. If a future phase ever requires tenant-administrative review of denial history, it must arrive as a new, separately adjudicated policy migration (read-only, tenant-scoped via the J-005/J-006 neutral predicate vocabulary) — never by weakening this posture in place. Until such an authority decision exists, this document records no policy direction.
