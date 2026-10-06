# CREDS-WAVE-3 REPORT — provider orchestration & full-stack integration (2026-10-06)

System: CoreGrid Scholar | Branch: `cursor/p08-foundation-loop-classification-fe86` | PR: #2 (draft)
Governance: AGENTS.md (CoreGrid ASI Constitution v1.0) — §42 report format, fail-closed, §29/§30 secret hygiene, §24/§26/§27 adapter-path law, §45 V1-only envelope.
Version-target classification: **V1 organizational capability envelope only** (§45); V2 (device/IoT) and V3 (Reality Intelligence) untouched — the posthog/sentry vendor credentials are CLASSIFIED ONLY (V1CAP-29 defers those vendors to V2); no vendor surface was implemented or claimed.

## Implemented

- **Machine-readable provider credential registry** —
  `frontend/src/lib/providers/provider-credentials.ts`: all 24 supplied
  credentials mapped as DATA (name + `env://` references only, never a value)
  with classification (`public_configuration` / `client_safe_identifier` /
  `server_runtime_configuration` / `server_runtime_secret` /
  `deployment_infrastructure_secret`), runtime scope, owning adapter surface,
  required capability, mission §26 status and the §32 verification level.
  Fail-closed validation: schema, uniqueness, secret-shape hygiene over every
  field; client-prefix leak audit (`VITE_`/`NEXT_PUBLIC_`/`PUBLIC_`).
- **Environment boundary hardening** — `frontend/src/lib/env.ts`
  `SERVER_ONLY_VARS` is now derived from the registry (union with the legacy
  names), and the exposure check covers `NEXT_PUBLIC_` and `PUBLIC_` in
  addition to `VITE_`. `.env.example` rewritten as the full environment
  contract with per-variable security marking ([SECRET]/[INFRA]/[PUBLIC]).
- **Twilio SMS adapter + webhook signature validator** —
  `frontend/src/lib/communications/twilio-sms.server.ts`: fail-closed
  credential gate (`TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` +
  `TWILIO_FROM_NUMBER`, Basic `SID:TOKEN` REST auth), bounded Zod payload
  contract, single-attempt transport with structured retryable
  classification, typed CoreGrid-vocabulary results (provider shapes never
  leak inward), and constant-time inbound webhook signature validation
  (base64 HMAC-SHA1 over URL + sorted params, §17).
- **Provider integration health battery** —
  `frontend/src/lib/observability/provider-health.server.ts`: the §18
  vocabulary (`NOT_CONFIGURED`/`CONFIGURED`/`AUTHENTICATED`/`OPERATIONAL`/
  `DEGRADED`/`NOT_REQUIRED`) executed as ONE read-only GET per provider
  (health/list endpoints only; no mutating capability; 8s timeout; redirects
  refused; https-only targets; secret values never leave the auth header).
  Static `NOT_REQUIRED` declarations for posthog/sentry/new-relic/
  cloudflare/vercel/expo-eas/redis. Deliberately NOT wired into the
  unauthenticated `/health.json` route (no third-party contact from a public
  endpoint); consumed by drills and authorized operator surfaces.
- **Provider-auth live drill** — `scripts/verify-provider-auth-live.drill.mjs`
  (exemplar-drill discipline): `--rehearse` offline registry/config
  validation; live mode gates ALL provider credentials BEFORE any network
  contact (exit 2 otherwise), then runs the read-only battery and writes
  secret-free artifacts.
- **Paystack webhook boundary hardening** —
  `frontend/src/routes/api/public/webhooks/paystack.ts`: the signed payload
  is now parsed through a bounded Zod contract (authenticated-but-malformed
  events are refused 400, never trusted by cast); idempotency note recorded
  (the reference-keyed terminal-state update keeps redelivery exactly-once in
  substance). Existing HMAC-SHA512 + constant-time compare unchanged.
- **Mobile deps linked in the environment** — `mobile/ npm ci` so the mobile
  env-contract suites execute in CI-parity conditions (no repo file changes).

## Files Changed

- `frontend/src/lib/providers/provider-credentials.ts` (new)
- `frontend/src/lib/communications/twilio-sms.server.ts` (new)
- `frontend/src/lib/observability/provider-health.server.ts` (new)
- `scripts/verify-provider-auth-live.drill.mjs` (new)
- `frontend/src/lib/env.ts` (exposure checks + registry-derived server-only set)
- `frontend/src/routes/api/public/webhooks/paystack.ts` (Zod event contract)
- `.env.example` (environment contract)
- `tests/unit/providers/provider-credentials.test.ts` (new)
- `tests/unit/communications/twilio-sms-server.test.ts` (new)
- `tests/unit/observability/provider-health.test.ts` (new)
- `tests/unit/env.test.ts` (multi-prefix exposure vectors)
- `progress/v1-wave/CREDS-WAVE-3-REPORT.md` (this report)

## Architecture Impact

Additive and layer-preserving: new registry/health modules are DATA + pure
functions behind existing ports; the Twilio SMS adapter follows the exact
V1-009 adapter pattern (contract gate → Zod → single bounded fetch → typed
result). No business domain imports a vendor. The provider-abstraction chain
(credential → configuration → adapter → capability → observability) is now
explicitly machine-readable. §45 respected throughout.

## Live verification evidence (all from executed runs, 2026-10-06)

| Provider | Level 3 (auth) | Level 4 (capability) | Artifact |
| --- | --- | --- | --- |
| supabase | `GET /auth/v1/health` → 200 OPERATIONAL | Management API probe `ACTIVE_HEALTHY` + `SELECT 1` → 201 | provider-health-battery.json |
| coregrid-postgres | — | Direct `DATABASE_URL` + strict TLS (CA) `SELECT` OK | (terminal evidence) |
| resend | `GET /domains` → 200 AUTHENTICATED | ONE governed self-addressed send through `createResendEmailAdapter` → provider receipt `01a1107d-51f9-7b51-be68-de024611b749` | resend-capability-probe.json |
| paystack | `GET /transaction?perPage=1` → 200 AUTHENTICATED | TEST-rails governed drill round (audit→initialize→owned-verify→denied mismatch) PASS | payments-drill-test-round.json |
| twilio | `GET /Accounts/{sid}.json` (Basic) → 200 AUTHENTICATED | SEND capability BLOCKED — no provisioned sender number | provider-health-battery.json |
| vapi | `GET /assistant?limit=1` → 200 AUTHENTICATED | Deliberate V1 stub — no live call path (none fabricated) | provider-health-battery.json |
| ai-gateway | `GET {AI_GATEWAY_URL}/models` → 200 AUTHENTICATED | One governed inference (deepseek-chat) `STATUS=DRILL_PASS`, tokensIn=16 tokensOut=2, digest `c2e3ac47f4a32546…` | ai-gateway-live-drill.json |
| posthog/sentry/new-relic/cloudflare/vercel/expo-eas/redis | NOT_REQUIRED (static; §45/V1CAP-29 or infra planes) | — | provider-health-battery.json |

## Tests

- New suites: `provider-credentials` 9/9, `twilio-sms-server` 13/13,
  `provider-health` 13/13, `env` 17/17 (multi-prefix vectors).
- Full gate: `npm run verify` → **exit 0** — typecheck clean, 426 test files
  / 8901 tests passed (5 skipped, typed skips), registry validation PASS,
  drift PASS, domain-neutrality PASS, secret scan PASS, client + server
  builds pass.
- Drills executed: provider-auth battery (rehearse + live, exit 0),
  `verify-ai-gateway-live.drill.mjs` (exit 0), `verify-payments-live.drill.mjs`
  (exit 0), `verify-communication-live.drill.mjs --rehearse` (exit 0),
  Supabase management-API probe + direct-PG strict-TLS probe (exit 0).

## Security Validation

- §30: no secret VALUE is printed, logged, committed, or written to any
  artifact — every module carries names/references only; the probe headers
  carry values only transiently in-memory; drill artifacts are secret-free by
  construction and were re-scanned.
- Exposure audit: `registryClientPrefixExposures` over the live environment →
  zero leaks; `exposedServerOnlyVars` now covers three client prefixes.
- §17: inbound webhook law enforced (signature-verified, schema-bounded,
  idempotent-in-substance); Twilio validator constant-time.
- §36: server-side verification stays authoritative; the drill's
  mismatched-amount ownership probe was DENIED (pass condition).
- Tenant boundary: probes carry no tenant data; the email probe used the
  `control-plane/verification` drill-tenant convention, recipient = the
  operator-supplied sender address (never recorded in repo files).

## Provider status (mission §36 vocabulary, evidence-backed)

- **OPERATIONAL**: supabase, coregrid-postgres, resend, paystack (TEST rails
  only), ai-gateway (governed inference path).
- **CONFIGURED BUT UNVERIFIED** (beyond auth): vapi (auth verified; live call
  path is a deliberate V1 stub).
- **BLOCKED** (human action required): twilio SMS/voice send — needs a
  provisioned/verified sender number (`TWILIO_FROM_NUMBER`) and, for inbound
  webhooks, the console webhook configuration.
- **NOT REQUIRED**: posthog, sentry (V2-deferred per V1CAP-29), new-relic,
  cloudflare, vercel, expo-eas, redis (no credential, no V1 requirement).

## Known Risks / Remaining Work

- Twilio number provisioning + console webhook wiring (BLOCKED — operator).
- Paystack live rails remain parked pending operator business verification
  (BLK-4 — coordinator decision).
- Vapi live call path is intentionally unimplemented in V1.
- Vercel deployment parity: server secrets must be configured in the Vercel
  dashboard per `.env.example` (the VERCEL_API_TOKEN is CI-scope and cannot
  provision them); not verifiable from this environment.
- PostHog: a personal API key cannot ingest client analytics; a project key +
  host would be required when V2 unfreezes (V1CAP-29).

## Rollback

All changes additive; revert the commit(s) on this branch. No migrations, no
data writes, no ratchet changes.