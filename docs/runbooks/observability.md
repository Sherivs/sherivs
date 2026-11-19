# RUNBOOK — Observability vendors and switches (OBS-DD-01)

Origin: owner decision of 17 Nov 2026 (Datadog behind a switch; Sentry and PostHog kept).
Creator: Tumi (Grok Bot) agent, mission O-001 (OBS-DD-01, Datadog over OpenTelemetry)
Created: 2026-11-17

Status: **AUTHORED** with the PR that adds Datadog over OpenTelemetry behind a switch.
Owner decision (17 Nov 2026): add Datadog through OpenTelemetry behind a switch, keep
Sentry and PostHog running, and turn them off once the Datadog startup credits land.
Authority: AGENTS.md §29 (observability), §30 (secrets). NDPA 2023 / GDPR apply:
Sherivs processes children's data.

Names only in this file. Never paste a key, DSN or token into the repo (it is public).

## 1. What runs today

| Vendor          | Signal                                                        | Where it runs                       | Gate                                                                                                           | Code                                                                                 |
| --------------- | ------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Sentry          | errors + 10% traces (browser + server)                        | **staging only** (INFRA-01)         | `APP_ENV` and `VITE_APP_ENV` both exactly `staging`, a DSN, **and** `OBSERVABILITY_SENTRY_ENABLED` not `false` | `frontend/src/lib/observability/sentry-*.ts`                                         |
| PostHog (EU)    | product analytics, after consent only                         | **staging only** (INFRA-01)         | same staging gate, a project key, consent, **and** `OBSERVABILITY_POSTHOG_ENABLED` not `false`                 | `frontend/src/lib/analytics/posthog.ts`                                              |
| Datadog (EU)    | server traces (+ optional request metrics) over OpenTelemetry | any environment, **off by default** | `OBSERVABILITY_DATADOG_ENABLED` exactly `true`, `DD_API_KEY` set, EU site only                                 | `frontend/src/lib/observability/datadog-otel*.ts`, wired in `frontend/src/server.ts` |
| Structured logs | JSON lines to stdout (Vercel logs)                            | everywhere                          | always on                                                                                                      | `structured-log.ts`, `boundary-log.ts`, `trace-context.ts`                           |

The switches can only **turn a vendor off**. They never turn Sentry or PostHog on outside
explicit staging; INFRA-01 still decides that.

## 2. Switches

| Variable                                | Default     | Turns the vendor off/on when | Scope                                                                                                                                  |
| --------------------------------------- | ----------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `OBSERVABILITY_SENTRY_ENABLED`          | on (unset)  | exactly `false` → off        | server at runtime; browser at the next production build (baked into `VITE_OBSERVABILITY_SENTRY_ENABLED`); also skips source-map upload |
| `OBSERVABILITY_POSTHOG_ENABLED`         | on (unset)  | exactly `false` → off        | browser, baked at the next production build (`VITE_OBSERVABILITY_POSTHOG_ENABLED`)                                                     |
| `OBSERVABILITY_DATADOG_ENABLED`         | off (unset) | exactly `true` → on          | server at runtime (new function instances)                                                                                             |
| `OBSERVABILITY_DATADOG_METRICS_ENABLED` | off (unset) | exactly `true` → on          | server; adds the `http.server.request.duration` histogram                                                                              |

Values are compared exactly: `TRUE`, `1`, `yes` and a trailing space all keep the default.
A typo therefore never changes today's behaviour.

## 3. Datadog intake choice

- **Path:** agentless OTLP over HTTP/protobuf from the Vercel function straight to
  Datadog's EU1 intake: `https://otlp.datadoghq.eu/v1/traces` (and `/v1/metrics`).
  No Datadog Agent, no Collector, no always-on server, no extra cost on our side.
- **Why:** Vercel functions cannot run an Agent or Collector sidecar. Datadog documents
  the direct OTLP intake for exactly this case ("serverless functions … where deploying a
  Collector or Agent is not feasible"). `http/protobuf` is the protocol Datadog documents
  for the JavaScript exporter (`@opentelemetry/exporter-trace-otlp-proto`); gRPC is not
  supported by the intake.
- **Headers:** `dd-api-key` and `compute_stats=true` (without it Datadog does not compute
  APM trace metrics for directly ingested traces).
- **Metrics:** delta temporality only (the intake rejects cumulative). Off by default
  because OTLP metrics count as Datadog custom metrics; APM trace metrics from
  `compute_stats` already give request rate, latency and errors.
- **Logs:** not exported over OTLP. They stay in Vercel's logs. If wanted later, use the
  Datadog–Vercel log drain or the OTLP logs intake, after a PII review.
- **Alternative:** Datadog also lists a Vercel managed-platform endpoint
  (`https://vercel.integrations.otlp.datadoghq.eu`), tied to the Vercel Marketplace
  integration. It can be selected with `OTEL_EXPORTER_OTLP_ENDPOINT` without a code change.
- **Data residency:** the code refuses any `DD_SITE` other than `datadoghq.eu` and any
  endpoint that is not `https://…datadoghq.eu`. Misconfiguration means no export, never
  export to the US.

Docs: <https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/>,
<https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/traces/>,
<https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/metrics/>,
<https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/managed_platforms/>,
<https://docs.datadoghq.com/getting_started/site/>.

## 4. What Datadog receives (privacy)

- Resource: `service.name` (`sherivs-web` or `OTEL_SERVICE_NAME`), `service.version`
  (`VERCEL_GIT_COMMIT_SHA`), `deployment.environment.name` and `deployment.environment`
  (explicit `APP_ENV`, else `VERCEL_ENV`).
- One SERVER span per request named `METHOD /route/template`.
- Span attributes are an **allowlist**: `http.request.method`, `http.route`, `url.path`,
  `http.response.status_code`, `error.type` (exception class name only),
  `sherivs.trace_id` (the existing random trace id, for joining with Vercel logs),
  `sherivs.component`.
- Paths are templated: query strings and hashes are dropped; ids, numbers, long tokens,
  emails, phone numbers and any segment that is not a static segment of the generated
  route tree become `:id`. A `$slug` or `$param` value never leaves the platform.
- No request or response bodies, headers, cookies, IPs, user ids, names, emails, phones,
  student data or exception messages. The exporter re-scrubs every span before sending
  (defence in depth) and drops the batch if scrubbing fails.
- The OTel providers are private (not registered as globals), so they do not interfere
  with Sentry's own OpenTelemetry use on staging.

## 5. Env vars to set in Vercel (project `coregrid-scholar-migration`) when turning Datadog on

| Name                                       | Value                                                                                  | Type          |
| ------------------------------------------ | -------------------------------------------------------------------------------------- | ------------- |
| `OBSERVABILITY_DATADOG_ENABLED`            | `true`                                                                                 | plain         |
| `DD_API_KEY`                               | Datadog EU org **API key** (Organization Settings → API Keys). Not an application key. | **Sensitive** |
| `DD_SITE`                                  | `datadoghq.eu` (optional; this is the default)                                         | plain         |
| `OTEL_SERVICE_NAME`                        | optional, default `sherivs-web`                                                        | plain         |
| `OTEL_EXPORTER_OTLP_ENDPOINT`              | optional, default `https://otlp.datadoghq.eu`                                          | plain         |
| `OBSERVABILITY_DATADOG_TRACES_SAMPLE_RATE` | optional, `0`–`1`, default `0.1`                                                       | plain         |
| `OBSERVABILITY_DATADOG_METRICS_ENABLED`    | optional, `true` to send request metrics                                               | plain         |

Roll out on **Preview** first, check APM → Traces in `app.datadoghq.eu` for
`service:sherivs-web env:<preview env>`, then add to Production. Server env changes apply
to new deployments (redeploy to be sure).

## 6. Cutover when the Datadog credits land

1. Datadog enabled on Production and seen working for at least a week (errors visible in
   APM → Error Tracking, latency in Service page).
2. Set `OBSERVABILITY_SENTRY_ENABLED=false` and `OBSERVABILITY_POSTHOG_ENABLED=false` on
   the staging/preview environment and **redeploy** (the browser switches are baked at
   build time).
3. Confirm no new events in Sentry / PostHog for that environment.
4. Only then remove the Sentry/PostHog keys from Vercel and, in a later PR, the SDKs.
   Product analytics has no Datadog replacement on the free tier; decide on RUM/Product
   Analytics before removing PostHog.

Rollback at any step: unset the switch (or set it back) and redeploy.

## 7. Known limits

- The first request(s) on a cold function instance are not traced while the SDK loads.
- The span ends when the response is returned; streamed SSR body time is not included.
- Flushing uses Vercel's `waitUntil` (via the Nitro request, the handler context, or the
  Vercel request context). If none is available, the batch processor exports on its own
  timer and spans from a frozen instance can be lost.
- Datadog's free plan does not include APM; traces are expected to need the trial or
  startup credits.

## 8. sherivs-cron (Cloudflare Worker) → Datadog EU (OBS-DD-02)

The scheduler Worker exports one span and one log record per route call to Datadog's EU
agentless OTLP intake (`https://otlp.datadoghq.eu/v1/traces` and `/v1/logs`, OTLP/HTTP JSON).
Code: `infra/cloudflare/sherivs-cron/src/telemetry.js`. Cloudflare's built-in OTLP
destinations need Workers Paid, so the Worker sends the data itself; that stays on Workers Free
(at most two extra subrequests per invocation, only when a route was called).

| Setting                         | Where                                                    | Default                                  |
| ------------------------------- | -------------------------------------------------------- | ---------------------------------------- |
| `OBSERVABILITY_DATADOG_ENABLED` | `wrangler.jsonc` var                                     | `"false"` (exactly `"true"` turns it on) |
| `DD_API_KEY`                    | Worker **secret** (`npx wrangler secret put DD_API_KEY`) | unset → off                              |
| `DD_SITE`                       | var                                                      | `datadoghq.eu`; anything else → off      |
| `DEPLOYMENT_ENVIRONMENT`        | var                                                      | `production` / `staging` → `env` tag     |
| `CF_VERSION_METADATA`           | `version_metadata` binding                               | Worker version id → `version` tag        |

Tags follow unified service tagging: `service:sherivs-cron`, `env:<DEPLOYMENT_ENVIRONMENT>`,
`version:<Worker version id>`. Exported fields: route name, fixed path, HTTP status, duration,
response byte count, trigger (`scheduled`/`manual`), outcome. Never bodies or credentials.

Turn on (needs Muhammad's yes in production): set the secret, change the var to `"true"`, deploy,
then check Logs for `service:sherivs-cron` and APM for the `cron <route>` spans. Rollback: set
the var back to `"false"` and deploy (or delete the secret).

## 9. Monitors, dashboard and service catalog as code

`infra/datadog/monitors/*.json`, `infra/datadog/dashboards/sherivs-overview.json`,
`service.datadog.yaml` (sherivs-web) and `infra/cloudflare/sherivs-cron/service.datadog.yaml`.
All notify `@hello@sherivs.com`. Apply from a trusted shell with an EU **application key**:

```sh
DD_API_KEY=… DD_APP_KEY=… node scripts/datadog/apply.mjs            # plan + remote validation
DD_API_KEY=… DD_APP_KEY=… node scripts/datadog/apply.mjs --apply    # create/update
# add --with-worker-telemetry once the Worker switch is on (the two cron monitors would
# otherwise alert on missing data)
```

The script is idempotent (monitors match on the `sherivs-monitor-id` tag, the dashboard on its
title), refuses any site other than `datadoghq.eu`, and never prints keys. Change monitors in the
repo, not the UI.

| Monitor                | Signal                                                                   | Alert / warn |
| ---------------------- | ------------------------------------------------------------------------ | ------------ |
| `web-5xx-rate`         | APM `trace.http.server.request` errors ÷ hits, 15 min, ≥20-request floor | 10% / 5%     |
| `web-error-spike`      | APM errors, 5 min                                                        | 25 / 10      |
| `web-latency-p95`      | APM p95, 15 min                                                          | 3 s / 1.5 s  |
| `cron-wallet-failures` | Worker logs, `@cron.outcome:failure`, 30 min                             | ≥2           |
| `cron-wallet-missing`  | Worker logs, no wallet run in 30 min (also on no data)                   | <1           |

## 10. Cost and the post-trial $0 plan

Monitors, dashboards and service catalog entries cost nothing on any plan. What costs money is
the data: APM spans (OTLP APM ingest $0.50/GB plus indexed spans) and logs (ingest $0.10/GB plus
indexing) are **not** part of Datadog's Free tier (Free = up to 5 Basic hosts, 1-day metric
retention). Sherivs is on a 14-day trial with no card on file.

- While the trial or startup credits cover it: switches may be on.
- Trial ends with no credits: set `OBSERVABILITY_DATADOG_ENABLED` to unset/`false` on Vercel
  production (redeploy) and leave the Worker var `"false"`. Sentry/PostHog keep running behind
  their own switches. Monitors and the dashboard stay in place and will simply show no data.
- Never add a card or accept a paid plan without Muhammad's yes.
