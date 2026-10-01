# ADR-004: Domain Server-Function Relocation Timing and Namespace (COND-013)

| Field | Value |
|---|---|
| Status | PROPOSED (operator rules; see Mission MISSION-R-03 humanApprovalsRequired: "relocation-timing ADR acceptance (COND-013)") |
| Date | 2026-10-01 |
| Author | GOVERNANCE ADR AUTHOR (MISSION-R-03, wave 1) |
| Mission | MISSION-R-03 (task T2, second half) |
| Capabilities | V1CAP-085 (mechanical relocation half), V1CAP-067 (domain-neutrality guard) |
| Hardening refs | L-H-023 (extend purity guard to lib root; relocate ~15 domain server functions per this ADR) |
| Blocks | MISSION-R-121 (mechanical relocation, wave 3, blast radius HIGH) may not execute the move until this ADR is accepted |
| Cites | STREAM I I-025/I-027 + unresolved (namespace + import-direction ADR); STREAM H orphan list (~15 `*.functions.ts` modules at lib root) + contradictions; COND-013/COND-009; L-H-023; MISSION-R-05/M-R-05 baseline; MISSION-R-73 (subscription-tiers); AGENTS §27, §14, §39 |

## Context

The universal lib root (`frontend/src/lib/`) — beside tenant-core.ts and authorization.ts — hosts ~15 Scholar server-function modules (STREAM H orphan list): attendance, bus-tracking, driver-portal, facilities, timetable, teachers, school-settings, staff-accounts, profile, org-profile, register-runtime, demo-provision, scholar-feature-access, scholar-institution-config, scholar-role-assignments `.functions.ts`, plus the paystack adapter split, the schoolId-typed audit helper, geofence, and the orphaned `subscription-tiers.ts` (legacy Scholar billing vocabulary). STREAM H's whyAtUniversalLayer: "the repo began as the Scholar app ... server functions were never relocated into the runtime/ or scholar/ namespace."

Two constitutional injuries follow. First, **AGENTS §27**: server functions are APIs and must authenticate / resolve-tenant / authorize / validate / execute / audit — yet STREAM H records that these ~15 modules have no dedicated invariant suites, so their authz posture rests on route-level usage and RLS. Second, **domain neutrality**: universal-layer code carries domain vocabulary, and the kernel-purity enforcement boundary covers kernel + migrations only, not the lib root (STREAM H "GOVERNANCE DOC VS CODE VOCABULARY"). STREAM I adds the adjacent location violation I-025: Control-Plane platform-org modules implemented under `lib/scholar/` — per AGENTS §14 the Control Plane is not a tenant and cannot be owned by a runtime's namespace. I-027 further shows the universal runtime route wired directly to Scholar server functions.

COND-013 requires an ADR on (a) **timing** — when the relocation happens relative to the neutrality-guard baseline — and (b) **namespace** — `lib/platform/` vs `lib/control-plane/` vs `lib/runtime/scholar/`, plus the shell/runtime import direction STREAM I flagged. STREAM H's own caution: "the safest sequence is after the org-model + runtime-registry substrate is applied so runtimes can own their function namespaces."

## Options

### Timing

**T-A — Relocate before the guard baseline exists.** Move the modules first, then record a clean baseline in MISSION-R-05.
- Consequences: a clean baseline with no quarantine list. But it inverts the dependency order the mission graph encodes: the guard (M-R-05, wave 1) is the measuring instrument; relocating before it exists means the ~15 violations are never *recorded* as violations, the mechanical move (M-R-121, wave 3) loses its before/after evidence, and any import-graph breakage during relocation has no guard to catch regressions. Also risks a big-bang move inside the same change as guard introduction — two HIGH-blast-radius changes fused.

**T-B — Relocate only at the end of the program (wave 3+ or never).** Leave the modules in place indefinitely; the guard quarantines them forever.
- Consequences: the universal lib root stays domain-contaminated; every new lib-root module inherits a contaminated neighborhood ("historical growth" repeats); AGENTS §27 invariant testing is deferred indefinitely; the neutrality claim in the registry stays false for server functions. The baseline becomes a museum instead of a ratchet. Rejected — a permanent baseline is the failure mode MISSION-R-05 explicitly guards against ("records current violations as an explicit baseline ... it does not silently pass them").

**T-C — Guard baseline first, relocation in wave 3 after runtime recertification (recommended).** Order: (1) MISSION-R-05 records the baseline including the ~15 server-function violations; (2) MISSION-R-120 recertifies the Scholar runtime against neutral vocabulary; (3) MISSION-R-121 executes the mechanical move, reduces the server-function baseline to zero, and adds §27 invariant suites per function. This matches the mission graph's own dependency edges (M-R-121 depends on M-R-03 and M-R-120) and STREAM H's sequence caution.

### Namespace

**N-A — `lib/platform/`** for Control-Plane modules; domain runtime functions elsewhere.
**N-B — `lib/control-plane/`** as a top-level Control-Plane namespace.
**N-C — `lib/runtime/scholar/`** for everything, including Control-Plane modules (rejected outright by I-025: Control Plane cannot live in a runtime namespace, AGENTS §14).

## Recommendation

**Timing: Option T-C.** The relocation is mechanical but high-blast-radius (every import site changes); it must happen (1) after the guard can measure it, (2) after the runtime namespace exists and is recertified so moved modules land in an owned, neutral-vocabulary home, and (3) as its own mission (M-R-121) so the guard's before/after output is the acceptance evidence. Each relocated function gains its §27 invariant suite in the same change (M-R-121 T2), converting the move into a security improvement, not just a cosmetic one. The baseline is a **ratchet**: M-R-111 and M-R-121 may reduce it; nothing may increase it without a new ADR.

**Namespace: a two-way split, not one namespace.**

1. **Domain runtime server functions → `lib/runtime/scholar/`.** They are Scholar runtime content (RULING-1: education modules are runtime content, not platform), and the namespace already exists with the correct precedent (`frontend/src/lib/runtime/scholar-*.ts` catalog/events/workforce/consumption modules, which STREAM I classifies as properly owned). Relocation there completes a consistent rule: `lib/runtime/<runtime>/` owns runtime-domain code.
2. **Control-Plane modules (`lib/scholar/platform-org/*`) → `lib/platform/`** (I-025's first-named target). This ADR picks `lib/platform/` over `lib/control-plane/` on evidence-weight grounds: STREAM I's correction names "lib/platform/org/" first, the shell ADR (ADR-003) already treats "platform-owned" as the ownership category, and `lib/control-plane/` would invite tenant-shaped sub-namespacing later. `lib/platform/` is the Control Plane's namespace precisely because it is *not* a tenant/runtime.
3. **Import direction rule** (the I-025/I-027 unresolved question): routes may import `lib/platform/` and may import `lib/runtime/<runtime>/` only through runtime-qualified abstractions registered in `installed-runtimes.ts` (per-runtime feature-access adapters, per the I-027 correction); `lib/runtime/<runtime>/` must never import `lib/platform/` or universal kernel modules upward; shell/platform routes must never import a runtime module directly. This keeps Domain ↓ Application ↓ Policy ↓ Infrastructure direction intact (AGENTS §24).
4. **Disposition of stragglers follows their classification**: `subscription-tiers.ts` relocates or retires per M-R-73 reconciliation (it is an orphan, not a runtime module); the schoolId-typed audit helper is renamed/neutralized in the same move; geofence and paystack splits follow M-R-73. COND-009 (legacy durable-tables disposition) is explicitly out of scope here — table retirement is a separate governance event.

**Consistency with the neutrality-guard baseline:** this ADR requires the guard baseline (M-R-05) to be recorded **before** any move, and requires M-R-121's verifier to show the server-function violation count at exactly zero afterward (mission graph: "guard output at zero"). ADR-003's shell ruling and this ADR's baseline mechanics are the same ratchet viewed from two surfaces: shell (routes) and lib root.

## Golden Questions

- **WHO?** MISSION-R-121 (Domain Runtime team) executes; phase 24/runtime registry owns the target namespace contract; the operator rules timing (COND-013).
- **WHAT?** ~15 Scholar server-function modules + control-plane org modules + audit helper + paystack/geofence/subscription-tiers stragglers, moved into owned namespaces with §27 invariant suites added.
- **WHERE?** Domain functions → `lib/runtime/scholar/`; Control-Plane modules → `lib/platform/`; universal lib root retains zero domain modules.
- **WHY?** AGENTS §27 (server functions are APIs, currently unproven per-function), §1/§39 (lib root is universal layer; contamination is documented, not hypothetical), L-H-023, J-037 guard program.
- **UNDER WHICH POLICY?** AGENTS §14 (Control Plane not a tenant), §24 (layer direction), §27, §39 (no destructive refactoring: relocation is a move with import-graph proof, not deletion); RULING-1; COND-009/COND-013 boundaries.

## UNKNOWNs

- Whether any of the ~15 modules are imported by other runtimes-in-waiting or tests in ways that assume lib-root paths — the import-graph proof (M-R-121 T1) must enumerate every import site before the move; count unknown today.
- Final disposition of `subscription-tiers.ts` (relocate vs retire) belongs to M-R-73's reconciliation, not this ADR; this ADR only forbids leaving it at the lib root.
- Whether the `lib/control-plane/` spelling is ever needed as a distinct namespace from `lib/platform/` — deferred; if the Control Plane grows runtime-adjacent tooling, a follow-up ADR may subdivide `lib/platform/`.
- Exhaustive domain-token list for the guard's lib-root scan is M-R-05's deliverable (derived from STREAM I's token list); this ADR assumes the scan classifies `*.functions.ts` modules at lib root as violations.
