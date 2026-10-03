# CARRY-ON MASTER PROMPT — V1 credential-wave (for the next agent window)

Copy everything below the line into the new agent window. The new agent's VM
will receive the four new platform secrets automatically (they are stored in
Cursor Secrets), but ONLY if the secret names match exactly what the code
reads (see Mission 0).

---

## ROLE

You are the autonomous engineering agent for **CoreGrid Scholar**
(`/workspace`, repo `vibeoraai-bit/coregrid-scholar-migration`). You are the
coordinator: teams author, you verify → register → apply → commit → push → PR.
Governance: `AGENTS.md` (CoreGrid ASI Constitution) is binding — §42 report
format, fail-closed behavior, honesty law (never fabricate a pass), shrink-only
ratchets, migrations only through the checksummed canonical apply channel.

## CURRENT STATE (do not re-derive; verify cheaply, don't redo)

- Branch: `cursor/p08-foundation-loop-classification-fe86`; PR #2 (draft):
  https://github.com/vibeoraai-bit/coregrid-scholar-migration/pull/2
- Latest commit: `8117eb1` (T-wave closure). Prior: `badb461` (T-E), `6a6d3bd`
  (T-D), `fe1348f` (T-A), `1372c1d` (T-C), `78ef8b6` (T-B).
- Verified at `8117eb1`:
  - `npm run verify` **exit 0** (typecheck + 8,866 unit tests + registry +
    drift + neutrality + secret scan + both builds).
  - RLS isolation battery `STATUS=PASS — 44/44` against the live Supabase
    project (`nwrflbpbhyiqdptmlccm`).
  - Canonical apply: 20 migrations registered, `STATUS=PASS`.
  - Legacy e2e: 18 passed / 1 typed skip / 0 failed.
- Read these for full context: `progress/v1-wave/T-WAVE-REPORT.md`,
  `architecture/campaigns/V1-PROGRAM/OPERATIONS.md` (§ blockers & drills),
  `architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_BLOCKERS.json`.
- Dev server (if booted): tmux session `coregrid-dev-server` on
  `http://localhost:8080` — **NEVER kill or restart it**.

## NEW: OPERATOR-PROVIDED CREDENTIALS (this wave's whole purpose)

The operator added 4 platform API keys to Cursor Secrets. They inject into
YOUR VM as env vars. **Mission 0 first: verify exact secret names in the
Cursor Dashboard (Cloud Agents → Secrets) — the code reads these EXACT names
and nothing else:**

| Platform | Required env var name(s) | Consumed by | Current adapter state |
| --- | --- | --- | --- |
| DeepSeek | `AI_API_KEY` + `AI_GATEWAY_URL=https://api.deepseek.com/v1` | `frontend/src/lib/ai-gateway.server.ts` (defaults to `https://api.openai.com/v1` — the URL override is REQUIRED or the DeepSeek key hits OpenAI and fails) | Real, live |
| Resend | `RESEND_API_KEY` (`re_...`) + `RESEND_FROM_ADDRESS` | `frontend/src/lib/communications/resend-email.server.ts` | Real, live |
| Vapi | `VAPI_API_KEY` | `frontend/src/lib/communications/vapi-voice.server.ts` | **Stub-gated in V1**: present key → typed `undeliverable("provider_not_live")`. Do NOT attempt live calls. |
| Expo | `EXPO_TOKEN` | EAS CLI (`eas build`) — mobile workspace | Real, but store SUBMISSION (ST-1) still blocked on Apple/Google accounts |

If the operator stored any key under a different name (e.g.
`DEEPSEEK_API_KEY`), stop and tell them to rename it in the dashboard to the
exact name in the table — an env var the code never reads is a credential
that does not exist (§30 hygiene: names are the contract, never values).

## MISSIONS (in order; each: implement → test → evidence → commit → push)

### Mission 0 — Credential inventory (cheap, read-only)
`env | rg "AI_API_KEY|AI_GATEWAY_URL|RESEND|VAPI|EXPO" | sed 's/=.*/=<set>/'`
— confirm presence/absence by NAME only. Never echo values. If any expected
var is absent, record it and continue with the ones present (fail-closed,
partial progress is honest progress).

### Mission 1 — BLK-2: live AI inference proof (DeepSeek)
1. `node scripts/verify-ai-gateway-live.drill.mjs --plan` (offline plan).
2. Live: `AI_DRILL_MODEL=deepseek-chat node scripts/verify-ai-gateway-live.drill.mjs`
   (env `AI_GATEWAY_URL=https://api.deepseek.com/v1` must be set). Exactly one
   governed completion; exit 0 = live proof. Try `deepseek-reasoner` only if
   `deepseek-chat` is unavailable on the key.
3. Record the drill artifact under `/opt/cursor/artifacts/` and update
   `COREGRID_V1_BLOCKERS.json` (BLK-2) + `OPERATIONS.md` blocker table with the
   evidence pointer (digest only — the drill already scrubs the raw text).

### Mission 2 — BLK-5: live email delivery proof (Resend)
1. `node scripts/verify-communication-live.drill.mjs --rehearse` (no network).
2. Resend-side setup the OPERATOR must do (you verify, they click): verify a
   sending domain in the Resend dashboard (SPF/DKIM DNS records) OR use the
   sandbox sender `onboarding@resend.dev` for test-only sends.
   `RESEND_FROM_ADDRESS` must be a verified sender or the adapter fails
   closed (`BLOCKED_NO_CREDENTIAL`).
3. Live proof: execute ONE real governed send through
   `createResendEmailAdapter` (with the delivery-evidence sink) to an
   operator-designated sandbox inbox, then verify the `cg_delivery_evidence`
   row (append-only) and the Resend dashboard delivery entry. If no sandbox
   inbox is designated, leave it typed-skipped and record what's needed.
4. Update BLK-5 in `COREGRID_V1_BLOCKERS.json` / `OPERATIONS.md` (email: live;
   voice: stub-gated with credential present — do not claim live voice).

### Mission 3 — Vapi: acknowledge, do not call
`VAPI_API_KEY` flips the provider registry to "credential present". The V1
adapter is deliberately `NOT_FOR_LIVE_USE`. Record that in the blockers doc
(voice live-path = future mission with its own least-privilege authoring) and
confirm via the telephony adapter unit tests
(`tests/unit/communications/telephony-adapter.test.ts`).

### Mission 4 — Expo: EAS credential validation
1. With `EXPO_TOKEN` set, run `eas whoami` (or equivalent read-only EAS CLI
   call) in the mobile workspace to prove the token works.
2. Kick an EAS **development/preview** build only if a build profile exists;
   store SUBMISSION (ST-1) remains blocked: Apple Developer ($99/yr) and
   Google Play Console ($25 one-time) accounts are NOT yet provided. Record
   exactly that, honestly.

### Mission 5 — OPS-RL: signup rate limit (operator decision in flight)
The T2 signup e2e skip is caused by the Supabase project's
`over_email_send_rate_limit` (free-plan email cap — the operator calls it
"2/hour"; it is a Dashboard setting, NOT hardcoded in the app). Two remedies;
operator picked Pro-plan upgrade as the path:
- Supabase Pro → Dashboard → Authentication → Rate Limits → raise email/hour.
- Cheaper alternative to offer the operator: Resend as custom SMTP
  (Supabase → Authentication → SMTP) — uses the Resend key they already have
  and lifts the built-in mail cap without a plan upgrade.
When the operator confirms a raise (either path), re-run the T2 signup case of
`tests/e2e/v1-vertical-slice.spec.ts` to convert the typed skip.

### Mission 6 — Paystack: parked, test-mode only (do not touch)
`PAYSTACK_SECRET_KEY` (test mode) is injected and used for webhook signature
verification. The operator cannot go LIVE yet: Paystack business verification
(CAC, TIN, etc.) is incomplete. Park it: zero code changes, zero live-mode
config. When the operator later supplies the live key, the swap is: toggle
live in Paystack dashboard → replace the secret value → update the webhook
URL → re-run `scripts/verify-payments-live.drill.mjs`.

### Mission 7 — Close-out
1. Update `COREGRID_V1_BLOCKERS.json`, `OPERATIONS.md`, and a new
   `progress/v1-wave/CREDS-WAVE-REPORT.md` (§42 format) with per-mission
   evidence. Keep every pass real; a credential gap stays a typed skip.
2. Full `npm run verify` must be exit 0 before the final commit.
3. Commit (descriptive messages, one logical change per commit), push with
   `git push -u origin <branch>`, and update PR #2 via the `ManagePullRequest`
   tool (never via `gh`/forge CLI). Then deliver the §42 report.

## STANDING LAWS (violating any of these = incorrect work, however green)
- Fail-closed: missing credential → typed block, never a fake pass.
- §29/§30: never log, print, or commit secret values; drill scripts scrub.
- §27: every send/inference goes through the declared adapter/gateway path.
- Ratchets shrink-only: baseline additions need an ADR (ADR-012 mechanism).
- Migrations: canonical channel only, with exact-inverse rollbacks.
- Honesty: report unproven as unproven. Blocked ≠ failed; unproven is the
  failure state (mh-15 accounting).
