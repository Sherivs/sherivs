# Observability

> Status: Current (V1 structured logs and health). Vendor sinks are environment-gated (INFRA-01, DECISIONS.md #205).

Approved policy. The company is self-funding: this document names sinks. It does not purchase or provision paid accounts.

| Environment | `APP_ENV` / `VITE_APP_ENV` | What may receive events |
| --- | --- | --- |
| development, local, test | `development` / `local` / `test` | Lightweight local diagnostics only (structured logs). Sentry and PostHog stay off. |
| unset or conflicting | empty, or the two names disagree | Fail closed. No Sentry, no PostHog. |
| staging | both exactly `staging` | Sentry and PostHog. PostHog still waits for consent and never tracks students. |
| production | both `production` | Datadog, CloudWatch, and provider-native consoles. Production must not export events to Sentry or PostHog. |

`NODE_ENV` is not the gate. A Vercel production or development target (`VERCEL_ENV`) fails closed even if `APP_ENV` was set to `staging` by mistake.

## Env names (values never belong in git)

- `APP_ENV`, `VITE_APP_ENV` — explicit environment. Both must be `staging` before Sentry or PostHog start.
- Staging only: `SENTRY_DSN`, `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`, `SENTRY_AUTH_TOKEN` (source-map upload).
- Production builds define the `VITE_` vendor names as empty and do not upload source maps. The production server bundle does not embed `SENTRY_DSN`.

Operator matrix and CI artifact retention: `architecture/campaigns/V1-PROGRAM/OPERATIONS.md`. Name manifest: `.env.example`.

## What exists

- Structured logs: `frontend/src/lib/observability/structured-log.ts` (secret-key redaction, `Name: message` errors, no stacks).
- PII scrubber: `frontend/src/lib/observability/scrub.ts`.
- Pseudonymous trace correlation: `frontend/src/lib/observability/trace-context.ts` (`trace_id`, `correlation_id`). Boundary failures in `server.ts`, `start.ts`, and `routes/__root.tsx` go through `boundary-log.ts`. Raw error objects are not logged.
- Vendor gate: `frontend/src/lib/observability/vendor-telemetry.ts` (Vite define, server init, client init, CI env-file strip).
- SSR error capture: `lib/error-capture.ts` + `lib/error-page.ts` + `server.ts` (the swallowed response body is not logged).
- Platform error reporter: `lib/platform-error-reporting.ts` via `window.__platformEvents`.
- Audit trail: `audit_logs` table + `lib/audit.ts`.
- Health: `/health.json`.

## Not provisioned here

Datadog and CloudWatch are the approved production sinks. No production account, API key, or Vercel production setting is changed by the gate. Owner steps for Vercel env names are in the INFRA-01 pull request.

