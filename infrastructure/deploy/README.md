# CoreGrid Scholar — single-VM deployment substrate (V1)

The sanctioned V1 deployment path (Part 31 economy): **one VM, Docker, one
service**. This directory holds the validated (not applied) run definition.
The Kubernetes and Terraform trees under `infrastructure/` stay authored-but-
FROZEN pending BLK-3 credentials.

Files (this directory only — no secrets in git, ever, §30):

| File | Purpose |
| --- | --- |
| `docker-compose.yml` | Run definition: image + env_file + healthcheck + log rotation. Contains **no** secret values; fails closed if the env file or `SCHOLAR_IMAGE` is missing. |
| `scholar.env.example` | Manifest of every env-var NAME the runtime expects (values empty). Cross-checked against `.env.example`, `frontend/src/lib/env.ts` and the lib/ adapters. |
| `deploy.sh` | Ship/run/healthcheck/rollback driver: pull → compose up → poll `/health.json` → auto-rollback to the previous image tag on failure. |

## 1. Build (CI or local)

The image is built from the repo-root `Dockerfile` (multi-stage: deps → build
→ `node:22-slim` runtime, non-root `node` user, no secrets in any layer —
`.dockerignore` excludes every `.env*` file and the whole `infrastructure/`
tree from the build context).

- **CI:** push a `v*` tag → `.github/workflows/release.yml` runs `npm run
  verify`, then builds and pushes
  `$DOCKER_REGISTRY/$DOCKER_NAMESPACE/coregrid-scholar:<version>` and
  `:<git-sha>`.
- **Local (optional):** `docker build -t <registry>/<ns>/coregrid-scholar:<tag> .`
  VITE_PUBLIC_* build args are build-time, non-secret values — pass them as
  `--build-arg`, never as runtime env.

## 2. Ship

1. Provision the VM (any Linux host with Docker Engine + compose plugin).
2. Create `/opt/coregrid/scholar.env` **out-of-band** (SSH/secret manager),
   mode `600`, root-owned, from the shape in `scholar.env.example`, filled
   with real values. Never commit it, never paste it into chat.
3. Push the image to the registry the VM can pull from.

## 3. Run

```bash
sudo ./deploy.sh <registry>/<ns>/coregrid-scholar:<tag>
```

The driver refuses to run (fail-closed) when the env file is missing or not
mode `600`; it pulls the new image **before** touching the running container;
then `docker compose up -d` swaps the service.

## 4. Healthcheck

- In-container: compose/Dockerfile `HEALTHCHECK` polls `/health.json` every
  30s (200 = ok/degraded, 503 = failing → orchestrator may drain).
- Deploy gate: `deploy.sh` polls `http://127.0.0.1:<port>/health.json` for
  `HEALTH_TIMEOUT_SECS` (default 120s) before declaring success.
- External proof: `curl -fsS https://<host>/health.json` (expect
  `{"status":"ok",...}`) and `curl -fsSI https://<host>/coregrid` (expect
  200). F-14 verified this exact smoke against the production start command
  in-VM: `node node_modules/srvx/bin/srvx.mjs --prod -s ../client
  dist/server/server.js` (note: `-s ../client` resolves relative to the
  server ENTRY `dist/server/`, not the CWD — this detail is load-bearing).

## 5. Rollback (§38 mandatory)

Automatic: if the new release is not healthy within the window, `deploy.sh`
re-deploys the previously running image tag (captured from
`docker inspect ... .Config.Image` before the swap) and re-polls health.

Manual:

```bash
sudo ./deploy.sh --rollback          # redeploys the last-known image
# or pin an arbitrary known-good tag:
sudo ./deploy.sh <registry>/<ns>/coregrid-scholar:<known-good-tag>
docker logs coregrid-scholar          # inspect the failed attempt if needed
```

Images are never deleted by the driver, so known-good tags remain on the VM.

## Validation status (honesty law)

Validated 2026-10-03 in-VM, no credentials, nothing deployed:

- `docker compose config` (real Docker CLI 27.3.1 + Compose v2.29.7,
  installed tooling-side; no daemon needed for parse): **exit 0** with
  `SCHOLAR_IMAGE` set and a names-only env file staged at the contract path.
- Fail-closed proofs: missing `SCHOLAR_IMAGE` → compose exits non-zero with
  the required-variable error; missing/unreadable env file → compose refuses
  to load.
- `bash -n deploy.sh` → clean. (`shellcheck` is not installed in this VM —
  not run, not claimed.)
- No image was built, pushed, or run anywhere; no credential exists on disk.