# Provider Onboarding Guide — Baby Mode

Status: GOVERNED — operator onboarding runbook. Steps marked "already did"
are executed and evidence-backed; remaining steps await operator action.
Mission: MISSION-V1-017 (deployment track, provider-credential dimension) under
the DECISIONS.md #204 un-freeze authority (2026-10-06).
Authority: AGENTS.md §12 (provenance), §30 (secrets — names only, never values),
§45 (V1 envelope; V2/V3 untouched), DECISIONS.md #204 (PLATFORM-013).

Audience: the operator (you). Style: one screen at a time, click-by-click.
Each section ends with the exact secret NAMES to add to Cursor Cloud Agents →
Settings → Secrets (never email or paste values anywhere else).

Scope authority: DECISIONS.md #204 (2026-10-06) — you authorized these vendor
integrations into V1. V2 (device/IoT) and V3 (Reality Intelligence) remain
frozen; nothing in this guide touches them.

---

## 1. Redis (Upstash) — get the REST keys

Redis is OPTIONAL today: the app runs fine with in-process rate limiting.
Add it when you deploy more than one server instance.

1. Open https://console.upstash.com and sign up (free plan is fine; GitHub
   login works).
2. Click **Databases** → **Create Database**.
   - Name: `coregrid-scholar`
   - Region: pick the region closest to your Vercel function region
     (Vercel default is `iad1` = US East, so pick US East/AWS us-east-1).
   - Type: **Regional** (free tier). TLS is always on.
3. Open the database you just created.
4. Scroll to the **REST API** section. You will see two values:
   - `UPSTASH_REDIS_REST_URL` — looks like `https://xxx.upstash.io`
   - `UPSTASH_REDIS_REST_TOKEN` — a long token
5. Add both to Cursor Cloud Agent Secrets with these exact names:
   - `REDIS_REST_URL` ← the REST URL
   - `REDIS_REST_TOKEN` ← the REST token

What happens automatically after that: the health battery probes the
endpoint with a single read-only `PING`, and `rateLimiterFromEnv` switches
the AI gateway from in-process to distributed fixed-window limiting. No code
change is needed from you.

---

## 2. Twilio — buy the phone number

The account SID and auth token are already live-verified. What is missing is
a sender NUMBER (`TWILIO_FROM_NUMBER`).

**Trials first (your account is a Trial — confirmed via the API):** Twilio
error 21404 refused the autonomous purchase on 2026-10-06: *"Trial accounts
must verify a phone number before purchasing a Twilio number."* So step 0 is:

0. In https://console.twilio.com → **Phone Numbers → Manage → Verified
   Caller IDs → +**, add YOUR mobile number, answer Twilio's call/text, type
   the code. (Only you can receive that verification code.)
1. Open https://console.twilio.com and log in.
2. Left sidebar: **Phone Numbers** → **Manage** → **Buy a number**.
3. Search for a number in your country. Check the **SMS** capability box
   (voice optional — Vapi uses its own voice stack, but SMS is what the V1
   Twilio adapter sends).
   - If your country has no local numbers, buy a US number: SMS-capable US
     numbers work worldwide for sending SMS.
4. Click **Buy** and confirm. Trial accounts: the purchase uses trial credit.
5. Copy the number in **E.164** format, e.g. `+15551234567`.
6. Add to Cursor Cloud Agent Secrets:
   - `TWILIO_FROM_NUMBER` ← e.g. `+15551234567`
7. (For inbound SMS later, optional) On the number's config page set
   **Messaging → "A message comes in"** webhook to your deployed webhook URL
   once the app is live. The inbound route verifies Twilio signatures
   (HMAC-SHA1) before processing anything.

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

## 5. PostHog — grab the project API key

Your personal key is verified but CANNOT ingest client events (a known
PostHog rule). For product analytics you need the PROJECT key:

1. Open https://us.posthog.com (your project is US-region, id 532234).
2. Click the gear (Settings) → **Project API key** — it starts with `phc_`.
   This one is safe to expose in the browser bundle (it is an ingest key,
   not a secret).
3. Add to Cursor Cloud Agent Secrets:
   - `POSTHOG_PROJECT_API_KEY` ← the `phc_…` value

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
- Provisioned 13 environment variables on the Vercel project
  `coregrid-scholar-migration` (encrypted, production+preview+development):
  SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY,
  VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, AI_API_KEY,
  AI_GATEWAY_URL, RESEND_API_KEY, RESEND_FROM_ADDRESS, PAYSTACK_SECRET_KEY,
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, VAPI_API_KEY.
  (Re-run any time with `node scripts/provision-vercel-env.mjs` after adding
  secrets to this environment.)
- Added an optional Redis-backed rate limiter that activates by itself when
  REDIS_REST_URL/REDIS_REST_TOKEN exist, and an extended 13-provider health
  battery.

## 9. Remaining operator actions (checklist)

- [ ] Twilio: verify YOUR phone number in the console (Twilio calls/texts you
      a code — trial accounts must do this before purchasing; API purchase
      attempt 2026-10-06 was refused with error 21404) → then buy the number
      → secret `TWILIO_FROM_NUMBER` (E.164, e.g. `+15551234567`)
- [x] PostHog project key → `POSTHOG_PROJECT_API_KEY` (grabbed autonomously
      2026-10-06; on Vercel; add to Cursor Secrets from the handover artifact)
- [x] Push-notification keys (web) → `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY`
      (generated 2026-10-06; on Vercel; add to Cursor Secrets)
- [ ] Upstash Redis → secrets `REDIS_REST_URL`, `REDIS_REST_TOKEN` (optional;
      requires an account only you can create — §1 above)
- [ ] Sentry: broader token + DSN → secrets `SENTRY_AUTH_TOKEN` (replace),
      `SENTRY_DSN` (the current token is scope-limited to org:ci and cannot
      read organizations — only a human with console access can mint a broader
      token or create a DSN)
- [ ] Apple: enroll ($99/yr) → secrets `APPLE_API_KEY_ID`,
      `APPLE_API_ISSUER_ID`, `APPLE_API_PRIVATE_KEY` (paid enrollment +
      identity verification are human-only)
- [ ] Google: register ($25 once) → secret `GOOGLE_SERVICE_ACCOUNT_JSON`
      (paid registration + identity verification are human-only)
- [ ] Vapi: top up credits (BYOK DeepSeek already supported)