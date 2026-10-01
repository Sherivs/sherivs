# ADR-002: Trust-Fabric Wiring — Phase 08 Consumes Phase 09 vs Phase 09 Evidence-Only Re-scope

| Field | Value |
|---|---|
| Status | PROPOSED (operator rules; see Mission MISSION-R-03 humanApprovalsRequired: "operator acceptance of trust-wiring direction (COND-007)") |
| Date | 2026-10-01 |
| Author | GOVERNANCE ADR AUTHOR (MISSION-R-03, wave 1) |
| Mission | MISSION-R-03 (task T1) |
| Capabilities | V1CAP-022 (trust wiring), V1CAP-085 adjacency |
| Hardening refs | D7 cluster (STREAM F), L-H-026 not applicable here |
| Blocks | MISSION-R-83 (wave 2, blast radius HIGH) may not start implementation until this ADR is accepted |
| Cites | STREAM F D7 + phase 09 contradiction line; STREAM J J-008; COND-007 in COREGRID_V1_V2_SCOPE_LOCK.json; COREGRID_V1_RECONSTRUCTED_ARCHITECTURE.json V1CAP-022 contract |

## Context

STREAM F records contradiction D7 (security-trust cluster, phases 08/09/42/51): "Phase 09 closure records 'Phase 08 does not consume the fabric (zero import sites)' while D7 and both phases' V1 status imply 08 should consume 09 — V1 wiring duty, not a scope dispute." Phase 09 (trust fabric) owns the Evidence and Verification loop nodes: trust assertions with evidence-backed state machines, revocation, provenance, `cg_foundation_evidence` and verification-result machinery — all implemented and verified. Phase 08 (security engine) owns runtime authorization (`authorization.ts`) but has **zero import sites** from phase 09.

STREAM J gap **J-008** (major) makes this a V1 reconciliation duty: "trust assertions with evidence-backed state machines exist (verified) but the runtime authorization authority does not import them, so Evidence -> Decision in the loop is **asserted, not derived**." Either wire it, or formally record 09 as evidence/verification-only owner; both close the D7 contradiction, and one is structurally required before scope lock.

The loop node at stake is **Evidence -> Decision**: security decisions (ALLOW / DENY / REDACT / ESCALATE / REQUIRE_APPROVAL per AGENTS §16) must be *derived* from trust evidence — revocation, staleness, verification results — not *asserted* by a decision function that cannot cite the evidence it relied on. AGENTS §42 ("never claim completion without evidence") and §21 (AI output trust) both presuppose that decisions are grounded in verifiable evidence state.

## Options

### Option A — Phase 08 consumes Phase 09 (wiring)

The security engine imports trust assertions (evidence-backed state machines, revocation, verification results) from the trust fabric and treats them as a mandatory input to every authorization decision. A decision must cite the trust-evidence state it was derived from (e.g. `trace: decision <- evidence_set <- state_machine_version`). Stale or revoked trust evidence flips the decision (this exact property is MISSION-R-83 T2's verifier proof).

**Security consequences:**
- Positive: closes the "asserted, not derived" hole; decisions become auditable against evidence provenance (AGENTS §12); revocation/expiry becomes mechanically effective at decision time instead of relying on whatever the caller passed in.
- Positive: single grounding path — evidence lives in one canonical owner (09), decisions cite it, Verification (42) checks the citation.
- Negative / risk: creates a runtime dependency edge 08 -> 09, which raises the cost of every authorization call (evidence lookup on the hot path) and couples the security engine's availability to the trust fabric's. A bug or outage in 09 now degrades 08 — a fail-safe analysis is required (fail-open is forbidden by AGENTS §17 deny-by-default; the engine must fail **closed** when trust evidence is unavailable or stale).
- Negative / risk: trust-evidence state machines become security-critical infrastructure; their compromise directly forges decisions. They inherit phase 08's threat model (hardened boundary, integrity-protected storage).

### Option B — Phase 09 formally re-scoped as evidence-only

09 remains what it observably is today: an evidence/verification store and state-machine owner with **no consumer contract on the decision path**. The ADR records this as the lawful architecture: Evidence -> Decision grounding is delegated to whatever the decision function declares as its inputs, and 09 is repositioned as the verification-stage fabric (Verification node owner) rather than an input to Decision.

**Security consequences:**
- Positive: no runtime coupling; no hot-path cost; smaller blast radius; phase 08 stays independently deployable.
- Negative: **the Evidence -> Decision loop node stays ungrounded by construction.** Decisions cite nothing; "was this DENY derived from revoked-access evidence?" becomes permanently unanswerable from the record. This is a standing weakening of AGENTS §16 (layered authorization decision must be reconstructible), §12 (provenance), and the mandatory invariant "revoked access fails" (AGENTS §31), which would then be enforced only by whatever ad-hoc check the decision function happens to perform, with no evidence trail.
- Negative: D7 closes only nominally — the contradiction is papered over by redefining the missing wiring as intentional, which is exactly the "code that works but violates CoreGrid architecture" failure mode named in AGENTS §1.
- Note: Option B does **not** remove the trust fabric from the platform; it removes it from the decision path. Verification (loop node owned by 09/42) still uses it. The gap is specific to Decision.

## Recommendation

**Option A — wire phase 08 to consume phase 09**, with three governing constraints that MISSION-R-83 must implement:

1. **Fail-closed**: if trust evidence cannot be resolved or is stale beyond the freshness bound, the decision is DENY/ESCALATE, never ALLOW (AGENTS §17).
2. **Decision citation**: every security decision record must reference the trust-evidence set (IDs + state-machine version) it was derived from, satisfying the reconstructibility duty of AGENTS §16 and the provenance duty of §12.
3. **Revocation proof**: the Evidence -> Decision grounding is verified by the MISSION-R-83 verifier task — "stale/revoked trust evidence flips the decision" is the acceptance property, mapping directly onto AGENTS §31 mandatory invariants (expired access fails, revoked access fails).

Rationale: Option B is cheaper but institutionalizes an ungrounded decision path in the one place the Constitution demands grounding (security). The corpus's own disposition ("08 consumes 09 (recommended)", COND-007) already leans this way; this ADR makes the lean explicit and adds the fail-closed + citation constraints so the wiring does not introduce a new availability or integrity risk.

## Golden Questions

- **WHO?** Phase 08 (security engine) is the consumer; phase 09 (trust fabric) is the canonical evidence owner; phase 42 verifies. Operator rules the direction (COND-007).
- **WHAT?** A mandatory, fail-closed, citation-producing dependency: security decisions derive from trust-evidence state.
- **WHERE?** Runtime authorization path in the phase 08 engine; evidence store and state machines in phase 09; wiring implementation is MISSION-R-83 (wave 2).
- **WHY?** J-008/D7: Evidence -> Decision is asserted, not derived; AGENTS §16/§12/§31 require derived, provenance-carrying, revocation-effective decisions.
- **UNDER WHICH POLICY?** AGENTS §16 (authorization decision model), §12 (data provenance), §17 (deny-by-default), §21 (untrusted AI output via evidence-backed verification), §31 (mandatory invariants); STREAM F D7 disposition; RULING-2 posture.

## UNKNOWNs

- Freshness bound for trust evidence on the hot path (how stale may evidence be before the decision must fail closed) — not specified anywhere in the corpus; MISSION-R-83 must propose it and the operator must ratify it.
- Performance envelope: whether evidence lookups on every decision require caching, and if so, how cache invalidation preserves the revocation invariant (a cache that outlives revocation re-creates the "asserted, not derived" hole).
- Whether phase 42 (verification) consumes the decision-citation records or the raw evidence set — both are defensible; the verification-independence mission (wave 3) should not depend on this ruling.
- Blast-radius detail for MISSION-R-83 (rated HIGH in the mission graph): the exact interface (import surface vs. gateway-style call) is left to the implementing mission; this ADR rules direction, not API shape.
