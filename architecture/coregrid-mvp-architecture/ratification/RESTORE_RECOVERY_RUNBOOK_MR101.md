# RESTORE/RECOVERY RUNBOOK — MISSION-R-101 (V1CAP-074 / J-042)

Status: **AUTHORED + EXECUTED against the canonical project (2026-10-02). VERDICT=PASS — recovery executed and verified, not assumed (E-102 invariant 30).**
Tooling: `scripts/restore-recovery-drill.mjs`
Evidence: `/opt/cursor/artifacts/restore-recovery-transcript.log`, `/opt/cursor/artifacts/restore-recovery-results.json`, `/opt/cursor/artifacts/restore-drill-backup.json`
Authority: AGENTS.md §28 (database law), §29 (observability), §31 (failure tests); J-042; mission graph MISSION-R-101. Restore execution on the canonical environment was ordered by the repository owner's execution directive (the mission's human-approval instrument), serialized after M-R-100 per the mission graph's exclusive canonical-access rule.

---

## 1. Scope and data categories (per ADR-005)

ADR-005 (RETENTION_VS_IMMUTABLE_AUDIT) fixes the V1 erasure mechanism as
redaction-with-tombstone over immutable records. Backup/restore tooling therefore
carries these binding obligations, honored by this drill and mandatory for any future
backup of real tenant data:

| Obligation | Source | How this drill honors it |
| --- | --- | --- |
| Immutable audit records are never destroyed — tombstoned, not deleted | ADR-005 decision; V1CAP-066 boundary | The drill's only destructive step is `DROP TABLE restore_drill_probe` — a dedicated synthetic drill table. `cg_execution_history` (append-only trigger), `cg_foundation_evidence`, and `cg_verification_result` are fingerprinted before and after and proven unchanged. |
| Restores must not resurrect erased personal data (tombstone/redaction state survives backup/restore) | ADR-005 Option-2 consequences | The drill set is synthetic and personal-data-free by construction. The runbook requirement for production backups: the backup manifest must include each record family's tombstone/redaction projection state, and restore must replay it — never the pre-erasure values. |
| Every personal-data-bearing record family references a retention policy ID | ADR-005 retention-schedule requirement | The drill table declares `data_class=synthetic-no-personal-data` and carries no policy ID for that reason; production backup manifests must record the policy ID per record family. |
| Backup-expiry discipline | ADR-005 | Backup artifacts are drill-synthetic, timestamped (`takenAt`), checksummed, and safe to expire. Production backups must carry a retention/expiry date in the manifest. |
| J-042 note on crypto-shred (Option 1, optional per-data-class) | ADR-005 | If crypto-shredding is adopted later, backups must restore keys and ciphertexts consistently (key backup joins the recovery scope). Not applicable to the V1 tombstone mechanism. |

## 2. The verified-recovery procedure (what the drill executes)

Serialized on exclusive canonical access, after M-R-100:

1. **Provision** — create `public.restore_drill_probe` (uuid PK, payload, tenant_tag,
   created_at) with RLS enabled and zero policies (deny-by-default posture preserved
   even for a scratch table). Seed 10 synthetic rows.
2. **Backup** — export all rows through the authorized Management API channel into a
   JSON manifest with a **per-row sha256 checksum** and a **manifest checksum**.
3. **Destroy** — `DROP TABLE restore_drill_probe`; confirm absence via
   `information_schema` (count=0).
4. **Restore** — recreate the table and reinsert every row from the manifest in a
   **single transaction**, preserving `id` and `created_at` (identity columns must
   survive restore; server defaults may not regenerate them).
5. **Verify row-level identity** — recompute per-row sha256 checksums post-restore and
   require set equality with the backup manifest; plus a canary row compared
   field-by-field. Count must match.
6. **Verify evidence integrity** — the immutable evidence/audit fingerprint
   (`cg_foundation_evidence`, `cg_execution_history`, `cg_verification_result` counts)
   must be identical before and after the entire drill.
7. **Cleanup** — drop the drill table; the canonical schema ends byte-equivalent to its
   pre-drill state.

Exit codes: 0 = PASS, 1 = FAIL (a FINDING with transcript evidence), 2 = blocked on
credentials. The transcript is the mission's restore-transcript evidence.

## 3. Execution record (2026-10-02)

```
project=nwrflbpbhyiqdptmlccm transport=management-api drill_table=restore_drill_probe
STEP2 backup rows=10 manifest_sha256=97b9cc6cba4f0e78c2cbda377fa65d8389e4d5115e9718caffde5e87063c517d
STEP3 destroy confirmed (count=0)
STEP5 per-row sha256 identity: VERIFIED (all rows byte-identical)
STEP5 canary row-level identity: VERIFIED (id, tenant_tag, created_at byte-identical)
STEP6 evidence integrity: INTACT
STEP7 cleanup: drill table dropped=true
VERDICT=PASS
```

## 4. Production posture (gaps that remain, recorded honestly)

- **Physical backup tooling**: the drill proves logical (row-level) restore. Supabase
  platform PITR/backups are a phase-21 (CI credentials, OPS-family) operational
  concern; this drill establishes the *verification discipline* they must satisfy.
- **Evidence-store content restore**: immutable evidence is never destroyed, so the
  drill proves it is untouched rather than restoring it. If a total-loss event ever
  destroys it, recovery is from platform backups and must re-verify the append-only
  history trigger's integrity — runbook extension required at that point.
- **Scheduled drills**: the mission graph requires recovery to be *repeatedly*
  verified; wire `restore-recovery-drill.mjs` into the phase-21 CI battery alongside
  the RLS isolation battery (V1CAP-073), serialized on canonical access.
