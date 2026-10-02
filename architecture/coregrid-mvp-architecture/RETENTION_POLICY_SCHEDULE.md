# RETENTION_POLICY_SCHEDULE — V1CAP-066 Personal-Data Retention Schedule

| Field | Value |
|---|---|
| Status | ACTIVE SCHEDULE (mechanism per ADR-005; durations are provisional defaults pending operator/legal ruling) |
| Date | 2026-10-02 |
| Author | TEAM 4 (V1 campaign, branch `cursor/p08-foundation-loop-classification-fe86`) |
| Machine-readable artifact | [`RETENTION_POLICY_SCHEDULE.json`](./RETENTION_POLICY_SCHEDULE.json) (schemaVersion 1.0.0) |
| Typed contract | `frontend/src/lib/governance/retention-policy-schedule.ts` |
| Validation gate | `scripts/verify-retention-schedule.mjs` (`node scripts/verify-retention-schedule.mjs`; exit 0 = valid, exit 1 = failure) |
| Authority | ADR-005_RETENTION_VS_IMMUTABLE_AUDIT.md (binding "Retention schedule requirement" on the V1CAP-066 contract); Constitution §19; AGENTS §12, §16, §17, §19, §28 |
| Owners | Phase 03 (tenancy/data classification), phase 14 (retention policy), phase 09 (audit immutability boundary) |

## What this schedule is

ADR-005 resolves the collision between **AGENTS §28 (immutable audit records)** and **Constitution §19 (personal data has a lawful lifecycle)** with **Option 2 — redaction-with-tombstone**: immutable records are never mutated or deleted; erasure appends an erasure audit event and tombstones subject-identifying personal values through a redaction layer. ADR-005 then makes a machine-readable retention schedule **binding on the V1CAP-066 contract**, keyed by **data classification, tenant class, and record family**, each entry carrying:

1. retention duration **or** event-triggered expiry,
2. lawful basis,
3. erasure mechanism (tombstone by default; crypto-shred only where designated),
4. downstream aggregation obligations.

This artifact is that schedule. The JSON file is canonical and machine-readable; this document explains it.

## Structure of the JSON artifact

- `meta` — provenance (who authored, from what authority, when, with what method — AGENTS §12), the validation-gate contract, and the reconciliation model (tombstone/erasure-event mechanics from ADR-005).
- `vocabularies` — the controlled enums: `dataClassification` (`public | internal | restricted | personal | special-category`), `tenantClass` (`education-institution | organization | platform`), `retentionKind` (`duration | event-triggered`), `lawfulBasis`, `erasureMechanism` (`tombstone | crypto-shred`).
- `policies[]` — one entry per (recordFamily, dataClassification, tenantClass) triple. 28 policies cover 12 personal-data-bearing families. Every erasure mechanism in V1 is `tombstone`; **no family is designated crypto-shred in V1** (ADR-005 defers crypto-shredding to a follow-up ADR unless the operator designates a shred class).
- `recordFamilyInventory[]` — the declared inventory of record families that exist in this repository, each with: `personalDataBearing`, `immutable`, a `policyId` reference (mandatory when `personalDataBearing: true`), `cryptoShredCandidate` where relevant, the concrete `tables[]` with their **source migration files** (provenance per AGENTS §12), and the family's `tombstoneInvariant`.

## Record families (as they exist in the repo)

Personal-data-bearing (12): `audit`, `event`, `memory`, `evidence`, `ai-snapshot`, `identity-profile`, `biometric-reference`, `workforce-employment`, `attendance-activity`, `financial`, `communication`, `kernel-object`.

Not personal-data-bearing (1): `governance-config` (tenant/scope/role/worker/config records reference identities but never embed personal values by design). It carries `policyId: null` deliberately — the gate only requires policy references for personal-data-bearing families.

The five ADR-named families map to the repo as:

| ADR family | Repo tables (source migrations cited in the JSON) |
|---|---|
| audit | `cg_memory_access_log`, `cg_execution_history`, `cg_execution_record`, `cg_verification_result`, `audit_logs`, `super_admin_logs`, `attendance_verification_log` |
| event | `cg_event` (append-only, V1CAP-041), `attendance_logs`, `fraud_attempts` |
| memory | `cg_memory_record`, `cg_observation` |
| evidence | `cg_foundation_evidence` |
| AI snapshot | `ai_conversations`, `ai_interaction_log` |

Beyond the ADR's five, inspection of `database/supabase/migrations/` surfaced additional personal-data-bearing families that are declared here: `identity-profile`, `biometric-reference` (`teacher_biometrics`), `workforce-employment`, `attendance-activity`, `financial`, `communication`, and the conservatively-PDB generic `kernel-object` envelopes.

## The V1-minimal gate (ADR-005 binding requirement)

> "Every personal-data-bearing record family must reference a policy ID; records without a policy ID are a validation failure... no new personal-data-bearing record family may ship without declaring at least a default policy — this is the V1-minimal gate."

`scripts/verify-retention-schedule.mjs` enforces exactly this, offline and deterministically (no DB, no network, no wall-clock):

1. Parses and validates the JSON against the Zod schema (mirrored by the typed contract module in `frontend/src/lib/governance/retention-policy-schedule.ts`).
2. For **every** `recordFamilyInventory` entry with `personalDataBearing: true`: the `policyId` must be present and resolve to a policy entry with the same `recordFamily` and a compatible classification. Any miss → **exit 1**.
3. Structural ADR-005 invariants: immutable families may only use the `tombstone` mechanism (never deletion); `crypto-shred` is only valid on entries flagged as designated shred-classes (none exist in V1); policy IDs are unique; vocabulary values are in range.

The gate is currently wired as a standalone script only (see Remaining Work in the authoring report for the verify-chain recommendation).

## Provisional durations — explicit caveat

ADR-005's UNKNOWNs rule that concrete durations are jurisdiction-dependent (education records, child data, staff payroll) and require operator/legal input. Every duration in this schedule is an explicit, marked **provisional default** so that the gate is enforceable today; re-ruling a number is a data edit, never a mechanism change. Special cases carry extra notes: biometric erasure is immediate on consent withdrawal regardless of the backstop; `legal-obligation` retention (payroll, tax/accounting) takes precedence over erasure for the statutory period.

## How to extend

1. Add the new tables' family to `recordFamilyInventory` with `personalDataBearing`, `immutable`, source migrations, and `personalValues`.
2. Add policy entries for every applicable (classification, tenantClass) pairing of that family.
3. Reference the primary policy ID from the inventory entry.
4. Run `node scripts/verify-retention-schedule.mjs` — exit 0 is required. A personal-data-bearing family without a resolvable policy reference fails the build of this artifact by design.