# F-14 Deployment Verification — FINAL (post-Wave-4 build)

Date: 2026-10-03 | Build: full `npm run verify` output (commit f60f2be tree)

## Method
Production start exactly per Dockerfile CMD (entry-relative static dir):
`node node_modules/srvx/bin/srvx.mjs --prod -s ../client dist/server/server.js`

Invocation note (corrects the baseline report): srvx resolves `-s <dir>` relative to the
server ENTRY (`dist/server/`), not the CWD. The baseline run's `./dist/client` therefore
fell back to the default `public/` — its sw.js/robots 404s were partly invocation artifact.
At baseline the files were ALSO genuinely absent from `dist/client` (the publicDir bug);
both defects existed and V1-001 fixed the real one. Final run uses the Dockerfile's exact CMD.

## Results (final)
| Check | Result |
|---|---|
| Server start | PASS — srvx 0.11.21, static dir `./dist/client/` resolved |
| GET /health.json | 200 — `{"status":"ok",...}` |
| GET / (root shell) | 200 |
| GET /coregrid (public site) | 200 |
| GET /assets/index-CPtokDb9.js | 200 (built JS served) |
| GET /sw.js | 200 (offline-shell SW ships) |
| GET /robots.txt | 200 |
| GET /favicon.ico | 200 |

## Status
- ENGINEERING COMPLETE for the deployment artifact; in-VM production start + smoke verified.
- Live-host deploy remains BLK-3 EXTERNAL GATE (no deploy SSH / Terraform credentials in this
  environment). Not claimed live.
- Correction recorded: Dockerfile CMD is correct as authored; baseline 404s were the missing
  public files (fixed) plus my misresolved static flag (corrected here).
