# Sherivs load tests (k6, local only)

Mission M23 (ADR-110). `smoke.k6.js` is a small smoke load test with three scenarios: the public
home page (`/`), the health endpoint (`/health.json`) and the sign-in page (`/auth`).

**Local targets only.** The script refuses to start against any host other than `localhost` or
`127.0.0.1`. It always refuses `sherivs.com`, `app.sherivs.com`, every other `*.sherivs.com` host
and `*.supabase.co`, even with the override below. Never point it at production (master brief
§2.2 rule 12).

## Install k6 (free, open source)

k6 is a single free binary from Grafana Labs (AGPL-3.0). It is not an npm dependency of this
repository and nothing here needs a Grafana Cloud account.

- macOS: `brew install k6`
- Debian/Ubuntu: follow the apt instructions at https://grafana.com/docs/k6/latest/set-up/install-k6/
- Windows: `winget install k6 --source winget`
- Any Linux, no root: download `k6-vX.Y.Z-linux-amd64.tar.gz` from
  https://github.com/grafana/k6/releases, unpack it, and run the `k6` binary inside.
- Docker: `docker run --rm -i --network host grafana/k6 run - < tests/load/smoke.k6.js` does NOT
  work, because the script imports `./target-guard.js`. Mount the folder instead:
  `docker run --rm --network host -v "$PWD/tests/load:/load" grafana/k6 run /load/smoke.k6.js`

Check: `k6 version`.

## Run

1. Start the app locally on port 8080, as `AGENTS.md` describes (local Supabase running and the
   local env file in place, otherwise `/` answers 500 and `/health.json` answers 503):
   `npm run dev -- --host 0.0.0.0 --port 8080 --strictPort`
   or, for numbers closer to production, build and serve the build:
   `npm run build && PORT=8080 node .output/server/index.mjs`
2. In another terminal:
   `k6 run tests/load/smoke.k6.js`

Options (all through `-e NAME=value`):

| Name                      | Default                 | Meaning                                                                            |
| ------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| `BASE_URL`                | `http://localhost:8080` | Target origin. Only the scheme, host and port are used.                            |
| `VUS`                     | `5`                     | Virtual users per scenario.                                                        |
| `DURATION`                | `30s`                   | Duration of each scenario (they run in parallel).                                  |
| `K6_ALLOW_NON_LOCAL_HOST` | unset                   | Must equal the exact host in `BASE_URL` to allow a non-local, NON-PRODUCTION host. |

Example against your own non-production machine on the local network:

```
k6 run -e BASE_URL=http://devbox.lan:8080 -e K6_ALLOW_NON_LOCAL_HOST=devbox.lan tests/load/smoke.k6.js
```

## Thresholds

The run fails when more than 1% of requests fail, when fewer than 99% of checks pass, or when the
95th percentile response time is above 1.5 s for the home and sign-in pages or 0.8 s for the
health endpoint. A local stack without a database answers `/health.json` with 503 and a valid
report; the script counts that as a correct answer. Whether production health is ok is the uptime
probe's job (`.github/workflows/uptime-probe.yml`).

## What this is not

It is not a capacity test, and its numbers on a laptop say little about production. No result
from this script has been recorded as evidence of production performance.

The guard's rules are unit-tested in `tests/unit/m23-load-target-guard.test.ts`.
