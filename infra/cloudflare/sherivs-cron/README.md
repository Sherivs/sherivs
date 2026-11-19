# sherivs-cron

This Worker schedules the existing authenticated `/api/public/cron/*` endpoints. It uses one
`* * * * *` trigger and the route table in `src/index.js` to apply UTC cadence and exact-string
`"true"` enablement independently. The default configuration keeps wallet reconciliation enabled;
all other routes are off. No route is enabled in production by this change.

The Worker is a free-tier-compatible project: it makes no more than six route subrequests per
scheduled invocation, plus at most two Datadog export requests when telemetry is on. Per-request timeouts are 50 seconds for `workflow-tick` and 25 seconds for other routes.
It logs statuses, durations, and response byte counts only; response bodies and credentials are
never logged or returned.

## Credentials and deployment

Use Wrangler v4 from this directory. Supply `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` through the deployment environment; do not put them in this repository.
Set the `CRON_SECRET` Worker secret interactively with `npx wrangler secret put CRON_SECRET` (add
`--env staging` for staging). Do not place the secret in a command argument, config var, or file.

Before deploying, inspect `wrangler.jsonc` and confirm `preview_urls` is `false`; deploys must keep
preview URLs off. `workers_dev` remains `true`. For staging, replace the
`https://staging-placeholder.invalid` `TARGET_BASE_URL` with the HTTPS URL of the staging
deployment only. It must point at staging, never production. The sample placeholder intentionally
does not resolve to an application.

Production (operator action only; not run by this change):

```sh
npx wrangler deploy
```

Staging (operator action only; not run by this change):

```sh
npx wrangler deploy --env staging
```

The default production vars preserve `ROUTE_WALLET_TOPUP_RECONCILE = "true"` and set every other
route to `"false"`. Staging enables only `ROUTE_WORKFLOW_TICK`; wallet reconciliation and every
other route are off. Keep `WORKFLOWS_ENABLED` unset in production and do not enable any
organization. Route-setting changes require a separate explicit decision for that route; enabling
the Worker route does not enable any organization's workflows.

| Route                    | Setting                        | Default  | UTC cadence              |
| ------------------------ | ------------------------------ | -------- | ------------------------ |
| `wallet-topup-reconcile` | `ROUTE_WALLET_TOPUP_RECONCILE` | `"true"` | Every 10 minutes         |
| `workflow-tick`          | `ROUTE_WORKFLOW_TICK`          | Off      | Every minute             |
| `org-notifications`      | `ROUTE_ORG_NOTIFICATIONS`      | Off      | Every 5 minutes          |
| `jarvis-tick`            | `ROUTE_JARVIS_TICK`            | Off      | Every 10 minutes         |
| `integrations-sync`      | `ROUTE_INTEGRATIONS_SYNC`      | Off      | Every 30 minutes         |
| `org-weekly-reports`     | `ROUTE_ORG_WEEKLY_REPORTS`     | Off      | Monday 05:00 (06:00 WAT) |

After an approved deployment, verify `preview_urls` remains off in Cloudflare's Worker settings and
inspect activity with:

```sh
npx wrangler tail
```

For manual verification, use the Worker URL with a single `?route=<table-name>` and the
`Authorization` header populated from the Worker secret. The endpoint accepts only a route name from the fixed table; it
does not accept a URL and returns only `{route, status, ms}`. An invalid bearer returns an empty
401 response, unknown routes return 404, and disabled routes return 409.

## Datadog telemetry (off by default)

`src/telemetry.js` sends one span and one log per route call to Datadog EU over OTLP when
`OBSERVABILITY_DATADOG_ENABLED` is exactly `"true"` and the `DD_API_KEY` Worker secret is set
(`npx wrangler secret put DD_API_KEY`, never in a file or argument). `DD_SITE` must be
`datadoghq.eu`. Production ships with the switch `"true"` (approved 18 Nov 2026); staging stays `"false"`. Export failures never affect a route. See
`docs/runbooks/observability.md` sections 8–10 and `service.datadog.yaml` in this directory.

## Local checks

```sh
npm ci --no-audit --fund=false
npx wrangler deploy --dry-run
npx vitest run ../../../tests/unit/sherivs-cron-worker.test.ts ../../../tests/unit/sherivs-cron-telemetry.test.ts
```

The deploy dry-run is for local configuration validation only and does not deploy. The repository
test suite also runs the Worker tests through `npm run test:unit`.
