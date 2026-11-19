# ADR-110: Production Hardening: Route Budgets, Tracing Facade, Freshness and Uptime Probes

| Field                      | Value                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Status                     | PROPOSED (founder review of the route-budget allowlist is required before the budget check joins `npm run verify`)                         |
| Date                       | 2026-11-17                                                                                                                                 |
| Author                     | Claude Code agent (mission M23 implementation)                                                                                             |
| Creator                    | Claude Code agent, mission E-013 (M23 production hardening tooling)                                                                        |
| Mission                    | M23 (production hardening), the parts that need no paid service and no cloud account                                                       |
| Capabilities               | Measure and cap route JavaScript; trace server work without a vendor; alert on stale backups and a failing health endpoint                 |
| Cites                      | Master brief §2.2 items 13 and 14, §12.1 M23, §13.1; [ADR-101](./ADR-101_SEC_M0_ANONYMOUS_SURFACE_AND_PRIVATE_BY_DEFAULT.md) (health ping) |
| Minimal ownership artifact | `scripts/verify-route-budgets.mjs`, `frontend/src/lib/observability/tracing.ts`                                                            |

## Context

The brief sets a shell budget of 170 KB gzip and 60 KB per screen, asks for OpenTelemetry with Datadog's free tier as the production target, and asks for uptime and backup-freshness alerts. On master 24ed7825 the /home shell is 242.89 KiB gzip against an enforced 250 KiB limit, and five lazily loaded chunks exceed 60 KiB. The repository has no direct `@opentelemetry` dependency (only `@opentelemetry/api`, pulled in by the staging-only Sentry SDK), and no Datadog account is set up.

## Options

- **Budgets. A:** fail the build at 170 KiB now. Rejected: it fails master today. **B:** report against 170 KiB, enforce the existing 250 KiB, and enforce 60 KiB per lazy chunk, with a reviewed allowlist that holds today's offenders to their measured size plus about 2%. Chosen.
- **Tracing. A:** add the OpenTelemetry SDK or `dd-trace`. Rejected: new dependencies, larger server bundle, vendor lock-in. **B:** a small facade that exports OTLP/HTTP JSON over `fetch`, no-op unless `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is set, with a strict attribute allowlist. Chosen.
- **Alerts. A:** a paid uptime service. Rejected (free tier only). **B:** scheduled GitHub Actions workflows whose failed runs are the alert. Chosen.

## Decision

1. `scripts/verify-route-budgets.mjs` uses the same manifest and gzip level as `verify-home-bundle.mjs`. KB in the brief is read as KiB, matching the existing 250 KiB budget. A chunk's size is its own file plus static imports not already in the shell. The allowlist is `scripts/verification/route-budget-allowlist.json`, marked review PENDING. The script is an npm script (`verify:route-budgets`) and is **not** in the `verify` chain until that review is done, because otherwise five unreviewed exceptions would be frozen in silently.
2. `frontend/src/lib/observability/tracing.ts` (pure) and `tracing.server.ts` (environment wiring). Only keys in `SPAN_ATTRIBUTE_ALLOWLIST` survive, each with a value kind. String values that look like credentials, emails, long digit runs or UUIDs are dropped. Routes must be templates without a query string. Errors keep their type, never their message. No request bodies, headers, user ids or tenant ids can be attached. The application reads no API key or header variable: a vendor key lives in the collector.
3. **How Datadog's free tier would receive it (NOT CONFIGURED):** run the Datadog Agent (or an OpenTelemetry Collector with the Datadog exporter) next to the server with its OTLP/HTTP receiver on port 4318. Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces` and `OTEL_SERVICE_NAME=sherivs-web` on the server. The Agent holds `DD_API_KEY`. UNVERIFIED: which Datadog free-tier products accept APM traces, and how much they retain. Check the plan before enabling this. Vercel serverless functions have no sidecar, so production would need a hosted collector. That is a separate decision.
4. `backup-freshness.yml` runs daily with `actions: read` and fails when the newest successful `nightly-db-backup` run is older than 26 hours or has no unexpired artifact. `uptime-probe.yml` runs hourly and requests `vars.SHERIVS_HEALTH_URL`. It fails unless the answer is 200 with `database: ok`, and reports BLOCKED and exits 0 when the variable is unset. Both pin actions by SHA and reference no secret.

## Deliberately not done

- No Datadog organisation, API key, agent or collector. No traces leave any environment today.
- No alert routing beyond GitHub's own failed-run notifications (no email, SMS or owner-alert channel wiring).
- No restore drill was executed. `docs/runbooks/backup-restore-drill-checklist.md` is the checklist and evidence template.
- The tracing facade is not wired into any route. `health.ts` and `db-health.server.ts` are unchanged.
- No translations were written. The ha, yo and ig catalogues are empty and marked TRANSLATOR_REQUIRED.

## Golden questions

- WHO: the founder reviews the allowlist and decides on a collector. Agents maintain the scripts.
- WHAT: budgets, a tracing facade, two probes, i18n scaffolding and a drill checklist.
- WHERE: `scripts/`, `.github/workflows/`, `frontend/src/lib/observability/`, `frontend/src/lib/i18n/`, `tests/load/`, `docs/runbooks/`.
- WHY: §2.2 items 13 and 14 and §12.1 M23 of the master brief.
- UNDER WHICH POLICY: free tier only, never point load at production, never print secrets.

## UNKNOWNs

- Datadog free-tier APM eligibility and retention (UNVERIFIED).
- Whether GitHub scheduled runs are reliable enough for hourly uptime checks (they can be delayed or skipped).
