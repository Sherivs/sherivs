# V1-PROGRAM — OPERATIONS RUNBOOK

System: CoreGrid Scholar (V1) | Owner team: INFRA-OPS (R8) | Version: 1.0
Status: **validated, not applied** — every external gate below is a recorded
blocker (`architecture/campaigns/V1-PROGRAM/COMMAND-CENTER.md` BLK table).
When a credential arrives, the operator executes the matching section
fill-in-the-blanks. Nothing here authorizes a bypass (§7, §8).

## Laws this runbook obeys

- **§30 Secrets** — no credential value ever enters chat, git, IaC, logs or
  reports. Files reference names only.
- **RULING-11 / COND-006** — operational secrets are provisioned via the
  Cursor Dashboard (Cloud Agents → Secrets) and/or GitHub Environment secrets;
  never in-repo, never printed.
- **§26 API governance / fail-closed** — every pipeline below refuses to run
  with missing credentials rather than degrading.
- **§38 Change management** — every deploy carries a healthcheck gate and a
  rollback plan (§"Deploy runbook" below).

## How credentials are injected (read once)

| Surface | Used by | Mechanism |
| --- | --- | --- |
| **Cursor Cloud Agents → Secrets** | this VM's agent runs (drills, verification) | Dashboard → Cloud Agents → Secrets → add `NAME=value`; values are injected as **environment variables** into new Cloud Agent VMs (never written to the repo) |
| **GitHub → Settings → Environments → `production`** | `.github/workflows/release.yml` deploy job | repository/environment secrets, referenced by name only, protected with required reviewers |
| **GitHub → repo secrets** | release.yml build job (`DOCKER_*`) | referenced by name only, never echoed |
| **VM-local `/opt/coregrid/scholar.env`** (mode 600, root-owned) | the running container (compose `env_file`) | created out-of-band over SSH from `infrastructure/deploy/scholar.env.example` |

The repo-side name manifests live in `.env.example` (application runtime) and
`infrastructure/deploy/scholar.env.example` (deployment env file). Adapters
resolve credentials strictly from `process.env` (`frontend/src/lib/env.ts`
`SERVER_ONLY_VARS` guards the server-only set).

---

## Gate index

| Gate | Credential(s) | Unlocks | Section |
| --- | --- | --- | --- |
| BLK-3 | `DEPLOY_SSH_HOST` / `DEPLOY_SSH_USER` / `DEPLOY_SSH_KEY` (+ `DOCKER_REGISTRY`, `DOCKER_NAMESPACE`, `DOCKER_USERNAME`, `DOCKER_PASSWORD`) | first live production deploy (V1CAP-33) | 1 |
| BLK-4 | `PAYSTACK_SECRET_KEY` | live payment rail (V1CAP-25) | 2 |
| BLK-5 | `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `VAPI_API_KEY` | email delivery; voice (stub-gated in V1) | 3 |
| ST-1 | Apple Developer / Google Play accounts + `EXPO_TOKEN` | mobile store builds + submission (V1-010) | 4 |
| BLK-2 | `AI_API_KEY` (+ `AI_GATEWAY_URL`) | live AI inference evidence (V1CAP-027) | 5 |
| OPS-RL | Supabase Dashboard auth rate-limit setting | self-serve signup T2 (F-13 finding) | 6 |

**Credential-wave status (2026-10-03):** BLK-2 **LIVE-PROVEN** (§5); BLK-5
**partially unblocked** — Resend key validated read-only, real send still
typed-skipped on `RESEND_FROM_ADDRESS` + unverified sending domain (§3);
ST-1: `EXPO_TOKEN` proven, store submission blocked on store accounts (§4);
BLK-4 **PARKED** in test mode pending business verification (§2); OPS-RL
operator decision in flight (§6).

**Credential-wave 2 status (2026-10-06):** BLK-2 **CLOSED** —
`AI_GATEWAY_URL` persisted as a Cursor Secret and the drill re-proven through
the real DeepSeek endpoint (§5); BLK-5 **EMAIL LIVE-PROVEN** — one governed
send through `createResendEmailAdapter` delivered with a provider receipt and
an append-only `cg_delivery_evidence` row; `resend` added to the Phase-10
provider catalogue + drill mirror (§3); ST-1: EAS project linked (`eas init`)
and an Android `preview` APK build kicked on EAS; store submission still
blocked on store accounts (§4); BLK-4 **PARKED** unchanged (§2); OPS-RL
**STILL OPEN** — direct real signup attempt re-confirmed
`429 over_email_send_rate_limit` (§6).

---

## 1. BLK-3 — Deployment credentials (SSH/host + registry)

**What it unlocks:** the first live production deploy. `.github/workflows/
release.yml` `deploy` job currently **fails closed** with
`deployment credentials not configured (BLK-3)`; `infrastructure/terraform`
and `infrastructure/kubernetes` stay FROZEN.

**Exact env vars the repo expects** (cross-checked against
`.github/workflows/release.yml`):

| Var | Used in | Meaning |
| --- | --- | --- |
| `DEPLOY_SSH_HOST` | deploy job | hostname/IP of the target VM |
| `DEPLOY_SSH_USER` | deploy job | SSH user on the target VM |
| `DEPLOY_SSH_KEY` | deploy job | **private** SSH key (ed25519), written to `~/.ssh/id_ed25519` at deploy time |
| `DOCKER_REGISTRY` | build-and-push job | container registry host (e.g. `ghcr.io`) |
| `DOCKER_NAMESPACE` | build-and-push job | registry namespace/org |
| `DOCKER_USERNAME` / `DOCKER_PASSWORD` | build-and-push job | registry login |

**Where the operator obtains it:** operator's own VM/hosting provider (SSH
keypair: generate locally `ssh-keygen -t ed25519`, install the PUBLIC half in
the VM's `authorized_keys`, keep the private half as the secret); registry:
create a push-capable token/robot account (e.g. GitHub Container Registry PAT
with `write:packages`).

**Injection:** `DEPLOY_SSH_*` → GitHub **Environment** `production` secrets
(required reviewers) and, for agent-run verification, Cursor Secrets.
`DOCKER_*` → GitHub repo secrets.

**Validation that proves it live:**
1. Tag a release (`git tag v0.x.y && git push origin v0.x.y`) → release.yml
   verify → build-and-push → deploy job passes the BLK-3 gate.
2. On the VM: `docker ps` shows `coregrid-scholar` up with
   `/opt/coregrid/scholar.env` mounted.
3. `curl -fsS https://<host>/health.json` → `{"status":"ok",...}` (200);
   `curl -fsSI https://<host>/coregrid` → 200 (F-14 smoke parity).

**Known drift — RESOLVED (2026-10-03, post-R-wave):** release.yml now deploys
through the SAME health-gated substrate — it stages
`infrastructure/deploy/deploy.sh` + `docker-compose.yml` onto the VM at
`/opt/coregrid/deploy/` (pinned to the tagged commit) and invokes
`sudo -n bash /opt/coregrid/deploy/deploy.sh '<image>'` over SSH. There is
deliberately NO raw `docker run` bypass: every production container swap goes
through the deploy.sh health gate and auto-rollback.

## 2. BLK-4 — Paystack live secret key

**What it unlocks:** live payments and webhook verification (V1CAP-25;
refunds remain capability-blocked by design per H3-051/H3-092).

**Exact env var:** `PAYSTACK_SECRET_KEY` — cross-checked in `.env.example`,
`frontend/src/lib/runtime/scholar/paystack.functions.ts` (server function
throws `missing PAYSTACK_SECRET_KEY` when absent), and
`frontend/src/lib/payments/paystack-adapter.ts` (HMAC-SHA512 of the raw body,
hex-encoded, carried in `x-paystack-signature` on
`/api/public/webhooks/paystack`).

**Where obtained:** Paystack Dashboard → Settings → API Keys & Webhooks.
Test-mode key is `sk_test_...` (drills use this only —
`scripts/verify-payments-live.drill.mjs` **refuses live keys by design**,
H3-043); live key is `sk_live_...`. Also configure the webhook URL there:
`https://<host>/api/public/webhooks/paystack`.

**Injection:** Paystack Dashboard → cursor secrets for drill runs; runtime
value into `/opt/coregrid/scholar.env` on the VM; GitHub only if CI ever
needs it (currently it does not).

**Validation:** test-mode first — `node scripts/verify-payments-live.drill.mjs`
(TEST-MODE round, real HMAC path, no live charge; H3-026 webhook drill for the
signature path). Live proof — one real low-value transaction initiated from
the deployed app; verify the fee row stores the provider reference and the
webhook receipt validates (`paystack-adapter.ts` HMAC check). Under §36:
signature validation, idempotency, audit and replay protection are already in
the adapter; the live run evidences them.

## 3. BLK-5 — Resend / Vapi communication credentials

**What it unlocks:** transactional email delivery evidence (V1CAP-081). Voice
is **declared but not live in V1**: `frontend/src/lib/communications/
vapi-voice.server.ts` returns typed `provider_not_live` even when the key is
present (NOT_FOR_LIVE_USE) — the credential gates the stub, not a live path.

**Exact env vars** (cross-checked against the V1-009 adapters):

| Var | Adapter | Notes |
| --- | --- | --- |
| `RESEND_API_KEY` | resend-email adapter (`RESEND_API_KEY_ENV`) | `re_...` key; credential reference is a pointer `env://RESEND_API_KEY`, never a value |
| `RESEND_FROM_ADDRESS` | resend-email adapter (`RESEND_FROM_ADDRESS_ENV`) | verified sender on a verified domain |
| `VAPI_API_KEY` | vapi-voice.server.ts (`VAPI_API_KEY_ENV`) | stub-gated in V1 |

**Drift note — RESOLVED (verified 2026-10-06):** all three names ARE declared
in `.env.example` (`RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `VAPI_API_KEY`,
server-side-only comments) since the R6 delivery-evidence wave; the earlier
V1-009 GAP no longer exists. They are also declared in
`infrastructure/deploy/scholar.env.example`.

**Where obtained:** Resend Dashboard → API Keys + Domains (verify the sending
domain, SPF/DKIM); Vapi Dashboard → API Keys.

**Injection:** Cursor Secrets for drill runs; VM env file for runtime.

**Validation:** `node scripts/verify-communication-live.drill.mjs`
(credential-gated provider probe; fail-closed
`BLOCKED_NO_CREDENTIAL` semantics otherwise — V1-009's fetch-spy tests prove
zero network contact when the key is absent). Live proof: one real email send
to an operator-controlled address; verify the Resend dashboard event and the
stored email receipt. Vapi: expect the typed `provider_not_live` result — that
**is** the correct V1 behavior, not a failure.

**2026-10-03 — credential-wave status (BLK-5 partially unblocked):**
- `RESEND_API_KEY` injected and **validated read-only**: `GET
  https://api.resend.com/domains` returned HTTP 200. NO email was sent —
  fail-closed typed skip, because:
  1. `RESEND_FROM_ADDRESS` is **not stored** in Cursor Secrets (name-only
     inventory) — the adapter's from-address gate would return
     `BLOCKED_NO_CREDENTIAL` before any provider call;
  2. the only registered Resend domain (`sherivs.com`) is **status=failed**
     (two records) — SPF/DKIM verification must be redone in the Resend
     dashboard before it can send;
  3. no operator-designated sandbox inbox exists yet.
  Until (1)+(2) land, the live send path stays `undeliverable` by design.
- Offline probe rehearsal: `STATUS=REHEARSAL_PASS` (provider-agnostic).
  Recorded GAP: `resend` is not an id in the Phase-10 provider catalogue
  mirror (the drill refuses `--rehearse resend` with typed `BLOCKED_USAGE`);
  the catalogue update is an authorized-follow-up, not done here.
- Vapi: `VAPI_API_KEY` present; the telephony registry acknowledges it and
  18/18 tests in `tests/unit/communications/telephony-adapter.test.ts` prove
  the stub law (credential present → typed `provider_not_live`,
  NOT_FOR_LIVE_USE, zero network contact in any credential state). Live voice
  path = a FUTURE mission with its own least-privilege authoring.

**2026-10-06 — BLK-5 EMAIL LIVE-PROVEN (credential-wave 2):**
- Operator prerequisites landed: `RESEND_FROM_ADDRESS` stored as a Cursor
  Secret (domain `sherivs.com`), and the Resend domain `sherivs.com` re-verified
  — read-only `GET https://api.resend.com/domains` now reports
  `status=verified` (previously `failed`). Evidence:
  `/opt/cursor/artifacts/blk5-resend-domains-recheck.json`.
- ONE governed send executed through the declared adapter path
  (`createResendEmailAdapter` + `withEmailFailurePolicy` +
  PostgREST delivery-evidence sink), recipient = the operator-provided
  `RESEND_FROM_ADDRESS` account (the only operator-controlled address on the
  verified domain; the value is never printed or logged, §30). Result:
  provider receipt `01a11034-da89-778a-9bd4-85d7a2344623`, durationMs 1235,
  invocationCount=1 (no retries). Provider-side read-only
  `GET https://api.resend.com/emails/<id>` confirms `last_event=sent`.
- Append-only substrate verified by read-back: `cg_delivery_evidence` row
  `b65e6545-b41e-40cb-9875-688537cb2757` — `tenant_id=control-plane/creds-wave`
  (drill convention, §-consistent with the AI drill's `control-plane/drill`),
  `channel=email`, `adapter=resend`, `outcome=delivered`,
  `recipient_redacted=n***@sherivs.com` (§19 minimization holds),
  `provider_message_id` matching the receipt, `ai_generated=false`.
  Evidence: `/opt/cursor/artifacts/blk5-governed-send.json` (digest only).
- Catalogue GAP CLOSED: `resend` added to the Phase-10 provider catalogue
  (`frontend/src/lib/communication-providers.ts`, health DISCOVERED —
  tenant-configured routing remains a separate authorization step) and to the
  drill's embedded mirror in lockstep; `--rehearse resend` now runs
  `STATUS=REHEARSAL_PASS` (exit 0; 22 providers audited). Catalogue-pinned
  suites: communication-providers 34/34, h3-044 18/18, steward-report 10/10.
- VOICE unchanged: Vapi remains the deliberate credential-gated stub.

## 4. Store accounts + Expo (ST-1)

**What it unlocks:** mobile store builds and submission (V1-010 scaffold,
`mobile/eas.json` + `mobile/app.json` authored).

**Exact env vars / credentials:**

| Credential | Used by | Where obtained |
| --- | --- | --- |
| `EXPO_TOKEN` | EAS CLI (`eas build`, `eas submit`) | expo.dev → account settings → Access Tokens |
| Apple Developer Program account | iOS build signing + App Store Connect | developer.apple.com (paid enrollment) |
| App Store Connect API key (optional, for non-interactive submit) | `eas submit --platform ios` | App Store Connect → Users and Access → Keys |
| Google Play Console account | Android `app-bundle` submission | play.google.com/console (one-time fee) |
| Google Play service-account JSON (for non-interactive submit) | `eas submit --platform android` | Play Console → API access |

**Injection:** `EXPO_TOKEN` via Cursor Secrets (agent runs) or the CI
secret store of the mobile pipeline; Apple/Google signing material stays in
EAS credentials (never in git).

**Validation:** `eas build --profile production --platform all` completes and
produces signed artifacts; `eas submit` uploads; the listing appears in App
Store Connect / Play Console. Store metadata itself comes from
`mobile/app.json` (owned by the mobile team — not modified here).

**2026-10-03 — `EXPO_TOKEN` PROVEN (credential-wave):** `eas whoami` (EAS CLI
in `mobile/`) exit 0, authenticated as account `vibeoraai-bit` via
`EXPO_TOKEN` — the token is valid and live. EAS build profiles present in
`mobile/eas.json`: `development`, `preview`, `production` (a development/
preview build is now unblocked; none was started in this wave). Evidence:
`/opt/cursor/artifacts/blk4-expo-whoami.txt`.

**2026-10-06 — ST-1 progress (credential-wave 2):** EAS project linked via
`eas init --account vibeoraai-bit` — `mobile/app.json` now carries
`extra.eas.projectId` (`3cea9979-47ba-4428-b1e8-67fe0671bac8`, owner
`vibeoraai-bit`), unblocking EAS builds from the repo. One Android build was
kicked on the `preview` profile (APK, internal distribution, no store account
required): build id `de78a81a-4c02-40b9-b13f-d0e5a398044c` **FINISHED
successfully** (08:00:33 → 08:20:27 UTC, ~20 min; SDK 57, version 0.1.0,
versionCode 1, commit d82b066, fingerprint `19b4bfb37…`); artifact verified a
real Android APK (`/opt/cursor/artifacts/eas-preview-apk-header.bin`):
`https://expo.dev/artifacts/eas/diNaR9KvlO3nmJH4xZYBZ0zNmoN8cRXxZ1Tk7s9lEXg.apk`
(logs:
`https://expo.dev/accounts/vibeoraai-bit/projects/coregrid-mobile/builds/de78a81a-4c02-40b9-b13f-d0e5a398044c`).
The EAS BUILD dimension of V1-010 is now live-proven end-to-end.
**ST-1 store SUBMISSION remains BLOCKED**: Apple Developer ($99/yr) and
Google Play Console ($25 one-time) accounts are NOT yet provided.

## 5. BLK-2 — AI provider key

**What it unlocks:** live AI inference evidence through the gateway
(V1CAP-027; H3 STREAM_H notes the live AI path never executed without it).

**Exact env vars** (cross-checked against `.env.example` and
`frontend/src/lib/ai-gateway.server.ts`):

- `AI_API_KEY` — server-only (`SERVER_ONLY_VARS`), resolved by the gateway at
  `frontend/src/lib/ai-gateway.server.ts:51`.
- `AI_GATEWAY_URL` — optional override; default `https://api.openai.com/v1`
  (OpenAI-compatible; adapters keep CoreGrid provider-agnostic, §25).
- Optional direct-provider vars in `.env.example`: `NVIDIA_API_KEY`,
  `NVIDIA_BASE_URL` (server-side).

**Where obtained:** the chosen AI provider console (API key with minimum
privilege: inference only, spend cap set).

**Injection:** Cursor Secrets for drills; VM env file (`AI_API_KEY`) for
runtime. Never `VITE_`-prefixed.

**Validation:** `node scripts/verify-ai-gateway-live.drill.mjs` (reads
`AI_API_KEY`, optional `AI_GATEWAY_URL` / `AI_DRILL_MODEL`; exits typed when
absent — never fakes a completion). Live proof: the drill's real completion +
`architecture/observability/slo-cards.md` AI SLO checks (latency/cost within
budget).

**2026-10-03 — LIVE PROOF OBTAINED (BLK-2 gate PASSED):** one governed drill
inference through the declared gateway path, `STATUS=DRILL_PASS`, exit 0 —
`AI_GATEWAY_URL=[REDACTED]`, model `deepseek-chat`,
invocationCount=1 (no retry), tokensIn=16, tokensOut=2, durationMs=459,
output sha256 `c2e3ac47f4a32546…` (raw completion withheld, §21). Evidence
artifact: `/opt/cursor/artifacts/ai-gateway-live-drill.json`.

**OPERATOR ACTION (still open 2026-10-03) — RESOLVED 2026-10-06:** the
`AI_GATEWAY_URL` secret was NOT stored in Cursor Secrets on 2026-10-03. It is
NOW stored: the name-only inventory on 2026-10-06 shows `AI_GATEWAY_URL`
present, and the drill re-run through the persisted env resolved
`endpoint=api.deepseek.com/v1/chat/completions` (the DeepSeek host, not the
OpenAI default) with `STATUS=DRILL_PASS`, exit 0 — invocationCount=1 (no
retry), tokensIn=16, tokensOut=2, durationMs=488, output sha256
`c2e3ac47f4a32546…` (identical digest to the 2026-10-03 proof). BLK-2 is
**CLOSED**: the app runtime now inherits the correct gateway host from the
environment (`AI_GATEWAY_URL=[REDACTED]` — a URL, not a
secret value; names are the contract, §30).

## 6. Supabase auth rate-limit setting (OPS-RL)

**What it unlocks:** T2 self-serve signup (F-13 vertical-slice finding: the
project's `over_email_send_rate_limit` blocked repeated signups for hours —
external backend constraint, not a code defect).

**Exact setting (not an env var):** Supabase Dashboard → **Authentication →
Rate Limits** → raise the *email sent per hour* / signup-related limits to a
level that supports onboarding volume (and/or add an SMTP provider under
Auth → SMTP so limits bind to the operator's mail provider).

**Injection:** dashboard-only configuration on the Supabase project
(`nwrflbpbhyiqdptmlccm` — the canonical project every live battery and the
T2 attempts target; an earlier revision of this section named
`srhmfaoyhpvhdfxmagho`, which does not match the configured
`SUPABASE_URL` and is corrected here); nothing enters the repo or env files.

**Validation:** re-run the signup path of
`tests/e2e/v1-vertical-slice.spec.ts` (T2) against the project, or a manual
signup; expect account creation instead of `429 over_email_send_rate_limit`.

**2026-10-03 — operator decision status + cheaper alternative:** the T2
signup e2e skip remains an external Supabase Dashboard rate-limit constraint
(`over_email_send_rate_limit`, free-plan cap), NOT app code. The operator is
raising the limit via the **Supabase Pro plan**. A cheaper alternative that
uses credentials already provisioned this wave: configure **Resend as custom
SMTP** (Supabase Dashboard → Authentication → SMTP, using `RESEND_API_KEY`
with Resend's SMTP settings) — this lifts the built-in mail cap without the
plan upgrade; the Resend sending-domain prerequisite is now satisfied (§3:
`sherivs.com` verified 2026-10-06). When the operator confirms either path,
re-run the T2 signup case to convert the typed skip.

**2026-10-06 — STILL OPEN (credential-wave 2 re-check):** T2 was re-run; the
typed skip persists — a direct real signup attempt through
`POST /auth/v1/signup` (run-unique address, anon key) returned
`429 over_email_send_rate_limit` ("email rate limit exceeded"), so the
Dashboard limiter is still closed and neither remedy (Pro raise / Resend SMTP)
has been applied yet. No auth row was created by the attempt. The cheap
`/auth/v1/recover` probe reported "open" for an unknown address — recorded as
a known-weak heuristic signal (GoTrue's recover path does not traverse the
same limiter); the authoritative signal is the real signup attempt.

**2026-10-03 — Paystack (BLK-4) parked:** `PAYSTACK_SECRET_KEY` (test mode)
is injected and used for webhook signature verification only. Going LIVE
requires Paystack business verification (CAC, TIN) to complete — zero code
changes until then. Live-key swap: toggle live in Paystack Dashboard →
replace the secret value → update the webhook URL → re-run
`scripts/verify-payments-live.drill.mjs`.

---

## Deploy runbook (BLK-3 cleared → first live deploy)

Full detail in `infrastructure/deploy/README.md`; the operator sequence:

1. Provision VM; install Docker Engine + compose plugin; create
   `deploy`-capable SSH identity; open inbound 443/80 (reverse proxy for TLS)
   and outbound to Supabase/registry.
2. `sudo install -m 600 -o root /path/scholar.env /opt/coregrid/scholar.env`
   filled out-of-band from `infrastructure/deploy/scholar.env.example`
   (ALLOW_DEMO_PROVISIONING must stay `false`).
3. Push/confirm the image tag exists in the registry (release.yml on a `v*`
   tag, or `docker build` + `docker push`).
4. `sudo ./infrastructure/deploy/deploy.sh <registry>/<ns>/coregrid-scholar:<tag>`
   — pulls first, swaps via compose, polls `/health.json`, auto-rolls back on
   failure.
5. External smoke: `/health.json` 200, `/coregrid` 200, `/sw.js` 200,
   `/robots.txt` 200 (F-14 final table), PWA installability manifest.
6. Record evidence in `progress/v1-wave/` (F-14 live-deploy addendum).

## Rollback plan (§38 mandatory)

- **Automatic:** `deploy.sh` restores the previously running image tag when
  the new one fails the health window.
- **Manual:** `sudo ./deploy.sh --rollback`, or pin any known-good tag:
  `sudo ./deploy.sh <registry>/<ns>/coregrid-scholar:<known-good>`.
- **Config rollback:** restore `/opt/coregrid/scholar.env` from the operator's
  secret store, then `deploy.sh --rollback` (env changes apply on container
  recreate).
- **Data layer:** migrations remain forward-only (§28); an app rollback does
  not revert the database — incident response uses the Supabase PITR window
  agreed in `infrastructure/CREDENTIALS.md` §5.
- Images are never pruned by the driver; known-good tags remain on the VM.

## Observability & audit (§29)

- Container logs: `docker logs coregrid-scholar` (json-file, 10m × 5
  rotation, defined in compose). No secrets are logged (secret-redacting
  logger is enforced in the app; §29 law).
- Health: `/health.json` (unauthenticated, leak-free, whitelisted payload;
  503 → drain).
- Deploy audit trail: release.yml run history (human-approved `production`
  environment) + `deploy.sh` stdout; record each operator action in
  `progress/` evidence notes.