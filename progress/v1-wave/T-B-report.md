# T-B (DEPLOY-PIPELINE) — post-R-wave follow-up report

Team: T-B — deploy-path reconciliation (R8 drift remediation)
Branch: `cursor/p08-foundation-loop-classification-fe86` (no branch switch)
Date: 2026-10-03

## Implemented

1. **`release.yml` deploy path reconciled onto the health-gated substrate.** The
   deploy job no longer issues raw `docker run` over SSH (the R8-flagged bypass
   of the health gate and rollback). It now:
   - checks out the tagged commit (new step — the deploy job previously had no
     checkout and could not reference repo files);
   - keeps the existing fail-closed BLK-3 gate step verbatim (same step name,
     same exit-1 behavior, same `::error::` marker);
   - stages `infrastructure/deploy/deploy.sh` + `docker-compose.yml` from the
     tagged commit onto the VM at `/opt/coregrid/deploy/` (so the health-gate
     and rollback logic always match the code being released), then invokes
     `sudo -n bash /opt/coregrid/deploy/deploy.sh '<image>'` over SSH. This is
     the exact `deploy.sh` contract documented in OPERATIONS.md §1/§"Deploy"
     and `infrastructure/deploy/README.md` §3: pull before swap → compose up
     with fail-closed env_file → poll `/health.json` → auto-rollback to the
     previous image (§38). The raw `docker run` path is **removed**, not
     gated — there is no bypass left in the file.
2. **Hardened SSH invocation** (workflow-side only): `BatchMode=yes` +
   `StrictHostKeyChecking=yes` (key material never typed interactively; host
   keys pinned via the pre-existing `ssh-keyscan` step), key file written
   mode `600` into a `700` `~/.ssh`, removed at step end. `sudo -n` keeps the
   session non-interactive: it fails loudly instead of hanging the runner if
   the deploy identity lacks passwordless sudo.
3. **Trigger/tag contract untouched:** `on: push: tags: ["v*"]`, `permissions:
   contents: read`, `IMAGE_NAME`, the verify and build-and-push jobs (all
   pinned action SHAs, both image tags `<version>` + `<github.sha>`) are
   byte-identical. `timeout-minutes` on deploy raised 10 → 15 to fit two
   health windows (deploy + possible auto-rollback) plus pull/staging.
4. **`.env.example` stale project-id comment fixed** (R6/R8-flagged drift):
   line 9 now reads `# Supabase (project: nwrflbpbhyiqdptmlccm)` — canonical
   id confirmed against `supabase/.temp/linked-project.json`,
   `architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json`,
   `.github/workflows/security-batteries.yml` (`CANONICAL_PROJECT_REF`) and
   `progress/v1-wave/R-WAVE-REPORT.md`. Exactly one comment line changed
   (diff below); no values, no other lines.
5. **`infrastructure/deploy/*`: no changes needed.** `deploy.sh` already
   satisfies non-interactive SSH use (no TTY prompts anywhere; `set -euo
   pipefail`; the workflow invokes it via `bash`, so no exec-bit dependency,
   and via `sudo -n`, so no interactive sudo). Zero-diff keeps the validated
   R-wave substrate byte-stable.

Secret names are **exactly** as documented in OPERATIONS.md §1 (BLK-3):
`DEPLOY_SSH_HOST`, `DEPLOY_SSH_USER`, `DEPLOY_SSH_KEY` — no rename, so
OPERATIONS.md required no edit (and per file-ownership scope was not touched
at all). No secret VALUES appear anywhere in the workflow: all six deploy-step
variables are `${{ secrets.* }}` / `${{ github.sha }}` references passed
through env blocks, never echoed.

## Files Changed

- `.github/workflows/release.yml` — header comment updated (deploy path
  contract stated explicitly); deploy job restructured as above. (+~40/−20
  lines; verify/build jobs untouched)
- `.env.example` — one comment line (line 9) only:

```diff
-# Supabase (project: srhmfaoyhpvhdfxmagho)
+# Supabase (project: nwrflbpbhyiqdptmlccm)
```

- `progress/v1-wave/T-B-report.md` — this report.
- `infrastructure/deploy/**` — **zero diff** (checked: not in
  `git diff --name-only` for my changes).
- `architecture/campaigns/V1-PROGRAM/OPERATIONS.md` — **untouched** (env
  names did not change; its §1 "Known drift" paragraph now reads as resolved —
  flagged as Remaining Work for the wave coordinator).

## Architecture Impact

- Single sanctioned deploy path (Part 31 economy): every production container
  swap now goes through `deploy.sh` — pre-pull, fail-closed env_file
  (compose `required: true`), `/health.json` gate, §38 auto-rollback. The
  CI path and the operator path (OPERATIONS.md "Deploy" step 4) are the same
  code.
- Fail-closed discipline (§26/§28) preserved end-to-end: missing BLK-3
  secrets → explicit gate step exits 1 before any deploy step; missing/mode≠600
  env file on the VM → `deploy.sh` refuses; missing `SCHOLAR_IMAGE` → compose
  refuses.
- Human approval gate unchanged (`environment: production`).
- No security boundary added, removed, or weakened; no governance doc changed.

## Tests

All commands actually run in this VM; nothing was deployed, no daemon used,
no database touched.

1. **actionlint 1.7.7** (not pre-installed; downloaded release binary
   `actionlint_1.7.7_linux_amd64.tar.gz`, then):

```
$ /tmp/actionlint .github/workflows/release.yml && echo "ACTIONLINT: CLEAN (exit 0)"
ACTIONLINT: CLEAN (exit 0)
```

2. **YAML parse** (js-yaml present in node_modules):

```
$ node -e "...yaml.load(...)"
YAML PARSE: OK
jobs: verify, build-and-push, deploy
deploy steps: Check out source | Fail closed — deployment credentials not configured (BLK-3) | Deploy via health-gated substrate (deploy.sh over SSH)
on: {"push":{"tags":["v*"]}}
env.IMAGE_NAME: coregrid-scholar
```

3. **bash -n on every inline `run:` block** (extracted programmatically from
   the parsed YAML — 5 scripts):

```
bash -n OK: verify :: Install locked dependencies
bash -n OK: verify :: Verify
bash -n OK: build-and-push :: Extract tag from git ref
bash -n OK: deploy :: Fail closed — deployment credentials not configured (BLK-3)
bash -n OK: deploy :: Deploy via health-gated substrate (deploy.sh over SSH)
checked 5 run scripts, 0 failures
```

4. **`bash -n infrastructure/deploy/deploy.sh`** → clean (file unchanged).
5. **Secret scan over the scoped diff**
   (`git diff -- .env.example .github/workflows/release.yml`, patterns:
   private-key headers, `sk_live_`/`sk_test_`, JWT `eyJ…` prefixes, AWS/GitHub
   token shapes, `ssh-ed25519|rsa` key bodies, 64+-hex runs):

```
SECRET-SCAN (scoped to my 2 files): CLEAN
```

   Note: the repo working tree also contains pre-existing modifications from
   other teams (architecture/proofs/*.json, tests/unit/h3-03{1,4}*) present in
   `git status` before this mission started; a whole-diff scan there matches
   only `sha256:` inventory digests in those pre-existing proof files — not
   secrets, not my diff. Those files were not touched by T-B.
6. **Not runnable offline (honesty law):** the SSH deploy step itself (needs
   BLK-3 secrets + a reachable VM) and `docker compose config` (no Docker CLI
   in this VM at run time — `command -v docker` → not available). Compose
   fail-closed behavior was already validated in-VM during the R-wave
   (`infrastructure/deploy/README.md` validation section) and the file is
   byte-identical since.

## Security Validation

- No secret values in any changed file (scan above); secrets referenced by
  name only, passed via env blocks, never echoed — same pattern as before.
- Fail-closed gate retained as a separate first-class step: with any of
  `DEPLOY_SSH_HOST/USER/KEY` unset, the job exits 1 before the deploy step can
  run (step failure semantics guarantee this ordering).
- `StrictHostKeyChecking=yes` + `BatchMode=yes`: no interactive fallback that
  could leak key material into runner logs; host trust anchored by the
  pre-existing `ssh-keyscan` step (unchanged TOFU trade-off, now documented).
- Key file lifecycle: `700 ~/.ssh`, key at `600`, removed after the step.
- The substrate staged to the VM comes from the **tagged commit** — deploy
  logic is pinned to the release being shipped, not to whatever happens to
  sit on the VM.
- Mandatory-invariant tests unaffected: no tenant/user/agent/RLS surface
  touched; nothing here can widen access (deploy runs only behind the human
  `production` approval gate).

## Known Risks

- **`ssh-keyscan` TOFU:** host-key pinning still trusts-on-first-use per run
  (pre-existing pattern, kept). A hardened variant would pre-seed
  `known_hosts` from an operator-supplied secret; deferred — it would add a
  new secret name not present in OPERATIONS.md.
- **VM pull authorization is out-of-band:** the workflow does not log the VM
  into the registry (same as the old path); the operator must ensure the VM
  can pull `$DOCKER_REGISTRY/$DOCKER_NAMESPACE/coregrid-scholar` (e.g. one
  `docker login` out-of-band, or a public registry). Documented in the step
  comment.
- **Non-root deploy identity:** if `DEPLOY_SSH_USER` is not root and lacks
  passwordless sudo (or `/opt/coregrid` ownership rights), `sudo -n` fails
  loudly (job fails, no hang) rather than deploying — intentional fail-closed
  behavior, consistent with OPERATIONS.md's `sudo ./deploy.sh` contract.
- OPERATIONS.md §1 still carries the R-wave "Known drift (reported, not
  modified)" paragraph describing the raw `docker run` path, which this
  mission removed. Its env-name table remains accurate. Text update is outside
  my file-ownership scope (env names unchanged ⇒ no pointer correction was
  authorized); wave coordinator should strike/resolve that paragraph.

## Remaining Work

- Wave coordinator: resolve the stale "Known drift" paragraph in
  OPERATIONS.md §1 (one-line edit; not authorized for T-B under file
  ownership rules).
- On first BLK-3 unlock: run the OPERATIONS.md §1 live-validation checklist
  (tag → deploy job → `docker ps` on VM → `/health.json` + `/coregrid` 200)
  to prove the reconciled path end-to-end.
- Optional hardening (future ADR): pre-seeded `known_hosts` secret; registry
  pull authorization on the VM formalized (e.g. a scoped pull secret
  provisioned out-of-band).