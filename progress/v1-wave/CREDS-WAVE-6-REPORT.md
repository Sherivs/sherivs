# CREDS-WAVE-6 REPORT — West-EU region alignment (2026-10-06)

System: CoreGrid Scholar | Branch: `cursor/p08-foundation-loop-classification-fe86` | PR: #2 (draft)
Governance: AGENTS.md (CoreGrid ASI Constitution v1.0) — §42 report format, §38 change management (rollback noted below), §30 secret hygiene (values never printed into the repo), §45 V1-only envelope.
Operator authorization: in-chat instruction 2026-10-06 — "i want my stacks to all share the same region west EU for all the stacks then upgrade and edit everything for me inside the platforms so everything will be set professionally no any error."
Governance record: DECISIONS.md **#205 (PLATFORM-014 — West-EU region alignment)**, RATIFIED 2026-10-06.
Version-target classification: **V1 organizational capability envelope only** (§45).

## Region audit (read-only, evidence per stack)

| Stack | Region BEFORE | Region AFTER | Evidence | Alignment |
| --- | --- | --- | --- | --- |
| Supabase (project `CoreGrid's Kernel`, ref `nwrflbpbhyiqdptmlccm`) | `eu-west-1` (Ireland), status `ACTIVE_HEALTHY`, Postgres 17 | `eu-west-1` (unchanged) | `GET api.supabase.com/v1/projects` → HTTP 200 | ALIGNED (anchor) |
| Vercel serverless functions (`coregrid-scholar-migration`, `prj_hpufTXbxU9OHM9GthJzI4MPUAeZM`) | `iad1` (US East) | **`dub1` (Dublin)** | `PATCH /v9/projects/{id}?teamId=…` → HTTP 200, `serverlessFunctionRegion: "dub1"` in response | ALIGNED (changed) |
| New Relic | EU (api.eu.newrelic.com) | EU (unchanged) | prior wave-4 probe `graphql actor.user` → 200 | ALIGNED |
| PostHog | US (`us.posthog.com`, project 532234) | US (unchanged) | prior wave-4 probe → 200 | HUMAN-ONLY migration (see below) |
| Sentry | undetermined (`org:ci`-scoped token cannot read orgs) | undetermined | prior wave-4 probe → 200, scope-limited | HUMAN-ONLY region pick at org level |
| Upstash Redis (keys grabbed by operator 2026-10-06) | n/a — keys not yet in this VM's env | n/a | env has no REDIS_REST_* yet | HUMAN-ONLY: database must be created in EU region |
| Twilio, Cloudflare, Expo EAS, Vapi, Resend, Paystack, AI gateway (`api.deepseek.com`) | global | global | provider design — no region setting | N/A |

## Implemented

- **Vercel region change**: `serverlessFunctionRegion` set to `dub1` (Dublin) — Vercel's closest region to Supabase `eu-west-1`, minimizing function↔database round-trip latency. Read-only PATCH (one settings field); nothing else on the project was touched. Rollback: PATCH the same field back to `iad1` (one API call / dashboard click).
- **Supabase**: audit only. The project was already West EU — per AD-114/§9 (no unnecessary destruction; the database holds canonical truth) NO migration was performed. Rollback: nothing to roll back.
- **DECISIONS.md #205 (PLATFORM-014)** records the decision, evidence, per-stack dispositions, and the operator's in-chat authorization quote.
- **Runbook** (`docs/runbooks/provider-onboarding-guide.md`) updated: region anchor stated at the top; Upstash step now mandates a WEST-EU region (eu-west-1/eu-central-1) with explicit guidance for recreating a US-region database before the keys are consumed anywhere; Sentry step now instructs picking Europe as the org data-storage region; PostHog section documents the EU signup migration (human-only — the US personal key cannot authenticate on eu.posthog.com, verified in wave 4).

## Security Validation

- §30: no credential value read, printed, or committed; both API calls used bearer tokens from the injected secret environment only.
- The Vercel change is a settings-field mutation verified by the API response; no deployment, env var, domain, or code was touched.
- No AI/analytics surface change: §19/§20/§21 invariants untouched.

## Known Risks

- PostHog stays US-hosted until the operator signs up on eu.posthog.com and swaps `POSTHOG_PROJECT_API_KEY` — one residual non-EU stack, human-only.
- Sentry region cannot be confirmed with the scope-limited token; resolved when the operator mints a broader token (console-only).
- If the operator's already-grabbed Upstash keys came from a US-region database, they must recreate the database in EU and hand over the NEW keys (costs nothing — the app has never consumed the old keys).

## Remaining Work

- Operator: add `REDIS_REST_URL` + `REDIS_REST_TOKEN` (EU-region DB) to Cursor Secrets → next agent window verifies the health probe and switches the AI-gateway rate limiter to distributed mode.
- Operator: optional PostHog EU migration + Sentry EU org/token/DSN (runbook §4/§5).
- Agent (next window, after Redis secrets arrive): re-run provider-health battery and confirm redis `NOT_REQUIRED → CONFIGURED_BUT_UNVERIFIED/capability_tested`.