# Infrastructure

Home of the **CoreGrid Cloud Fabric** — the vendor-neutral infrastructure layer
that powers CoreGrid and every future domain runtime. Scholar is its first
consumer, never its design input.

**Owner:** Phase 21 — Global Cloud Fabric (`architecture/phase-21-global-cloud-fabric.md`).
**Blueprint:** `architecture/cloud-fabric-implementation-blueprint.md`.
**Plan:** `architecture/cloud-fabric-migration-plan.md` (waves CF-0…CF-12).

## Current state (evidence-based, 2026-09-13)

| Layer | State |
| --- | --- |
| IaC (Terraform) | **Authored** — 6 modules, 5 provider roots, 1 production composition |
| Kubernetes baseline | **Authored** — 8 namespaces, quotas, default-deny policies, PSA, RBAC, sandbox isolation |
| Monitoring / security / agent runtime / n8n / runtime cutover | **Not deployed** (waves CF-8…CF-12, credential-gated) |
| Provider credentials | **Not supplied** — see `CREDENTIALS.md`; nothing is applied without them |
| Toolchain here | Node + git only (no terraform/kubectl/helm/docker), so IaC is proven structurally by `verify:infrastructure` |

No Docker, CI/CD or cloud configuration existed in this repository before this
wave. Deployment was the hosted Supabase project plus the web build output.

## Layout

```
infrastructure/
├── CREDENTIALS.md     credential checklist (names only — never values)
├── CREDENTIALS-WALKTHROUGH.md   step-by-step acquisition per provider + rotation
├── .gitignore         state, plans, tfvars, kubeconfig, generated backend config
├── terraform/         providers, modules, production composition (see its README)
├── kubernetes/        cluster baseline (namespaces, policy, quotas, RBAC, sandbox)
├── monitoring/        observability values (CF-9, not deployed)
└── workloads/         deployable service manifests (images injected by CI)
```

## Commands

```bash
npm run verify:infrastructure        # proves the fabric's source invariants (no credentials)
npm run preflight:infrastructure     # read-only credential/scope doctor; names the blocked waves
npm run preflight:infrastructure -- --static   # contract + presence only, no secrets needed
npm run bootstrap:infrastructure     # prepares backend.hcl + prints the exact apply sequence (dry run)
node scripts/infrastructure/supabase-config-check.mjs --static   # data-layer contract check
node scripts/db-apply.mjs            # apply migrations (needs DATABASE_URL)
node scripts/db-apply-one.mjs <prefix> --dry-run                 # one migration, dry run
```

## Laws this fabric obeys

1. **Ownership** — no identity, authorization, policy, analytics, workflow or twin
   engine is built here; those are consumed from their owning phases.
2. **No credentials in git, ever** — references only; secret variables `sensitive`.
3. **Remote state only** — local state is a defect.
4. **Domain-neutral** — no vertical's vocabulary in the fabric (machine-checked).
5. **Fail closed** — a missing secret, an unreachable provider or an unproven
   residency rule stops the plan instead of degrading isolation.
6. **Evidence** — `architecture/proofs/cloud-fabric-foundation.proof.json` binds
   the proof to a digest of every infrastructure file.

## What happens next

Waves CF-4…CF-12 need credentials supplied out-of-band (never in chat, never in
git). See `CREDENTIALS.md` for the exact list, minimum privilege, storage location
and rotation expectations, then follow `architecture/cloud-fabric-migration-plan.md`.

Environment variables in `.env.example` remain the application runtime's contract;
infrastructure variables are `TF_VAR_*` and never enter the application bundle.

## V1 deployment path (sanctioned — Part 31 economy)

The V1 launch deployment is a **single VM running Docker**. No Kubernetes, no
service mesh, no multi-region. The `terraform/` and `kubernetes/` trees remain
**authored but FROZEN pending BLK-3 credentials** — nothing in them is applied.

### Runtime shape (verified against `vite build` output)

| Artifact | Path |
| --- | --- |
| Static client assets | `dist/client/` |
| Start server entry (fetch-style handler, not a runnable server) | `dist/server/server.js` |
| Production server | `srvx` CLI (already in the dependency tree via nitro/h3 — no new dependency) |

Start command (verified on this branch):

```
node node_modules/srvx/bin/srvx.mjs --prod -s ../client dist/server/server.js
```

`srvx` serves `dist/client/` as static assets and forwards everything else to
the Start handler. The port is `PORT` (default 3000).

### Docker image

`Dockerfile` (repo root) is multi-stage (deps → build → `node:22-slim`
runtime), runs as the non-root `node` user, `EXPOSE`s 3000, and its
`HEALTHCHECK` polls the health endpoint. `.dockerignore` keeps `node_modules`,
`dist`, `.git`, `tests`, `docs` and every `.env*` file out of the build
context — **no secret can enter an image layer**. All application environment
is injected at `docker run` time only (`--env-file`), never baked.

### `/health.json` contract

Unauthenticated, leak-free machine health endpoint (`frontend/src/routes/health[.]json.ts`):

- `200` with a whitelisted JSON payload (`status`, `ts`, `uptime_s`, `memory`, `version`, `checks`) for `ok`/`degraded`
- `503` when `status` is `failing` — orchestrators may drain the instance
- `Cache-Control: no-store`

### Environment variable contract (names only — never commit values)

Runtime-only, supplied via `--env-file /opt/coregrid/scholar.env` on the VM
(file permissions 600, owned by root — created out-of-band, never in git):

- `PORT` — listen port (default 3000)
- `NODE_ENV` — set to `production` in the image
- `SUPABASE_URL` — project URL
- `SUPABASE_ANON_KEY` — browser-safe anon key
- `SUPABASE_SERVICE_ROLE_KEY` — server-only; must never reach the client bundle
- `VITE_PUBLIC_*` variables — build-time (injected as build args), not runtime secrets

See `.env.example` for the authoritative list.

### CI/CD

`.github/workflows/release.yml` runs on `v*` tag push:

1. **verify** — `npm ci` + `npm run verify` (typecheck, unit tests, registry validation, secret scan, build)
2. **build-and-push** — builds and pushes the image to the registry configured via `DOCKER_*` secrets (referenced by name only, never echoed)
3. **deploy** — gated on the `production` GitHub environment (human approval). It **fails closed** with `deployment credentials not configured (BLK-3)` until `DEPLOY_SSH_HOST` / `DEPLOY_SSH_USER` / `DEPLOY_SSH_KEY` are configured.

All third-party actions are pinned to commit SHAs.
