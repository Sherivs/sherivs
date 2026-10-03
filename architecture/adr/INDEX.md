# ADR Index

| Field | Value |
|---|---|
| Purpose | Complete, verified index of every Architecture Decision Record in this repository |
| Maintainer | J-094 (ADR Librarian, Squad J — Governance & documentation) |
| Last verified against working tree | 2026-10-03 |
| Canonical template | [TEMPLATE.md](./TEMPLATE.md) — every new ADR MUST follow it |
| Authority | AGENTS.md §4 places Architecture Decisions at governance level 4 (below security invariants, privacy, and the Constitution); §22/§23 (inspect before acting); §38 (large changes require an ADR) |

This index is a record of reality, not intent: an ADR exists here only if its file exists on disk. It is maintained under the honesty law (AGENTS §42): gaps are recorded as gaps, never as entries.

---

## ADR register — `architecture/adr/`

The H3-wave ADR directory. Next free number here: **ADR-012**.

| # | File | Title | Status | Date | Gist |
|---|---|---|---|---|---|
| 011 | [ADR-011_BACKUP_EXPIRY_DISCIPLINE.md](./ADR-011_BACKUP_EXPIRY_DISCIPLINE.md) | Backup-Expiry Discipline — Erasure Reaches Backups Through Time, Never Through Mutation (J-042) | PROPOSED | 2026-10-03 | Backups are bounded-lifetime redundant copies: manifest-bound `expiresAt` ≤ the earliest retention deadline among contained personal-data families (binding ADR-008's B-1..B-4); flat TTLs forbidden; backups read through the redaction layer; restore re-applies redaction state; expired-copy destruction ruled non-destruction. Closes ADR-005 UNKNOWN 4 and binds the discipline ADR-008 recorded as a standalone ruling. |

## ADR register — `architecture/coregrid-mvp-architecture/adr/`

The wave-1 / wave-2 governance corpus. These files are the authoritative records for their rulings; they are indexed here for completeness but are NOT relocated into `architecture/adr/` (no destructive refactoring — AGENTS §39; citations elsewhere in the corpus point at these paths).

| # | File | Title | Status | Date | Gist |
|---|---|---|---|---|---|
| 001 | [ADR-001_TENANT_ID_TYPE.md](../coregrid-mvp-architecture/adr/ADR-001_TENANT_ID_TYPE.md) | Canonical Tenant Identifier Type (text vs uuid) — COND-003 Ruling Dossier | PROPOSED | 2026-10-01 | Recommends opaque `text` (`tenant_ref`, CHECK length 1..128) as the canonical tenant identifier across the `cg_*` substrate, with an additive `cg_tenant_ref` bridge table restoring declarative integrity to `cg_tenant.id uuid`; no applied migration rewritten. Closes COND-003; unblocks MISSION-R-20. |
| 002 | [ADR-002_TRUST_WIRING.md](../coregrid-mvp-architecture/adr/ADR-002_TRUST_WIRING.md) | Trust-Fabric Wiring — Phase 08 Consumes Phase 09 vs Phase 09 Evidence-Only Re-scope | PROPOSED | 2026-10-01 | Rules Option A: wire phase 08 (security engine) to consume phase 09 (trust fabric) so every authorization decision is derived from trust evidence — fail-closed on stale/revoked evidence, decision citations mandatory; implemented by MISSION-R-83. Closes J-008/D7 (COND-007). |
| 003 | [ADR-003_GLOBAL_SHELL_OWNERSHIP.md](../coregrid-mvp-architecture/adr/ADR-003_GLOBAL_SHELL_OWNERSHIP.md) | Global Application Shell Ownership (GAP-008) | PROPOSED | 2026-10-01 | Rules platform-owned shell (phase 24) with runtime content admitted only through the neutral registry; shell is presentation, not policy (AGENTS §34). Superseded-in-part by ADR-010, which is the resolution ruling J-047 requires. |
| 004 | [ADR-004_RELOCATION_TIMING.md](../coregrid-mvp-architecture/adr/ADR-004_RELOCATION_TIMING.md) | Domain Server-Function Relocation Timing and Namespace (COND-013) | PROPOSED | 2026-10-01 | Rules timing T-C (neutrality-guard baseline first, mechanical relocation of ~15 domain server functions in wave 3 by MISSION-R-121 with §27 invariant suites added) and a two-way namespace split: domain functions → `lib/runtime/scholar/`, Control-Plane modules → `lib/platform/`. |
| 005 | [ADR-005_RETENTION_VS_IMMUTABLE_AUDIT.md](../coregrid-mvp-architecture/adr/ADR-005_RETENTION_VS_IMMUTABLE_AUDIT.md) | Personal-Data Retention vs Immutable Audit (J-039 / V1CAP-066) | PROPOSED | 2026-10-01 | Rules redaction-with-tombstone (Option 2) as the V1 erasure mechanism: immutable records are never mutated or deleted; erasure is an append-only audit event; crypto-shredding deferred to a follow-up ADR; aggregation is a downstream analytics discipline only. Reconciles Constitution §19 (privacy) with AGENTS §28 (immutable audit). |
| 008 | [ADR-008_CROSS_TENANT_ERASURE_AND_BACKUP_EXPIRY.md](../coregrid-mvp-architecture/adr/ADR-008_CROSS_TENANT_ERASURE_AND_BACKUP_EXPIRY.md) | Cross-Tenant Erasure Semantics and Backup-Expiry Discipline (J-042 coordination) | PROPOSED | 2026-10-02 | Rules Option 3 hybrid erasure: global-by-request (subject-level request at the governance layer), per-tenant-by-execution (tenant-scoped tombstone events, no cross-tenant data scope); defines the `erasureScope` vocabulary and invariants E-1..E-4 plus backup-expiry invariants B-1..B-4. Closes ADR-005 UNKNOWNs 3 and 4; changes nothing in ADR-005's mechanism. |
| 009 | [ADR-009_CRYPTO_SHRED_DESIGNATION.md](../coregrid-mvp-architecture/adr/ADR-009_CRYPTO_SHRED_DESIGNATION.md) | Crypto-Shred Designation (COND-009 / the biometric shred-class question) | PROPOSED | 2026-10-02 | Rules Option 2: V1 is tombstone-only — no data class is designated crypto-shred-class (the candidate stores a one-way hash while the raw biometric payload sits on a different table under a different policy, and no KMS capability exists); residual risks R-1..R-3 and binding future-designation triggers T-1..T-3 recorded. Closes ADR-005 UNKNOWN #2. |
| 010 | [ADR-010_GLOBAL_SHELL_OWNERSHIP.md](../coregrid-mvp-architecture/adr/ADR-010_GLOBAL_SHELL_OWNERSHIP.md) | Global Shell Ownership Resolution (J-047 / GAP-008) | PROPOSED | 2026-10-02 | Resolution ruling: the platform layer owns the shell; runtimes compose INTO it exclusively through neutral contribution contracts (nav sets, search providers, switcher directory). Supersedes-in-part ADR-003 and authors the minimal ownership artifact (`frontend/src/lib/platform/global-shell.ts` + its test). |

Supporting material (not an ADR, not indexed as a decision): [`CONSISTENCY_NOTE.md`](../coregrid-mvp-architecture/adr/CONSISTENCY_NOTE.md) — the MISSION-R-03 cross-ADR consistency check (ADR-002..005, PROPOSED, 2026-10-01); verdict: no bundle ADR contradicts another, the mission-graph freezeRule, or the Constitution.

## Gap register — numbers referenced but NOT authored

Recorded for accuracy; these numbers MUST NOT be reused silently. A future ADR may adopt one of these numbers only by explicitly superseding this register entry.

| # | Expected subject | Evidence it was referenced | Finding |
|---|---|---|---|
| 006 | Event architecture | `architecture/phase-01-foundation.md` (≈ lines 2213–2214) lists "ADR-006 Event architecture" as planned | **No ADR-006 file exists anywhere in the repository.** The planned decision record was never authored. |
| 007 | Audit architecture | `architecture/phase-01-foundation.md` (≈ lines 2213–2214) lists "ADR-007 Audit architecture" as planned | **No ADR-007 file exists anywhere in the repository.** The planned decision record was never authored. |

Note: `.claude/helpers/adr-compliance.sh` also maps ADR-006/ADR-007 to titles ("Unified memory service", "Event sourcing for state") that belong to a foreign toolset, not the CoreGrid corpus; its mapping is not authoritative for this index.

## Status vocabulary

`PROPOSED` — authored decision dossier; binds only when the operator rules it (every ADR in this repository is currently PROPOSED; operator ratification is the standing gate recorded in each file's Status field and UNKNOWNs).

`APPROVED` — ruled by the operator (record it in the ADR's Status field and here when it happens).

`SUPERSEDED` — replaced by a newer ADR (the superseding ADR's `Supersedes-in-part`/`Supersedes` field names it; the entry here must keep pointing to the old file for provenance, marked superseded).

`REJECTED` — a decision dossier whose recommendation was ruled down (keep the file; the reasoning is evidence).

## Maintenance rules (for future ADR authors)

1. Follow [TEMPLATE.md](./TEMPLATE.md) exactly — metadata table first, then Context / Options (each with honest Consequences) / Recommendation / Golden Questions (AGENTS §43: WHO / WHAT / WHERE / WHY / UNDER WHICH POLICY) / UNKNOWNs.
2. Number sequentially per directory: next free number in `architecture/adr/` is ADR-012; the `coregrid-mvp-architecture/adr/` corpus continues at ADR-012 or beyond only if the operator says where new rulings live — default new ADRs to `architecture/adr/`.
3. Never renumber, rewrite history, or delete an existing ADR (AGENTS §39). A new ADR supersedes; it does not edit its predecessor.
4. Add the new ADR to the register table above in the same change, with number, title, status, date, and a one-line gist — an unindexed ADR is a documentation defect.
5. If a decision closes a gap-register entry, update that entry to point at the ruling.