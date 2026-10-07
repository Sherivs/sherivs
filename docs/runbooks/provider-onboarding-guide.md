# Provider Onboarding Guide — Baby Mode

Status: GOVERNED — operator onboarding runbook. Steps marked "already did"
are executed and evidence-backed; remaining steps await operator action.
Mission: MISSION-V1-017 (deployment track, provider-credential dimension) under
the DECISIONS.md #204 un-freeze authority (2026-10-06).
Authority: AGENTS.md §12 (provenance), §30 (secrets — names only, never values),
§45 (V1 envelope; V2/V3 untouched), DECISIONS.md #204 (PLATFORM-013),
DECISIONS.md #205 (PLATFORM-014 — West-EU region alignment).

Region anchor (DECISIONS.md #205): the production database is Supabase
`eu-west-1` (Ireland) and Vercel serverless functions run in `dub1`
(Dublin). Every region-bearing vendor stack must co-locate in West Europe;
items that require a human console click are flagged below.

Audience: the operator (you). Style: one screen at a time, click-by-click.
Each section ends with the exact secret NAMES to add to Cursor Cloud Agents →
Settings → Secrets (never email or paste values anywhere else).

Scope authority: DECISIONS.md #204 (2026-10-06) — you authorized these vendor
integrations into V1. V2 (device/IoT) and V3 (Reality Intelligence) remain
frozen; nothing in this guide touches them.

---

## 1. Redis (Upstash) — get the REST keys

Redis is OPTIONAL to ADOPT but ACTIVE as of 2026-10-07 (DECISIONS.md #212):
`REDIS_REST_URL` + `REDIS_REST_TOKEN` are injected, capability-proven through
the app's own adapter, and synced to Vercel — `rateLimiterFromEnv` now uses
distributed fixed-window limiting, falling back to in-process only if the
data plane is unreachable.

> **Status (2026-10-07, DECISIONS.md #212): DONE.** The earlier wave-6
> findings are resolved: the secrets now exist under the exact contract names
> (`REDIS_REST_URL`, `REDIS_REST_TOKEN`) with a valid `https://…upstash.io`
> URL. In this session the capability probe exited 0 — PING http 200 →
> `PONG`, one governed rate-limit check through `rateLimiterFromEnv` →
> `allow` (verification level `capability_tested`) — and
> `node scripts/provision-vercel-env.mjs` upserted both variables to Vercel
> (0 failed). Registry entries are `OPERATIONAL` / `capability_tested`.
> Remaining human check: confirm in the Upstash console that the database
> region is WEST-EU (eu-west-1 / eu-central-1, DECISIONS.md #205) — the REST
> data plane cannot report its own region.

1. Open https://console.upstash.com and sign up (free plan is fine; GitHub
   login works).
2. Click **Databases** → **Create Database**.
   - Name: `coregrid-scholar`
   - **Region: pick a WEST-EU region — AWS `eu-west-1` (Ireland) or
     `eu-central-1` (Frankfurt). This matches Supabase eu-west-1 and Vercel
     dub1 (DECISIONS.md #205). Do NOT pick a US region.**
   - Type: **Regional** (free tier). TLS is always on.
3. Open the database you just created.
4. Scroll to the **REST API** section. You will see two values:
   - `UPSTASH_REDIS_REST_URL` — looks like `https://xxx.upstash.io`
   - `UPSTASH_REDIS_REST_TOKEN` — a long token
5. Add both to Cursor Cloud Agent Secrets with these exact names:
   - `REDIS_REST_URL` ← the REST URL
   - `REDIS_REST_TOKEN` ← the REST token

**Already created the database before reading this?** Check its region on
the Upstash dashboard. If it is NOT an EU region, create a new EU database
(free tier, takes a minute), grab the NEW REST keys from it, and use those.
Old US keys can be deleted — nothing in the app has consumed them yet, so
switching now costs nothing.

What happens automatically after that: run
`node scripts/infrastructure/redis-capability-probe.mjs` in a fresh agent
session (secrets inject into new VMs) — it proves a read-only `PING` and one
governed rate-limit check through the app's own adapter, then re-run
`node scripts/provision-vercel-env.mjs` to push both variables to Vercel.
`rateLimiterFromEnv` switches the AI gateway from in-process to distributed
fixed-window limiting by itself. No code change is needed from you.

---

## 2. Twilio — sender number (deferred by operator decision, activation is config-only)

The account SID and auth token are already live-verified. What is missing is
a sender NUMBER (`TWILIO_FROM_NUMBER`) — and as of 2026-10-07 that is a
deliberate operator hold, not a blocker.

**Status (2026-10-07):** the operator has **subscribed to a Twilio business
plan and topped up $20**. The account is funded. Sender-number purchase is
**deferred until the operator's CAC (business identity) verification clears**,
so the number is issued to a verified business rather than an individual
(the earlier error-21404 trial limitation no longer applies — the account is
no longer Trial). All the code the number will light up already exists; when
the CAC clears, activation requires **no adapter changes**:

1. Wait for CAC verification → complete Twilio Trust Hub business profile
   (only the operator can submit CAC documents).
2. Buy the sender number: https://console.twilio.com → **Phone Numbers →
   Manage → Buy a number** — check the **SMS** capability box (voice is
   optional; Vapi uses its own voice stack). If your country has no local
   numbers, a SMS-capable US number works worldwide.
3. Add the number to Cursor Cloud Agent Secrets:
   - `TWILIO_FROM_NUMBER` ← E.164, e.g. `+15551234567`
   - then re-run `node scripts/provision-vercel-env.mjs` to sync it to Vercel.

**Per-organization sender identities (PLATFORM-019, DECISIONS.md #210).**
Every organization that connects to CoreGrid can carry its OWN sender number
instead of borrowing the platform default. The substrate:

- table `cg_org_communication_sender` (zero-policy, service-role only): one
  row per (tenant, org, channel=sms, provider=twilio) with an E.164
  `from_number` and an `env://` credential reference; only one ACTIVE sender
  per org+channel+provider (partial unique index enforces it).
- resolver `frontend/src/lib/communications/org-sender-config.ts`:
  active org sender wins → falls back to the platform default
  (`TWILIO_FROM_NUMBER`) → fail-closed "unresolved" otherwise; malformed and
  cross-tenant rows are excluded and counted, never trusted.
- store `frontend/src/lib/communications/org-sender-store.server.ts`:
  `upsertOrgSender` demotes the prior ACTIVE row then inserts (the partial
  unique index is the final authority), and `twilioConfigForOrg` composes the
  platform credentials with the resolved sender into the exact
  `TwilioSmsConfig` the existing adapter consumes.

So after the CAC clears the full menu is: platform-only number (just the
`TWILIO_FROM_NUMBER` secret), or per-org numbers (insert
`cg_org_communication_sender` rows through the service — org rows win over
the platform default). Both work the moment the number exists.

After the number exists, the Twilio SMS adapter moves from BLOCKED to
capability-tested on the next live drill.

---

## 3. Vapi — your question answered directly

- **Can you use your own API keys?** Yes — Vapi supports BYOK (bring your
  own key) for the model (e.g. DeepSeek/OpenAI), transcription, voice, and
  even telephony (bring your own Twilio number). Provider costs pass through
  at cost.
- **Does Vapi give a free month?** There is no subscription and no trial
  month. Vapi is pay-as-you-go: you get roughly $5–$10 of free starter
  credits when you sign up (no credit card required to start), and Vapi's
  hosting fee is about $0.05 per minute, prorated per second.
- **Must you subscribe before phone calls?** No subscription exists. But
  sustained calling requires a payment method / topped-up balance once the
  free credits run out. On the free usage plan you get 1 included Vapi phone
  number and 4 concurrent calls; extra Vapi numbers cost about $2/month.

Recommended setup: sign up at https://dashboard.vapi.ai, add your AI_API_KEY
provider (DeepSeek) as a BYOK credential in the dashboard, and top up ~$10
when you want real calls. Your existing `VAPI_API_KEY` secret stays the
same.

---

## 4. Sentry — what you still need

Your current token works (verified) but is narrow (`org:ci` — release
automation only). For full integration you need two things:

0. **Region check (DECISIONS.md #205)**: when you create/choose the Sentry
   organization, use an **EU-hosted Sentry org** (sso/instances on
   `eu.sentry.io`-style hosts, or select Europe during org setup). Sentry
   asks where data is stored when an organization is created — pick Europe
   so error data stays in West EU like everything else.
1. **A broader token** (for release/source-map upload in CI):
   - https://sentry.io → **Settings → Auth Tokens → Create New Token**
   - Scopes: `org:read`, `project:read`, `project:releases`
   - Replace the `SENTRY_AUTH_TOKEN` secret.
2. **A runtime DSN** (for error reporting in the app):
   - Settings → **Projects → your project → Client Keys (DSN)**
   - Copy the DSN string (starts with `https://…ingest.sentry.io/…`).
   - Add secret `SENTRY_DSN` with that value.

Until then the health check honestly reports "auth-verified, scope-limited".

---

## 5. PostHog — grab the project API key (and the EU decision)

Your personal key is verified but CANNOT ingest client events (a known
PostHog rule). For product analytics you need the PROJECT key:

1. Open https://us.posthog.com (your project is US-region, id 532234).
2. Click the gear (Settings) → **Project API key** — it starts with `phc_`.
   This one is safe to expose in the browser bundle (it is an ingest key,
   not a secret).
3. Add to Cursor Cloud Agent Secrets:
   - `POSTHOG_PROJECT_API_KEY` ← the `phc_…` value

**EU migration (DECISIONS.md #205 — human-only, your choice of moment):**
your current PostHog is US-hosted and PostHog does not let an account
migrate between US and EU cloud via API — EU is a separate signup at
https://eu.posthog.com (your US personal key cannot authenticate there;
verified 2026-10-06). To fully align: sign up on eu.posthog.com (same email
is fine), create the project, then:
- grab the NEW `phc_…` project API key from the EU project,
- replace the `POSTHOG_PROJECT_API_KEY` secret with it,
- (optional) also mint a personal API key on the EU org if you want the
  agent to keep verifying it — note `us.posthog.com` probes will then stop
  working; the health battery reads the region from env so nothing in the
  repo changes.
Until you migrate, analytics keep flowing to the US project and everything
else in the stack is already West EU — this is the one step that must be
done by you in the browser.

Do NOT build any analytics surface until the §19 AI-privacy pipeline
(authorization → classification → minimization) is wired; the registry note
enforces this.

---

## 6. Apple developer console (iOS deployment)

Cost: **$99 USD per year** (Apple Developer Program).

1. **Enroll**: https://developer.apple.com/programs → sign in with your
   Apple ID → enroll as an Individual (fastest) → pay $99.
   - Two-factor auth must be enabled on the Apple ID first.
2. **Bundle ID**: after approval, go to
   https://developer.apple.com/account/resources/identifiers → **+** →
   App IDs → App → description `CoreGrid Scholar` and explicit bundle id,
   e.g. `com.vibeora.scholar` (decide this once; it cannot change later).
   Enable capabilities you use (Push Notifications is the V1 one).
3. **App Store Connect record**: https://appstoreconnect.apple.com →
   **Apps → +** → New App → name, primary language, bundle id (from step 2),
   SKU `coregrid-scholar`.
4. **API key for EAS Submit** (so the agent can submit builds for you):
   App Store Connect → **Users and Access → Integrations → App Store
   Connect API → Team Keys → +** → name `eas-submit`, role **App Manager** →
   download the `.p8` file ONCE (you cannot re-download).
   - The key gives you: Key ID (10 chars), Issuer ID (uuid), and the .p8
     content.
5. Add to Cursor Cloud Agent Secrets:
   - `APPLE_API_KEY_ID` ← Key ID
   - `APPLE_API_ISSUER_ID` ← Issuer ID
   - `APPLE_API_PRIVATE_KEY` ← full contents of the `.p8` file (multi-line
     is fine)
6. EAS build credentials (certs/profiles) are handled by `eas build`
   interactively or with `eas credentials`; give the agent the go-ahead and
   it will run them with `EXPO_TOKEN` (already verified).

---

## 7. Google Play Console (Android deployment)

Cost: **$25 USD one-time** (registration fee).

1. **Register**: https://play.google.com/console/signup → pay $25 → complete
   the identity verification (can take 48h the first time).
2. **Create the app**: All apps → **Create app** → name `CoreGrid Scholar`,
   default language, App (not game), free/paid → create.
3. **App signing**: Play uses Play App Signing automatically on first
   upload.
4. **Service account for EAS Submit**:
   - Google Cloud Console (https://console.cloud.google.com) → create/select
     a project → **IAM → Service Accounts → +** → name `eas-submit` →
     **Keys → Add key → JSON** → the `.json` file downloads once.
   - Back in Play Console: **Users and permissions → Invite new users** →
     invite the service account email → grant **Release to testing tracks**
     (Admin is simplest for a solo operator).
5. Add to Cursor Cloud Agent Secrets:
   - `GOOGLE_SERVICE_ACCOUNT_JSON` ← full contents of the `.json` file
6. Package/bundle id: use the same `com.vibeora.scholar` as Apple (or any
   stable reverse-domain string) — set it in `mobile/app.json` under
   `android.package` / `ios.bundleIdentifier` once you decide.

---

## 8. What the agent already did (no action needed from you)

- Verified every injected vendor token with one read-only probe
  (Cloudflare, Vercel, PostHog US, Sentry, New Relic EU, Expo).
- **Aligned the stack regions to West EU (DECISIONS.md #205, 2026-10-06):**
  Vercel `coregrid-scholar-migration` serverless function region changed
  `iad1` → `dub1` (Dublin) via the Vercel API (HTTP 200, verified), matching
  Supabase `eu-west-1` (Ireland, verified via the Supabase API — the project
  was already EU, no migration needed) and New Relic EU.
- Provisioned the app-runtime environment variables on the Vercel project
  `coregrid-scholar-migration` (encrypted, production+preview+development);
  the 2026-10-07 wave-4 sync re-upserted 17 of the 20 mapped variables
  (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY,
  VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, AI_API_KEY,
  AI_GATEWAY_URL, RESEND_API_KEY, RESEND_FROM_ADDRESS, PAYSTACK_SECRET_KEY,
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, VAPI_API_KEY, VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY, VITE_VAPID_PUBLIC_KEY, POSTHOG_PROJECT_API_KEY) and
  honestly reported the 3 absent ones (TWILIO_FROM_NUMBER, REDIS_REST_URL,
  REDIS_REST_TOKEN). (Re-run any time with
  `node scripts/provision-vercel-env.mjs` after adding secrets to this
  environment.)
- Added an optional Redis-backed rate limiter that activates by itself when
  REDIS_REST_URL/REDIS_REST_TOKEN exist, and an extended 13-provider health
  battery.
- **2026-10-07 (DECISIONS.md #209):** re-probed Twilio read-only (account
  active, still Trial, **zero owned phone numbers** — sender number remains
  blocked on the §2 console step); added
  `scripts/infrastructure/redis-capability-probe.mjs` — run it after you add
  the two Redis secrets and it will prove the PING + one governed
  rate-limit check through the app's own adapter.
- **2026-10-07 (DECISIONS.md #210, PLATFORM-019):** operator subscribed to a
  Twilio **business plan** (funded, $20 top-up) and deferred sender-number
  purchase until CAC business-identity verification clears — §2 rewritten:
  activation becomes config-only. Built the per-org sender substrate
  (`cg_org_communication_sender` + resolver + store, zero-policy posture
  battery-verified) and the CoreGrid API-key substrate (`cg_api_key` +
  issue/verify/revoke service — Supabase-style publishable/secret key
  classes; plaintext never stored, sha256 lookup only).
- **2026-10-07 (DECISIONS.md #211):** Redis activation attempt ran fail-closed
  — secrets found injected under the Upstash console names, but the URL value
  is malformed (scheme truncated to `ttps://`), so the probe rejected the
  connection and the registry honestly stays `NOT_CONFIGURED`. Diagnostic
  re-probe with the single character restored in memory proved the token and
  data plane fully valid (PING http 200 → PONG, governed rate-limit check →
  allow). Also fixed a probe defect found by that evidence: the PING
  assertion wrongly expected `OK` — Redis replies `PONG`. §1 status block and
  §10 checklist carry the exact operator fix (one character; prefer renaming
  the secrets to the step-5 contract names).

- **2026-10-07 (DECISIONS.md #212):** Redis activation COMPLETED. In a fresh
  session the secrets (now under the exact contract names
  `REDIS_REST_URL`/`REDIS_REST_TOKEN`, URL scheme valid) passed the
  capability probe (exit 0: PING http 200 → PONG, one governed rate-limit
  check through `rateLimiterFromEnv` → allow) and were upserted to Vercel
  (15 upserted, 0 failed — including both Redis variables; TWILIO_FROM_NUMBER,
  VAPID pair, VITE_VAPID_PUBLIC_KEY and POSTHOG_PROJECT_API_KEY were absent
  from that session's environment and honestly skipped; the VAPID/PostHog
  values already on Vercel from wave 4 are untouched). Registry entries
  flipped to OPERATIONAL / capability_tested with dated probe evidence.

- **2026-10-07 (DECISIONS.md #213, PLATFORM-022):** VAPID pair
  (operator-regenerated) round-tripped Cursor Secrets → Vercel. Provisioning
  run: **18 upserted / 0 failed / 2 honestly skipped** (`TWILIO_FROM_NUMBER`
  — deliberate CAC console hold; `POSTHOG_PROJECT_API_KEY` — absent from
  that session's environment despite the operator having added it to Cursor
  Secrets; its wave-4 value stays live on Vercel, upsert never deletes).
  Registry notes rewritten with the dated regeneration evidence; statuses
  unchanged (`CONFIGURED_BUT_UNVERIFIED` / `credential_present` — a push
  capability claim still requires a real browser subscription). **Production
  deployment deliberately WITHHELD this run:** the session rule is to not
  deploy a runtime missing credentials it could have had, and the PostHog
  project key is re-checkable by the operator (§10). The documented deploy
  path is `npx vercel deploy --prod --yes --token "$VERCEL_API_TOKEN"` from
  the repo root (§45/Vercel `dub1` alignment, DECISIONS.md #205) — run it
  once the PostHog secret is corrected and re-synced.

- **2026-10-07 (DECISIONS.md #214, PLATFORM-023):** credential round-trip
  COMPLETED + Vercel deployment pipeline UNBLOCKED + production deployed.
  (1) All 3 wave-8 credentials verified injected in the fresh session
  (names only): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
  `POSTHOG_PROJECT_API_KEY` — #213's PostHog absence was a window-timing
  gap, resolved. (2) Provisioning re-run: **19 upserted / 0 failed / 1
  honestly skipped** (TWILIO_FROM_NUMBER deliberate CAC console hold) — the
  exact 19/1 shape #213 predicted. (3) **Root cause found for the
  "production deploy withheld" state: every Vercel build since at least
  wave 5 had been failing** (all auto-deployments `readyState: ERROR`) —
  Vercel's guard blocks `@tanstack/react-start@1.168.44` (CVE-2026-102989
  XSS). Fixed by upgrading to 1.168.60 (commit d3f4e33; zod 4.4.3 -> 4.6.5
  rides along and HARDENS strictObject `__proto__` denial — four
  recorded-finding tests flipped to refusal assertions per their own
  reports' documented procedure; no module changed). First build after the
  fix: READY (preview, 20:25:06Z). (4) Production deploy executed via the
  documented CLI path: deployment `dpl_BXCb5tTxJjDo3xTdeHrww2sriMvt`
  READY, target production, built from commit d3f4e33, aliases assigned
  (`coregrid-scholar-migration.vercel.app`,
  `coregrid-scholar-migration-vibeora.vercel.app`). HTTP evidence: the
  `-vibeora` production alias answers HTTP 302 (Vercel SSO deployment
  protection is ON for the project — `all_except_custom_domains` — so
  anonymous requests meet the protection layer, not the app); the bare
  alias still answered HTTP 404 from the edge at 20:32Z (it has never
  served a READY production deployment before — edge propagation finding,
  recorded, API proves the assignment). Public HTTP-200 verification
  requires either disabling the SSO protection (operator call,
  security-sensitive) or a Protection Bypass for Automation token.

---

## 9. AWS and OCI — do you need them? (direct answer: not for V1)

You asked whether AWS and OCI credentials are still needed. **For the V1
deployment on the ratified stack: no.** Here is the honest breakdown:

| Layer | What it runs on | AWS/OCI needed? |
| --- | --- | --- |
| Web app + serverless functions | Vercel (`dub1`, Dublin) | No |
| Database / auth / storage | Supabase (`eu-west-1`, Ireland) | No |
| Email | Resend | No |
| Payments | Paystack | No |
| SMS/voice | Twilio + Vapi | No |
| Rate limiting (optional) | Upstash Redis REST | No |
| Analytics / errors / monitoring | PostHog, Sentry, New Relic | No |
| DNS/CDN/WAF | Cloudflare (IaC token verified) | No |
| Mobile builds | Expo EAS | No |

AWS or OCI would only enter the picture if a named capability requires raw
compute/storage/queues outside Vercel+Supabase (e.g. a long-running worker
daemon, self-managed Postgres, GPU inference). Under the CoreGrid V1
envelope (AGENTS.md §45 + DECISIONS.md #204 vendor set) none is named, no
adapter exists for them, and §58 forbids duplicate systems. If you ever want
one: pick the capability first, record an un-freeze decision, and an adapter
will be built — do not add the credentials speculatively (un-minimized
secrets are a §19 liability, and unused credentials in a dashboard are an
audit finding waiting to happen).

**Recommendation: declare the stack as Vercel + Supabase (already done in
DECISIONS.md #204/#205) and skip AWS/OCI entirely for V1.**

---

## 10. Remaining operator actions (checklist)

- [ ] Twilio: when the CAC business-identity verification clears → complete
      the Trust Hub business profile → buy the sender number → secret
      `TWILIO_FROM_NUMBER` (E.164, e.g. `+15551234567`) → re-run
      `node scripts/provision-vercel-env.mjs`. Account is already a funded
      business plan ($20 top-up, 2026-10-07); purchase is a deliberate hold,
      activation is config-only (see §2 — per-org senders now supported).
- [x] Push-notification keys (web) → `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY`
      — FULLY CLOSED 2026-10-07 (DECISIONS.md #213): the pair was REGENERATED
      by the operator (deliberate — zero push subscriptions existed, the fresh
      pair is canonical), injected into Cursor Secrets under the exact
      contract names, verified in the VM (names only), and round-tripped to
      Vercel with the derived `VITE_VAPID_PUBLIC_KEY` mirror (PLATFORM-022
      provisioning run). Delivery activates once browser subscriptions exist.
- [x] PostHog project key → `POSTHOG_PROJECT_API_KEY` (grabbed autonomously
      2026-10-06; on Vercel). FULLY CLOSED — 2026-10-07 (DECISIONS.md #214):
      in the fresh session after the operator's re-check, the secret was
      verified injected (names only) and round-tripped to Vercel in the
      PLATFORM-023 provisioning run (19 upserted / 0 failed / 1 honestly
      skipped — `TWILIO_FROM_NUMBER` deliberate CAC console hold). The
      personal key name remains a different credential and is deliberately
      never synced to Vercel.
- [x] Upstash Redis → secrets `REDIS_REST_URL`, `REDIS_REST_TOKEN` — DONE
      2026-10-07 (DECISIONS.md #212): credentials injected under the exact
      contract names, capability probe exit 0 (PING OK + one governed
      rate-limit check through the app's own adapter), both variables
      upserted to Vercel (0 failed), registry entries `OPERATIONAL` /
      `capability_tested`. Optional human follow-up: confirm the database
      region is WEST-EU in the Upstash console (eu-west-1 or eu-central-1 per
      DECISIONS.md #205).
- [ ] PostHog EU migration (optional now, required for full West-EU
      alignment): sign up at https://eu.posthog.com, create the project,
      replace `POSTHOG_PROJECT_API_KEY` with the EU project key (§5 above —
      only you can create an EU org; the US key cannot reach it)
- [ ] Sentry: EU org (when creating/choosing the org, pick Europe as the
      data-storage region — §4 above) + broader token + DSN → secrets
      `SENTRY_AUTH_TOKEN` (replace), `SENTRY_DSN` (the current token is
      scope-limited to org:ci and cannot read organizations — only a human
      with console access can mint a broader token or create a DSN)
- [ ] Apple: enroll ($99/yr) → secrets `APPLE_API_KEY_ID`,
      `APPLE_API_ISSUER_ID`, `APPLE_API_PRIVATE_KEY` (paid enrollment +
      identity verification are human-only)
- [ ] Google: register ($25 once) → secret `GOOGLE_SERVICE_ACCOUNT_JSON`
      (paid registration + identity verification are human-only)
- [ ] Vapi: top up credits (BYOK DeepSeek already supported)