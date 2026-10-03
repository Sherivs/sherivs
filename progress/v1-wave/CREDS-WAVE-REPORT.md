# CREDS-WAVE REPORT — V1 credential wave (coordinator window, 2026-10-03)

System: CoreGrid Scholar | Branch: `cursor/p08-foundation-loop-classification-fe86` | PR: #2 (draft)
Governance: AGENTS.md (CoreGrid ASI Constitution v1.0) — §42 report format, fail-closed, §29/§30 secret hygiene, §27 adapter-path law, §45 V1-only envelope.
Team structure: coordinator + three disjoint-ownership squads — Team SIGNAL (BLK-2 AI drill), Team COURIER (BLK-5 Resend probe), Team AERO (ST-1 Expo credential); coordinator sole owner of all repo files, tests, git, and PR (no cross-team file overlap).

## Implemented

- **Mission 0 — credential inventory (name-only, §30).** Present: `AI_API_KEY`, `RESEND_API_KEY`, `VAPI_API_KEY`, `EXPO_TOKEN`, `PAYSTACK_SECRET_KEY`. ABSENT: `AI_GATEWAY_URL`, `RESEND_FROM_ADDRESS` → operator actions recorded below. No secret value was ever printed or written.
- **Mission 1 — BLK-2 LIVE-PROVEN.** Drill plan `STATUS=PLAN_OK` (exit 0), then ONE governed inference through the declared gateway path: `AI_GATEWAY_URL=https://api.deepseek.com/v1`, model `deepseek-chat` → `STATUS=DRILL_PASS` (exit 0), invocationCount=1 (no retry), tokensIn=16, tokensOut=2, durationMs=459ms, output sha256 `c2e3ac47f4a32546…` (raw completion withheld, §21). Evidence: `/opt/cursor/artifacts/ai-gateway-live-drill.json`, `/opt/cursor/artifacts/blk2-deepseek-drill.log`.
- **Mission 2 — BLK-5 partial (honest typed skip on the real send).** Offline rehearsal `STATUS=REHEARSAL_PASS` (exit 0, provider-agnostic). Live-mode drill captured typed `BLOCKED_NO_SANDBOX_TARGET` (fail-closed proven: no network contact, nothing sent). Read-only credential probe `GET https://api.resend.com/domains` → HTTP 200 (key valid); the only registered domain `sherivs.com` is status=**failed** (two records). NO email was sent — adapter-law fail-closed because `RESEND_FROM_ADDRESS` is unset, the sending domain is unverified, and no operator sandbox inbox was designated. Recorded GAP: `resend` is not an id in the Phase-10 provider catalogue mirror (drill refuses `--rehearse resend` with typed `BLOCKED_USAGE`); catalogue update is an authorized follow-up, not done here. Evidence: `/opt/cursor/artifacts/communication-probe-rehearsal.json`, `/opt/cursor/artifacts/blk5-resend-credential-probe.txt`, `/opt/cursor/artifacts/blk5-resend-rehearsal.log`.
- **Mission 3 — Vapi acknowledged, not called.** `VAPI_API_KEY` present; telephony registry exposes the credential reference `env://VAPI_API_KEY`; 18/18 tests in `tests/unit/communications/telephony-adapter.test.ts` pass, including the stub law (credential present → typed `provider_not_live`, NOT_FOR_LIVE_USE, zero network contact in any credential state). Live voice path = a FUTURE mission with its own least-privilege authoring. Zero code changes.
- **Mission 4 — Expo token proven.** `eas whoami` exit 0, authenticated as `vibeoraai-bit` via `EXPO_TOKEN`. Build profiles `development` / `preview` / `production` exist in `mobile/eas.json`; no build was started. **ST-1 store SUBMISSION remains BLOCKED** (Apple Developer + Google Play accounts not provided). Evidence: `/opt/cursor/artifacts/blk4-expo-whoami.txt`.
- **Mission 5 — OPS-RL documented.** T2 signup e2e skip remains the Supabase Dashboard `over_email_send_rate_limit` constraint (free-plan cap), NOT app code. Operator path: Supabase Pro raise. Cheaper alternative offered: Resend as custom SMTP (Supabase → Authentication → SMTP) using the already-provisioned `RESEND_API_KEY` — requires the Resend sending domain to be verified first. T2 re-run deferred until the operator confirms either path.
- **Mission 6 — Paystack parked.** `PAYSTACK_SECRET_KEY` (test mode) injected, used for webhook signature verification only. Going live requires Paystack business verification (CAC, TIN). Zero code changes, zero live-mode config. Swap procedure recorded in OPERATIONS.md §6 and the blockers registry.

## Files Changed

- `architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_BLOCKERS.json` — BLK-2 live-proven, BLK-5 partial state, BLK-4 parked status.
- `architecture/campaigns/V1-PROGRAM/OPERATIONS.md` — gate-index status block + 2026-10-03 evidence notes in §2, §3, §4, §5, §6.
- `progress/v1-wave/CREDS-WAVE-REPORT.md` — this report (new).
- No adapter, migration, test, or application code was changed (evidence-and-documentation wave; ratchets untouched, migrations untouched).

## Architecture Impact

None structural. All network effects flowed through the declared paths only: the AI drill through `AI_GATEWAY_URL` + `/chat/completions` (§20/§27), the Resend probe as a single read-only `GET /domains`, zero telephony contact by design. V1 envelope only (§45); V2/V3 frozen scope untouched.

## Tests

- `npm run verify` — **exit 0** (2026-10-03 close-out run, log
  `/opt/cursor/artifacts/creds-wave-verify.log`): typecheck clean; unit suite
  **8,866 passed | 5 skipped** across 423 passed / 1 skipped test files
  (exact T-wave baseline parity); registry, drift, and neutrality gates
  `STATUS=PASS` (neutrality: no new violations beyond the honest quarantine
  baseline); secret scan pass; client + SSR production builds green.
  Environment note: this fresh VM required `npm install` (root, to restore
  the `file:packages/contracts` workspace link) and `mobile && npm install`
  (mobile workspace deps absent from the snapshot) before verify could run —
  no lockfile or source changes resulted.
- `tests/unit/communications/telephony-adapter.test.ts` — **18/18 pass** (Vapi stub law exercised with credential-present semantics).

## Security Validation

- Secret values never printed, logged, or written; name-only inventory; drill scripts scrub against live keys (defense in depth verified by their own unit suites in the full verify).
- Fail-closed exercised for real: communication drill refused live mode (`BLOCKED_NO_SANDBOX_TARGET`), Resend adapter's from-address gate would return typed `BLOCKED_NO_CREDENTIAL` — no fake passes fabricated (honesty law / mh-15).
- Exactly one governed AI inference; no retries, no fallback invocations.
- Ratchet law respected: no baseline additions, no ADR-triggering changes.

## Known Risks

1. `AI_GATEWAY_URL` is not stored as a Cursor Secret — at app runtime the gateway would default to `api.openai.com` with the DeepSeek key (wrong host). Operator action required.
2. `RESEND_FROM_ADDRESS` missing + `sherivs.com` domain verification failed → email live path unproven (typed skip).
3. `resend` absent from the Phase-10 provider catalogue mirror (drill `BLOCKED_USAGE` on the named rehearsal) — recorded GAP for an authorized follow-up.
4. Supabase Pro raise not yet confirmed → T2 signup e2e stays typed-skipped.

## Remaining Work

- Operator: store `AI_GATEWAY_URL=https://api.deepseek.com/v1` and `RESEND_FROM_ADDRESS` in Cursor Secrets (exact names); re-verify `sherivs.com` SPF/DKIM in the Resend dashboard; designate a sandbox inbox for the one governed BLK-5 send; confirm the Supabase rate-limit path (Pro raise or Resend-as-SMTP).
- Agent (next wave): execute the single governed BLK-5 live send through `createResendEmailAdapter` + verify the `cg_delivery_evidence` row; re-run the T2 signup case; EAS development/preview build; Paystack live swap after business verification; live voice-path mission (own authoring).
