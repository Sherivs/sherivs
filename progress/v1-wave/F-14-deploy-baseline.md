# F-14 Deployment Verification — Baseline Evidence (pre-Wave-1 build)

Date: 2026-10-03 | Environment: in-VM (Docker unavailable in this VM — no docker binary; reported honestly)

## Method
Production start identical to Dockerfile CMD:
`node node_modules/srvx/bin/srvx.mjs --prod -s ./dist/client dist/server/server.js`

## Results (baseline, commit 9f12052 build)
| Check | Result |
|---|---|
| Server start | PASS — srvx 0.11.21, listening :3000 |
| GET /health.json | 200 |
| GET / (root shell) | 200 |
| GET /sw.js | **404 — CONFIRMED BUG** (publicDir mismatch; V1-001 in flight) |
| GET /robots.txt | **404 — same bug** |

## Findings
1. Production server artifact is runnable and healthcheck endpoint serves 200 in-VM — deployment path is real, pending BLK-3 credentials for live host deploy.
2. PWA build bug reproduced against the actual artifact (not just source inspection).

## Final verification plan
After Wave 1 + integration: rebuild (`npm run build`), restart server, re-run smoke (expect sw.js/robots 200), capture /health.json + installability manifest check, then report per §42. Live-host deploy remains BLK-3 EXTERNAL GATE.
