# GOV-P63-DEFER-MINIMIZE — Ratification Packet (Launch Criterion APPLICATION)

| Field | Value |
|---|---|
| Artifact | Ratification packet for launch-gate `GOV-P63-DEFER-MINIMIZE` (Squad E, mission E-045) |
| Status | PROPOSED — awaits operator ratification (this packet decides nothing by itself) |
| Date | 2026-10-03 |
| Author | H3-045, RATIFICATION ENGINEER (GOV-P63), CoreGrid H3 wave — agent-authored; per AGENTS §7/§12 this packet is AI-generated provenance and is untrusted until the operator's ratification record exists |
| Gate owner of record | `GOV-P63-DEFER-MINIMIZE` — resolution law in `scripts/verify-launch-criteria.mjs` (`resolveGateRecord`, lines 816–831) |
| Criterion owned | `APPLICATION` — "Can useful internal applications be created?" (`COREGRID_V1_LAUNCH_CRITERIA.json`, current: `NO — application builder not started (V1-minimal required)`) |
| Cites | V5.3 Part 63 (`part63OrderCorrections.deferOrMinimize`) and Part 5 golden rule, recorded in `architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_MASTER_IMPLEMENTATION_PLAN.json`; V5.3 Part 5 in `architecture/coregrid-mvp-architecture/COREGRID-V1.md` §2; Part 53 launch definition and Part 74 acceptance standard (`COREGRID_V1_LAUNCH_CRITERIA.json`); `COREGRID_V1_SCOPE_LOCK.json` v1Allowed (`application-builder-minimal`); `COREGRID_V1_CAPABILITY_CATALOG.json` (area `application-builder`); AGENTS §5, §7, §12, §21, §34, §38, §40, §43, §45; H3-WAVE-CAMPAIGN.md Squad E |
| Excluded from scope | The V2/V3/FUTURE frozen layers (AGENTS §45) — this packet concerns an ACTIVE-V1 area only and never authorizes frozen scope |

## Context

The V1 launch harness (`scripts/verify-launch-criteria.mjs`, mission H2-15) evaluates 18 criteria with three honest verdicts: `proven`, `blocked`, `unproven` — `blocked` is NOT failed; `unproven` is the failure state. `APPLICATION` is one of the `verdictMode: "gated"` criteria: its substrate checks are evaluated live, and a `blocked` verdict is granted only if the named external gate **resolves to a recorded entry**. The harness refuses to invent gates.

**Observed evidence (every claim below is file-verified in the working tree, 2026-10-03):**

1. **The deferral is a recorded CTO sequencing decision, not an improvisation.** `COREGRID_V1_MASTER_IMPLEMENTATION_PLAN.json` (mechanism: "V5.3 Part 80 (PLAN MODE output) + Part 63 (build order, dependency-corrected)") records under `part63OrderCorrections.deferOrMinimize`: *"application builder (21), metering (29), broad integrations (28), memory (16) — V1-minimal or post-launch per V5.3 Part 5 golden rule."*
2. **The golden rule the deferral appeals to is canonical.** `COREGRID-V1.md` §2: "DO NOT BUILD FUTURE COMPLEXITY EARLY" (V5.3 Part 5).
3. **The authoring capability is honestly recorded as absent.** `COREGRID_V1_CAPABILITY_CATALOG.json`, area `application-builder`: `status: GAP`, `implementationStatus: NOT_STARTED`, `verificationStatus: NOT_VERIFIED`, `owner: phase-05`, evidence: "no generic builder; scholar/school-builder.ts is domain-specific", missing: "V1-minimal config-driven builder via workspace-engine."
4. **The minimized scope is inside the V1 envelope.** `COREGRID_V1_SCOPE_LOCK.json` lists `application-builder-minimal` in `v1Allowed.areas` — the deferral defers *breadth*, it does not reclassify the area out of V1.
5. **What the runtime substrate IS proven on.** The harness's APPLICATION checks require, and the tree records: `frontend/src/lib/kernel/phase-contracts/phase-05-application-runtime.ts` (Core Application Runtime, `status: "implemented"`), `frontend/src/lib/runtime-core.ts` (header: "Implements `architecture/phase-05-core-application-runtime.md`"), and the runtime suites (`tests/unit/runtime.test.ts`, `runtime-extended.test.ts` et al.). The command/query/event/outbox/jobs/webhooks substrate applications would run on exists and is tested offline.
6. **The gate resolution law is mechanical and unfakeable.** `resolveGateRecord` returns ok only if the master plan's `deferOrMinimize` string includes "application builder"; an unreadable plan, a reworded record, or a removed deferral makes the criterion `unproven` (harness exit 1). Conversely, a passing substrate plus a resolved gate yields `blocked` — never `proven`. There is no path by which the runtime substrate alone can be reported as the authoring capability.

## What is deferred / what is minimized

The gate defers or minimizes **one thing only**: the generic **application-builder authoring capability** (master-plan step 21, area owner phase-05) — the mechanism by which an organization *authors* its own internal applications, rather than uses the applications the platform ships.

Precisely:

- **Deferred (the broad form):** a general-purpose application builder (drag-and-drop or schema-studio construction of arbitrary app surfaces). Nothing in V1 builds this, and per the Part 5 golden rule nothing should before launch.
- **Minimized (the V1-minimal residue that stays ACTIVE-V1):** a **config-driven builder via workspace-engine** — the capability catalog's recorded "missing" definition and the scope lock's `application-builder-minimal`. Organization administrators configure application surfaces declaratively (views, projections, forms over entity/workspace records) through existing, already-authorized machinery.
- **NOT deferred and NOT claimed:** the runtime substrate (phase-05, evidence 5) is proven and stays proven. The deferral never retro-claims the authoring capability via the substrate — the harness gate exists precisely to forbid that fold-in.

## Why the gate exists

1. **Anti-fraud on the launch record.** The launch rule (`COREGRID_V1_LAUNCH_CRITERIA.json`): "launch-ready only when every criterion is OPERATIONAL with evidence on a deployed environment — not when code exists." Without the gate, the proven runtime substrate could be (mis)read as satisfying APPLICATION. The gate forces the gap to surface as an explicit `blocked` verdict owned by a named, recorded decision — the harness "refuses to invent gates," so the deferral cannot silently evaporate.
2. **Governance-hierarchy enforcement (AGENTS §4).** A recorded CTO sequencing decision (Part 63) sits above implementation preference. The gate makes the hierarchy machine-checkable: a criterion may only report `blocked` when its in-repo substrate passes AND a recorded gate owns the gap; "a failed substrate with a claimed gate is unproven, not blocked."
3. **Sequencing correctness (Part 63).** The dependency-corrected build order found the application builder to be the classic golden-rule violation risk: high effort, no V1 launch dependency, and it would sit on a substrate already proven. Deferring it pulls scarce effort to the launch-critical spine.
4. **Human-in-the-loop for scope (AGENTS §40, §45).** Whether "V1-minimal" ships pre-launch or the whole capability moves post-launch is an operator disposition, not an agent's. The gate holds the criterion open until a human ratification record exists.

## Options considered

### Option 1 — Ratify MINIMIZE: commit the V1-minimal config-driven builder to the V1 envelope (recommended)

The operator ratifies the Part 63 deferral in its minimized form: `application-builder-minimal` (config-driven, via workspace-engine, phase-05-owned) is scheduled as launch work; the broad builder is post-launch. The gate's terminal state when the minimal builder is built and evidenced is a `proven` APPLICATION criterion (the gate then owns nothing open).

- **Consequences:** the launch record keeps its integrity without a permanent exception; the scope is bounded by the scope lock (`application-builder-minimal`), so the Part 5 ratchet is preserved. Cost: the minimal builder becomes critical-path launch work with an authorization surface of its own (see Residual risk R3).

### Option 2 — Ratify DEFER: accept APPLICATION as blocked-at-launch by recorded governance

The operator ratifies the deferral in full: no builder of any form pre-launch; APPLICATION rides the gate as `blocked` at launch time, like BLK-2/3/4/5 criteria.

- **Consequences:** zero launch-critical-path cost; the harness exits 0 with APPLICATION counted `blocked`, not failed. Cost: the launch record carries a permanent governance exception on one of the 18 criteria, and the platform launches without any organization-authoring surface for internal applications beyond shipped domain configuration — a commercial/fitness-for-purpose risk the operator must own explicitly.

### Option 3 — Rescind: order a general application builder pre-launch (rejected)

Rejecting the Part 63 decision. **Rejected:** violates the V1 golden rule (Part 5, evidence 2) and the recorded CTO sequencing authority; it converts the largest remaining NOT_STARTED area into launch-critical path and recreates exactly the future-complexity-early failure mode the V5.3 profile exists to prevent. Rescission remains the operator's right, but this packet records it as unsound.

### Option 4 — Claim APPLICATION proven on the runtime substrate (rejected — forbidden)

Treat the proven phase-05 substrate as satisfying the criterion. **Rejected:** dishonest and mechanically impossible — the capability catalog records `NOT_STARTED`/`NOT_VERIFIED` (evidence 3), and the harness verdict law (evidence 6) can return at best `blocked` for this criterion. Recorded here only to state that no ratification packet may ever carry it.

## Residual risk (at time of ratification)

- **R1 — Launch-integrity risk if Option 2:** the 18-criterion launch bar ("every criterion OPERATIONAL with evidence") is waived for APPLICATION by recorded exception. If a buyer or auditor reads the launch record, the exception must be discoverable — it is, via this packet and the harness summary, but only if the operator's decision names it.
- **R2 — Deferral-erosion risk:** "V1-minimal or post-launch" is a two-valued commitment. Without an explicit operator choice, teams may drift toward building builder-like features ad hoc under other areas (workspace composition, website builder, domain configuration), silently reconstituting the deferred scope. Ratification (either option) plus the shrink-only posture of the existing guards is the containment.
- **R3 — Authorization-surface risk if Option 1:** a config-driven builder is exactly the class of feature that can become a permission bypass if configuration can express visibility that out-runs policy. Mitigations are standing law and must bind the minimal builder by construction: the UI is not security (AGENTS §34); every builder-served surface is backend-enforced through the existing server-function rule (§27) and RLS (§17); the builder authors *configuration data*, never code, and never a transport path that bypasses phase-08 authorization. Acceptance of Option 1 must include this constraint explicitly.
- **R4 — Canonical-truth risk:** builder-authored configuration must enter the authorization model as data reviewed by the same policy pipeline as any other intent (AGENTS §21), not as operator-equivalent truth. Unratified AI-proposed configurations get REQUIRE_APPROVAL semantics, same as everything else.

## What ratification requires from the operator

The operator (CTO / supreme human authority per DECISIONS.md PLATFORM-012 provenance) is asked to produce ONE recorded decision covering all six:

1. **Choose the disposition** — Option 1 (MINIMIZE: `application-builder-minimal` is launch work) or Option 2 (DEFER: APPLICATION is blocked-at-launch by recorded exception). Option 3/4 are recorded as rejected and require a new packet if revived.
2. **If Option 1: ratify the minimal boundary in writing** — config-driven only (declarative configuration over the workspace-engine/entity/workspace substrate), no code authoring, no custom execution surface, no authorization bypass; domain-neutral vocabulary only.
3. **Name the owner and the acceptance standard** — owner phase-05 (per the capability catalog); acceptance = the harness's own standard: what concrete evidence proves "useful internal applications can be created" end to end on the deployed environment (Part 53), so the criterion can move to `proven` honestly.
4. **Update the canonical records through their owners** (never via this packet): `COREGRID_V1_MASTER_IMPLEMENTATION_PLAN.json` (schedule), `COREGRID_V1_CAPABILITY_CATALOG.json` (status transitions), `COREGRID_V1_LAUNCH_CRITERIA.json` (current-state string) — coordinator-owned artifacts per campaign law.
5. **Accept the residual risk explicitly** — R1 (if Option 2) or R3/R4 (if Option 1) acknowledged in the decision record.
6. **Record the decision with provenance** — append to `DECISIONS.md` (human-authored ratification, dated, superseding nothing else), so the harness's "recorded governance decision" class keeps a real entry to resolve against.

Absent items 1–6, the gate remains open and the criterion's honest verdict stays `blocked` (substrate passing, gate resolved to the recorded deferral) — which is correct and must not be worked around.

## Decision slot

| Field | Entry |
|---|---|
| Decision (Option 1 / 2 / other) | — |
| Ratified minimal boundary (if Option 1) | — |
| Owner + acceptance standard confirmed | — |
| Residual risk accepted (R1/R2/R3/R4) | — |
| Decision record reference (DECISIONS.md entry) | — |
| Decision-maker (operator) | — |
| Date | — |

## Golden Questions

- **WHO?** The operator (CTO authority) ratifies; phase-05 owns the (minimized) capability; H3-045 authored this packet and owns nothing but it; the launch harness (`scripts/verify-launch-criteria.mjs`) owns the verdict law.
- **WHAT?** The deferral/minimization of the generic application-builder authoring capability, and the authorization of the APPLICATION criterion to report `blocked` (never `proven`) while the gap is owned by the recorded decision.
- **WHERE?** The decision record: `COREGRID_V1_MASTER_IMPLEMENTATION_PLAN.json` `part63OrderCorrections.deferOrMinimize`; the verdict law: `scripts/verify-launch-criteria.mjs`; the scope: `COREGRID_V1_SCOPE_LOCK.json` + `COREGRID_V1_CAPABILITY_CATALOG.json`; this packet: `architecture/campaigns/h3/gov-p63-ratification-packet.md`.
- **WHY?** Part 5 golden rule + Part 63 sequencing (build order correctness), launch-record honesty (Part 74/53), and the constitutional demand that a recorded governance decision — not an agent's preference — owns a launch gap.
- **UNDER WHICH POLICY?** AGENTS §4 (governance hierarchy: recorded decisions above implementation), §5/§7 (agents propose, humans dispose), §12 (provenance — this packet is agent-authored until ratified), §21 (AI output trust), §34 (UI is not security — binds any future minimal builder), §38 (change management), §40 (phase governance), §45 (V1 execution boundary: only `application-builder-minimal` is in the V1 envelope); V5.3 Parts 5, 53, 63, 74, 80.

## UNKNOWNs

- The operator's disposition (the entire point of the decision slot) — until recorded, both Option 1 and Option 2 remain live and no scheduling may assume either.
- The exact acceptance evidence for a `proven` APPLICATION verdict under Option 1 (what "useful internal application created by an organization, end to end, on the deployed environment" concretely demonstrates) — this packet deliberately does not invent it; the operator's item 3 fixes it.
- Interaction with the sister deferrals in the same recorded string (metering (29), broad integrations (28), memory (16)) — this packet rules ONLY the application-builder leg; the others need their own ratification treatment and are out of E-045 ownership.
- Whether the harness gate, after ratification + build-out, should later be re-pointed or retired — that is a harness edit owned by the harness maintainers, not by this packet; the gate stays as-is until then.
