# A-008 — Recovery CI Wiring Design (V1CAP-074 / MISSION-R-101 extension)

Team: H3-008 (Recovery CI Integrator) · Wave: H3 · Squad: A (Recovery & Resilience)
Authority: AGENTS.md §22, §23, §26, §42 · Campaign: `architecture/campaigns/H3-WAVE-CAMPAIGN.md` (Campaign Law 3, 6, 10)

Golden Questions:

- **WHO** — Team H3-008 designs; H3-000 (coordinator) owns `.github/workflows/security-batteries.yml` and is the sole applier.
- **WHAT** — A design for wiring team A-001's recovery drill runner (`scripts/verify-recovery-drill.mjs`) into the Security Batteries workflow: an offline rehearsal job (zero network, zero credentials) plus an opt-in live, credential-gated drill job.
- **WHERE** — `.github/workflows/security-batteries.yml` only (as a patch design; not applied by this team).
- **WHY** — The workflow's header claims V1CAP-074 coverage, but the drill coverage it names is the existing `restore-recovery-drill.mjs` live drill. A-001's rehearsal runner must be executable in CI so recovery-readiness is *proven per change* (offline) rather than only *proven weekly against production-like state* (live). AGENTS.md §29: everything important is observable and evidenced.
- **UNDER WHICH POLICY** — Campaign Law 6 (secret values never printed/written), AGENTS.md §17/§34 (CI is not a bypass; the live drill touches the canonical database only through the authorized, locked channel), and the workflow's own header law: *do not remove or widen the `canonical-db-batteries` group without an ADR*.

---

## 1. Ground truth (read-only inspection)

Current state of `.github/workflows/security-batteries.yml` (read as-is; not modified by this team):

- **Triggers:** `workflow_dispatch` + `schedule` (`17 6 * * 1`). Intentionally **no `pull_request`** — the batteries are live-credential-gated against the canonical database.
- **Concurrency:** workflow-level `concurrency: { group: canonical-db-batteries, cancel-in-progress: false }` — serializes *workflow runs* so live batteries never overlap or get interrupted mid-drill.
- **Jobs:** `rls-isolation-battery` (V1CAP-073) and `restore-recovery-drill` (V1CAP-074), both live, both mapping secrets by **name only** from the GitHub Actions secret store, both following the exit-code contract `0 = PASS / 1 = FINDINGS (fails build) / 2 = BLOCKED_NO_CREDENTIAL (blocked, not failed)`, both writing evidence to `/opt/cursor/artifacts/` and uploading it via `actions/upload-artifact@v4`, both recording outcomes to `$GITHUB_STEP_SUMMARY`.
- **Accuracy note (observed, for the coordinator's attention):** the run-level lock serializes *runs*, not *jobs* — within a single run, `rls-isolation-battery` and `restore-recovery-drill` already execute concurrently against the canonical environment. The header's "at most ONE battery job at a time" claim is stronger than what the current YAML enforces. The design in §3 fixes this as a side effect (a strengthening, not a widening).

## 2. Target runner contract (wire contract with A-001)

`scripts/verify-recovery-drill.mjs` (A-001, authored concurrently) is assumed to expose:

| Mode | Invocation | Network | Credentials | Exit 0 | Exit 1 | Exit 2 |
|---|---|---|---|---|---|---|
| Offline rehearsal | `node scripts/verify-recovery-drill.mjs --rehearse` | **none** | **none** (never reads secret env) | Drill plan valid; backup-manifest shapes conform (A-003 contract); recovery-target declarations conform (A-002 contract) | FINDINGS: invalid plan / malformed manifest / fail-open target defaults | BLOCKED: required rehearsal inputs absent — blocked, NOT failed |
| Live drill | `node scripts/verify-recovery-drill.mjs --live <project-ref>` | Management API channel | `SUPABASE_ACCESS_TOKEN` (fail-closed: absent ⇒ exit 2, `BLOCKED_NO_CREDENTIAL`, secrets never printed) | Recovery executed and verified against the canonical environment | FINDINGS — fails the job | `BLOCKED_NO_CREDENTIAL` — blocked, NOT failed |

Artifacts (battery-exemplar discipline, matching the existing jobs): result JSON + transcript log written to `/opt/cursor/artifacts/` (paths assumed: `recovery-drill-rehearsal-results.{json,log}` and `recovery-drill-results.{json,log}`).

**Reconciliation flag (Campaign Law 10):** A-001's runner did not exist at design time (`scripts/` was inspected). If A-001's final CLI differs (flag names, artifact file names), the coordinator reconciles the YAML below against A-001's implemented contract **before applying** — the invocation lines are the only touch points.

## 3. Concurrency-lock interaction

Three options were evaluated:

1. **Rehearsal inside the existing run-level lock, no trigger change.** The rehearsal would only run on dispatch/schedule, queued behind (and sharing a run with) live batteries. No PR-time proof; rejects the mission's purpose.
2. **Add `pull_request` trigger, keep run-level lock.** A PR touching recovery paths would enter the `canonical-db-batteries` group: PR CI would queue behind live drills and *hold* the canonical lock during PR runs. This widens lock contention against the workflow's own header law.
3. **RECOMMENDED — move the canonical lock from run-level to job-level; keep the group name and `cancel-in-progress: false` unchanged.**
   - `rls-isolation-battery`, `restore-recovery-drill`, and the new live drill job each declare `concurrency: { group: canonical-db-batteries, cancel-in-progress: false }`. Job-level groups are shared across all runs of the workflow, so the *stated invariant — at most one canonical-access battery job at a time, a running battery is never canceled mid-drill, new runs queue behind it — is preserved exactly*.
   - In fact the invariant is **strengthened**: the two existing live jobs (which currently run concurrently *within* one run) begin to serialize on the group too.
   - The offline rehearsal job gets its own group (`recovery-drill-rehearsal`, `cancel-in-progress: true` — superseding an in-flight offline rehearsal is safe; it touches nothing shared) and is thereby released from the canonical lock.
   - The live drill job additionally declares `needs: [recovery-drill-rehearsal]` — a live drill never runs unless the offline rehearsal passed first (fail-closed ordering, AGENTS.md §21 pattern: validate before execution).

**ADR flag (Campaign Law 3 / workflow header law):** the guarded sentence is "do not remove or *widen* this group." This design does not widen it — the group keeps its name, its members keep their semantics, and its protection extends to one more canonical-access job. It *does* relocate the lock from run-level to job-level. H3-000 should record the relocation (with the §1 accuracy note and the invariant-equivalence argument above) in the ADR ledger when applying. If the coordinator prefers zero ADR surface, **fallback = Option 1** (rehearsal on dispatch/schedule only, no trigger change, rehearsal job inherits the run-level lock) — the exact YAML for Option 3 below degrades to Option 1 by simply not applying the `pull_request` trigger and the `if:` guards.

## 4. Exact YAML (coordinator-applied patch)

### 4.1 Trigger block (replaces the current `on:`)

```yaml
on:
  workflow_dispatch:
    inputs:
      drill_mode:
        description: "Recovery drill mode: rehearsal (offline, default) or live (credential-gated; joins the canonical-db-batteries lock)"
        required: false
        default: rehearsal
        type: choice
        options:
          - rehearsal
          - live
  schedule:
    # Weekly, Mondays 06:17 UTC (off the top of the hour to avoid scheduler herds).
    - cron: "17 6 * * 1"
  pull_request:
    # PR runs execute the OFFLINE rehearsal only (zero network, zero secrets).
    # Live jobs are gated off pull_request by `if:` conditions below.
    paths:
      - "scripts/verify-recovery-drill.mjs"
      - "scripts/restore-recovery-drill.mjs"
      - "frontend/src/lib/reliability/**"
      - "tests/unit/h3-001-recovery-drill.test.ts"
      - "tests/unit/h3-002-recovery-targets.test.ts"
      - "tests/unit/h3-003-backup-manifest.test.ts"
      - "docs/runbooks/recovery-drill.md"
      - ".github/workflows/security-batteries.yml"
```

### 4.2 Workflow-level block (the run-level `concurrency:` block is REMOVED; `permissions:` unchanged)

```yaml
permissions:
  contents: read

# NOTE: the previous workflow-level concurrency group
# (`canonical-db-batteries`, cancel-in-progress: false) is replaced by
# job-level concurrency declarations on every canonical-access job below.
# The group name and cancel-in-progress: false are unchanged; the stated
# invariant (one canonical-access battery at a time, never canceled
# mid-drill) is preserved and strengthened. See A-008 design doc §3 / ADR slot.
```

### 4.3 Existing live jobs — two changes each (shown for `rls-isolation-battery`; identical shape for `restore-recovery-drill`)

```yaml
  rls-isolation-battery:
    name: RLS isolation battery (V1CAP-073)
    # Live battery: never on pull_request (secret-gated, canonical access).
    if: github.event_name != 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    concurrency:
      # Job-level canonical exclusive-access lock (relocates the former
      # run-level group without widening it; see A-008 design doc §3).
      group: canonical-db-batteries
      cancel-in-progress: false
    env:
      # (env block unchanged — secret NAMES only, values from the Actions
      # secret store; see existing job.)
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

(All remaining steps of both existing jobs are unchanged.)

### 4.4 New job — offline rehearsal (runs on every trigger)

```yaml
  recovery-drill-rehearsal:
    name: Recovery drill rehearsal — offline (V1CAP-074 / M-R-101)
    runs-on: ubuntu-latest
    timeout-minutes: 10
    concurrency:
      # Offline-only job: own group, safe to supersede; deliberately NOT in
      # the canonical-db-batteries group (no canonical access by construction).
      group: recovery-drill-rehearsal
      cancel-in-progress: true
    # SECURITY: no secrets are mapped into this job — the rehearsal is
    # offline and credential-free by contract. A PR run can never observe,
    # print, or leak secret material.
    steps:
      - name: Check out source
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install locked dependencies
        run: npm ci

      - name: Prepare rehearsal artifacts directory
        # Battery scripts write evidence to the fixed path /opt/cursor/artifacts
        # (outside the repo). Pre-create it writable so artifact persistence
        # cannot be mistaken for a battery FINDING.
        run: |
          sudo mkdir -p /opt/cursor/artifacts
          sudo chown "$(id -u):$(id -g)" /opt/cursor/artifacts

      - name: Run recovery drill rehearsal (offline)
        id: rehearsal
        run: |
          # Exit-code contract (scripts/verify-recovery-drill.mjs --rehearse):
          #   0 = PASS — drill plan, backup-manifest shapes, and recovery-target
          #       contracts all conform (offline; zero network, zero credentials)
          #   1 = FINDINGS (invalid plan / malformed manifest / fail-open target
          #       defaults) — FAILS the job
          #   2 = BLOCKED — required rehearsal inputs absent; job is marked
          #       blocked, NOT failed (no rehearsal claim is made either way)
          set +e
          node scripts/verify-recovery-drill.mjs --rehearse
          code=$?
          echo "exit_code=$code" >> "$GITHUB_OUTPUT"
          case "$code" in
            0)
              echo "STATUS=PASS — recovery drill rehearsal proven offline (drill plan, backup manifests, recovery targets all conform)."
              ;;
            2)
              echo "STATUS=BLOCKED — rehearsal inputs absent (see step output). No rehearsal claim is made either way."
              ;;
            *)
              echo "STATUS=FAIL — recovery drill rehearsal recorded FINDINGS (see step output and /opt/cursor/artifacts/recovery-drill-rehearsal-results.json)."
              exit "$code"
              ;;
          esac

      - name: Record rehearsal outcome
        if: always()
        run: |
          {
            echo "### Recovery drill rehearsal — offline (V1CAP-074 / M-R-101)"
            echo ""
            echo "Exit code: \`${{ steps.rehearsal.outputs.exit_code || 'no-run' }}\`"
            if [ "${{ steps.rehearsal.outputs.exit_code }}" = "2" ]; then
              echo "**BLOCKED** — the job did not fail: required rehearsal inputs were absent. No recovery claim is made either way."
            elif [ "${{ steps.rehearsal.outputs.exit_code }}" = "0" ]; then
              echo "PASS — drill plan, backup-manifest shapes, and recovery-target contracts validated offline (zero network, zero credentials)."
            else
              echo "**FINDINGS recorded** — see the run step output above; result JSON attached to the runner at /opt/cursor/artifacts/recovery-drill-rehearsal-results.json."
            fi
          } >> "$GITHUB_STEP_SUMMARY"

      - name: Upload rehearsal artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: recovery-drill-rehearsal-results
          path: |
            /opt/cursor/artifacts/recovery-drill-rehearsal-results.json
            /opt/cursor/artifacts/recovery-drill-rehearsal-results.log
          if-no-files-found: ignore
```

### 4.5 New job — live drill (manual opt-in, rehearsal-gated, canonical-locked)

```yaml
  recovery-drill-live:
    name: Recovery drill — live, credential-gated (V1CAP-074 / M-R-101)
    # Manual opt-in only: never on pull_request, never on schedule.
    if: github.event_name == 'workflow_dispatch' && inputs.drill_mode == 'live'
    needs: [recovery-drill-rehearsal]
    runs-on: ubuntu-latest
    timeout-minutes: 15
    concurrency:
      # Joins the canonical exclusive-access lock: serializes against the RLS
      # battery, the restore/recovery drill, and any other live drill.
      group: canonical-db-batteries
      cancel-in-progress: false
    env:
      # NOTE: secret NAMES only. Values resolve from the GitHub Actions secret
      # store and are automatically masked in logs; the drill runner redacts
      # secret material in its output. No step in this job echoes secret
      # values. Absent credential ⇒ the runner exits 2 (BLOCKED_NO_CREDENTIAL)
      # and the job is blocked, not failed.
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    steps:
      - name: Check out source
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Install locked dependencies
        run: npm ci

      - name: Prepare drill artifacts directory
        run: |
          sudo mkdir -p /opt/cursor/artifacts
          sudo chown "$(id -u):$(id -g)" /opt/cursor/artifacts

      - name: Run recovery drill (live, credential-gated)
        id: live_drill
        run: |
          # Exit-code contract (scripts/verify-recovery-drill.mjs --live):
          #   0 = PASS — recovery executed and verified against the canonical
          #       environment (not assumed)
          #   1 = FINDINGS — FAILS the job
          #   2 = BLOCKED_NO_CREDENTIAL — SUPABASE_ACCESS_TOKEN absent; job
          #       blocked, NOT failed (fail-closed, per Campaign Law 6)
          set +e
          node scripts/verify-recovery-drill.mjs --live "$CANONICAL_PROJECT_REF"
          code=$?
          echo "exit_code=$code" >> "$GITHUB_OUTPUT"
          case "$code" in
            0)
              echo "STATUS=PASS — recovery executed and verified, not assumed."
              ;;
            2)
              echo "STATUS=BLOCKED_NO_CREDENTIAL — SUPABASE_ACCESS_TOKEN is not configured in the GitHub Actions secret store. No recovery claim is made either way."
              ;;
            *)
              echo "STATUS=FAIL — live recovery drill recorded FINDINGS (see step output and /opt/cursor/artifacts/recovery-drill-results.json)."
              exit "$code"
              ;;
          esac

      - name: Record live drill outcome
        if: always()
        run: |
          {
            echo "### Recovery drill — live (V1CAP-074 / M-R-101)"
            echo ""
            echo "Exit code: \`${{ steps.live_drill.outputs.exit_code || 'no-run' }}\`"
            if [ "${{ steps.live_drill.outputs.exit_code }}" = "2" ]; then
              echo "**BLOCKED on credentials** — the job did not fail: \`SUPABASE_ACCESS_TOKEN\` is absent from the repository secret store."
            elif [ "${{ steps.live_drill.outputs.exit_code }}" = "0" ]; then
              echo "PASS — live recovery drill executed and verified against the canonical environment."
            else
              echo "**FINDINGS recorded** — see the run step output above; result JSON attached to the runner at /opt/cursor/artifacts/recovery-drill-results.json."
            fi
          } >> "$GITHUB_STEP_SUMMARY"

      - name: Upload drill artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: recovery-drill-live-results
          path: |
            /opt/cursor/artifacts/recovery-drill-results.json
            /opt/cursor/artifacts/recovery-drill-results.log
          if-no-files-found: ignore
```

(`CANONICAL_PROJECT_REF` remains the existing workflow-level `env:` value — a project ref, not a secret.)

## 5. Exit-code semantics in CI (consolidated)

| Runner exit | Meaning | CI effect (both new jobs) |
|---|---|---|
| `0` | PASS — recovery readiness proven (rehearsal: offline contract conformance; live: verified recovery) | Job succeeds; `PASS` recorded in `$GITHUB_STEP_SUMMARY` |
| `1` | FINDINGS — recovery posture violated (invalid plan / manifest defects / fail-open targets / live verification failure) | Step echoes `STATUS=FAIL`, then `exit 1` — **job fails**; evidence JSON uploaded for triage |
| `2` | BLOCKED — `BLOCKED_NO_CREDENTIAL` (live) or absent rehearsal inputs (offline) | Step echoes `STATUS=BLOCKED…` and **does not exit nonzero** — job is marked blocked, not failed; no claim is made either way (matches the existing jobs' semantics and Campaign Law 6 fail-closed pattern) |

Any unexpected code (`*` branch) falls into the FAIL arm and propagates the raw exit code, so unknown failure modes can never masquerade as success.

## 6. Secret handling

- **Rehearsal job maps zero secrets.** It runs on `pull_request` precisely because it is credential-free by construction; a PR run cannot observe or leak secret material (AGENTS.md §19 minimization: AI/CI context receives only what it is authorized to receive).
- **Live job maps secret NAMES only** — `SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}`. This document contains no secret values; the workflow must never inline values.
- GitHub Actions automatically masks values sourced from `secrets.*` if they would otherwise appear in logs; the runner additionally redacts secret material (battery-exemplar discipline).
- No step uses `secrets.*` inside shell `echo`, string interpolation into commands, or artifact paths.
- Credential absence is a **blocked** state (exit 2), never a silent pass — the drill cannot be tricked into claiming recovery without credentials (fail-closed, Campaign Law 6).

## 7. Interactions with concurrent H3 missions

- **A-001 (runner author):** the YAML's only touch points are the two invocation lines (`--rehearse`, `--live "$CANONICAL_PROJECT_REF"`) and artifact file names. Reconcile against A-001's implemented CLI before applying (§2).
- **C-024 (workflow-file owner this wave, L-T-002):** C-024 extends this same workflow for the RLS battery on `pull_request`. If C-024's change lands, the run-level `canonical-db-batteries` lock would serialize PR CI against live battery runs — this design's job-level relocation (§3) resolves exactly that contention. Apply order: prefer this design's concurrency relocation, then C-024's trigger/path work on top (RLS job's `if:` then becomes unconditional, with the documented residual gap that fork PRs have no secret access ⇒ exit 2 blocked). Final merge order is the coordinator's call.
- **J-099 / Squad D:** untouched — this design adds no posture values.

## 8. Residual gaps (honest accounting)

1. The rehearsal's `pull_request` coverage depends on the ADR-flagged concurrency relocation being ratified; under the conservative fallback (§3 Option 1), PR-time proof is deferred.
2. Artifact file names (`recovery-drill-rehearsal-results.*`, `recovery-drill-results.*`) are this design's proposal; A-001's implementation may name them differently — reconcile at apply time.
3. This design was validated by inspection against the workflow's exemplar jobs only; no CI run was executed (Campaign Law: no workflow edits by this team; no `npm run verify`). The coordinator should smoke-test with a manual `workflow_dispatch` (default `drill_mode: rehearsal`) after applying.
4. Within-run concurrency of the two pre-existing live jobs is currently *parallel*; the relocation serializes them (slightly slower, strictly safer). Recorded as an intended strengthening, not a regression.

## 9. Apply checklist (coordinator)

1. Reconcile §4 invocations/artifact names with A-001's merged `scripts/verify-recovery-drill.mjs`.
2. Record the concurrency relocation in the ADR ledger (invariant-preserving move; see §3).
3. Apply §4.1–§4.5 to `.github/workflows/security-batteries.yml`.
4. Smoke-test: `workflow_dispatch` with `drill_mode: rehearsal` → expect `recovery-drill-rehearsal` PASS (exit 0), live job skipped.
5. Confirm `pull_request` rehearsal run on a recovery-path PR; confirm live jobs remain PR-excluded and secret-free.