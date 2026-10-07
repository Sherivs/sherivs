# DECISION BRIEF — PLATFORM-003 and the two blocked workforce roles (human adjudication required)

Prepared by: JARVIS wave 2 (autonomous, directive-authorized) | 2026-10-07
Governing records: DECISIONS.md #195 (PLATFORM-003, PROPOSED 2026-09-03, UNRATIFIED), #206 (PLATFORM-015), #207 (PLATFORM-016)
Authority note: this brief PROPOSES; it does NOT adjudicate (Constitution §7). The two roles remain frozen observe-only in the V1 workforce scope lock until the owner decides.

## What PLATFORM-003 is

`DECISIONS.md #195 (PLATFORM-003 — Canonical Memory / Knowledge Ownership, D1, D2, P48 projection)` is an OPEN ADR, status PROPOSED since 2026-09-03:

- **P36** (Universal Memory & Knowledge Civilization Engine) would be the single canonical owner of long-term memory and knowledge semantics.
- **P33** (Reality Intelligence Kernel) owns the reality primitives (`cg_entity`/`cg_relationship`/`cg_event`/`cg_observation` + ontology kernel) that memory/knowledge project over.
- **P48** (Civilization Knowledge Graph) would be a derived projection over P33/P36 — not a competing store.
- **P07/P34/P35** would consume through P36's contract; no second memory engine may be constructed.
- Duplication map rows **D1 (memory: phases 07/14/26/33/34/36/48)** and **D2 (knowledge: 33/36/48/14)** are OPEN pending this ADR.
- Status line: "PROPOSED (2026-09-03). Ratification required before P36/P48 implementation."

## Why it blocks two workforce roles

The V1 workforce scope lock (`frontend/src/lib/workforce/role-catalog.ts`, DECISIONS #206) classifies:

- `knowledge_engineer` — REQUIRES_ARCHITECTURAL_DECISION — because its natural canonical owner (P36) has no implemented, ratified owner; its capability surface sits on the open D2 row.
- `memory_systems_engineer` — REQUIRES_ARCHITECTURAL_DECISION — same reason via the open D1 row.

Both are frozen (observe-only) in the scope lock; the machine gate (`npm run verify:workforce`) asserts this. Neither can staff capabilities until this is resolved.

## The §45 scope interplay (important)

Even full ratification of PLATFORM-003 does NOT by itself un-freeze the two roles' implementation scope:

- P36 and P48 are CIVILIZATION-scope phases; P33 is Reality Intelligence (V3, FROZEN under Constitution §45).
- §45 freezes V2/V3/FUTURE scope; un-freezing requires an explicit human authorization record. Ratifying PLATFORM-003 picks the OWNER; it does not authorize IMPLEMENTATION inside the V1 envelope.
- V1 already HAS a governed memory substrate in the intelligence plane (the existing memory store that the recon map recorded as EXISTS-FULL), so any V1 work for these roles would attach to THAT substrate, not to P36.

## Options

- **Option A: ratify PLATFORM-003 as written** (P36 canonical, P33 kernel, P48 projection; P07/P34/P35 as consumers). Consequence for the scope lock: reclassify both roles `REQUIRES_ARCHITECTURAL_DECISION → DEFERRED_BEYOND_V2` (their canonical substrate P36 does not exist in V1), staying frozen. Clean ownership; no V1 change.
- **Option B: ratify PLATFORM-003 AND issue a separate V1-scope authorization** naming the existing intelligence-plane memory store as the V1 memory engineering substrate. Consequence: `memory_systems_engineer` may be reclassified V1 with substrateRefs pointing at the existing memory store + context-assembly modules; `knowledge_engineer` stays deferred (knowledge semantics remain P36-scoped). This requires the explicit owner record — agents may propose, never self-grant (§45).
- **Option C: explicitly defer PLATFORM-003 with a date** (e.g. revisit at V1 completion). Consequence: the two roles stay REQUIRES_ARCHITECTURAL_DECISION and frozen; the D1/D2 duplication rows remain open risk register items. Honest, but the ambiguity persists.

## Recommendation

Decide PLATFORM-003 now — it is the single longest-open PLATFORM ADR blocking workforce classification rows — and, if the memory systems capability is wanted in V1, pair the ratification with an explicit §45 authorization record per Option B. If the owner prefers minimum movement, Option C with a named revisit date is acceptable; the scope lock remains correct either way.

Decision needed from the owner: pick A, B, or C (or override). One line suffices: e.g. "PLATFORM-003: A" or "PLATFORM-003: B + memory role V1 authorized".