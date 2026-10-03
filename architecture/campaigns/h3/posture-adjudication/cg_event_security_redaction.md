# Posture Adjudication — `cg_event_security_redaction`

Team: H3-036 (Posture Adjudication Engineer, Squad D — event-security family)
Wave: H3 (2026-10-03). Read-only adjudication; nothing applied.

## OWNERSHIP

- **Creating migration:** `database/supabase/migrations/20261002000006_coregrid_v1_event_security.sql` (§3, `CREATE TABLE IF NOT EXISTS public.cg_event_security_redaction`). Rollback: `database/supabase/rollbacks/20261002000006_coregrid_v1_event_security.sql`.
- **Owning server path:** `frontend/src/lib/adapters/event-security-store.adapter.ts` — persistence adapter of the event-security consumption gate (V1CAP-044 / J-022 / MISSION-R-81). Writes exclusively via `saveEventSecurityRedaction` / `redactionToRow` (append `REDACTION_COLUMNS` audit rows naming `withheld_fields` and `withheld_subject_refs`); reads via `loadRedactions(tenantId)` — all through the server-side gate's injected service-role `EventSecurityDbClient`. No client-facing route touches this table.
- **Policy-layer ownership:** none authored by design — migration §4 `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL ... FROM anon, authenticated`; the H2-04 policy layer deliberately left the table policy-free.

## EVIDENCE

1. `scripts/verification/rls-table-postures-substrate.json` — table entry: `"posture": "zero-policy"`, `"auditAppendOnly": true`, `"clientWritePolicy": "NONE — append-only gate redaction audit (Constitution §28/§19): no client INSERT/UPDATE/DELETE policy is ever authored; withheld-field records are immutable; reads remain service-role only"`.
2. Same file, `batteryExpectations.zeroPolicyTables` includes `cg_event_security_redaction`.
3. `scripts/verify-rls-isolation-battery.mjs` — zero-policy posture proof: RLS on, zero permissive policies, zero anon/authenticated/PUBLIC privileges.
4. Migration header: redaction rows name "the withheld fields and subject refs (withheld, not deleted — the original event is untouched)"; migration §4 denies all client privileges at the privilege layer.
5. Adapter surface: redaction writes are append-only ("Append one gate redaction audit row"); no update/delete operation exists in the owning path.

## DECISION

**ZERO-POLICY-BY-DESIGN.** Confirmed battery-scoped zero-policy; no client-facing policy is legitimate in V1. No change is proposed; posture remains unchanged deny-by-default.

## RATIONALE

- A redaction record discloses **what was withheld and from whom** — publishing that through any client-readable policy would defeat the redaction itself (an attacker learns exactly which fields exist and are sensitive). This is the §19 AI-privacy/minimization law applied at the delivery plane: minimize what is revealed about the minimization too.
- Append-only audit law (§28): a redaction that could be rewritten or deleted is not tamper-evident. The withheld-fields ledger is the proof that the original event was never silently altered — that property requires zero write policies, permanently.
- The redaction decision is produced by the consumption gate (`deliverEvent` REDACT outcome), the single authorization enforcement point of the event plane. Clients receive already-redacted deliveries; they never receive the redaction metadata (§16: REDACT is a decision outcome whose record is audit, not content).
- Realtime security (§35): broadcast content is gated before delivery; the redaction ledger is the audit of those gates and stays server-side.
- No V1 client path requires it ("reads remain service-role only" per H2-04); deny-by-default is terminal for V1.

## CONSTITUTION SECTIONS

- **§28 DATABASE LAW** — immutable audit records; zero write policies make tampering structurally impossible, not merely discouraged.
- **§19 AI PRIVACY LAW** — minimization/redaction discipline; the withheld-fields ledger must not become a side channel.
- **§35 REALTIME SECURITY** — never broadcast unauthorized events or their redaction metadata.
- **§16 AUTHORIZATION MODEL** — REDACT is a decision outcome; its record is audit data owned by the gate.
- **§17 DATABASE SECURITY** — RLS-on/zero-policies is the strongest deny-by-default form, battery-proven.

## PROPOSED-POLICY-IF-ANY

**None.** No client-facing policy is legitimate in V1. A future tenant-administrative redaction-review surface (if ever authorized) must be a new, separately adjudicated read-only policy migration using the J-005/J-006 neutral predicate vocabulary, with the withheld-field columns explicitly excluded from the readable projection. Until then, this document records no policy direction.
