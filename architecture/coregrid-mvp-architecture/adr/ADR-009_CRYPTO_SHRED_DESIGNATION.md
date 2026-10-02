# ADR-009: Crypto-Shred Designation (COND-009 / the biometric shred-class question)

| Field | Value |
|---|---|
| Status | PROPOSED (operator rules; closes the ADR-005 shred-class UNKNOWN) |
| Date | 2026-10-02 |
| Author | DATA LIFECYCLE ARCHITECT (MISSION H2-10) |
| Mission | MISSION H2-10 (rule the crypto-shred designation question) |
| Capabilities | V1CAP-066 (privacy & retention lifecycle) |
| Hardening refs | L-H-026 (retention/erasure reconciliation contract) |
| Cites | ADR-005_RETENTION_VS_IMMUTABLE_AUDIT.md (UNKNOWN #2: "Whether any data class in V1 is designated crypto-shred-class"); COND-009 (legacy Scholar durable-tables disposition — OPEN per COREGRID_V1_MISSION_GRAPH.json unresolved list); ADR-004_RELOCATION_TIMING.md (leaves table retirement out of scope as a separate governance event); CONSISTENCY_NOTE.md §4; RETENTION_POLICY_SCHEDULE.json (RP-BIOMET-EDU, biometric-reference family, cryptoShredCandidate); AGENTS §17, §19, §28, §39; Constitution §19 |

## Context

ADR-005 ruled redaction-with-tombstone as the V1 erasure mechanism and deferred one question to a follow-up ADR: **whether any V1 data class is designated crypto-shred-class**, naming "teacher biometrics in the orphan legacy tables" as the candidate. COND-009 (legacy Scholar durable-tables disposition) governs that candidate's fate and remains open — the mission graph records that "retirement of orphan tables is a governance event requiring a ruling," and ADR-004 explicitly excludes table retirement from its scope. This ADR resolves the designation question on the strength of a migration-level survey of every biometric-bearing surface in the repository.

**Survey result — biometric-bearing tables (grep of `database/supabase/migrations/*.sql` for `biometric|face_template|face_biometric`; no fingerprint/voice/iris/template columns exist anywhere):**

| # | Surface | Source migration(s) | Stored value | Schedule family / policy | Notes |
|---|---|---|---|---|---|
| 1 | `teacher_biometrics.face_template_hash` (text) | `20260729052237_75252732…sql` **and** `20260729054314_21b2720c…sql` — the table is created twice (`CREATE TABLE IF NOT EXISTS`, orphan duplicate) | A one-way reference hash of the face template, not a raw template (the enrollment path writes simulated `sim_*` values today) | `biometric-reference` / RP-BIOMET-EDU, special-category | RLS enabled with school-isolation policy; `GRANT DELETE` to authenticated. The orphan duplicate-creation is direct evidence of COND-009's open disposition. |
| 2 | `users.face_biometric` (jsonb) + `face_registered_at` + `face_skip_count` | `20260620122048_50e590c2…sql` (CREATE TABLE) + `20260626111823_66d215f2…sql` (ALTER TABLE re-add) | **Raw biometric payload in jsonb** — not a hash | `identity-profile` / RP-IDPRO-EDU, classification `personal` (NOT the biometric-reference family) | Lives on the legacy identity master table, which carries a 1825-day event-triggered retention backstop under RP-IDPRO-EDU. |

The survey changes the shape of the question. There are **two** biometric surfaces, not one, and they are governed by different policies. Designating only `teacher_biometrics` as a shred-class would draw an erasure boundary around a one-way hash while the raw special-category payload in `users.face_biometric` remains outside it — a designation that *looks* like maximal biometric protection but leaves the most sensitive material under the longest-retention, non-biometric policy. Additionally, ADR-005's Option 1 analysis stands unchanged: **no key-management capability is evidenced anywhere in the corpus** (STREAM H shows no KMS family), so a V1 designation has no mechanism to execute.

## Options

### Option 1 — Designate `teacher_biometrics` as the first crypto-shred-class

Set RP-BIOMET-EDU's erasure mechanism to `crypto-shred` (the verify gate permits it: the family already carries `cryptoShredCandidate: true`), update the schedule, and record the operational consequences.

- **Consequences:** the erasure guarantee for biometric *references* would be bit-level rather than policy-level. But: (a) the column stores a one-way hash — crypto-shredding a hash adds little over tombstoning it, since the hash is not the biometric; (b) the raw payload in `users.face_biometric` would remain under RP-IDPRO-EDU, so the designation delivers an incomplete erasure boundary for the special category while implying a complete one; (c) no key-management capability exists — the schedule would declare a mechanism that cannot execute, forcing an immediate silent fallback to tombstone and violating ADR-005's rule that mechanisms "must be decided in the contract, not improvised"; (d) COND-009 is open — the candidate table is an orphan created twice by two migrations, and its disposition (retire / migrate / retain) is a pending governance event that shred designation would presuppose.

### Option 2 — Rule V1 tombstone-only; record residual risk; defer designation with explicit trigger conditions

V1 designates **no** crypto-shred-class. Every family — including `biometric-reference` — erases by tombstone (ADR-005 Option 2) with the redaction layer, RLS deny-by-default (AGENTS §17), and the J-042 backup-expiry discipline as the compensating controls. The candidate flag stays a *candidate*, not a designation. The decision to designate is deferred, but not open-ended: this ADR records binding trigger conditions under which designation becomes mandatory or electable.

- **Consequences:** erasure for special-category data remains policy-level, so raw readers, pre-erasure backups, replicas, and change streams can retain biometric material until backup expiry — a real residual risk, honestly recorded rather than papered over. In exchange: no unexecutable mechanism is declared; no false erasure boundary is drawn around `teacher_biometrics` while `users.face_biometric` sits outside it; and the designation question stays coupled to its actual inputs (COND-009 disposition + a real KMS capability) instead of being answered ahead of them.

## Recommendation

**Option 2 — V1 is tombstone-only; no data class is designated crypto-shred-class.** This closes ADR-005's UNKNOWN #2 with a ruling rather than a deferral: the answer is *no in V1*, and the conditions under which that answer flips are explicit and binding. `RETENTION_POLICY_SCHEDULE.json` is consistent with this ruling as authored — all 28 policies are `tombstone`, `cryptoShredCandidate` on `biometric-reference` marks candidacy only, and the verify gate continues to PASS.

**Residual risks (recorded, owned, not hidden):**

- **R-1 — Policy-level erasure is bypassable below the redaction layer.** Raw database access, pre-erasure backups, read replicas, and change streams retain biometric material after erasure. Mitigations that make this survivable: RLS deny-by-default on every biometric-bearing table (AGENTS §17 — `teacher_biometrics` already carries school-isolation RLS), the J-042 backup-expiry discipline (backups expire on the retention schedule; restore re-applies redaction state), and the realtime-coverage assumption carried in ADR-005's UNKNOWNs.
- **R-2 — The raw biometric surface is outside the biometric-reference family.** `users.face_biometric` (jsonb, raw payload) is governed by RP-IDPRO-EDU (`personal`, 1825-day backstop), not RP-BIOMET-EDU (`special-category`, immediate erasure on consent withdrawal). This is a schedule-consistency finding for the phase 14 schedule owner: the special-category column inside the identity master should be re-declared into a family whose erasure treatment matches its sensitivity. Re-declaration is a phase 14 schedule edit under AGENTS §12 provenance and is deliberately **not** made in this mission (file ownership is the new ADR only; the schedule may change solely for a designation, which did not happen).
- **R-3 — Backups hold biometric material until expiry.** If `teacher_biometrics` survives COND-009 disposition as a durable table, its reference hashes (and `users.face_biometric` payloads) persist in backups until the backup-expiry discipline retires them. Tombstone erasure cannot reach them mechanically — this is the same J-042 gap ADR-005 records, restated for the special category.

**Trigger conditions for future designation (binding on any follow-up ADR; a designation without these is invalid):**

- **T-1 (mandatory designation):** COND-009 is ruled such that any biometric-bearing table is *retained* into the durable substrate (not retired) **and** that table stores raw biometric template material (not a one-way reference hash). When raw templates persist, tombstone-only is no longer an acceptable erasure posture for the special category — the follow-up ADR MUST designate a shred-class before that surface ships new rows.
- **T-2 (mandatory precondition — key management is NOT invented here):** a key-management capability with an owning phase and a provider adapter is *evidenced in the corpus* (a KMS family, per STREAM H's absence), with key backup/restore coordinated against J-042 so backups cannot resurrect destroyed data. No designation may be recorded before T-2 exists — including by operator ruling, because a shred-class without key management is a promise the platform cannot execute.
- **T-3 (elective designation):** an explicit operator ruling per ADR-005 implementation-path step 5 becomes valid only jointly with T-2. Once T-2 holds, the operator MAY designate `biometric-reference` (and any family holding raw biometric material) as a shred-class; the schedule's `cryptoShredCandidate` flag and the verify gate's `CRYPTO_SHRED_NOT_DESIGNATED` check are the mechanical ready-markers.

**If designation ever happens, the operational consequences are (recorded now so the cost is known before T-2/T-3 are exercised):** encryption-at-rest with per-subject or per-data-class keys on every biometric-bearing record; a key ceremony and audited key destruction as the erasure act; decryption plumbing on every reader path; backup/restore that keeps keys and ciphertexts consistent (J-042) or backups resurrect destroyed data; and a new availability failure mode — accidental key loss equals data loss inside the erasure path.

## Golden Questions

- **WHO?** This ADR rules the designation question for V1 (operator accepts); phase 03 owns data classification, phase 14 owns the schedule (and inherits finding R-2), phase 09 owns the audit/immutability boundary, COND-009's ruling owner owns table disposition; the operator owns T-3 and any future shred designation.
- **WHAT?** No V1 data class is crypto-shred-designated; all erasure is tombstone; residual risks R-1/R-2/R-3 are recorded; triggers T-1/T-2/T-3 bind any future designation, and T-2 makes key management a prerequisite the platform does not invent on its own.
- **WHERE?** The mechanism stays in the retention schedule and the redaction layer (ADR-005); the candidate flag stays on `biometric-reference` in `RETENTION_POLICY_SCHEDULE.json`; this ADR is the decision record that the schedule's "pending COND-009" note points to.
- **WHY?** The candidate stores a one-way hash while the raw biometric payload lives on a different table under a different policy — designation would create a false erasure boundary; no KMS capability exists, so the mechanism could not execute; COND-009 disposition is open. Honesty about these facts (Constitution: explainability; AGENTS §19 maximal minimization *with* truthful guarantees) outweighs the appearance of a stronger erasure promise.
- **UNDER WHICH POLICY?** AGENTS §17 (RLS deny-by-default as the compensating control for policy-level erasure), §19 (maximal minimization for special-category data), §28 (immutable audit — untouched; tombstone stands), §39 (no destructive refactoring — this ADR deletes nothing, including the candidate flag); Constitution §19 privacy lifecycle (erasure must be real, and its guarantees must be true); ADR-005 (mechanism authority); COND-009 (disposition authority); V1CAP-066.

## UNKNOWNs

- COND-009's ruling itself (retire / migrate / retain the legacy durable tables) — this ADR consumes its outcome through trigger T-1 but does not rule the disposition; until ruled, `teacher_biometrics` remains an orphan created by two duplicate migrations.
- Whether `users.face_biometric` still receives writes in the live product (generated types and the tier feature flags (`face_biometrics`) suggest a wired surface; the enrollment route writes only `teacher_biometrics`) — phase 14's R-2 re-declaration should confirm actual write paths before re-classifying.
- The KMS capability that T-2 requires — which phase owns key management, which provider adapter carries it, and how key destruction is audited — is unevidenced in the corpus and remains the gating unknown for any future designation.
- Whether backup-expiry discipline (R-3) is mechanically testable in V1 CI without live credentials — inherited from ADR-005's J-041/J-042 UNKNOWN, unresolved here.
- Whether realtime/change-stream coverage (R-1) is mechanically enforced or policy-assumed — inherited from ADR-005's UNKNOWN, unresolved here.