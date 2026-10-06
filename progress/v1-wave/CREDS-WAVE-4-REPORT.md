# CREDS-WAVE-4 REPORT — vendor un-freeze execution, Redis limiter, Vercel provisioning (2026-10-06)

System: CoreGrid Scholar | Branch: `cursor/p08-foundation-loop-classification-fe86` | PR: #2 (draft)
Governance: AGENTS.md (CoreGrid ASI Constitution v1.0) — §42 report format, fail-closed, §29/§30 secret hygiene, §24/§26/§27 adapter-path law, §45 V1-only envelope.
Version-target classification: **V1 organizational capability envelope only** (§45). The un-frozen scope (DECISIONS.md #204 / PLATFORM-013, operator in-chat authorization 2026-10-06) covers observability + deployment/infrastructure vendor planes ONLY. V2 (device/IoT) and V3 (Reality Intelligence) remain FROZEN — untouched, unimplemented, unclaimed.

## Implemented

- **§45 un-freeze authority record** — `DECISIONS.md` #204 (PLATFORM-013):
  the operator's explicit in-chat authorization to integrate PostHog, Sentry,
  New Relic, Cloudflare, Vercel, Expo EAS and Redis into V1, with scope
  limits and the §19/§20/§21 conditions on any future analytics ingestion.
- **Credential registry un-freeze** —
  `frontend/src/lib/providers/provider-credentials.ts`: every formerly
  NOT_REQUIRED vendor entry now carries evidence-backed statuses
  (CONFIGURED_BUT_UNVERIFIED + `provider_reachable`) after live read-only
  probes; four new config-plane entries (POSTHOG_API_URL,
  NEW_RELIC_API_URL, REDIS_REST_URL, REDIS_REST_TOKEN) document the
  region-qualified API hosts and the optional Redis plane. Registry stays
  name-only, schema-validated, secret-shape-hygienic.
- **Provider health battery expansion** —
  `frontend/src/lib/observability/provider-health.server.ts`: six new
  single-request read-only probes (posthog, sentry, new-relic, cloudflare,
  vercel, expo-eas) plus a redis check. Redis with no credential reports
  NOT_REQUIRED (never fails the posture); a supplied credential is verified
  with one read-only PING. `probe()` now supports POST bodies (New Relic
  GraphQL actor probe, Expo viewer query, Redis PING) under the same 8s
  https-only redirect-refusing bound. `staticNotRequiredProviders()` is now
  intentionally empty.
- **Optional distributed rate limiter** —
  `frontend/src/lib/rate-limit/redis-rate-limiter.server.ts`: implements the
  shared `RateLimiter` contract over an Upstash-compatible REST plane with
  one atomic EVAL (INCR + first-hit PEXPIRE) per check; refKeys are
  sanitized and namespaced (`coregrid:rl:`); the credential exists only in
  the auth header. Missing/malformed REDIS env provisions the IN-PROCESS
  limiter (Part 31 default) with a secret-free reason — an optional plane
  never hard-fails the gateway path; Redis failures degrade to the
  in-process fallback (degraded but never unenforced).
- **Async-capable rate-limit contract** — `ai-gateway.server.ts`:
  `RateLimiter.check` may return `RateLimitDecision | Promise<...>` (both
  gateway call sites await); `SyncRateLimiter` preserves the synchronous
  view for the in-process limiter so every existing consumer keeps its
  type-safety. In-process semantics unchanged.
- **Vercel environment provisioning** —
  `scripts/provision-vercel-env.mjs` (authorized operator flow, §30:
  values in-memory only, report carries names/statuses never values). Live
  run 2026-10-06: project `coregrid-scholar-migration`
  (`prj_hpufTXbxU9OHM9GthJzI4MPUAeZM`, team `team_S9pZ4QaEvGaAibR5GBZBynpI`),
  13 variables upserted encrypted for production+preview+development
  (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY,
  VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, AI_API_KEY,
  AI_GATEWAY_URL, RESEND_API_KEY, RESEND_FROM_ADDRESS, PAYSTACK_SECRET_KEY,
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, VAPI_API_KEY); TWILIO_FROM_NUMBER
  skipped-absent; 0 failures. Read-back verified: 13 env records present.
  CLI/infra tokens (VERCEL_API_TOKEN, EXPO_TOKEN, SENTRY_AUTH_TOKEN,
  POSTHOG_PERSONAL_API_KEY, NEW_RELIC_*, CLOUDFLARE_API_TOKEN,
  SUPABASE_ACCESS_TOKEN) are deliberately NOT pushed to the app runtime
  (§19 minimization).
- **Operator onboarding runbook** —
  `docs/runbooks/provider-onboarding-guide.md` (provenance header: creator
  MISSION-V1-017 deployment track under DECISIONS #204): baby-mode steps for
  Upstash Redis REST keys, Twilio number purchase, Vapi BYOK/pricing facts,
  Sentry token+DSN, PostHog project key, Apple Developer enrollment +
  App Store Connect API key, Google Play Console + service account, plus
  the executed-vs-remaining checklist.
- **Provenance checker alignment** —
  `scripts/verify-provenance-metadata.mjs`: CREATOR_MATCHERS now recognize
  the `MISSION-V1-NNN` series (additive; the script predated the V5.3
  mission family). Zero findings across all 158 governance artifacts.
- **Env contract** — `.env.example` extended with POSTHOG_API_URL,
  NEW_RELIC_API_URL, REDIS_REST_URL/REDIS_REST_TOKEN and the un-freeze
  notes; `frontend/src/lib/env.ts` SERVER_ONLY_VARS picks up
  REDIS_REST_TOKEN automatically via the registry derivation.

## Evidence (live, read-only, single-request per provider, 2026-10-06)

| Provider | Probe | Result |
| --- | --- | --- |
| cloudflare | GET /client/v4/user/tokens/verify | 200 (token active) |
| vercel | GET /v9/projects | 200 (team-scoped; project resolved) |
| posthog | GET us.posthog.com/api/projects/ | 200 (project 532234; api.posthog.com does not resolve from this VM — region host authoritative) |
| sentry | GET api.sentry.io/api/0/ | 200 (valid token; scopes `["org:ci"]` only — cannot read orgs) |
| new-relic | POST api.eu.newrelic.com/graphql actor.user | 200 (EU region account; api.newrelic.com returned 403 "not authorized for account region") |
| expo-eas | POST api.expo.dev/graphql viewer | 200 (username vibeoraai-bit) |
| redis | no credential supplied | NOT_REQUIRED (in-process limiter active per Part 31) |

## Tests

- `tests/unit/rate-limit/redis-rate-limiter.test.ts` (9): fail-soft
  provisioning, atomic-EVAL request shape (token never leaves the auth
  header), allow/deny + window-bounded retry, key isolation/sanitization,
  fallback on network/non-2xx, fail-closed on malformed config.
- `tests/unit/observability/provider-health.test.ts` (14): new probes'
  state derivation, empty static set, redis NOT_REQUIRED posture, non-https
  refusals, full 13-provider battery.
- `tests/unit/providers/provider-credentials.test.ts` (10): un-frozen
  vendor entries (probes, no app-runtime adapters), Redis plane
  NOT_CONFIGURED, region-host config entries.
- Full gate: `npm run verify` (typecheck + unit suite + registry + drift +
  neutrality + secret scan + build) — see PR body for the final counts.

## Security Validation

- §30: no secret value printed, logged, or written anywhere; the Vercel
  provisioner forwards values in-memory and reports names only.
- §16/§26: health probes are read-only, https-only, redirect-refused,
  8s-bounded; credentials only in auth headers.
- §19 minimization: only app-runtime variables were pushed to Vercel; CI/CLI
  tokens stay out of the app runtime.
- §27: the Redis limiter fails soft to the in-process limiter (availability)
  while never becoming an unenforced path; malformed configs deny.
- Registry hygiene re-validated fail-closed (schema, uniqueness, secret
  shapes, client-prefix exposure audit).

## Known Risks / Remaining Work (operator actions)

- TWILIO_FROM_NUMBER: purchase a sender number (runbook §2) → secret; the
  Twilio SMS adapter then moves BLOCKED → capability-testable.
- Redis: optional; add REDIS_REST_URL/REDIS_REST_TOKEN to enable distributed
  limiting (runbook §1).
- Sentry: current token is scope-limited (org:ci); a broader token + a
  runtime DSN are operator actions (runbook §4).
- PostHog: personal key cannot ingest client events; a project API key is
  needed for any analytics surface (runbook §5) — and any such surface must
  first satisfy §19/§20/§21.
- Vercel deployments were ERROR before this wave (empty env); the next
  deploy should pick up the 13 provisioned variables and validate the
  production path end-to-end.
- Vapi live-call path remains a deliberate credential-gated stub in V1.

## Architecture Impact

Provider plane only: no domain behavior, no security-boundary change, no
frozen scope touched. New surfaces: rate-limit adapter (behind the existing
RateLimiter contract), health probes (observability), one operator script.
The gateway rate-limit seam is now async-capable with full backwards
compatibility (SyncRateLimiter).