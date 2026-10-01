# ADR-005: Personal-Data Retention vs Immutable Audit (J-039 / V1CAP-066)

| Field | Value |
|---|---|
| Status | PROPOSED (operator rules; see Mission MISSION-R-03 humanApprovalsRequired: "retention/erasure ADR acceptance") |
| Date | 2026-10-01 |
| Author | GOVERNANCE ADR AUTHOR (MISSION-R-03, wave 1) |
| Mission | MISSION-R-03 (task T3) |
| Capabilities | V1CAP-066 (privacy & retention lifecycle) |
| Hardening refs | L-H-026 (retention/erasure reconciliation contract) |
| Cites | STREAM J J-039 + missingFromCtoList + inflationWarnings (G-088 rejection); STREAM H hardening JSON L-H-026 and erasureVsImmutableAudit note; COREGRID_V1_RECONSTRUCTED_ARCHITECTURE.json V1CAP-066 (tombstone security boundary); AGENTS §28, §19, §17; Constitution §19 privacy law per J-039 citation |

## Context

Two constitutional mandates collide for personal data inside audit, event, and memory records:

- **AGENTS §28 (Database Law):** "immutable audit records" — prefer append-only, tamper-evident record-keeping; audit integrity is a security invariant (§17 fabric: enforcement then audit; re-evaluation reads the audit).
- **Constitution §19 privacy law (as carried by J-039):** personal data has a lawful lifecycle — retention bounds, purpose limitation, and erasure when the purpose or lawful basis expires. E-094 adds retention as a data-architecture duty; V1CAP-066's security boundary notes AI snapshots are "redacted per AI privacy pipeline; retention aligned to V1CAP-066" — but the policy does not exist (STREAM H: "the policy itself does not exist; evidence records carry no retention policy").

STREAM J is explicit that this is THE unresolved collision: "the two mandates pull in opposite directions for personal data inside audit/event/memory records, and no artifact resolves the collision." The corpus already fixes the direction at the capability level — V1CAP-066's securityBoundary states "erasure never destroys audit integrity; immutable records are tombstoned, not deleted," and its evidenceOwner names "erasure evidence that preserves audit integrity (tombstone pattern)." STREAM H's hardening note names "crypto-shredding or tenant-scoped redaction layers" as candidate mechanisms that "must be decided in the V1CAP-066 contract, not improvised." This ADR is that decision artifact for V1.

The platform context makes this non-negotiable: CoreGrid is multi-tenant and institutional (schools hold child and staff personal data), agents and AI pipelines write observations/memory/audit continuously, and J-039 records that the 16-fabric list has **no privacy/retention node at all** — without an explicit rule, erasure requests are either impossible (law violation) or performed by deletion (audit violation).

## Options

### Option 1 — Cryptographic erasure (crypto-shredding)

Personal data is stored encrypted (per-subject or per-data-class key); erasure destroys the key. The ciphertext and its audit record remain, but are permanently unreadable.

- **Consequences:** strongest technical erasure guarantee without touching immutable records; the audit trail stays byte-intact, satisfying §28 maximally. Costs: mandatory encryption-at-rest with key management for every personal-data-bearing record (the substrate has no key-management capability evidenced anywhere in the corpus — STREAM H shows no KMS family); key ceremony, backup/restore coordination (J-042 must restore keys and ciphertexts consistently or backups resurrect destroyed data); every reader path needs decryption plumbing. Risk: key loss by accident equals data loss — an availability failure mode introduced into the audit path.

### Option 2 — Redaction-with-tombstone (logical erasure over immutable records)

Immutable records are never mutated or deleted. Erasure appends an erasure event that (a) tombstones the subject's personal-data records — downstream readers and projections render redacted placeholders ("record erased per retention policy <id>") instead of the personal values; (b) records who/when/under which policy authorized the erasure (provenance per AGENTS §12); and (c) leaves non-personal, decision-relevant record structure (event type, tenant, timestamp, decision, policy reference) fully intact. The append-leaning substrate (`cg_event` append-only by design, V1CAP-041) already matches this model.

- **Consequences:** audit integrity is structurally preserved (§28 satisfied — nothing is mutated); erasure itself becomes auditable evidence; no new infrastructure beyond a redaction projection layer + retention policy schema. Costs: redaction is policy-level erasure, not bit-level — any reader that bypasses the redaction layer (raw database access, old backups, pre-existing replicas) can still see personal values; therefore it must be paired with RLS/deny-by-default access to raw records (AGENTS §17, mandatory RLS) and a documented backup-expiry discipline; the erasure completeness guarantee is only as good as the coverage of the redaction layer.

### Option 3 — Aggregation

After the retention window, personal-level records are aggregated into statistics; the individual records are then deletable because only aggregates retain value.

- **Consequences:** legitimate for analytics and reporting surfaces (metering, usage-ledger, attendance statistics) — and the corpus's canon: **AI inference must never overwrite canonical truth** (Constitution §9), so aggregates are Intelligence, never Reality. But aggregation cannot be the general erasure mechanism: audit records exist precisely for their individual decision granularity (AGENTS §16 reconstructibility — Identity + Tenant + Role + ... = Decision); aggregating them destroys the audit function itself. Rejected as a general mechanism; retained as a downstream discipline.

## Recommendation

**Option 2 — redaction-with-tombstone — as the V1-minimal mechanism**, with Option 1 (crypto-shredding) as an optional per-data-class hardening and Option 3 (aggregation) as the mandatory downstream discipline for analytics/AI surfaces. This matches the corpus's own recorded security boundary ("immutable records are tombstoned, not deleted") and is the only mechanism implementable in V1 without inventing an unowned key-management capability.

**What MAY be forgotten (redactable on lawful erasure/retention expiry):**
- Subject-identifying personal values inside audit/event/memory records: names, contact details, biometric references, free-text observations containing personal content, AI snapshot personal content (per the V1CAP-066 AI-snapshot boundary).
- Personal identifiers in memory stores (J-016's persisted memory) and knowledge-graph personal nodes — per the privacy lifecycle, subject to purpose limitation (AGENTS §19: only authorized information reaches AI; expired purpose means redaction there too).

**What may NOT be forgotten (immutable audit must retain):**
- The **fact and shape of the decision or transaction**: that an event occurred, its type, tenant attribution, timestamp/ordering, the actor's *role and relationship structure* (not personal identity values), the policy under which it was decided (AGENTS §16 decision reconstruction), verification results and evidence-class metadata (J-034 family), and the erasure event itself. Decision integrity, tenant attribution, and provenance are not personal data and are load-bearing for §17/§28; they are retained in full.

**Reconciliation mechanism (how both are recorded):** erasure is itself an append-only audit event referencing the tombstoned record IDs, the retention policy ID, the authorizing identity, and the erasure scope. Verification (phase 01 pipeline, per V1CAP-066's verificationOwner) checks the invariant: *for every tombstoned record, the record exists, is non-readable as personal data through the redaction layer, and its erasure event is present and well-formed.* No mutation, no deletion — §28 is satisfied literally.

**Retention schedule requirement (binding on the V1CAP-066 contract, owner phase 03 with 14 and 09):** a machine-readable retention policy schema keyed by data classification (data classification is a Prime Directive input), tenant class, and record family (audit / event / memory / evidence / AI snapshot), each with: retention duration or event-triggered expiry, lawful basis, erasure mechanism (tombstone by default; crypto-shred where designated), and aggregation obligations downstream. Every personal-data-bearing record family must reference a policy ID; records without a policy ID are a validation failure. Until phases 03/14 author the schedule, no new personal-data-bearing record family may ship without declaring at least a default policy — this is the V1-minimal gate.

**V1-minimal implementation path (for the retention contract mission, wave 2+):**
1. Retention policy schema + default policies (phase 03/14 contract artifact).
2. Redaction projection layer + tombstone/erasure event type over the append-only substrate (no schema break; `cg_event` append-only stands).
3. Erasure-invariant check in the verify pipeline (the pipeline is V1CAP-066's verification owner).
4. Backup-expiry discipline statement coordinated with J-042 (backups expire on retention schedule; restore must re-apply redaction state).
5. Crypto-shredding deferred to a follow-up ADR unless the operator designates a data class (e.g. biometrics) as shred-class in V1.

## Golden Questions

- **WHO?** Phase 03 (tenancy/data classification) owns with phase 14 (retention policy) and phase 09 (audit immutability boundary); the operator rules this ADR; erasure actions are authorized, audited operations (never silent).
- **WHAT?** Personal values may be redacted-with-tombstone; decision facts, tenant attribution, provenance, and the erasure record itself may never be forgotten.
- **WHERE?** Retention policy schema in the data-classification layer; redaction at the projection/reader layer; erasure events in the append-only audit substrate; invariant check in the verify pipeline.
- **WHY?** Constitution §19 privacy law and E-094 retention duties vs AGENTS §28 immutable audit — the collision is real, documented (J-039, L-H-026), and currently unresolved; a platform holding child and staff data cannot operate legitimately without the rule.
- **UNDER WHICH POLICY?** AGENTS §12 (provenance of erasure), §16 (decision reconstruction survives erasure), §17 (RLS deny-by-default covers raw personal data), §19 (AI receives only authorized, unexpired data), §21 (AI output untrusted; erasure of AI snapshots), §28 (immutable audit), §31 (security tests must prove the erasure invariant); J-039; V1CAP-066 boundary; G-088 rejection (no observation-level machinery, but the privacy RULE stands).

## UNKNOWNs

- The concrete retention durations per data class (jurisdiction-dependent: education records, child data, staff payroll) — requires operator/legal input; this ADR rules the *mechanism*, not the numbers; the phase 14 schedule carries them.
- Whether any data class in V1 is designated crypto-shred-class (e.g. teacher biometrics in the orphan legacy tables) — depends on COND-009 (legacy durable-tables disposition), which this ADR does not resolve.
- Cross-tenant erasure semantics: whether a subject spanning multiple tenants (e.g. a staff member at two schools) is erased per-tenant or globally — depends on the tenant_id type ruling (COND-003) and identity model; flagged for the V1CAP-066 contract.
- Interaction with J-042 backups: the guarantee "erasure reaches backups" is stated as expiry discipline, not mechanical proof; whether restore-time re-redaction is testable in V1 CI without live credentials (J-041 issue) is open.
- Whether the redaction layer must also cover read replicas or change streams (realtime security, AGENTS §35) — assumed yes by policy; mechanical coverage is unverified in the corpus.
