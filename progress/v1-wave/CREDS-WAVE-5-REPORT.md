# CREDS-WAVE-5 REPORT — autonomous credential grab (2026-10-06)

System: CoreGrid Scholar | Branch: `cursor/p08-foundation-loop-classification-fe86` | PR: #2 (draft)
Governance: AGENTS.md (CoreGrid ASI Constitution v1.0) — §42 report format, §30 secret hygiene (values never printed into the repo), §45 V1-only envelope.
Operator authorization: in-chat instruction 2026-10-06 — "grab the remaining credentials by yourself and then add them in the secret sections."
Version-target classification: **V1 organizational capability envelope only** (§45).

## Implemented (grabs)

| Credential | Method | Result |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` | generated locally (Node crypto, P-256: 65-byte uncompressed point + raw 32-byte scalar, base64url — the exact shapes `push.server.ts` imports) | OK — provisioned to Vercel (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VITE_VAPID_PUBLIC_KEY` mirror) |
| `POSTHOG_PROJECT_API_KEY` | management API `GET us.posthog.com/api/projects/` with the operator's personal key | OK — project 532234 key grabbed; ingest verified with ONE synthetic event (`distinct_id=control-plane/creds-wave-5`, no personal data) → http 200 |
| `TWILIO_FROM_NUMBER` | Twilio REST: listed SMS-capable US numbers (`address_requirements=none`), attempted purchase | BLOCKED — Twilio error **21404**: "Trial accounts must verify a phone number before purchasing a Twilio number" (the verification call goes to the operator's own phone — human-only) |

## Delivery

- **Vercel**: `scripts/provision-vercel-env.mjs` mappings extended (+5: TWILIO_FROM_NUMBER passthrough, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VITE_VAPID_PUBLIC_KEY mirror, POSTHOG_PROJECT_API_KEY). Live run: **17 variables upserted encrypted (production+preview+development), 0 failures**; only TWILIO_FROM_NUMBER skipped-absent. Read-back verified.
- **Cursor Secrets**: I cannot write the Cursor Secrets store directly (dashboard-only), so the values are handed over in the artifact `secrets-to-add-to-cursor.txt` (created 2026-10-06) for one-time paste into Cursor Dashboard → Cloud Agents → Secrets. Values never entered the repository (§30).
- **Registry**: new entries `POSTHOG_PROJECT_API_KEY` (client_safe_identifier, capability_tested ingest), `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VITE_VAPID_PUBLIC_KEY` (credential_present), `TWILIO_FROM_NUMBER` (BLOCKED, error 21404 recorded). Twilio SID/TOKEN notes updated with the precise blocker. `.env.example` + runbook checklist updated.

## Security Validation

- §30: no credential VALUE printed, logged, or committed; the orchestrator scripts were temp files deleted after the run; values passed to Vercel in-memory only.
- §19/§21: the PostHog probe sent ONE synthetic event with the drill-tenant convention and zero personal data; no analytics surface was implemented — any such surface stays gated behind §19/§20/§21 implementation + tests.
- Secret scan (`verify:secrets`) re-run in the gate: clean.

## Honest blockers (cannot be done by an agent)

- **Twilio number**: requires the operator to verify their own phone number in the Twilio console (Twilio contacts the operator's phone with a code), then purchase. After that: set `TWILIO_FROM_NUMBER` as a Cursor secret and re-run `node scripts/provision-vercel-env.mjs`.
- **Upstash Redis**: requires creating an Upstash account (email verification) — human-only. Steps in the runbook §1.
- **Sentry DSN / broader token**: the supplied token is scope-limited (`org:ci`) and cannot read organizations; minting a new token or creating a DSN requires console access — human-only.
- **Apple / Google console credentials**: paid enrollment ($99/yr, $25 once) + identity verification — human-only.

## Verification

- Registry parse fail-closed with zero issues (schema, uniqueness, secret-shape hygiene).
- Vercel read-back: 17 env records present, all encrypted, all targets.
- Full gate `npm run verify` re-run — see PR body for final counts.

## Known Risks

- The VAPID pair was generated twice during the wave (a first run was overwritten by a second); the SECOND pair is authoritative — the artifact and Vercel both carry it, so there is no drift between the two stores. If the operator already added the first pair anywhere, replace it with the artifact values.
- Web-push delivery remains unexercised until browser subscriptions exist (capability evidence stays at credential_present; nothing fabricated).