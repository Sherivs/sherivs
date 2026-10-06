# CREDS-WAVE-2 REPORT — credential-wave close-out II (coordinator window, 2026-10-06)

System: CoreGrid Scholar | Branch: `cursor/p08-foundation-loop-classification-fe86` | PR: #2 (draft)
Governance: AGENTS.md (CoreGrid ASI Constitution v1.0) — §42 report format, fail-closed, §29/§30 secret hygiene, §27 adapter-path law, §45 V1-only envelope.
Version-target classification: **V1 organizational capability envelope only** (§45); V2 (device/IoT) and V3 (Reality Intelligence) untouched.

## Implemented

- **BLK-2 CLOSED — `AI_GATEWAY_URL` operator action landed and re-proven.** The
  2026-10-03 name-only inventory recorded `AI_GATEWAY_URL` as absent; it is now
  injected as a Cursor Secret. The governed AI drill re-run through the
  persisted env resolved `endpoint=api.deepseek.com/v1/chat/completions` (the
  DeepSeek host, not the `api.openai.com` default) with `STATUS=DRILL_PASS`,
  exit 0 — invocationCount=1 (no retry), tokensIn=16, tokensOut=2,
  durationMs=488, output sha256 `c2e3ac47f4a32546…` (identical digest to the
  2026-10-03 proof; raw completion withheld, §21). Evidence:
  `/opt/cursor/artifacts/ai-gateway-live-drill.json`.
- **BLK-5 EMAIL LIVE-PROVEN — one governed send through the declared adapter
  path.** Operator prerequisites confirmed first: `RESEND_FROM_ADDRESS`
  injected; Resend domain `sherivs.com` re-verified (read-only
  `GET https://api.resend.com/domains` → `status=verified`; previously
  `failed`). Then exactly ONE send executed through
  `createResendEmailAdapter` (J-045 failure policy wrap + PostgREST
  delivery-evidence sink), recipient = the operator-provided
  `RESEND_FROM_ADDRESS` account (the only operator-controlled address on the
  verified domain; the value is never printed/logged, §30): provider receipt
  `01a11034-da89-778a-9bd4-85d7a2344623`, durationMs 1235, invocationCount=1;
  provider-side read-only `GET /emails/<id>` confirms `last_event=sent`;
  notification state transitioned `queued → delivered` ONLY via the provider
  receipt (the typed `markDelivered` path). Append-only substrate verified by
  read-back: `cg_delivery_evidence` row
  `b65e6545-b41e-40cb-9875-688537cb2757` — `tenant_id=control-plane/creds-wave`
  (drill-tenant convention, matching the AI drill's `control-plane/drill`),
  `outcome=delivered`, `recipient_redacted=n***@sherivs.com` (§19 minimization
  holds), `provider_message_id` = receipt id, `ai_generated=false`. Evidence:
  `/opt/cursor/artifacts/blk5-governed-send.json` (digest only).
- **BLK-5 catalogue GAP CLOSED (authorized follow-up from the first wave).**
  `resend` added to the Phase-10 provider catalogue
  (`frontend/src/lib/communication-providers.ts`) — health stays **DISCOVERED**
  (the catalogue's lifecycle law tracks tenant-configured routing; a platform
  credential existing is a different authorization step), credential reference
  `env://RESEND_API_KEY` (scheme-checked, never a value). The communication
  drill's embedded mirror was updated in lockstep (the unit suite deep
  cross-checks both read-only), and `--rehearse resend` now runs
  `STATUS=REHEARSAL_PASS` exit 0 (22 providers audited; previously typed
  `BLOCKED_USAGE`).
- **ST-1 progress — EAS project linked + first EAS build FINISHED.** `eas whoami`
  re-proven (authenticated as `vibeoraai-bit` via `EXPO_TOKEN`). `eas init`
  linked the repo to the Expo project: `mobile/app.json` now carries
  `extra.eas.projectId` (`3cea9979-47ba-4428-b1e8-67fe0671bac8`, owner
  `vibeoraai-bit`). One Android build on the `preview` profile (APK, internal
  distribution — no store account required) **finished successfully**:
  build `de78a81a-4c02-40b9-b13f-d0e5a398044c`, 08:00:33 → 08:20:27 UTC
  (~20 min), SDK 57, version 0.1.0 (versionCode 1), commit `d82b066`; the
  archive URL was verified to serve a real Android APK
  (`file`: "Android package (APK), with gradle app-metadata.properties"). The
  EAS BUILD dimension of V1-010 is live-proven end-to-end. Store SUBMISSION
  stays blocked on Apple/Google accounts.
- **OPS-RL re-checked — STILL OPEN, honestly.** T2 signup e2e re-run: typed
  skip persists. A direct real signup attempt through `POST /auth/v1/signup`
  (run-unique address, anon key) returned `429 over_email_send_rate_limit`
  ("email rate limit exceeded") — the Dashboard limiter on the canonical
  project (`nwrflbpbhyiqdptmlccm`) is still closed; no auth row was created.
  The cheap `/auth/v1/recover` probe reported "open" — recorded as a known-weak
  heuristic (recover does not traverse the same limiter); the authoritative
  signal is the real signup attempt.
- **BLK-4 (Paystack): untouched — parked in test mode pending operator business
  verification.** Vapi: untouched — deliberate credential-gated stub.

## Files Changed

- `frontend/src/lib/communication-providers.ts` — additive `resend` catalogue
  entry (DISCOVERED) + header email-provider list.
- `scripts/verify-communication-live.drill.mjs` — embedded catalogue mirror
  updated in lockstep (required by the h3-044 deep cross-check).
- `mobile/app.json` — EAS project link (`extra.eas.projectId`, `owner`) written
  by `eas init`; no store metadata changed.
- `scripts/verify-launch-criteria.mjs` — the AI criterion's gate ownership
  moved from BLK-2 (now closed) to the open recorded gate BLK-6 that actually
  owns the remaining gap (worker delegation, mission M-R-40); its substrate
  check flipped from "BLK-2 recorded open" to "BLK-2 recorded RESOLVED (live
  proof never bypassed)"; COMMUNICATION baseline/gate reason updated honestly
  (email live-proven; SMS/voice still provider-gated); EXECUTION residual-gate
  note updated. The canonical record
  (`COREGRID_V1_LAUNCH_CRITERIA.json`) `current` fields for AI, EXECUTION and
  COMMUNICATION were updated to match — statements (questions) untouched,
  drift-lock unaffected. Harness result: `PASS (exit 0)` — 13 proven, 5
  blocked, 0 unproven; every blocked criterion owned by an OPEN recorded gate
  (mh-15 suite 13/13).
- `architecture/campaigns/V1-PROGRAM/OPERATIONS.md` — wave-2 status block;
  BLK-5 §3 live-proof record + stale `.env.example` drift note corrected
  (all three RESEND/VAPI names ARE declared there since R6); §4 EAS record;
  §5 BLK-2 closure; §6 OPS-RL re-check + project-ref drift fix
  (`srhmfaoyhpvhdfxmagho` did not match the configured `SUPABASE_URL` →
  corrected to `nwrflbpbhyiqdptmlccm`).
- `architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_BLOCKERS.json`
  — BLK-2 → RESOLVED/CLOSED; BLK-5 → EMAIL LIVE-PROVEN (voice unchanged).
- `progress/v1-wave/CREDS-WAVE-2-REPORT.md` — this report.
- No migration, no ratchet change, no application behavior change.

## Architecture Impact

Additive data only: one catalogue entry (fail-closed DISCOVERED — routing still
refuses; the concrete adapter remains the only live path and is unchanged), one
drill mirror line, one EAS project link. The governed send flowed through the
declared §27 adapter chain (`evaluateEmailPreSend` gate → Zod payload contract
→ single bounded fetch → typed receipt), with the append-only evidence ledger
recording the attempt. §45 respected: V1 communications capability only.

## Tests

- Catalogue-pinned suites after the change: `communication-providers` 34/34,
  `h3-044-communication-drill` 18/18 (incl. the mirror deep cross-check),
  `communication-steward-report` 10/10 — 62/62 green.
- Launch-criteria harness after the BLK-2 closure:
  `node scripts/verify-launch-criteria.mjs` — `PASS (exit 0)` (13 proven /
  5 blocked / 0 unproven; AI owned by open gate BLK-6, COMMUNICATION by BLK-5);
  `tests/unit/mh-15-launch-criteria.test.ts` 13/13.
- `node scripts/verify-communication-live.drill.mjs --rehearse resend` —
  `STATUS=REHEARSAL_PASS`, exit 0 (22 providers audited).
- `node scripts/verify-ai-gateway-live.drill.mjs` — `STATUS=DRILL_PASS`, exit 0
  (one governed inference through the persisted gateway env).
- T2 signup e2e re-run: 1 typed skip (honest — limiter closed, verbatim 429
  evidence recorded above); no fake pass fabricated.
- Full `npm run verify` — see close-out evidence below (required exit 0 before
  final commit).

## Security Validation

- §29/§30: no secret value printed, logged, or written anywhere; the from/recipient
  address appears only in redacted form in the evidence row (`n***@sherivs.com`)
  and never in repo files; artifacts carry digests and ids only.
- Fail-closed preserved and exercised: the send would have been a typed
  `BLOCKED_NO_CREDENTIAL` without the from-address; the evidence row exists
  BECAUSE the sink was configured; a sink failure could not upgrade the result.
- §21: provider response consumed through the Zod response contract only
  (`ResendEmailResponseSchema` — id field); no untrusted output surfaced.
- Exactly-once: one AI inference, one email send, no retries; limiter probe and
  signup attempts created no auth rows.
- Ratchet law: additive catalogue entry only; no baseline files touched.

## Known Risks

1. The EAS preview build finished successfully and its APK was verified (see
   ST-1 record); the remaining ST-1 dimension is store SUBMISSION, blocked on
   Apple/Google accounts.
2. The BLK-5 send self-addressed the operator's `RESEND_FROM_ADDRESS` account —
   the only operator-controlled inbox available; a future operator-designated
   sandbox inbox can re-target the verification without code change.
3. OPS-RL remains open until the operator applies the Pro raise or Resend-SMTP
   configuration; T2 stays typed-skipped.
4. The `/auth/v1/recover` limiter probe reads "open" while the signup limiter is
   closed — recorded as a weak heuristic; callers must rely on real attempts.

## Remaining Work

- Store submission (ST-1) still blocked on Apple Developer + Google Play
  accounts; the EAS build dimension itself is proven (APK produced and
  verified).
- Operator: apply the OPS-RL remedy (Supabase Pro raise or Resend-as-SMTP on
  the now-verified domain); then re-run T2 to convert the typed skip.
- Paystack live swap after business verification; Vapi live-path mission with
  its own least-privilege authoring.