# RUNBOOK — Recovery drill (backup → destroy → restore → verify → clean, operator procedure)

Status: **AUTHORED** — H3-wave mission A-004 (team H3-004, DR Runbook Engineer). This
runbook defines the operator procedure for the recovery drill driven by
`scripts/verify-recovery-drill.mjs`. The runner is built by sibling mission A-001 in the
same wave; this document cites it **by path and contract only** — it does not depend on,
import, or describe its implementation. Until A-001's acceptance (offline rehearsal PASS
with zero network; unit suite green) is recorded, the live procedure below is GOVERNED
NOT EXECUTED.
Authority: AGENTS.md §29 (observability), §30 (secrets), §31 (testing standard — the
mandatory access-failure matrix), §42 (report format); campaign law in
`architecture/campaigns/H3-WAVE-CAMPAIGN.md` (no canonical access by teams; secrets never
printed; honesty over evidence).
Related contracts cited:

| Artifact | Owner (mission) | Role in the drill |
| --- | --- | --- |
| `scripts/verify-recovery-drill.mjs` | A-001 | Runner: offline `--rehearse` validation + credential-gated live drill; exit 0/1/2 |
| `frontend/src/lib/reliability/backup-manifest.ts` | A-003 | Zod contract for what a valid backup set is (scope, checksums, instant, expiry, tenant coverage) |
| `frontend/src/lib/reliability/recovery-targets.ts` | A-002 | Zod contract for RTO/RPO declarations per record family, fail-closed defaults |
| `scripts/restore-recovery-drill.mjs` + `docs/runbooks/restore-recovery.md` | M-R-101 (executed 2026-10-02) | Executed predecessor drill: checksummed manifest, single-transaction restore, row-level identity, evidence-store fingerprint, cleanup verified |
| `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md` | J-041 | Evidence discipline this runbook mirrors (honesty rules, cleanup verified by re-count, secret-free evidence) |
| `docs/runbooks/incident-lockdown.md` | L-T-011 | Escalation path when a drill failure coincides with a real incident |

---

## 1. Golden questions (WHO / WHAT / WHERE / WHY / POLICY)

- **WHO:** a platform operator holding the approved drill window and the canonical lock
  (`docs/runbooks/canonical-apply.md` §1 — exclusive-access law). The operator is never
  an autonomous agent working alone: every live drill result is reviewed by a second
  engineer before being recorded as platform state (AGENTS §21 — AI/automation output is
  untrusted by default).
- **WHAT:** prove that recovery from a backup is *executed and verified, not assumed*:
  a backup set is taken from a declared manifest, data is destroyed, restored, verified
  at row level, and every probe artifact is cleaned up with re-count evidence. A DRILL
  NEVER TOUCHES REAL TENANT DATA — drill fixtures are `synthetic-no-personal-data` by
  construction (see §6).
- **WHERE:** the offline `--rehearse` mode runs anywhere (zero network, zero database).
  The live mode runs ONLY against the designated drill target (a dedicated drill project
  or the canonical project under the exclusive lock) — never against a production
  serving environment.
- **WHY:** M-R-101's invariant — "recovery executed and verified, not assumed." Backups
  that have never been restored-and-verified are not recoveries; they are hope.
- **POLICY:** ADR-005 (retention vs immutable audit — tombstone law), ADR-008
  (backup-expiry discipline B-1–B-4), the retention schedule
  (`architecture/coregrid-mvp-architecture/RETENTION_POLICY_SCHEDULE.md`), and the
  exit-code contract of the runner (§4).

## 2. Modes and the exit-code contract

The runner exposes two modes. This runbook binds operators to interpret them ONLY through
the following contract (the exact numbers are the runner's public contract, cited from
the campaign mission graph and the exemplar batteries):

| Mode | Invocation | Network | Credentials |
| --- | --- | --- | --- |
| **Offline rehearsal** | `node scripts/verify-recovery-drill.mjs --rehearse` | NONE — must pass with zero network | NONE — no secrets read |
| **Live drill** | `node scripts/verify-recovery-drill.mjs` (credential-gated) | drill target only | credential-gated; absence is a clean block, never an error traceback |

Exit codes (same semantics as the RLS battery and the M-R-101 drill):

| Code | Meaning | Operator action |
| --- | --- | --- |
| `0` | **PASS** — all checks verified (or, in rehearsal: all plan/manifest/target contracts validate) | Archive evidence per §7; do not treat as a substitute for the live drill |
| `1` | **FAIL / FINDING** — a check failed (checksum mismatch, expired backup set, partial scope, restore identity mismatch, cleanup not verified) | Treat as a FINDING: preserve artifacts, open a finding record, do NOT claim recovery. If a real incident triggered the drill, escalate per `docs/runbooks/incident-lockdown.md` |
| `2` | **BLOCKED_NO_CREDENTIAL** — nothing ran; missing credential detected before any side effect | Provision via the approved secrets channel and re-run. NEVER work around exit 2 by inline values |

## 3. Preconditions (all mandatory, in order)

1. **Read the contracts before touching anything.** The operator reads:
   the backup-manifest contract (`frontend/src/lib/reliability/backup-manifest.ts`),
   the recovery-targets contract (`frontend/src/lib/reliability/recovery-targets.ts`),
   and this runbook. "Never assume. Verify." (AGENTS §22).
2. **Offline rehearsal first, always.** Run `--rehearse`. A live drill may not start
   until rehearsal exits `0`. Rehearsal validates: the drill plan, the
   backup-manifest shapes, and the per-family target contracts. A rehearsal FAIL
   (exit 1) is a stop-the-line event — the drill PLAN is wrong before any database is
   involved.
3. **Recovery targets declared.** Every record family in scope must carry an RTO/RPO
   declaration from `frontend/src/lib/reliability/recovery-targets.ts`. Families with
   no declaration fail closed (fail-closed defaults are the contract) and BLOCK the
   drill — a family you cannot state an objective for is a family you cannot verify.
4. **Manifest validity.** The backup set must satisfy the manifest contract: declared
   scope, per-record checksums, `takenAt` instant, `expiresAt`, and tenant coverage.
   An expired backup set (`expiresAt` in the past) is a FINDING, not a warning —
   per ADR-008 B-2 a backup must never outlive the lawful retention of its most
   short-lived personal data.
5. **Exclusive access.** For live mode against canonical: hold the campaign canonical
   lock; no concurrent apply, battery run, or foundation-loop exercise
   (`docs/runbooks/canonical-apply.md` §1).
6. **Secrets posture (hard law, AGENTS §30).** Credentials are provided as environment
   variable NAMES via the approved secrets channel. The operator must never print, log,
   redirect, or paste a secret VALUE. Terminal history, CI logs, and evidence files are
   all in scope for this rule (see §7's redaction discipline).

## 4. Drill phases (live mode)

The phases mirror the executed M-R-101 drill (`scripts/restore-recovery-drill.mjs`,
documented in `docs/runbooks/restore-recovery.md`) — the discipline is proven; the
runner re-expresses it in the battery exemplar's image.

| Phase | What happens | Operator watch-point |
| --- | --- | --- |
| 1 PLAN | The runner loads the drill plan and validates every manifest and target-contract shape against the A-002/A-003 Zod schemas | Any shape rejection aborts with exit 1 BEFORE any destructive step — never override |
| 2 BACKUP | Export the declared scope into a manifest with per-record checksums and a manifest checksum; record `takenAt` | Confirm the scope is exactly the declared drill scope — no production family may be swept in "for convenience" |
| 3 DESTROY | Remove the drill data; confirm absence | The ONLY destructive step; it must be scoped by construction to the drill fixture. If the log shows any path outside the fixture, ABORT and file a FINDING |
| 4 RESTORE | Rebuild from the manifest in a SINGLE transaction, preserving identity fields (`id`, `created_at`) | A partial restore must fail loudly, never partially "succeed" |
| 5 VERIFY | Recompute per-record checksums and require set equality with the backup; canary record compared field-by-field; evidence-store fingerprints identical before and after | Checksum equality is the pass condition. A 200/empty-set-style ambiguity must be treated like the battery treats `INCONCLUSIVE`: it is NOT a pass |
| 6 CLEANUP | Remove every drill artifact (rows, tables, probe principals); **cleanup is verified by re-count**, mirroring the RLS battery's `probe_cleaned=true` discipline | A failed or unverified cleanup is a FINDING (exit 1) even if restore succeeded — a drill that leaves probe rows behind has failed as an operation |

VERDICT=PASS requires ALL of: restore identity, canary identity, evidence integrity,
and verified cleanup. Four-out-of-five is a FAIL. (This all-checks-true shape is the
M-R-101 contract, `docs/runbooks/restore-recovery.md` §3.)

## 5. Honesty rules (the pass conditions that are NOT passes)

These are lifted from the RLS isolation battery's discipline
(`architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md` §1) and
bind every drill operator:

- **Only genuine evidence counts.** A credential rejection, a network fluke, or an
  ambiguous empty result proves nothing about recoverability and is recorded
  `INCONCLUSIVE` with a finding — never a pass.
- **Failures are recorded, never masked.** The battery's precedent: a control-flow bug
  and an invalid key were honestly reported as battery-correctness events rather than
  silently retried into a green verdict. A drill that "goes green" on the third retry
  without recording the first two runs is fake evidence.
- **Cleanup is part of the verdict.** As in the battery's §7 extension: probe rows,
  aux parents, and probe principals are removed through the same channel and the
  cleanup is verified by re-count; `probe_cleaned=true` on every seeded fixture; a
  failed cleanup is a FINDING.
- **Privileged paths are explicit and logged.** Any privileged (service-role / bypass)
  step is opt-in behind an explicit flag and printed as used (battery exemplar:
  `SERVICE_ROLE_USED_EXPLICITLY`). It is never the default path and never left on.

## 6. Data-safety law for drill fixtures

1. **Synthetic only.** Drill fixtures are declared `synthetic-no-personal-data`
   (M-R-101 precedent, `restore_drill_probe`). Real tenant rows are NEVER the restore
   corpus of a drill. If you find yourself restoring real tenant data "to make it
   realistic," STOP — that is an incident in the making and ADR-005 personal-data
   obligations (tombstone replay, retention policy IDs, erasure non-resurrection)
   attach in full to real-data restores (`docs/runbooks/restore-recovery.md` §5).
2. **Production-restore rehearsals are a different mission.** Rehearsing a REAL
   production restore (when one is ever required) follows
   `docs/runbooks/restore-rehearsal-checklist.md` (A-005) and the ADR-005/ADR-008
   obligations — not this drill's synthetic path.

## 7. Evidence discipline (secret-free, provenance-first)

Mirrors the battery's evidence shape (`RLS_ISOLATION_BATTERY.md` §3) and AGENTS §29–30:

1. **Artifacts.** The runner writes structured results + a human-readable transcript
   under `/opt/cursor/artifacts/` (exemplar naming:
   `recovery-drill-results.json` / `recovery-drill-results.log` — use the names the
   runner actually emits; the operator cites what exists, never invents paths).
2. **Verbatim excerpts, with the verdict line.** Evidence records include the run
   header, per-check PASS/FAIL lines, and the final `STATUS=…` line copied verbatim.
3. **Secret hygiene in evidence (hard law).**
   - Reference credentials by NAME and provenance, never value: the battery's pattern
     is the standard — `source=… ref=… role=anon prefix=eyJhbGciOi (value never
     printed)`. A short prefix is the maximum allowed disclosure; when in doubt,
     record zero characters of the value.
   - NEVER paste `SUPABASE_ACCESS_TOKEN`, service-role keys, anon keys, or connection
     strings into evidence files, tickets, reports, or this runbook. Evidence showing
     a secret value is itself a security FINDING: redact, re-issue the credential if
     it touched an uncontrolled medium, and record the leak as a finding.
   - Screenshots and screen recordings count as evidence: before capturing, close any
     surface that could render an env value or connection string.
4. **Provenance per AGENTS §12.** Every evidence record answers: who ran it, when
   (`executedAt`), against which environment (`projectRef` / drill-target id), runner
   version/commit, and which operator reviewed it. A result that cannot answer these
   is not platform state.
5. **Recording.** PASS evidence is recorded alongside the existing recovery state truth
   (the M-R-101 ratification record and its artifacts); FAIL evidence is preserved
   unmodified for the finding record. Never edit an artifact after the fact — append
   a dated addendum instead (immutable-evidence discipline, AGENTS §28).

## 8. Operator decision table (what to do when things go wrong)

| Symptom | Interpretation | Action |
| --- | --- | --- |
| Rehearsal exit 1 (manifest shape / target contract invalid) | Drill PLAN defect | Fix the plan or manifest fixture; re-rehearse. No live run |
| Rehearsal exit 1 (expired backup set, partial scope) | Contract violation in the input set | Regenerate the backup set per ADR-008 B-1–B-2; re-rehearse |
| Live exit 2 | Credential absent — nothing ran | Provision via secrets channel; never inline values |
| Live exit 1 at VERIFY (checksum/canary/evidence mismatch) | Recovery could not be proven | FINDING; preserve artifacts; no recovery claim; escalate to incident-lockdown if a real incident is in flight |
| Live exit 1 at CLEANUP | Probe residue on the drill target | FINDING; remove residue via the same authorized channel and re-count to zero; record `probe_cleaned=true` only after verified re-count |
| Runner behaves contrary to this runbook's contract | Contract drift between A-001's runner and this document | Do not "fix" the runner as an operator; file a finding citing the divergence; the owners reconcile |
| Unexpected network/database contact in `--rehearse` | Contract violation (rehearsal must be zero-network) | FINDING against the runner; quarantine the rehearsal evidence |

## 9. When to run the drill

- After every canonical apply wave (serialized after the apply, before the recovery
  state is relied upon — see `docs/runbooks/canonical-apply.md` §6 ordering).
- On schedule, per the unified drill calendar (`docs/runbooks/drill-schedule.md`,
  mission F-050) once that calendar lands.
- Before relying on any new backup/restore tooling: every tool must satisfy this
  verification discipline (checksummed manifest, single-transaction restore, row-level
  identity, evidence-store integrity, verified cleanup, ADR-005 tombstone replay /
  ADR-008 B-4 for real data).
- CI wiring: the intended steady-state is the recovery drill as a battery step with the
  same exit-code semantics (0 = posture holds, 1 = findings fail the build,
  2 = blocked on credentials); the wiring design is mission A-008
  (`architecture/campaigns/h3/recovery-ci-wiring.md`) and is applied only by the
  coordinator.

## 10. Change control for this runbook

This document is owned by mission A-004. Contract changes to the runner, the manifest
schema, or the targets schema require a corresponding review of §§2–7 here — the
runbook cites contracts, so contract drift makes the runbook stale by definition and
stale is a finding. Update both together or file the divergence.
