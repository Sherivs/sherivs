# RUNBOOK — Restore / recovery drill (backup → destroy → restore → verify)

Status: **OPERATIONAL** — the drill has been executed against the canonical project
with VERDICT=PASS (2026-10-02); see
`architecture/coregrid-mvp-architecture/ratification/RESTORE_RECOVERY_RUNBOOK_MR101.md`.
Script: `scripts/restore-recovery-drill.mjs`
Contract: MISSION-R-101 / V1CAP-074 / J-042 — "recovery executed and verified, not
assumed" (E-102 invariant 30, script header `:3–5`).
Authority: AGENTS.md §28 (database law — transactions, immutable audit), §29
(observability), §31 (failure tests); ADR-005_RETENTION_VS_IMMUTABLE_AUDIT
(`architecture/coregrid-mvp-architecture/adr/ADR-005_RETENTION_VS_IMMUTABLE_AUDIT.md`);
ADR-008_CROSS_TENANT_ERASURE_AND_BACKUP_EXPIRY (backup-expiry discipline B-1–B-4);
retention schedule
(`architecture/coregrid-mvp-architecture/RETENTION_POLICY_SCHEDULE.md`).

---

## 1. What the drill is (and is not)

A verified-recovery proof against the canonical environment: it creates a dedicated
synthetic drill table, backs it up with per-row checksums, destroys it, restores it,
and verifies row-level identity plus evidence-store integrity
(`scripts/restore-recovery-drill.mjs:8–27`). It is NOT a platform backup tool — the
production-physical-backup gap is recorded honestly in the ratification runbook §4.

The drill table is `restore_drill_probe` (`:46`), declared
`data_class=synthetic-no-personal-data` — ADR-005 personal-data categories are untouched
by construction (`:90`, and the ADR-005 obligations table in the ratification runbook
§1).

## 2. Preconditions

1. **Exclusive canonical access** — serialized after MISSION-R-100 per the mission
   graph; the header states the drill runs on the exclusive-access law
   (`scripts/restore-recovery-drill.mjs:6–7`). No concurrent canonical apply, battery
   run, or foundation-loop exercise (see `docs/runbooks/canonical-apply.md` §1).
2. **Credential** — `SUPABASE_ACCESS_TOKEN` must be set; absence exits with code 2 and
   nothing runs (`:57–61`).
3. **Transport note** — the drill uses the Management API channel, which needs no CA
   cert. Any FUTURE direct-Postgres restore path MUST derive its `ssl` option from
   `scripts/lib/pg-ssl.mjs` strict TLS policy (`:28–31`), i.e. via
   `scripts/lib/pg-connect.mjs`: strict verification against `COREGRID_DB_CA_CERT` or
   Node's default store, session-pooler fallback for IPv6-only endpoints
   (`scripts/lib/pg-connect.mjs:89–122`), and `COREGRID_DB_INSECURE_TLS=1` remains the
   explicitly logged last resort that must never be used against production
   (`scripts/lib/pg-ssl.mjs:10–15`, `:75–78`). TLS is never weakened automatically
   (`scripts/lib/pg-connect.mjs:91`, `:109`).

Usage:

```
SUPABASE_ACCESS_TOKEN=... node scripts/restore-recovery-drill.mjs [project-ref]
```

(project-ref is argv[2]; default is the canonical ref — `:44–45`.)

## 3. Drill steps (as executed by the script)

| Step | What happens | Cite |
| --- | --- | --- |
| 1 PROVISION | create `public.restore_drill_probe` (RLS enabled, zero policies — deny-by-default posture kept even for a scratch table) and seed 10 synthetic rows across two synthetic tenant tags | `:93–109` |
| 2 BACKUP | export rows through the management channel into a JSON manifest with per-row sha256 checksums and a manifest sha256; write `/opt/cursor/artifacts/restore-drill-backup.json`; fingerprint evidence stores | `:111–137` |
| 3 DESTROY | `DROP TABLE restore_drill_probe` — the ONLY destructive step, scoped to the drill table by construction; confirm absence via `information_schema` | `:139–146` |
| 4 RESTORE | recreate the table and reinsert every row from the manifest in a SINGLE transaction, preserving `id` and `created_at` | `:148–167` |
| 5 VERIFY row identity | recompute per-row sha256 checksums and require set equality with the backup; plus a canary row compared field-by-field (`id`, `tenant_tag`, `created_at`) | `:169–185` |
| 6 VERIFY evidence integrity | fingerprint of `cg_foundation_evidence` / `cg_execution_history` / `cg_verification_result` must be identical before and after the whole drill | `:77–86`, `:187–191` |
| 7 CLEANUP | drop the drill table; confirm count=0; canonical schema ends unchanged | `:193–200` |

VERDICT=PASS requires all four checks true: row-level identity, canary identity,
evidence integrity, cleanup (`:202–203`).

## 4. Exit codes and operator interpretation

| Code | Meaning | Operator action | Cite |
| --- | --- | --- | --- |
| `0` | PASS — recovery executed and verified | archive transcript + results as the mission evidence | `:35`, `:227` |
| `1` | FAIL — any check failed (checksum mismatch, canary mismatch, evidence-store CHANGED, cleanup failed, destroy failed, unexpected row count) | treat as a FINDING: read `/opt/cursor/artifacts/restore-recovery-transcript.log` and `restore-recovery-results.json`; do NOT claim recovery; if a real restore triggered the drill, escalate per `docs/runbooks/incident-lockdown.md` | `:35`, `:116`, `:145`, `:191`, `:227` |
| `2` | `BLOCKED_NO_CREDENTIAL` — `SUPABASE_ACCESS_TOKEN` missing; nothing ran | provision via the approved secrets channel and re-run | `:57–61` |

Artifacts: `/opt/cursor/artifacts/restore-recovery-transcript.log`,
`restore-recovery-results.json` (mission, project ref, drill table, backup path,
`backupManifestSha256`, the four check booleans, verdict — `:206–226`), and
`restore-drill-backup.json`.

## 5. ADR-005 retention / tombstone obligations during restore

ADR-005 fixes the V1 erasure mechanism as **redaction-with-tombstone over immutable
records** (`architecture/coregrid-mvp-architecture/adr/ADR-005_RETENTION_VS_IMMUTABLE_AUDIT.md`;
mechanism summary in `RETENTION_POLICY_SCHEDULE.md`). These obligations are encoded as
runbook requirements — the drill honors them by not touching personal data at all
(`scripts/restore-recovery-drill.mjs:22–27`), and they BIND any future production
restore:

1. **Immutable records are never destroyed** — tombstoned, not deleted (AGENTS §28;
   ADR-005 decision). The drill proves this by fingerprinting
   `cg_foundation_evidence`, `cg_execution_history`, `cg_verification_result` before
   and after (`:77–86`, `:187–191`). During a real restore, never rebuild immutable
   audit families by deletion-and-reinsert; restore around them.
2. **Restores must not resurrect erased personal data** — a backup manifest for real
   tenant data MUST include each record family's tombstone/redaction projection state
   and the restore MUST replay it, never the pre-erasure values (ADR-005 Option-2;
   ratification runbook §1 table, row 2). This is now the machine-checkable J-042
   invariant B-4 of ADR-008: post-restore, for every tombstoned record the record
   exists, is non-readable as personal data through the redaction layer, and its
   erasure event is present and well-formed — a restore that resurrects pre-erasure
   values is a FINDING (exit 1), the same shape this drill produces
   (`architecture/coregrid-mvp-architecture/adr/ADR-008_CROSS_TENANT_ERASURE_AND_BACKUP_EXPIRY.md`,
   invariants B-1–B-4). The drill's manifest is synthetic and therefore carries no
   such state — that is allowed only because the drill set holds no personal data
   (`:90`).
3. **Retention policy IDs** — every personal-data-bearing record family in a
   production backup manifest must reference its ADR-005 retention policy ID from
   `RETENTION_POLICY_SCHEDULE.md` (28 policies / 12 families). The drill table carries
   no policy ID for the same synthetic-no-personal-data reason (ADR-008 B-1 makes the
   manifest contract-bound: `takenAt`, per-family policy IDs, per-family
   tombstone/redaction state).
4. **Backup expiry discipline** — production manifests must carry `expiresAt` ≤ the
   earliest possible retention deadline among the personal data the backup contains
   (ADR-008 B-2: a backup must never outlive the lawful retention of its most
   short-lived personal data; expired backup artifacts are destroyed as redundant
   copies — destroying them is copy expiry, NOT record destruction, because backups
   are redundant copies, not the canonical immutable substrate). The drill manifest is
   timestamped (`takenAt`, `:121`) and checksummed, which is the shape future
   production manifests must keep.
5. **Backups are read through the redaction layer** (ADR-008 B-3) — a backup taken
   after a record's erasure contains the tombstoned rendering, never pre-erasure
   personal values. Honest residual exposure (ADR-008, stated): a subject erased after
   a backup was taken remains readable inside that artifact until its `expiresAt` —
   bounded by B-2, never instant.
6. **Crypto-shred is NOT designated in V1** — ADR-009 rules V1 tombstone-only, no
   shred-class (`architecture/coregrid-mvp-architecture/adr/ADR-009_CRYPTO_SHRED_DESIGNATION.md`:
   no key-management capability is evidenced, so the mechanism could not execute). The
   earlier J-042 note ("if crypto-shredding is adopted later, key backup joins the
   recovery scope") remains conditional on ADR-009's binding triggers T-1/T-2 (a KMS
   capability evidenced in the corpus) — until then this obligation is dormant, not
   deleted.
7. **Cross-tenant erasure during remediation** — if a restore is part of incident
   remediation (see `docs/runbooks/incident-lockdown.md` Phase 4), erasure of exposed
   personal data is global-by-request, per-tenant-by-execution (ADR-008 Option 3): each
   executed erasure event is `tenant-scoped` or `platform-scoped` under a resolvable
   policy ID; `global` is valid only on the subject-level request record, never on an
   executed event (E-1/E-2); no data operation crosses a tenant boundary.

## 6. When to run the drill

- After every canonical apply wave (serialized after the apply; the RLS battery run
  should follow — `docs/runbooks/canonical-apply.md` §6).
- On schedule (mission graph requires recovery to be repeatedly verified — ratification
  runbook §4, third bullet: wire it into the phase-21 CI battery alongside the RLS
  battery).
- Before relying on any new backup/restore tooling: the tool must satisfy this
  verification discipline (checksummed manifest, single-transaction restore, row-level
  identity, evidence-store integrity, ADR-005 tombstone replay / ADR-008 B-4).