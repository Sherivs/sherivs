# CHECKLIST — Restore rehearsal (evidence-recorded, no live execution by default)

Status: **AUTHORED** — this document is a checklist instrument. It has NOT been
executed as a rehearsal; every evidence slot below is empty by design. No drill
run is claimed anywhere in this file. Honesty law: AGENTS.md §42 ("never claim
completion without evidence") and H3 Campaign Law 10 ("never claim applied/proven
what was not executed").

Team: H3-005 (Restore Rehearsal Engineer), Squad A — Recovery & Resilience, M-R-101
groundwork. Mission: A-005.

Scope boundary (do not duplicate the sibling runbook): the operator-grade drill
**procedure** lives in `docs/runbooks/recovery-drill.md` (H3-004). That runbook
explains HOW a restore rehearsal is executed end to end, citing the offline
rehearsal runner (`scripts/verify-recovery-drill.mjs`, H3-001), the backup-manifest
contract (`frontend/src/lib/reliability/backup-manifest.ts`, H3-003), and the
recovery-target declarations (`frontend/src/lib/reliability/recovery-targets.ts`,
H3-002). THIS file is the step-by-step **checklist + evidence record**: an operator
walks the steps in order, fills one evidence slot per step, and the completed sheet
becomes the rehearsal evidence artifact. If this file and the drill runbook ever
disagree on a technical fact, the drill runbook's cited procedure wins and a FINDING
is recorded in §10 below.

Authority: AGENTS.md §28 (database law), §29 (observability — evidence without
secrets), §31 (testing standard), §42 (report format / evidence honesty); H3
Campaign Law 5 (no canonical access by teams — live execution is coordinator-only),
Law 6 (secrets — never print, log, or write a secret value); the operational
exemplar `docs/runbooks/restore-recovery.md` (executed drill, VERDICT=PASS
2026-10-02) and its script `scripts/restore-recovery-drill.mjs`; ADR-005
(RETENTION_VS_IMMUTABLE_AUDIT), ADR-008 (CROSS_TENANT_ERASURE_AND_BACKUP_EXPIRY,
invariants B-1–B-4), ADR-009 (CRYPTO_SHRED_DESIGNATION — dormant in V1).

---

## 0. How to use this sheet

- One rehearsal = one copy of this sheet, completed top to bottom. Steps are
  sequential; a skipped or failed step STOPS the rehearsal — do not continue past a
  FAIL. Record the stop in §10 (Findings) instead of improvising.
- Every step has: an ID, the pass condition, and an evidence slot. Fill the slot
  with **facts only**: what ran, which command name/flag, exit code, artifact paths,
  timestamps, counts, checksums. Never fill a slot with a secret value (see §0.1).
- A slot left empty means the step did not happen — that is honest and acceptable;
  a slot filled with assumed values is not. Never pre-fill slots "in advance".
- The completed sheet is stored with the run's artifacts (see EV-09). It is the
  only artifact this checklist produces; the runner script produces its own
  artifacts, which the slots reference by path — the sheet never embeds their
  contents wholesale.

### 0.1 Secret hygiene for every slot (BINDING — Campaign Law 6, AGENTS §30)

Across ALL slots in this sheet:

- Never write the VALUE of any credential: `SUPABASE_ACCESS_TOKEN`,
  `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, anon/publishable keys, DB
  passwords, connection strings with embedded credentials, CA private keys, or any
  key material. Reference them by NAME only.
- Permitted provenance-style notations when a credential fact matters: the env-var
  name, whether it was present/absent, and (where the tooling logs it) a source
  label such as `env` / `.env.local` — never the value, never a prefix that leaks a
  usable fragment.
- Never paste tool output that echoed a secret. If a transcript contains a secret
  shape (token/JWT/password-like string), redact it in the slot and record the
  redaction as a fact: `redacted: 1 credential-shaped string`.
- Artifact paths may be recorded; artifact contents are not copied into slots
  except checksums and counts.

### 0.2 Modes and the no-live-execution default

| Mode | What it touches | Who may execute it | Checklist use |
| --- | --- | --- | --- |
| OFFLINE rehearsal (`scripts/verify-recovery-drill.mjs --rehearse`) | no network, no database, no credentials; validates plan, manifest shapes, target contracts (exit 0/1/2) | any engineer, any time | Steps 1–4 of this sheet |
| LIVE drill (per `docs/runbooks/recovery-drill.md`, credential-gated) | canonical/exclusive-access environment | coordinator-serialized only (Campaign Law 5) | Steps 5–9; only when the drill runbook's preconditions are met |

The default completion of this checklist is the OFFLINE mode (Steps 1–4 + §9/§10).
Steps 5–9 are completed only during a coordinator-authorized live rehearsal; an
offline-only run marks them `N/A — live steps not performed (offline rehearsal only)`.
Do not run `npm run verify` to "back" this checklist; per-step evidence comes from
the named commands only.

---

## 1. Precondition checklist (before anything runs)

- [ ] **PC-1** — Role and authorization confirmed: the operator holds a named
      mission role and the rehearsal was authorized for THIS run (who/what/where/why
      recorded in EV-01).
- [ ] **PC-2** — Mode declared: OFFLINE or LIVE (see §0.2). LIVE additionally
      requires every precondition in `docs/runbooks/recovery-drill.md` §"Preconditions",
      including exclusive serialized canonical access (no concurrent canonical apply,
      RLS battery, or foundation-loop exercise — per `docs/runbooks/canonical-apply.md`).
- [ ] **PC-3** — Secret hygiene readiness: no credential values pasted into any
      shell history, transcript, or this sheet; only env-var NAMES are referenced.
- [ ] **PC-4** — Artifacts directory available for evidence output
      (`/opt/cursor/artifacts/` is the exemplar convention used by the drill
      tooling; confirm the target directory before Step 2).

**EV-01 (preconditions)**
```
operator_role:            <named role / mission id>
authorized_by:            <who authorized this rehearsal>
mode_declared:            <OFFLINE | LIVE>
live_preconditions_met:   <N/A for offline | list of met live preconditions, names only>
artifacts_dir:            <path>
secret_hygiene_confirmed: <yes — no secret values written anywhere; operator initial>
timestamp_utc:            <YYYY-MM-DDTHH:MM:SSZ>
```

STOP RULE: any unchecked box in §1 → do not proceed; record the blocker in §10.

---

## 2. Step 1 — Recovery plan and target contracts validated (offline)

Run the offline rehearsal runner's plan/contract validation
(`node scripts/verify-recovery-drill.mjs --rehearse`; see `docs/runbooks/recovery-drill.md`
for the exact invocation surface). This proves the drill PLAN, the RTO/RPO target
declarations (`frontend/src/lib/reliability/recovery-targets.ts`), and the
backup-manifest shapes (`frontend/src/lib/reliability/backup-manifest.ts`)
are internally consistent — with zero network and zero credentials.

Pass condition: exit code `0` (offline rehearsal PASS). Exit `1` = a validation
failure (FINDING, §10). Exit `2` = `BLOCKED_NO_CREDENTIAL` semantics — expected
only if the runner's offline path is mis-invoked in credential-requiring mode;
investigate, do not "fix" by supplying credentials for an offline step.

**EV-02 (plan/target/manifest validation)**
```
command_run:              node scripts/verify-recovery-drill.mjs --rehearse
exit_code:                <0 | 1 | 2>
failure_codes_if_any:     <list of the runner's typed failure codes, or none>
rto_rpo_families_covered: <count or list of record families declared, names only>
manifest_shapes_checked:  <backup-manifest contract version / shape ids, no contents>
transcript_path:          <path>
timestamp_utc:            <...>
```

---

## 3. Step 2 — Backup manifest pre-flight (shape, checksums, scope, expiry)

Before any restore path is trusted, the backup set it would consume must prove
itself against the manifest contract (Campaign Law: A-003's schema; ADR-008 B-1).
Check, per manifest under test (synthetic drill set only in offline mode):

- [ ] **MF-1** — Manifest parses against the backup-manifest contract (Zod-validated;
      a parse failure is a FINDING, not a workaround).
- [ ] **MF-2** — `takenAt` present; per-family retention policy IDs present for any
      personal-data-bearing family (synthetic-no-personal-data drill sets are exempt
      from policy IDs by the same rule as `scripts/restore-recovery-drill.mjs:90`).
- [ ] **MF-3** — Per-row (or per-record) checksums present and recomputable; a
      manifest-level checksum present.
- [ ] **MF-4** — Scope declared: which record families / tenants the set covers;
      partial scope is declared, never silent.
- [ ] **MF-5** — `expiresAt` present for any personal-data-bearing set and ≤ the
      earliest retention deadline of its contents (ADR-008 B-2).
- [ ] **MF-6** — Tombstone/redaction projection state present for any
      personal-data-bearing family (ADR-005 / ADR-008 B-3, B-4); synthetic sets
      exempt (no personal data by construction).
- [ ] **MF-7** — No secret-shaped values inside the manifest (it must never carry
      credentials; if one does, that is a FINDING — do not proceed).

**EV-03 (manifest pre-flight)**
```
manifest_path:            <path>
contract_version:         <from the contract module, no contents>
mf_checks:                MF-1:<pass/fail> MF-2:<pass/fail/n-a> MF-3:<...> MF-4:<...> MF-5:<...> MF-6:<...> MF-7:<pass>
manifest_sha256:          <hex digest of the manifest file>
record_family_count:      <n>
personal_data_families:   <count; 0 expected for synthetic drill sets>
findings:                 <none | reference to §10 entries>
timestamp_utc:            <...>
```

---

## 4. Step 3 — Offline restore-path rehearsal (dry: plan → destroy → restore → verify → cleanup)

Execute the runner's offline rehearsal of the full restore path: the plan's
provision/backup/destroy/restore/verify/cleanup stages are simulated against the
validated manifest and target contracts. Nothing touches a database.

Pass condition: exit code `0` and the runner's typed verdict is PASS. Any typed
failure code from the failure-family surface (corrupt manifest, missing checksum,
expired backup set, partial scope — cf. `tests/failure/h3-007-recovery-chaos.test.ts`)
is recorded verbatim as a FINDING in §10.

**EV-04 (offline rehearsal execution)**
```
command_run:              <exact offline invocation, flags only — no env values>
exit_code:                <0 | 1 | 2>
verdict:                  <PASS | FAIL | BLOCKED_NO_CREDENTIAL>
failure_codes_if_any:     <typed failure codes, or none>
steps_covered:            <provision/backup/destroy/restore/verify/cleanup as simulated>
transcript_path:          <path>
results_path:             <path>
timestamp_utc:            <...>
```

---

## 5. Step 4 — Evidence packaging (offline portion)

Assemble the offline evidence set: the runner's transcript and results artifacts,
the manifest pre-flight record, and this sheet's EV-01..EV-04.

- [ ] **EP-1** — All artifact paths in EV-02..EV-04 exist on disk.
- [ ] **EP-2** — Every artifact was scanned once for secret shapes; zero found
      (or redactions recorded in §10).
- [ ] **EP-3** — This sheet carries no secret values (§0.1 audit re-run).
- [ ] **EP-4** — Verdict honesty check: the sheet's verdict language matches the
      runner's actual verdict — an offline PASS is recorded as "offline rehearsal
      PASS", NEVER as "restore executed" or "recovery proven live".

**EV-05 (offline evidence package)**
```
artifact_paths:           <one per line, paths only>
secret_scan_result:       <0 secret-shaped strings | redactions recorded in §10>
offline_verdict_recorded: offline rehearsal PASS / FAIL / BLOCKED_NO_CREDENTIAL
honesty_check:            <EP-4 confirmed — offline language, no live claims>
timestamp_utc:            <...>
```

---

## 6. Live-rehearsal steps (ONLY during a coordinator-serialized live drill; otherwise mark N/A)

These steps mirror the executed operational discipline of
`docs/runbooks/restore-recovery.md` and the procedure in `docs/runbooks/recovery-drill.md`.
If the declared mode was OFFLINE, write `N/A — live steps not performed (offline
rehearsal only)` in EV-06..EV-09 verdict lines and stop after §5.

### Step 5 — Synthetic provision + backup capture

- [ ] **LV-1** — Exclusive canonical access confirmed and serialized (Campaign Law 5;
      `docs/runbooks/canonical-apply.md` §1 discipline).
- [ ] **LV-2** — Drill table/data set is `synthetic-no-personal-data` by construction
      (mirrors `restore_drill_probe`, `scripts/restore-recovery-drill.mjs:46`, `:90`).
- [ ] **LV-3** — Backup captured with per-record checksums + manifest checksum;
      fingerprint of immutable evidence stores taken BEFORE any destructive step
      (`cg_foundation_evidence` / `cg_execution_history` / `cg_verification_result`
      per `scripts/restore-recovery-drill.mjs:77–86`).
- [ ] **LV-4** — RLS posture of any scratch/probe table is deny-by-default (enabled,
      zero policies) even for synthetic data.

**EV-06 (provision + backup)**
```
exclusive_access_confirm: <how serialized — reference to the coordinator's access record>
data_classification:      synthetic-no-personal-data
backup_manifest_path:     <path>
manifest_sha256:          <hex digest>
record_count_backed_up:   <n>
evidence_store_fingerprint_before: <fingerprint value>
rls_posture_of_probe:     enabled, zero policies (deny-by-default)
timestamp_utc:            <...>
```

### Step 6 — Destroy (scoped, the ONLY destructive step)

- [ ] **LV-5** — Destruction scoped to the drill table/set only, by construction.
- [ ] **LV-6** — Absence confirmed via catalog before restore.

**EV-07 (destroy)**
```
destroyed_object:         <drill table/set name>
scope_proof:              <why nothing else could be affected>
absence_confirmation:     <method + result, e.g. information_schema query returned no rows>
timestamp_utc:            <...>
```

### Step 7 — Restore + verification gates

All four gates must be true for a live PASS (operational exemplar:
`docs/runbooks/restore-recovery.md` §3–§4):

- [ ] **RV-1** — Row-level identity: recomputed per-record checksums equal the
      backup set (set equality).
- [ ] **RV-2** — Canary identity: a designated canary record compared
      field-by-field matches.
- [ ] **RV-3** — Evidence-store integrity: immutable-store fingerprint AFTER the
      drill equals the BEFORE fingerprint (no rebuild-by-deletion-and-reinsert of
      immutable audit families — ADR-005 obligation 1).
- [ ] **RV-4** — Tombstone replay: if any personal-data-bearing family was in scope,
      post-restore tombstone/redaction state replays the erasure events — a restore
      that resurrects pre-erasure values is a FINDING (ADR-008 B-4). N/A for
      synthetic-only sets.
- [ ] **RV-5** — Restore executed in a single transaction where the path supports it
      (exemplar discipline, `scripts/restore-recovery-drill.mjs:148–167`).

**EV-08 (restore + gates)**
```
rv1_row_identity:         <pass/fail + counts compared>
rv2_canary_identity:      <pass/fail + fields compared>
rv3_evidence_integrity:   <pass/fail + after-fingerprint>
rv3_before_equals_after:  <yes/no>
rv4_tombstone_replay:     <n/a — synthetic set | pass | fail + finding ref>
rv5_single_transaction:   <yes/no + method>
restore_duration_note:    <optional observation, no secrets>
timestamp_utc:            <...>
```

### Step 8 — Cleanup + end-state proof

- [ ] **LV-7** — Drill artifacts dropped/removed; re-count confirms zero residue.
- [ ] **LV-8** — Canonical schema end-state unchanged (exemplar:
      `scripts/restore-recovery-drill.mjs:193–200`).

**EV-09 (cleanup)**
```
residue_recount:          <0 expected; actual>
end_state_proof:          <method + result>
drill_artifacts_retained: <list of evidence artifact paths KEPT for audit>
timestamp_utc:            <...>
```

---

## 7. Verdict sheet (fill last)

| Gate | Source | Value |
| --- | --- | --- |
| Offline rehearsal verdict | EV-04 | `<PASS/FAIL/BLOCKED_NO_CREDENTIAL>` |
| Manifest pre-flight | EV-03 | `<all MF checks pass? yes/no>` |
| Provision/backup gates (live) | EV-06 | `<pass/fail/N/A>` |
| Restore gates RV-1..RV-5 (live) | EV-08 | `<pass/fail/N/A>` |
| Cleanup gate (live) | EV-09 | `<pass/fail/N/A>` |
| **SHEET VERDICT** | — | `<OFFLINE_REHEARSAL_PASS \| OFFLINE_REHEARSAL_FAIL \| LIVE_REHEARSAL_PASS \| LIVE_REHEARSAL_FAIL \| BLOCKED_NO_CREDENTIAL>` |

Verdict semantics (fail-closed, mirroring the operational drill's exit codes):

- `OFFLINE_REHEARSAL_PASS` / `LIVE_REHEARSAL_PASS` — every applicable gate true;
  the sheet is archived as rehearsal evidence.
- `*_FAIL` — any gate false → FINDING(s) in §10; recovery is NOT claimed; a live
  FAIL triggered by a real incident escalates per `docs/runbooks/incident-lockdown.md`.
- `BLOCKED_NO_CREDENTIAL` — a credential-gated step ran without its credential;
  nothing of that step executed; provision via the approved secrets channel and
  re-run. The blocked fact is recorded WITHOUT any credential value.

**EV-10 (verdict)**
```
sheet_verdict:            <from the table above>
operator_signature_role:  <named role>
reviewer_role:            <independent reviewer — a worker must not verify its own output (B-021 independence discipline)>
timestamp_utc:            <...>
```

---

## 8. Cadence — when a rehearsal is scheduled

Per `docs/runbooks/recovery-drill.md` and the operational exemplar §6:

1. After every canonical apply wave (serialized; the coordinator owns live runs).
2. On schedule per the unified drill calendar (`docs/runbooks/drill-schedule.md`,
   F-050) — one fresh copy of this sheet per scheduled rehearsal.
3. Before relying on any new backup/restore tooling: the tool must satisfy the
   checksummed-manifest + single-transaction-restore + row-identity +
   evidence-integrity + tombstone-replay discipline before it is trusted, and this
   sheet is the record of proving it.

---

## 9. Sheet retention and auditability (AGENTS §12, §29)

The completed sheet is itself evidence: store it with the run's artifacts, keep the
runner transcript/results referenced (not embedded), and never rewrite a filled slot
— corrections are appended in §10 with a reason and timestamp, never silently edited.
Retention of the backup artifacts themselves follows ADR-008 B-2 expiry discipline
(copy expiry, not record destruction).

---

## 10. Findings / corrections log (append-only)

| # | Finding / correction | Slot affected | Severity | Raised by | Timestamp |
| --- | --- | --- | --- | --- | --- |
| 1 | _(empty — no findings recorded at authoring time; this sheet has not been executed)_ | — | — | — | — |

Authoring note (honesty): as of authoring (2026-10-03, team H3-005) no rehearsal has
been executed against this checklist; the sibling drill runbook
(`docs/runbooks/recovery-drill.md`, H3-004) and the offline runner
(`scripts/verify-recovery-drill.mjs`, H3-001) are being authored concurrently by
Squad A. If either lands with a different invocation surface or step order, update
this sheet's references in a follow-up pass and log the correction above — do not
drift silently.