# CoreGrid Cloud Fabric — monitoring values

The observability stack runs in `coregrid-monitoring`. This directory holds the
declarative values/configuration it is deployed with (CF-9).

## Signals

| Signal | Source | Retention | Notes |
| --- | --- | --- | --- |
| Metrics | node/pod/service exporters + application `/metrics` | 30d (raw) → object storage (long term) | scrape targets opt in via `coregrid.io/scrape=enabled` |
| Logs | container stdout/stderr + cluster audit | 30d | never log secrets or unnecessary private data (Constitution §29) |
| Traces | application instrumentation | 7d | sampled; tenant ref present, payload never |
| Alerts | rule evaluation → routing policy | — | routing is policy data, not hard-coded channels |

## What is monitored (Phase 21 §BH–BM)

- compute: CPU, memory, GPU utilisation, node pressure, pool saturation
- data: database health, connection saturation, replication lag, backup freshness
- API: latency percentiles, error rate, saturation — SLO-based with an error budget
- jobs: queue depth, failure rate, autoscale floor/ceiling hits
- fabric: provider health, quota consumption, drift, cost per tenant
- autonomy: agent and workflow failure rates, approval backlog

## Approved sinks (INFRA-01)

Production events go to Datadog, CloudWatch, and provider-native consoles.
Staging may use Sentry and PostHog. Development uses local structured logs
only. Production must not export events to Sentry or PostHog. No paid account
is created from this repository. See `docs/architecture/observability.md`.

## Status

**Not deployed.** CF-9 requires a running cluster (CF-4/CF-5) and credentials.
The application gate for Sentry and PostHog is in
`frontend/src/lib/observability/vendor-telemetry.ts`. Datadog and CloudWatch are the
approved production sinks and are not wired in this tree until an owner
configures an existing account. The tables above remain the measurement
contract.
