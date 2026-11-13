# ADR-069: SMS Goes Through One Provider Port, Starting With BulkSMS Nigeria

|| Field | Value |
||---|---|
|| Status | PROPOSED, IN PROGRESS. Operator review before `SMS_PROVIDER` is set, any provider credential is stored, or `sms_live` is turned on for any organization. The 2026-11-13 financial and entitlement review found a blocking defect (F1: the dispatcher's database writes are refused) and a charge on simulated sends (F2); see the review section at the end. |
|| Date | 2026-11-13 |
|| Author | Claude Code coding agent (Claude Sonnet 5.5) for issue #330. Extends the communication fabric delivered by `copilot-swe-agent[bot]` in PR #222 (issue #221). |
|| Mission | COMMS-03 — BulkSMS as the Sherivs SMS provider inside the communication fabric |
|| Capabilities | V1 organizational communications; SMS dispatch and delivery reports scoped to the organization that owns the message |
|| Supersedes-in-part | None. The Twilio SMS adapter (`twilio-sms.server.ts`) stays and is not part of this selection. The legacy `BulkSmsNigeriaAdapter` in `scholar/comms/adapters.server.ts` is left in place and is not wired by this change. |
|| Cites | AGENTS.md §§13, 16, 17, 19, 24–31, 45; issue #330; `database/supabase/migrations/20261101001000_sherivs_033_communication_scope_lock.sql` (`comms_send`, the `comms_audit_event` trigger loop); `database/supabase/migrations/20261024000260_sherivs_019_wallet_ndpa_campus.sql` (`usage_price_book`, `meter_usage`); `frontend/src/lib/communications/sms-gateway-contract.ts`; `frontend/src/lib/communications/bulksms-nigeria.server.ts`; `frontend/src/lib/communications/sms-fabric.server.ts`; `frontend/src/lib/payments/tier-entitlements.ts` |
|| Minimal ownership artifact | `frontend/src/lib/communications/sms-gateway-contract.ts` (the port) |

## Context

Issue #330 asks for "BulkSMS" as the SMS provider inside the existing fabric. Two products carry that name. BulkSMS.com is a global gateway (`api.bulksms.com/v1`, Basic auth with a token id and secret). BulkSMS Nigeria is a Nigerian gateway (`www.bulksmsnigeria.com/api/v2`, Bearer token). The issue says no BulkSMS provider exists in the repository. The repository already commits to the Nigerian one:

- `comms_send` stamps `provider = 'bulksmsnigeria'` on every queued SMS row (migration `20261101001000`).
- The price book derives SMS unit cost from "BulkSMSNigeria NGN6.49 + VAT" (migration `20261024000260`).
- `scholar/comms/adapters.server.ts` holds a `BulkSmsNigeriaAdapter` that reads `BULKSMS_NG_TOKEN` and `BULKSMS_NG_SENDER`. Nothing calls `adapterFor`, so it never sends from the fabric. It also takes a recipient string directly, with no re-resolution, no consent check and no claim.

This ADR reads "BulkSMS" as BulkSMS Nigeria for that reason. That reading is an assumption and is reversible: a BulkSMS.com adapter is one more file behind the same port.

Facts from the provider's current documentation (read 2026-11-13): sends are `POST /api/v2/sms` with `from` (max 11 characters), `to` (digits, international form), `body` (max 1530), optional `unicode` and `callback_url`. A success carries `data.message_id`. Errors are HTTP 4xx with a `BSNG-XXXX` code; `409` is a duplicate within a minute. There is no idempotency key. Delivery outcomes are POSTed per recipient to `callback_url` with `message_id`, `recipient`, `delivery_status`. The provider states those requests are not signed and suggests a secret in the URL. No inbound-reply webhook is documented. The documented request limit is stated for the sandbox only (120 per minute); the vendor's tutorial says 100 per minute.

The fabric already decides what may be sent (approved template, one verified member, opt-in, per-student daily cap, wallet metering) and already audits every `outbound_messages` insert and update into `audit_chain` through `trg_outbound_messages_comms_audit`. What is missing is the dispatcher that turns a `queued` row into a provider call and the authenticated delivery-report intake.

## Options

### Option 1 — Wire the legacy adapter into the fabric as it is (rejected)

Call `adapterFor("sms", …)` from a worker.

- **Consequences:** Smallest change. It sends to whatever `to_address` the row holds without re-checking membership, plan or consent, has no claim so two workers can double-text a parent, has no delivery-report path, and returns a synthetic `bsn-<uuid>` reference when the provider omits an id, which fabricates a receipt.

### Option 2 — Build the BulkSMS.com adapter instead (rejected for this change, retained as future)

Target `api.bulksms.com/v1` with Basic auth.

- **Consequences:** It would match the owner's wording if BulkSMS.com was meant. It contradicts the provider id the database already stamps, the price book cost basis, and Nigerian sender-ID needs. Its webhook has no signature either (secret in the URL), so it would need the same per-message token. If the owner confirms BulkSMS.com, it is added behind the port without touching the dispatcher.

### Option 3 — One provider port, explicit `SMS_PROVIDER` selection, dispatcher and per-message callback token (ruled)

A port (`SmsGateway`) with a typed result union. `SMS_PROVIDER` must name a registered provider; unset, unsupported or unconfigured selections send nothing. The dispatcher re-resolves the recipient from the queued row's member id, re-checks consent and the plan, claims the row atomically, sends once and writes the outcome. The delivery-report route authenticates a per-message HMAC token carried in the callback URL, resolves the organization from Sherivs's own row, and ignores unknown or replayed reports.

- **Consequences:** Reuses the fabric, the metering and the audit trigger; adds no table. Costs: one more provider id in a registry, and an at-most-once policy that fails some sends terminally rather than risk a duplicate.

### Option 4 — One shared secret in the callback URL, as the provider suggests (rejected)

- **Consequences:** Simple. A single leaked request log would let anyone forge delivery outcomes for every message. A per-message HMAC limits a leak to one message and keeps the secret out of every URL.

## Recommendation (decision)

**Use Option 3.** SMS is dispatched only from approved, queued fabric rows. The recipient is never taken from a caller, the client or a model. Missing or invalid credentials fail closed and leave rows queued. A send is at-most-once: it is retried only when the provider provably did not process it (HTTP 429 or 503, or a connection that never left Sherivs); every ambiguous outcome is terminal. The provider is selected by `SMS_PROVIDER=bulksmsnigeria` and configured by `BULKSMS_NG_TOKEN`, `BULKSMS_NG_SENDER`, and optionally `BULKSMS_NG_WEBHOOK_URL` plus `BULKSMS_NG_WEBHOOK_SECRET` for delivery reports. No value is stored in code, logs, results or URLs. `sms_live` stays off. **Correction (2026-11-13 review): this PR adds no migration, but one is needed before the dispatcher can write; see F1 and the proposal in `docs/proposals/comms-03-financial-entitlement/`.** Plan gating reads the tier catalog through `tenantTierEntitlement` (Growth, Professional and Enterprise include SMS; Starter and Trial do not); the deprecated `hasTierFeature` always returns true and is not used.

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual risk:** (1) A worker that crashes between the claim and the state write leaves a row claimed and invisible to the dispatcher. It is never re-sent. The scheduled dispatcher now reports claims older than 15 minutes (`staleClaims`), but an operator must still reconcile them by hand: the provider's delivery-reports endpoint looks up by `message_id` only and we never received one. (2) The callback URL carries a per-message token and can appear in request logs. (3) The provider account is shared by all tenants, so its request limit is shared; a `429` halts the run and leaves rows queued. (4) Non-ASCII messages are sent as Unicode and may cost more provider pages than the 160-character metering assumes. (5) The provider documents no inbound-reply webhook, so SMS STOP replies cannot be received on this provider. (6) A message rejected or failed after metering is not refunded to the wallet or the term pool. (7) `comms_send` does not check the plan at queue time, so a Starter or Trial organization is metered for an SMS that the dispatcher then refuses.
- **The sharpest instance:** A crashed worker leaves a parent's message claimed and unsent with no automatic alarm.
- **The accepted rationale:** Double-texting a parent costs money and trust and cannot be undone; a stuck row is visible and recoverable.
- **Owner of the residual risk:** The communications owner, before `sms_live` is enabled for a tenant. Needed first: wallet and pool refund on terminal failure, a plan check at queue time, an inbound opt-out channel, and a decision on stuck-claim reconciliation (see the readiness review).

## Consequences (summary)

- **Positive:** The fabric can now send and track SMS without a second recipient path. Consent, plan and tenant membership are enforced at send time as well as queue time. Every change is audited by the existing trigger; a test fails if that trigger is dropped.
- **Negative / obligations:** The scheduled dispatcher is `/api/public/cron/sms-dispatch` (Bearer `CRON_SECRET`, like the other cron jobs). No scheduler is configured in this repository (there is no `vercel.json`), so someone with Vercel or n8n authority must create the schedule; until then nothing drains the queue. The Resend webhook module in draft PR #333 defines a similar database interface; they can share one after that merges. A finding for the owner: the seed in migration `20261024000230` gives the Starter plan the `sms` feature and a 500-message quota, and `plan_allowances` (migration `20261024000260`) gives Starter and Trial SMS allowances, which disagrees with the rule in issue #330 that Starter and Trial do not include SMS. The dispatcher follows the tier catalog; the seeds are not changed here.
- **For the wave/program specifically:** V1 communications only. No V2 device or V3 reality work. No migration range is consumed.

## Golden Questions

- **WHO?** The communications owner rules on the provider choice and on enabling `sms_live`. The dispatcher acts as a system worker for one organization at a time. The provider's callback acts only through a verified per-message token.
- **WHAT?** One SMS provider port with BulkSMS Nigeria as its first adapter, a dispatcher for approved queued rows, a CRON_SECRET-gated scheduled trigger for it, and an authenticated delivery-report route.
- **WHERE?** `sms-gateway-contract.ts`, `sms-gateway.server.ts`, `bulksms-nigeria.server.ts`, `sms-fabric.server.ts`, `routes/api/public/webhooks/bulksms.ts`, `routes/api/public/cron/sms-dispatch.ts`, and the two test files under `tests/unit/communications/`.
- **WHY?** Issue #330 requires SMS inside the fabric, behind env selection, with fail-closed credentials, verified delivery reports, consent, metering and audit.
- **UNDER WHICH POLICY?** AGENTS.md §§13, 16, 17, 19, 24–31 and 45; forced RLS stays untouched; `sms_live` default-off; ADR-067 and ADR-068 for the sibling communications missions.

## UNKNOWNs

- **Which BulkSMS did the owner mean?** BulkSMS Nigeria is implemented because the database already names it. Confirm or redirect.
- **Production request limit.** The vendor documents only the sandbox limit.
- **Callback behaviour for `callback_url` query strings.** The provider's documentation shows query strings in callback URLs and says to use HTTPS, but a live test has not been run, so the end-to-end behaviour is documented, not observed. Run one against a test organization before delivery reports are relied on.
- **Refund treatment of failed messages by the provider.** The API page links a refund policy but does not state whether a message that is accepted and later fails is credited back. Ask the provider.
- **Provider timing of final delivery status.** Not stated by the provider. The token therefore has no expiry.

## Production readiness review (COMMS-03, 2026-11-13)

Status of each reviewed area: FIXED (changed in this PR), VERIFIED (read and tested, no change), or OPEN (not fixed here, with a reason and an owner).

> **Correction (2026-11-13 financial review):** rows that rely on dispatcher or webhook database writes were verified against a test double, not the real grants, and the wallet and plan rows are OPEN. See "Corrections to earlier sections" in the final section.

| Area                                         | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Webhook token: generation                    | `signBulkSmsCallback` is HMAC-SHA256 of the outbound message id under `BULKSMS_NG_WEBHOOK_SECRET`, base64url. One token per message, so a leaked URL exposes one message, not all. The secret is never placed in a URL or payload.                                                                                                                                                                                                                                                                                                                                        | VERIFIED                                                                                                             |
| Webhook token: validation                    | Constant-time comparison; a missing, wrong, truncated or other-message token gets 403 with no database read; the ref must be a UUID; the secret missing gets 503. Tested.                                                                                                                                                                                                                                                                                                                                                                                                 | VERIFIED                                                                                                             |
| Webhook token: expiry                        | None, deliberately. The provider does not state when a final status arrives and retries a failed callback up to 3 times, so an expiry window would drop legitimate late reports. A forged report also needs the provider's `message_id` and the right recipient digits, and can only move a row from `sent` to `delivered` or `failed` once. Rotating the secret invalidates tokens already issued for messages still awaiting a report; there is no dual-secret window.                                                                                                  | VERIFIED; rotation window OPEN (low)                                                                                 |
| Webhook replay                               | State compare-and-set (`status = 'sent'` only). A replay or a conflicting later report returns `applied: false` and changes nothing; the provider can legitimately send the same update more than once. Tested.                                                                                                                                                                                                                                                                                                                                                           | VERIFIED                                                                                                             |
| Callback query string                        | The provider's page shows query strings on callback URLs and requires HTTPS. The builder uses the URL API: existing parameters survive and `ref`/`sig` are always ours. Configuration rejects a non-HTTPS base, credentials, or a base that already has a query or fragment. Tested. Not yet observed against the live provider.                                                                                                                                                                                                                                          | VERIFIED in code; live test OPEN (needs credentials, separate authorization)                                         |
| Claim recovery                               | A claim that never reaches a provider id cannot be resolved automatically: there is no idempotency key, and the delivery-reports endpoint looks up by `message_id` only. **Fixed:** the scheduled dispatcher reports claims older than 15 minutes and never re-sends them. Rejected: letting an authentic callback adopt its message id onto a claimed row, which would remove the second factor (`provider_ref` equality) during exactly the window an attacker would use.                                                                                               | FIXED (visibility); adoption OPEN (owner decision)                                                                   |
| Duplicate delivery after provider acceptance | (a) Timeout or ambiguous 5xx after acceptance: terminal, never re-sent, so the row may read `failed` while the parent received it. (b) The state write after a successful send fails: row stays claimed, never re-sent, reported as stale. (c) A retry inside one minute is refused by the provider (`409`, same text to the same recipient within a minute); outside that minute only our claim protects. (d) 429/503 are treated as provably unprocessed; that is an assumption about provider behaviour. (e) Duplicate callbacks are idempotent.                       | VERIFIED; (a) and (d) accepted risks                                                                                 |
| Wallet refund                                | `comms_send` meters at queue time (`meter_usage`: term pool, wallet debit, `usage_events`). Nothing credits it back: the ledger allows `kind = 'refund'` but no function writes one and `_wallet_post` is revoked from every role. Rejection at dispatch (plan, consent, membership), a terminal provider failure and a delivery failure all keep the charge. The provider's refund treatment is not stated. A fix needs a new SECURITY DEFINER function, a term-pool reversal and a refund policy (full or partial; rejected versus delivery-failed).                    | OPEN — follow-up issue; must precede `sms_live`                                                                      |
| STOP and consent                             | Consent is enforced at queue time (`comms_send`) and again at send time (opt-out blocks unless the message is safety; marketing needs an opt-in). The database function `comms_inbound` already turns STOP, UNSUBSCRIBE, END, DAINA, DURO, KWUSI into an `opted_out` row, but only WhatsApp routing calls it. The provider documents no inbound-reply webhook, so an SMS STOP cannot reach the system. Opt-out via the other sources (web form, admin entry) works. Confirm the Nigerian regulatory position on opt-out with counsel before launch.                       | VERIFIED (consent); inbound STOP OPEN — needs an inbound number (Africa's Talking is the owner's choice for numbers) |
| Starter-plan discrepancy                     | Issue #330 and the TypeScript tier catalog say Starter and Trial do not include SMS. Migration `20261024000230` gives Starter the `sms` feature and a 500 placeholder quota, and `plan_allowances` gives Starter 6 and Trial 2 SMS per student. The dispatcher follows the issue (fail closed). Because `comms_send` has no plan check, those organizations are metered then refused (see wallet refund).                                                                                                                                                                 | OPEN — follow-up issue; needs an owner decision and a migration outside this range                                   |
| Dispatcher scheduling and execution          | **Fixed:** `/api/public/cron/sms-dispatch` (GET or POST). 503 without `CRON_SECRET`, 401 without the bearer, no provider call unless `SMS_PROVIDER` is selected and configured and the organization's `sms_live` is on. At most 20 messages and 10 organizations per run; a provider-level halt (bad credentials, 429) stops the run. Response is counts only. Requirements: `CRON_SECRET`; a scheduler (none exists in the repository); a function time limit that covers 20 sends at the provider's 15 second timeout in the worst case; a cadence of about one minute. | FIXED (trigger); schedule OPEN (needs Vercel or n8n authority)                                                       |

### Follow-up work recorded outside this PR

1. Refund on terminal failure: wallet ledger `refund` writer, term-pool reversal, refund policy.
2. Plan check at `comms_send` and reconciliation of the Starter and Trial seeds with issue #330.
3. Inbound SMS opt-out path through a dedicated inbound number into `comms_inbound`.
4. Stuck-claim reconciliation policy (owner decision on callback adoption or a manual tool).
5. Dual-secret window for webhook secret rotation.
6. Live delivery-report test against a test organization, after credentials are authorized.
7. Metering while `sms_live` is off, and the database default tier (`enterprise`) for schools inserted without a tier: owner decisions.
8. The provenance checker has no matcher for `COMMS-NN` mission ids, so COMMS artifacts cite the Copilot-authored fabric they extend.

## Consistency review addendum (COMMS-03, 2026-11-13)

A second read-only review of seven areas. One defect was fixed; the rest are recorded, not changed. Nothing here alters financial accounting or message delivery semantics.

### Trial and Starter entitlements, layer by layer

Issue #330: Growth, Professional and Enterprise include SMS; Starter and Trial do not.

| Layer                   | Source                                                                                                                                                                                                                                                                                                   | Trial              | Starter  | Growth / Professional / Enterprise                   | Agrees with #330?                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------- | ---------------------------------------------------- | ---------------------------------------------- |
| TypeScript tier catalog | `frontend/src/lib/subscription-tiers.ts`, read through `tenantTierEntitlement`; an unknown or missing tier resolves to Trial                                                                                                                                                                             | no                 | no       | yes                                                  | Yes                                            |
| Dispatcher (this PR)    | `resolveRecipient` uses the catalog; refuses and marks the row `failed`                                                                                                                                                                                                                                  | refused            | refused  | allowed                                              | Yes                                            |
| Database plan features  | `entitlement_plans` (migrations `20261022000200`, `20261024000230`): `starter` carries `sms`; `subscription_tier_plans` has no `trial` row and `sync_org_entitlements_from_tier` falls back to `starter`, so Trial organizations get the Starter plan; read by the workspace manifest (`20261025100210`) | yes (via fallback) | yes      | yes                                                  | **No**                                         |
| Database quotas         | `entitlement_plan_quotas`: Starter `sms` 500 per month, marked PLACEHOLDER by the migration                                                                                                                                                                                                              | via fallback       | 500      | 3,000 / (Professional uses the Growth plan) / 20,000 | **No**                                         |
| Database allowances     | `plan_allowances` (`20261024000260`): SMS per student and per-day cap; drives `wallet_open_term_pools` and `meter_usage`                                                                                                                                                                                 | 2, cap 1           | 6, cap 1 | 8 / 12 / 15                                          | **No**                                         |
| Database enforcement    | `comms_send` (`20261101001000`) has no plan check; its only gate is `flag_on('sms_live', org)`, which only a super admin or the service role can set                                                                                                                                                     | none               | none     | none                                                 | Plan rule is **not enforced** in the database  |
| Database default        | `schools.subscription_tier` defaults to `enterprise` (migration `20260707225659`); the onboarding code passes an explicit tier and falls back to `trial`                                                                                                                                                 | n/a                | n/a      | n/a                                                  | A school inserted without a tier is Enterprise |

Consequence: the dispatcher is the only plan gate. Keeping `sms_live` off for Trial and Starter organizations is therefore a required operating rule, and a Starter organization with the flag on would be metered by `comms_send` and then refused at dispatch. Not changed here: the seeds are the owner's placeholders, and a plan check inside `comms_send` is a migration to a core function used by every channel.

### Other areas

| Area                              | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dispatcher scheduling             | Verified. `/api/public/cron/sms-dispatch` is the only executor. The repository's scheduling precedent is an inactive n8n export plus a shared Header Auth credential; this PR adds `automation/n8n/sherivs-sms-dispatch-tick.json` the same way and a runbook, and deliberately adds no `vercel.json` (a committed cron would activate on the next production deploy). A test enforces both. Delivery by any scheduler may miss or repeat a run; the per-row claim makes a repeated or overlapping run safe.                    |
| `CRON_SECRET` handling            | Verified. Unset or blank: 503. Missing or wrong bearer: 401, constant-time comparison, no work done. The same secret protects four cron routes and the n8n credential, and there is no dual-secret window, so rotation is one coordinated step in which a tick that arrives mid-rotation is rejected and skipped. Vercel captures the secret when a deployment builds, so rotation needs a redeploy; a rollback restores the older deployment's secret. The runbook documents the steps.                                        |
| Stale claims                      | Verified. Reported by the dispatcher after 15 minutes; never re-sent; manual reconciliation procedure in the runbook (record as sent with the provider id, or close as failed; never re-queue).                                                                                                                                                                                                                                                                                                                                 |
| Duplicate delivery                | **One defect fixed.** A rejection discovered before the claim (for example a consent change) updated the row on `status = 'queued'` alone, so it could overwrite a row another worker had claimed a moment earlier, leaving a message that was sent recorded as failed. The close is now a compare-and-set that also requires the row to be unclaimed; if it loses the race the outcome is reported as skipped. Test added and checked to fail without the fix. All other duplicate paths unchanged (see the readiness review). |
| Webhook replay and authentication | Verified, unchanged. Per-message HMAC; 405 for non-POST, 503 without the secret, 403 for any bad token; the organization comes from our row; only `sent` moves to `delivered` or `failed`, once; replays return `applied: false`.                                                                                                                                                                                                                                                                                               |
| Wallet debit and refund           | Verified, not changed. Additional finding: `comms_send` meters (term pool, then wallet) in the same step that decides `queued` versus `sent_stub`, so a message is debited even when `sms_live` is off and nothing is sent. Opt-out blocked messages are not metered. Nothing credits a charge back. Whether stub sends should be charged, and what is refunded, is a policy decision recorded as follow-up work.                                                                                                               |

## Financial integrity and tenant entitlement review (COMMS-03, 2026-11-13, 07:01 directive)

A focused review of the SMS wallet lifecycle and of plan enforcement at the database. **Nothing was changed**: no financial policy, no migration, no production setting, no `sms_live`. The four COMMS-03 commits and the verified implementation are untouched. Everything below is a finding or a proposal for the owner to rule on.

**Method and limits.** Code and migrations were read in full for the paths named. Database behavior was then reproduced on a throwaway local PostgreSQL 16 server with all 168 repository migrations applied and synthetic data only (labels: **[clone]** reproduced there, **[code]** read in code, **[tests]** covered by the vitest suite). Production was not queried, so "reproduced" means "reproduced against the repository's migrations"; production could differ through out-of-band changes (the repository records some). Local server notes are in `docs/proposals/comms-03-financial-entitlement/README.md`.

### Corrections to earlier sections of this ADR

1. **"No migration is added: the fabric tables already hold everything this needs" (Recommendation) is wrong.** In a database built from the migrations, `service_role` holds `SELECT` only on `outbound_messages` and `comms_optins` (migration `20261024000270` revokes every write and re-grants read), and the dispatcher and the delivery-report route write with direct `UPDATE`s through `supabaseAdmin` [clone]. The unit tests drive a database test double that accepts those writes, so `npm run verify` stayed green while the real path would be refused with `42501`.
2. **"Verified" rows that depend on dispatcher or webhook writes** (readiness review: "Webhook replay", "Claim recovery", "Duplicate delivery after provider acceptance"; addendum: "Stale claims", "Duplicate delivery", "Webhook replay and authentication") hold at the logic level against the test double, not against the real grants. Until F1 is resolved they are not verified end to end.
3. **The wallet and plan rows were recorded but understated.** The readiness review's "Wallet refund" row and the addendum's "Wallet debit and refund" row already named the missing refund and the charge on simulated sends (F2, F3, F8); the addendum labelled the wallet row "Verified, not changed" and treated the plan gap as a seed question. This review adds the reproduced charge-without-submission cases (section 1.2), the database plan gap as a defect (F4) and two defects independent of SMS (F5, F6). Read those rows as **OPEN**.

### 1. Current behavior

#### 1.1 Transaction flow

Charge happens at **approval**, inside one transaction run by the approving human's session, before anyone knows whether the message will be sent.

```text
STAFF (authenticated)           DATABASE                                         SERVICE ROLE (dispatcher)        PROVIDER
comms_propose_send -----------> comms_send_proposals: pending_approval
 (comms.send_class|broadcast)   [no charge, no outbound row]
comms_approve_send (a different human, comms.broadcast) - ONE transaction, per recipient:
   comms_send
     plan check ................ NONE in the database today (TypeScript catalog only, later, at dispatch)
     opted out / opt-in missing -> row blocked_optout ................................ [not charged]
     else, in a subtransaction:
       meter_usage: term pool first, then wallet; per-student cap when a student is given
         cap or wallet short ---> exception, subtransaction rolled back
                                  -> row blocked_cap / blocked_wallet ............... [not charged]
         ok ---------------------> usage_events + term pool used + wallet_ledger 'usage'
                                                                        <= THE CHARGE IS TAKEN HERE
       flag_on('sms_live') is evaluated AFTER the charge:
         off -> row sent_stub, provider 'stub' ..................... [CHARGED, never submitted]
         on  -> row queued, provider 'bulksmsnigeria' ............... [CHARGED, waiting]
                                                |
                          /api/public/cron/sms-dispatch  <-- needs a scheduler; none exists in the repository
                                                |
                                   dispatchQueuedSms: sms_live? provider selected?
                                   re-resolve recipient, plan (TypeScript catalog), consent
                                   claim: provider_ref NULL -> claim:<uuid>  <-- DB DENIES THIS WRITE TODAY (F1)
                                                |
                    +---------------------------+------------------------------+------------------------+
              rejected before claim     provider rejects / errors      claimed, worker crashes     accepted (message_id)
              status failed             failed (or claim released)     stale claim, reported       status sent  ---------> BulkSMS
              [CHARGED, no refund]      [CHARGED, no refund]           [CHARGED, no refund]        [CHARGED]
                                                                                                          |
                                                                  webhook (per-message HMAC): sent -> delivered | failed
                                                                  [CHARGED either way; no refund path anywhere]
```

`wallet_ledger` allows `kind = 'refund'` but no function writes one, and `_wallet_post` is revoked from every role [code, clone]. The proposal path always passes `NULL` as the student, so the per-student daily cap never applies to approved proposals [code].

#### 1.2 Every way an organization is charged without a provider submission

| #   | Situation                                                                                                                      | Charged | Refunded | Basis         |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------- | -------- | ------------- |
| C1  | `sms_live` off for the organization (the default): row `sent_stub`, nothing is ever sent                                       | yes     | no       | [clone]       |
| C2  | `sms_live` on but nothing drains the queue (no scheduler exists in the repository, `CRON_SECRET` unset, cron paused)           | yes     | no       | [code]        |
| C3  | `sms_live` turned off, or `SMS_PROVIDER` unset or unconfigured, after approval: rows stay `queued`                             | yes     | no       | [code, tests] |
| C4  | Trial or Starter organization with `sms_live` on: queued and charged at approval, refused at dispatch, closed `failed`         | yes     | no       | [clone, code] |
| C5  | Consent, membership or phone changed between approval and dispatch: rejected before the claim, closed `failed`                 | yes     | no       | [code, tests] |
| C6  | Provider explicitly refuses (HTTP 4xx, `409` duplicate, bad payload): closed `failed`, provider never accepted                 | yes     | no       | [code, tests] |
| C7  | Ambiguous provider outcome (timeout, HTTP 5xx, unreadable response): closed `failed`; the SMS may or may not have been sent    | yes     | no       | [code, tests] |
| C8  | Worker dies between the claim and the state write: stale claim, never re-sent, outcome unknown                                 | yes     | no       | [code, tests] |
| C9  | Provider accepted, later reports delivery failure (webhook): a submission did happen; provider refund policy unknown           | yes     | no       | [code]        |
| C10 | A parent or student calls `meter_usage` directly: wallet debited, or overdrawn with `p_priority = 'safety'`, no message at all | yes     | no       | [clone]       |

Not charged, verified: opt-out (`blocked_optout`), wallet short or cap hit (`blocked_wallet`, `blocked_cap`; the subtransaction rolls back the usage event, the pool and the ledger row) [clone], a replay of the same reference (no second debit) [clone], and an approval that fails midway (one transaction, nothing persists) [code].

#### 1.3 Plan entitlement as it stands

The layer table in the consistency review still holds. Added from this review: the only enforcement of "Starter and Trial do not include SMS" is the dispatcher's TypeScript check, which reads `schools.subscription_tier`, a column the school's own admin can write (F6) [clone].

### 2. Confirmed defects

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Severity                                        | Basis         | Owner mission |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------- | ------------- |
| F1  | **The dispatcher and the webhook cannot write.** `service_role` has `SELECT` only on `outbound_messages`; the claim `UPDATE` is refused (`permission denied`), the same statement works for the owner role. The only service-role writer is `comms_delivery_receipt`, which allows only `sent` / `delivered` / `failed`, overwrites `provider_ref`, ignores `error` and has no compare-and-set.                                                                                                                                                                      | **Blocker** for COMMS-03; nothing can ever send | [clone]       | COMMS-03      |
| F2  | **Simulated sends are charged.** `comms_send` meters before it reads `sms_live`; with the flag off the row is `sent_stub`, `provider = 'stub'`, `cost = 10` and the wallet is debited NGN 10. It applies to every metered channel, not only SMS.                                                                                                                                                                                                                                                                                                                     | High: silent real charge                        | [clone]       | COMMS-03      |
| F3  | **No refund exists.** Every outcome in C2 to C9 keeps the charge; marking a message `failed` through the real service-role function left the wallet unchanged and wrote no refund row. Pool allowance is not returned either.                                                                                                                                                                                                                                                                                                                                        | High                                            | [clone, code] | COMMS-03      |
| F4  | **The plan is not enforced in the database.** `comms_propose_send`, `comms_approve_send` and `comms_send` have no plan check; a Trial organization with the flag on was queued and charged.                                                                                                                                                                                                                                                                                                                                                                          | High                                            | [clone]       | COMMS-03      |
| F5  | **Any parent or student can debit or overdraw the school wallet.** `authenticated` holds `EXECUTE` on `meter_usage`; it admits `comms.send_class` **or** `ai_tutor.use`, which the legacy bridge in `scholar_can` gives every parent and student; and the caller picks `p_priority`, where `'safety'` permits a negative balance. A parent debited NGN 50, then NGN 10,000 on a funded NGN 940 wallet, leaving -9,060, with no outbound row. Cross-organization calls are refused (tenant isolation holds).                                                          | **Critical, pre-existing**, independent of SMS  | [clone]       | **FIN-01**    |
| F6  | **A school admin can change its own plan.** Policy "School admin updates own school" has no column limit and `authenticated` holds table `UPDATE`; `UPDATE schools SET subscription_tier = 'enterprise'` succeeded and the trigger rewrote `org_entitlements` to the Enterprise plan. The sanctioned routes are `request_plan_change` (a request, effective next term) and `updateSchoolPlan` (super admin). The same tier column feeds the dispatcher check, the COMMS-02 plan gates and `plan_allowances`. Another organization's tier cannot be changed (0 rows). | **Critical, pre-existing**                      | [clone]       | **ENT-01**    |
| F7  | **Defaults and catalogs disagree with issue #330.** A school inserted without a tier is `enterprise` (default set by migration `20260707225659`), which is what the founder RPC `create_organization_with_founder` does; `trial` has no row in `subscription_tier_plans`, so Trial maps to the Starter plan, which carries `sms` and a 500 placeholder quota; `plan_allowances` gives Trial 2 and Starter 6 SMS per student.                                                                                                                                         | High                                            | [clone]       | ENT-01        |
| F8  | **The charge precedes dispatch with no guarantee of dispatch** (C2, C3): money is taken at approval for messages that may sit `queued` indefinitely, and nothing cancels or refunds them.                                                                                                                                                                                                                                                                                                                                                                            | Medium                                          | [code]        | COMMS-03      |
| F9  | **The per-student daily cap is consumed by simulated sends** (a Starter student's second same-day message was `blocked_cap` after a `sent_stub`). Unreachable through the proposal path today.                                                                                                                                                                                                                                                                                                                                                                       | Low                                             | [clone]       | later         |
| F10 | **The legacy `BulkSmsNigeriaAdapter`** (`scholar/comms/adapters.server.ts`) still contains a live `fetch` to the provider. No caller was found (only documentation strings in `provider-credentials.ts` name it).                                                                                                                                                                                                                                                                                                                                                    | Low                                             | [code]        | later         |

#### Production-safety checks you asked for

| Check                                                               | Result                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sms_live = false` cannot trigger a provider call                   | **Holds.** `dispatchQueuedSms` reads `flag_on('sms_live', org)` first and returns `skipped` before it selects a gateway; `flag_set` is super admin or service role only; the 52 SMS tests pass (re-run 07:09). No other live provider path was found (F10 is unreachable).                                                   |
| Disabled or simulated messaging cannot silently create real charges | **Does not hold.** F2: reproduced.                                                                                                                                                                                                                                                                                           |
| Tenant isolation intact                                             | **Holds** for what was exercised [clone]: cross-organization `meter_usage` refused, cross-organization tier update changed 0 rows, cross-organization wallet and ledger reads returned 0 rows. Every dispatcher query and update is scoped by `org_id`; the webhook resolves the organization from Sherivs's own row [code]. |
| Dispatcher cannot bypass entitlement or consent                     | **Consent holds**: opt-out and marketing opt-in are re-checked at dispatch [code, tests]. **Entitlement does not fully hold**: the dispatcher's plan check reads a tenant-writable column (F6), and nothing in the database checks the plan (F4).                                                                            |
| No secrets in logs                                                  | **Holds.** The SMS files contain no logging calls; the `error` column receives only a closed set of codes (`provider_*`, `invalid_payload`) or fixed reason strings, never a provider response body; the routes return counts only; the callback token and credentials never appear in a URL stored or returned.             |

### 3. Proposed corrections

#### 3.1 Financial policy (for the owner to rule on; not implemented)

1. **A charge stands only for a message the provider accepted, or one that is queued and still deliverable.** A simulated send is never charged and records no usage.
2. **Keep charging at approval as a reservation** (it keeps the fail-closed wallet behavior and the `blocked_wallet` experience), but return it in the same transaction as any terminal outcome in which the provider provably did not accept the message.
3. **Automatic refund only for provable non-acceptance:** rejected before the claim (consent, membership, phone, plan), provider `4xx` refusal, provider duplicate (`409`), and an operator-cancelled message that was never sent. The refund is a `wallet_ledger` row `kind = 'refund'` keyed `refund:msg:<reference>` for the amount actually charged, plus the pool allowance the message consumed.
4. **No automatic refund for ambiguous outcomes** (timeout, `5xx`, unreadable response, stale claim). The message may have been delivered; refunding it would give the service away. An operator refunds after confirming non-delivery with the provider; the operator action is one audited function call.
5. **No refund for delivery failure reported after acceptance** until the provider's refund policy is known (existing UNKNOWN).
6. **Everything idempotent and append-only**, as the ledger already is: one reversal row per message reference.
7. **Reconciliation invariants** (a read-only report, separate mission): no `sent_stub` row has a usage event; no `failed` row with an eligible error has an unreversed usage event; wallet balance equals topups plus adjustments plus refunds minus usage.
8. **Charge nothing the plan does not include:** the plan gate runs before metering, so Trial and Starter organizations are never charged for SMS.
9. **Metering is not a client API.** Only the platform (service role, and `comms_send` running as the function owner) meters; a client can never choose a priority or a quantity.

#### 3.2 Entitlement policy

1. **One decision, two readers.** The database function `sms_plan_entitled` mirrors the TypeScript tier catalog (Growth, Professional, Enterprise); a parity test fails if they drift. It follows the COMMS-02 precedent (`voice_agent_plan_entitled` also reads `schools.subscription_tier`). A longer-term single source (a plan-feature table read by both) is a separate mission.
2. **Tenants cannot write commercial columns** (`subscription_tier`, `subscription_status`, `subscription_expires_at`, `monthly_fee`); the service role and a super admin can. The tenant route stays `request_plan_change`.
3. **Safe provisioning default:** a school created without a tier is Trial, not Enterprise. This is a business decision about the default and about whether existing Enterprise defaults were intentional grandfathering; the migration that set it says so for "any newly created school going forward".
4. **Starter and Trial seeds:** reconcile `entitlement_plans`, `entitlement_plan_quotas` and `plan_allowances` with the owner's ruling on issue #330 (data change, not a schema change).

#### 3.3 Database changes (tested on the throwaway server; see `docs/proposals/comms-03-financial-entitlement/`)

| Part | Change                                                                                                                          | Findings | Tests (`tests.sql.txt`) |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------- |
| 01   | `usage_event_reversals`, `_comms_refund_charge`, operator `comms_refund_unsubmitted`                                            | F3, F8   | B2a-B2h                 |
| 02   | `comms_sms_claim`, `comms_sms_settle` (compare-and-set, atomic optional refund), `comms_sms_report_delivery`; service role only | F1       | F1a-F1d                 |
| 03   | `comms_send`: **[B1]** meter only when live; **[D4]** plan gate, new status `blocked_plan`; `sms_plan_entitled`                 | F2, F4   | B1, D4a, D4b, A1        |
| 04   | `REVOKE EXECUTE ON meter_usage FROM authenticated`                                                                              | F5       | C1                      |
| 05   | trigger blocking tenant writes to the four commercial columns                                                                   | F6       | C2a-C3                  |

Alternative for F1, recorded and not recommended: `GRANT UPDATE (status, provider, provider_ref, error, updated_at) ON outbound_messages TO service_role`. It needs no application change, but it reverses the scope-lock decision of migration `20261101001000` that every outbound write go through a definer function, and it widens the power of every server function that uses `supabaseAdmin`.

### 4. Database migration impact

| Object                                       | Change                                      | Data impact                                                           | Application impact                                                                                            |
| -------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `usage_event_reversals`                      | new table, forced RLS, append-only          | none (empty)                                                          | none                                                                                                          |
| 5 new `SECURITY DEFINER` functions, 1 helper | new, `search_path` fixed, service role only | none                                                                  | dispatcher and webhook must call them (part 02)                                                               |
| `comms_send`                                 | replaced (core function, all channels)      | none; behavior changes for simulated sends (F2) and Trial/Starter SMS | screens and types must learn `blocked_plan`; [B1] also stops charging simulated WhatsApp unless scoped to SMS |
| `outbound_messages_status_check`             | dropped and re-added with one more status   | rows are scanned once (use `NOT VALID` then `VALIDATE` when promoted) | status types                                                                                                  |
| `meter_usage`                                | `EXECUTE` revoked from `authenticated`      | none                                                                  | `tools/sim-lab/sim/scenarios.mjs` calls it as the admin and must use `asOwner`; no application caller exists  |
| `schools` trigger                            | new `BEFORE UPDATE`                         | none                                                                  | any authenticated-context function that updates those columns would now fail; none exists in the repository   |

CI: `migrations-sim` must pass on PostgreSQL 17 (the local run was 16); the repository security audit reported no RLS gap and no definer function without a fixed `search_path` after parts 01 to 05.

### 5. Acceptance criteria

Each criterion is checked by the named test in `tests.sql.txt` unless marked otherwise. All pass on the throwaway server after parts 01 to 05 (21 of 21; 5 of 21 before).

1. **AC1** A simulated SMS is not charged, records no usage and leaves the wallet unchanged (B1).
2. **AC2** A Trial or Starter organization with `sms_live` on is blocked by plan, not queued and not charged (D4a); the function agrees with the TypeScript catalog on all five tiers (D4b; a repository parity test is required before promotion).
3. **AC3** Exactly one worker wins a claim; a settle succeeds only for the claim held; a delivery report moves `sent` to `delivered` once; the service role still cannot `UPDATE` the table directly (F1a-F1d).
4. **AC4** A provider-rejected message and a rejection before submission are refunded in the same transaction as the close; a second refund is a no-op; an ambiguous failure is not refunded; an operator can refund after reconciliation; an accepted message can never be refunded; net charge equals the accepted messages only (B2a-B2g).
5. **AC5** A pool-funded refund restores the pool and not the wallet (B2h).
6. **AC6** The approval path still works end to end for an entitled organization and debits once (A1).
7. **AC7** A parent cannot call `meter_usage` (C1); a school admin cannot change its own plan but can still edit non-commercial fields (C2a, C2b); the service role and a super admin still can (C3).
8. **AC8** `npm run verify`, CI `migrations-sim` on PostgreSQL 17, the security audit, a TypeScript test that the dispatcher and webhook use the new functions, and a status-type test for `blocked_plan`: **not yet run**; they belong to implementation after approval.

### 6. Risks and rollback

| Risk                                                                                                                              | Mitigation                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Policy ruling changes what organizations see (simulated sends become free; Trial and Starter SMS is refused at approval)          | Owner decision first; communicate before enabling; part 03 is two marked blocks that can be approved separately                                                    |
| Misclassifying an ambiguous failure as a refund gives a delivered message away (about NGN 10 a page)                              | The refund argument comes from a closed list set only for provable outcomes; ambiguous outcomes never carry it; tested (B2c)                                       |
| Part 03 replaces a core function used by every channel                                                                            | The replacement is the live definition with two marked edits; the approval path is regression-tested (A1); rollback restores the original byte for byte (verified) |
| The status CHECK change locks a table scan                                                                                        | `NOT VALID` then `VALIDATE` on promotion                                                                                                                           |
| Revoking `meter_usage` or guarding the tier trigger breaks a caller outside the repository (mobile, n8n, an out-of-band function) | Repository search found none; one read-only production catalog check is requested below before promotion                                                           |
| Parts 04 and 05 may already have been exercised in production                                                                     | Read-only detection queries below, on approval                                                                                                                     |
| Refunds are not yet in the audit chain                                                                                            | Add `usage_event_reversals` and the new functions to the audit trigger loop before promotion (open)                                                                |

**Rollback strategy.** `rollback.sql.txt` reverses in the reverse order and was tested with data present. Application first (the dispatcher must stop calling `comms_sms_*`), then the database. Data written while the proposal was live is never deleted: refund ledger rows and `usage_event_reversals` stay (they record money already returned), and `blocked_plan` rows are converted to `failed` / `blocked_plan` so the original CHECK can return. After rollback the original defects return; rolling back part 04 or 05 reopens F5 and F6.

**Read-only detection queries (run only with your approval, production not touched):** wallets with a negative balance; `wallet_ledger` rows of `kind = 'usage'` whose reference does not begin `msg:` (a direct `meter_usage` call leaves a caller-chosen reference; `comms_send` always uses `msg:`); and `schools` tier changes in the audit records whose actor is not a super admin or the service role.

### 7. What belongs to COMMS-03, and what does not

| Item                                                                                | Mission                           | Blocks `sms_live`?                            | Why                                                                                                     |
| ----------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| F1 database write path (part 02) and the dispatcher and webhook change that uses it | **COMMS-03**                      | **Yes, and blocks the PR from being correct** | The delivered feature cannot send or record without it                                                  |
| F2 stop charging simulated sends (part 03, B1)                                      | **COMMS-03**                      | Yes                                           | COMMS-03 is the change that makes `sms_live` meaningful; first needs your policy ruling                 |
| F3 and F8 refund and cancel (part 01, and settle's refund argument)                 | **COMMS-03**                      | Yes                                           | Already listed as "must precede `sms_live`"                                                             |
| F4 plan gate at `comms_send` (part 03, D4)                                          | **COMMS-03** (the SMS channel)    | Yes                                           | Closes charged-then-refused (C4); needs your ruling on Starter and Trial                                |
| F5 `meter_usage` lockdown (part 04)                                                 | **FIN-01, separate and urgent**   | No, but do not wait                           | Independent of SMS and exploitable today by any parent or student, if production matches the migrations |
| F6 tenant plan self-upgrade (part 05)                                               | **ENT-01, separate and urgent**   | No, but do not wait                           | Independent of SMS; also defeats the COMMS-02 voice-agent plan gate                                     |
| F7 default tier, Trial mapping, Starter seeds                                       | ENT-01                            | No                                            | Business decisions plus data changes across several features                                            |
| F9, F10, reconciliation report, audit-chain coverage of refunds, plan-feature table | later missions (FIN-02, COMMS-05) | No                                            | Hardening that does not gate the first live test                                                        |

### Awaiting your approval

1. **Financial policy** (section 3.1): simulated sends free (all metered channels or SMS only); the refund eligibility list; ambiguous outcomes held for an operator; delivery-failed not refunded.
2. **Starter and Trial SMS** (issue #330 says no) and the default tier for new organizations (Trial or keep Enterprise).
3. **Part 02 and the matching dispatcher and webhook change into COMMS-03** as a sixth commit with tests, after which the readiness review rows can be re-verified.
4. **FIN-01 and ENT-01 as separate, prioritized missions**, and whether you want them ahead of COMMS-03 publication.
5. **One read-only production catalog check** (grants on `outbound_messages` and `meter_usage`, the policies and triggers on `schools`) and the detection queries above, so that F1, F5 and F6 are confirmed or refuted against production rather than the repository.

Nothing in this section has been applied, merged or deployed; GitHub publication remains pending on repository write access.
