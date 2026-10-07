# DECISION BRIEF — Phase-52 corpus hash drift (human adjudication required)

Prepared by: JARVIS wave 2 (autonomous, directive-authorized) | 2026-10-07
Governing records: DECISIONS.md #206 (PLATFORM-015), #207 (PLATFORM-016)
Authority note: this brief PROPOSES; it does NOT adjudicate (Constitution §7 — agents analyze, recommend, propose; humans own architecture decisions). No artifact was modified or "repaired" by this wave.

## The finding

Phase-52 derived artifacts cite a provenance SHA that matches NO revision of the corpus file that exists in this repository.

| Fact | Value | Evidence |
| --- | --- | --- |
| Cited SHA-256 | `A69A3E74FAA88B78B6FB33C36A499E764F7DE04A2C4B33B20C5795D1084CE286` | `architecture/COREGRID_PHASE_52_RECONCILIATION.md`, `COREGRID_PHASE_52_DECOMPOSITION_MAP.json`, `COREGRID_PHASE_52_CAPABILITY_CATALOG.json`, `COREGRID_PHASE_52_CANONICAL_SURFACE_ALLOCATION.json`, `COREGRID_CAMPAIGN_52_RECOMPOSITION.md`, `COREGRID_MISSION_0001_ENGINEERING_PLAN.md`, `COREGRID_ENGINEERING_RECONCILIATION_AUDIT.md` (×2), and the `source_sha256:` front matter of every file under `architecture/phase-52-extracts/` |
| Cited size | 1,844,342 bytes | same artifacts |
| Actual SHA-256 (working tree) | `7365DA0EAE73B5CB87529EB9F4F6268E93783B3715C2DC535B9537B74F84B7E7` | `sha256sum` 2026-10-07 |
| Actual size | 1,728,535 bytes (−115,807 B, ≈6.3% smaller than cited) | `wc -c` 2026-10-07 |
| Git history of the corpus file | EXACTLY ONE revision ever: `2d9621b` 2026-09-29 "Preserve the Phase 52 source corpus." | `git log --follow -- architecture/phase-52-cross domain and engineering sections` |
| Hash of that one revision | `7365DA0E…` / 1,728,535 B — identical to the working tree | `git show 2d9621b:<file> \| sha256sum` |

Conclusion (observed, not inferred): the extraction pipeline that produced the decomposition map, capability catalog, surface allocation, routing decomposition, and every extract block ran against a byte-sequence that was NEVER preserved in this repository. The preserved file differs from the cited provenance by 115,807 bytes and has never had a revision matching the cited hash.

## Risk containment (why this is not urgent)

- The Campaign-52 receiving record DENIES registering/implementing Phase 52; the corpus and all derived artifacts are frozen reference material.
- Phase 52 is not a canonical phase (`architecture/registry.json` untouched); the routing decomposition shows 4,759 DEFERRED / 466 CONFLICTING records.
- No V1 runtime path consumes Phase-52 content. The risk is DOCUMENTARY (provenance chain of frozen-scope analysis), not behavioral.
- The JARVIS V1 workforce scope lock did NOT extract workforce capabilities from Phase-52 (DECISIONS #206 §c) — nothing built this wave depends on the drifted provenance.

## Adjudication options

- **Option A (recommended): ratify the preserved file as canonical.** The tracked file (`7365DA0E…`/1,728,535 B, commit `2d9621b`) is declared THE canonical Phase-52 corpus. The cited `A69A3E74…` hash is recorded as stale provenance of a non-preserved byte-sequence (erratum note in DECISIONS). Original artifacts are NOT rewritten (§39 no destructive refactoring; extracts keep their front matter as historical record). If the original 1,844,342-byte export can still be located, it may be re-preserved separately in a follow-up — but analysis artifacts are not regenerated unless the owner orders it.
- **Option B: re-preserve the true source.** The owner locates the original export (the byte-sequence that hashes `A69A3E74…`), it is committed, and derived artifacts are regenerated and re-keyed under a new Campaign-52 receiving record. Highest provenance fidelity; highest cost; touches frozen scope.
- **Option C: demote derived artifacts.** All Phase-52 derived artifacts are declared non-canonical reference material; their provenance fields are labeled historical; the corpus is retained as-is. Lowest effort, weakest audit trail.

## Recommendation

Option A. Rationale: contained risk, zero V1 impact, preserves §39, and keeps the human decision to a single ratification. Any regeneration of Phase-52 analysis (Option B) should happen only if the owner also intends to act on Phase-52 content, which remains frozen (§45).

Decision needed from the owner: pick A, B, or C (or override). One line suffices: e.g. "Phase-52 drift: A".