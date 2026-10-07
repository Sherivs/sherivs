# JARVIS Wave 4 Report — PLATFORM-018 (DECISIONS.md #209)

Date: 2026-10-07 · Executing agent: JARVIS wave 4 · Version-target classification: **V1** (organizational capability envelope; AGENTS.md §45)

## Operator instruction

"Build all the remaining works professionally, then wire all the secret credentials of the Vercel environment variables credentials … I have added the redis credentials … remaining twilio from number, OCI and AWS, then apple and android credentials, and before the deployment tell me does Vercel require any other credentials we have not added yet — if yes we should add them before the deployment."

## Implemented

1. **Token/cost observation plumbing into the §40 workforce performance lens** (deliberately-not-built item carried from DECISIONS.md #208(f), now built on the existing metering substrate):
   - `frontend/src/lib/workforce/performance-metrics.ts`: `WorkforcePerformanceInput.usage?` (readonly `UsageRecord[]` from `frontend/src/lib/metering/usage-ledger.ts`); records are attribution-validated fail-closed, tenant-partitioned (excluded + counted via new `excludedCrossTenant.usage`); `tokenUsage` = observed sum of `tokensIn + tokensOut`; `computeCost` = observed sum of non-null `estimatedCostUsd` (rounded to micro-dollar precision, sample = records carrying rate entries). Absent records → `not_observable` (§65 reasons preserved); records present but all-null costs → `not_observable` "…not derivable (Part 9: never guessed)". `toolErrors` / `securityViolations` remain honestly `not_observable` (no substrate).
   - `frontend/src/lib/jarvis/executive-loop.ts`: `ExecutiveWorkforceRecords.usage?` passes metering records through to the lens; `tokenUsage` / `computeCost` join the briefing with their own claim classes when computed; unobservables stay silent.
   - `scripts/verification/workforce-role-catalog-validate.mjs`: **check 8** — usage-wired golden probe (tokenUsage=150, computeCost=0.0002 from the fixture), no-rate-entries → `not_observable` "never guessed", non-attributable record fails closed, executive-loop passthrough verified.
2. **Vercel environment sync (re-run with Redis mappings)**: `scripts/provision-vercel-env.mjs` now maps `REDIS_REST_URL` + `REDIS_REST_TOKEN` (server-only, encrypted). Live run 2026-10-07T05:50:35Z against project `coregrid-scholar-migration` (team-scoped): **17 UPSERTED, 0 failed**, 3 honestly `SKIPPED_ABSENT` (`TWILIO_FROM_NUMBER`, `REDIS_REST_URL`, `REDIS_REST_TOKEN` — sources not set in the VM). §19 minimization preserved: CLI/infra tokens (VERCEL_API_TOKEN, EXPO_TOKEN, SENTRY_AUTH_TOKEN, POSTHOG_PERSONAL_API_KEY, NEW_RELIC_*, CLOUDFLARE_API_TOKEN, SUPABASE_ACCESS_TOKEN) deliberately not pushed.
3. **Redis verification tooling**: new `scripts/infrastructure/redis-capability-probe.mjs` — read-only `PING` + one governed rate-limit check through the app's own `rateLimiterFromEnv` adapter (verification level `capability_tested` path). Fail-closed without credentials (exit 2, verified), FINDING path verified against an unreachable host, values never printed (§30).
4. **Twilio read-only probe re-run (2026-10-07)**: account status http 200 — **active, Trial, 0 owned phone numbers**. `TWILIO_FROM_NUMBER` therefore remains BLOCKED on the human console step (trial verification + number purchase; error 21404 precedent 2026-10-06). No purchase attempted (would fail identically; §65 honesty).
5. **AWS/OCI/Apple/Android deployment-readiness audit** → `docs/runbooks/provider-onboarding-guide.md` §9 (AWS/OCI direct answer) + refreshed §1/§8/§9→§10. Summary: AWS/OCI **not required** for the ratified V1 stack (Vercel+Supabase+vendor adapters; no named capability, no adapter, §58); Apple ($99/yr) + Google Play ($25 once) enrollment are human-only console steps for mobile submission (secrets `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, `APPLE_API_PRIVATE_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON` — documented runbook steps 6–7); mobile push (FCM/APNs) rides on those enrollments via EAS, web push is already VAPID-wired.

## Files Changed

- `frontend/src/lib/workforce/performance-metrics.ts` (usage substrate + token/cost metrics)
- `frontend/src/lib/jarvis/executive-loop.ts` (usage passthrough + briefing labels)
- `scripts/verification/workforce-role-catalog-validate.mjs` (gate check 8)
- `scripts/provision-vercel-env.mjs` (REDIS mappings)
- `scripts/infrastructure/redis-capability-probe.mjs` (new)
- `docs/runbooks/provider-onboarding-guide.md` (AWS/OCI section, wave-4 evidence, checklist refresh)
- `tests/unit/workforce/performance-metrics.test.ts` (+5 usage-lens tests)
- `tests/unit/jarvis-executive-loop.test.ts` (+2 usage-in-cycle tests)
- `DECISIONS.md` (#209), `progress/v1-wave/JARVIS-WAVE-4-REPORT.md` (this file)

## Pre-deployment Vercel credential gap analysis (operator question answered)

**Does Vercel require any other credentials not yet added? Direct answer: NO additional credentials are REQUIRED for deployment.** Evidence-based breakdown:

| Category | State | Blocks deployment? |
| --- | --- | --- |
| Production `REQUIRED_VARS` (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY) | All 5 upserted to Vercel 2026-10-07 | No — covered |
| App-runtime adapter credentials (AI_*, RESEND_*, PAYSTACK_*, TWILIO_*, VAPI_*, VAPID_*, POSTHOG_PROJECT_API_KEY) | 12/14 upserted; `TWILIO_FROM_NUMBER` absent (trial-blocked), Redis pair absent (optional) | No — adapters degrade honestly (SMS BLOCKED, in-process limiter) |
| CLI/infra tokens (VERCEL_API_TOKEN, EXPO_TOKEN, SENTRY_AUTH_TOKEN, POSTHOG_PERSONAL_API_KEY, NEW_RELIC_*, CLOUDFLARE_API_TOKEN, SUPABASE_ACCESS_TOKEN, DATABASE_URL, *_CA_CERT) | Deliberately NOT pushed (§19: not app-runtime) | No — correct posture |
| `SENTRY_DSN` | Absent; no Sentry SDK is wired in the app (registry note says operator action) | No — optional error reporting |
| AWS/OCI | Not in the ratified V1 vendor set; no adapter | No — not required (runbook §9) |
| Apple/Android push | Web push = VAPID (done); mobile push = FCM/APNs via EAS, needs Apple/Google console enrollment | No for web deployment — human-only for mobile |
| Vercel platform features (cron, blob, KV, integrations) | None used by the app | No |

**Recommended before deploy (nice-to-have, not blockers):** (a) add the two Redis secrets then run the probe + re-provision (multi-instance rate limiting), (b) Twilio console step then `TWILIO_FROM_NUMBER` (SMS send capability), (c) `SENTRY_DSN` when Sentry runtime error reporting is wanted.

## Tests

- `npm run test:unit` focused: 45/45 pass across the two touched suites (24 performance-metrics, 21 executive-loop); full gate `npm run verify` run before commit (typecheck + all suites + registry/workforce/drift/neutrality/secrets gates + production build).

## Security Validation

- §30: no secret VALUE printed, logged, or committed anywhere; probe/provision scripts carry names + statuses only; secret-scan gate green.
- §19: minimization posture unchanged (CLI/infra tokens stay off Vercel); REDIS_REST_TOKEN classified server-only and guarded by `SERVER_ONLY_VARS` exposure checks via the registry.
- Multi-tenancy §13: usage records tenant-partitioned, cross-tenant exclusions counted, never mixed; invalid records fail closed.
- §65/Part 9: unknown rates never guessed; absent substrates honestly declared `not_observable`.

## Known Risks

- Redis credentials are NOT registered on the platform despite the operator's belief they were added — verified twice (dashboard secret-names list + VM env). Until they are added to Cursor Secrets and a fresh session runs the probe, the limiter stays in-process (safe, honest degradation; no silent failure).
- Twilio remains trial-gated: no SMS send capability until the console step.
- The metering substrate is in-process (`UsageLedger` persistence is a later-phase concern); the lens observes only caller-supplied records — live token/cost figures become real once mission execution feeds the ledger.

## Remaining Work

- Operator console actions: Redis secrets → probe → re-provision; Twilio number; (optional) Sentry EU org + DSN; PostHog EU migration; Apple/Google enrollments for mobile.
- Deliberately-not-built (restraint records carried): scheduler daemon, durable workflow persistence (approved migration required).