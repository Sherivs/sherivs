# R8 (INFRA-OPS) Report — Deployment substrate + operations runbook (F-14 follow-up)

Date: 2026-10-03 | Branch: `cursor/p08-foundation-loop-classification-fe86` | Version-target: **V1** (§45)

## Implemented

1. **`infrastructure/deploy/`** — validated (not applied) single-VM deployment
   substrate for the sanctioned V1 target:
   - `docker-compose.yml`: runs the prebuilt image (`SCHOLAR_IMAGE` required
     interpolation — compose fails closed without it), required env_file
     `/opt/coregrid/scholar.env` (fails closed if absent), `/health.json`
     healthcheck mirroring the Dockerfile exactly, log rotation
     (json-file 10m×5), `no-new-privileges`. No secret values committed.
   - `scholar.env.example`: env-NAME manifest (values empty) cross-checked
     against `.env.example`, `frontend/src/lib/env.ts`
     (`REQUIRED_VARS["production"]`, `SERVER_ONLY_VARS`) and the lib/
     adapters (`ai-gateway.server.ts`, `paystack.functions.ts`,
     `push.server.ts`, resend/vapi adapters, `digital-twin.functions.ts`).
     Declares `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `VAPI_API_KEY`
     (missing from `.env.example` — recorded V1-009 gap).
   - `deploy.sh`: pull-before-touch → compose up → `/health.json` poll gate
     (default 120s) → automatic rollback to the previously running image tag
     (§38); `--rollback` mode for manual reverts; fail-closed preflight on
     env-file presence/permissions.
   - `README.md`: build → ship → run → healthcheck → rollback procedure.
2. **`architecture/campaigns/V1-PROGRAM/OPERATIONS.md`** — operations runbook
   mapping every external gate (BLK-3, BLK-4, BLK-5, store accounts/EXPO_TOKEN,
   BLK-2 `AI_API_KEY`, Supabase auth rate limit) to: what it unlocks, exact env
   var names (cross-checked in-repo), where obtained, injection path (Cursor
   Secrets / GitHub environment secrets / VM env file, per RULING-11/COND-006),
   and the live validation step. Includes the deploy runbook + rollback plan.
3. Additive pointer section in `infrastructure/README.md` (existing
   prior-phase content preserved untouched — §39).

## Files Changed

- NEW `infrastructure/deploy/docker-compose.yml`
- NEW `infrastructure/deploy/scholar.env.example`
- NEW `infrastructure/deploy/deploy.sh` (mode 755)
- NEW `infrastructure/deploy/README.md`
- NEW `architecture/campaigns/V1-PROGRAM/OPERATIONS.md`
- NEW `progress/v1-wave/R8-report.md` (this file)
- MODIFIED `infrastructure/README.md` (additive pointer only)

Not touched (per ownership): Dockerfile, frontend/, mobile/, scripts/,
database/, tests/, .env.example, .github/workflows/. Note: `git status` shows
other teams' concurrent modifications in the shared wave tree (frontend,
database, proofs) — not this agent's changes.

## Architecture Impact

- No runtime code touched; substrate only. The compose definition codifies the
  F-14-verified runtime shape (`srvx --prod -s ../client` resolved relative to
  the server ENTRY `dist/server/`; static dir `dist/client/`).
- `.dockerignore` excludes `infrastructure` and all `.env*` from the build
  context — verified: no deploy file can enter an image layer (§30).
- Drift findings reported (not modified, outside ownership):
  1. release.yml's deploy step uses raw `docker run --env-file` while the
     validated substrate uses compose + health-gated auto-rollback — first
     live deploy should run `deploy.sh` on the VM (or align release.yml).
  2. `.env.example` lacks `RESEND_API_KEY` / `RESEND_FROM_ADDRESS` /
     `VAPI_API_KEY` (V1-009 recorded gap) — declared in the deploy env
     manifest; authorized follow-up should update `.env.example`/`env.ts`.
  3. Dockerfile: **no drift found** — CMD correct per F-14 final (baseline
     `-s` misresolution corrected there); HEALTHCHECK matches the compose
     healthcheck I authored.

## Tests (all commands actually run in this VM; nothing fabricated)

Tooling provisioned for validation (no daemon, client-side only): Docker CLI
27.3.1 + Compose v2.29.7 installed to user/system paths — `docker compose
version` → `Docker Compose version v2.29.7`. Docker **daemon** is not running;
no image was built, pushed, or run anywhere.

| Check | Command (abridged) | Result |
| --- | --- | --- |
| Compose canonical parse (the `docker compose config` proof) | `sudo env SCHOLAR_IMAGE=ghcr.io/example/coregrid-scholar:0.0.0-dryrun docker compose config` | **exit 0** — full normalized config emitted: 21 env names resolved from the staged names-only env file, healthcheck + logging + security_opt intact |
| Fail-closed: image ref missing | `docker compose config` (no SCHOLAR_IMAGE) | **exit 15** — `required variable SCHOLAR_IMAGE is missing a value` |
| Fail-closed: env file missing | `SCHOLAR_IMAGE=x docker compose config` | **exit 14** — `env file /opt/coregrid/scholar.env not found` |
| Fail-closed: env file unreadable to non-root | parse as non-root with mode-600 root-owned file | **exit 14** — `permission denied` (correct: env file is root-only; deploy runs under sudo) |
| Script syntax | `bash -n deploy.sh` | clean (`BASH_N_OK`) |
| Secret scan (my files) | `rg "sk_live\|sk_test\|re_[A-Za-z0-9]{20}\|BEGIN … PRIVATE\|ghp_…"` over `infrastructure/deploy/` + OPERATIONS.md | 3 hits, all key-FORMAT placeholders in prose (`sk_live_...`, `sk_test_...`) — zero credential values |
| Terraform | `which terraform` | **not installed** → VM module authoring + `terraform validate` honestly SKIPPED (no fabricated result). `infrastructure/terraform/` remains authored-not-applied, frozen pending BLK-3. |
| shellcheck | `which shellcheck` | **not installed** → `bash -n` used instead (stated, not claimed) |
| docker build | — | NOT run: daemonless VM + heavy build; the image artifact's runtime behavior was already verified in-VM by F-14 (final table: /health.json, /, /coregrid, assets, sw.js, robots, favicon all 200) |

Staged placeholder env file (names only, zero values, plus
`ALLOW_DEMO_PROVISIONING=false`) was created at the contract path for the
parse proof and **removed after validation**.

## Security Validation

- No secret value exists in any committed file; compose consumes credentials
  only through the required root-owned mode-600 env_file (proved fail-closed
  by exits 14/15 above).
- `scholar.env.example` ships names + empty values only; the scan above
  confirms no credential material.
- Container hardening in the run definition: `no-new-privileges`, non-root
  image user (node:22-slim `node`), log rotation bounds, restart policy.
- Runbook enforces §30/RULING-11 injection paths and §34/§26 fail-closed
  semantics (`ALLOW_DEMO_PROVISIONING=false` pinned in the manifest).

## Known Risks

1. Substrate is parse-validated, not load-tested: first live deploy is the
   first real execution (BLK-3 gate — by design, not a claim of deployment).
2. release.yml vs deploy.sh dual deploy paths (drift #1) could cause an
   operator to bypass the health-gated rollback if they use the CI path first.
3. Compose `env_file.required: true` needs Compose ≥ 2.24 on the target VM
   (validated against v2.29.7; older engines fail loudly, which is safe).
4. Terraform VM module absent — if the target host must be provisioned as
   code, that work remains (blocked on provider credentials anyway).

## Remaining Work

- On BLK-3 credential arrival: execute `OPERATIONS.md` §1 + deploy runbook;
  record F-14 live-deploy addendum.
- Authorized follow-ups for other owners: declare the three Resend/Vapi names
  in `.env.example` + `frontend/src/lib/env.ts`; align release.yml deploy step
  with `deploy.sh` (or adopt it).
- Author + validate a Terraform VM module only if/when Terraform is available
  and a provider credential (BLK-3) exists.

No git commit/push performed; nothing deployed; no database contacted.