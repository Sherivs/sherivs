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

**Known drift (reported, not modified):** the release.yml deploy step issues
raw `docker run --env-file` commands, while `infrastructure/deploy/deploy.sh`
runs compose with health-gated auto-rollback. For the first live deploy prefer
running `deploy.sh` on the VM (or aligning release.yml to it) — flag to the
release.yml owners; this agent did not touch CI.

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

**Drift note:** these three names are **not yet in `.env.example`** (recorded
V1-009 GAP — outside this agent's file ownership). They ARE declared in
`infrastructure/deploy/scholar.env.example`. An authorized follow-up should
declare them in `.env.example` / `frontend/src/lib/env.ts`.

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

## 6. Supabase auth rate-limit setting (OPS-RL)

**What it unlocks:** T2 self-serve signup (F-13 vertical-slice finding: the
project's `over_email_send_rate_limit` blocked repeated signups for hours —
external backend constraint, not a code defect).

**Exact setting (not an env var):** Supabase Dashboard → **Authentication →
Rate Limits** → raise the *email sent per hour* / signup-related limits to a
level that supports onboarding volume (and/or add an SMTP provider under
Auth → SMTP so limits bind to the operator's mail provider).

**Injection:** dashboard-only configuration on the Supabase project
(`srhmfaoyhpvhdfxmagho`); nothing enters the repo or env files.

**Validation:** re-run the signup path of
`tests/e2e/v1-vertical-slice.spec.ts` (T2) against the project, or a manual
signup; expect account creation instead of `429 over_email_send_rate_limit`.

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