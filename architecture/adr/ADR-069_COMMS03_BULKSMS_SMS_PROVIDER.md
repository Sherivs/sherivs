# ADR-069: SMS Goes Through One Provider Port, Starting With BulkSMS Nigeria

|| Field | Value |
||---|---|
|| Status | PROPOSED (operator review before `SMS_PROVIDER` is set, any provider credential is stored, or `sms_live` is turned on for any organization) |
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

**Use Option 3.** SMS is dispatched only from approved, queued fabric rows. The recipient is never taken from a caller, the client or a model. Missing or invalid credentials fail closed and leave rows queued. A send is at-most-once: it is retried only when the provider provably did not process it (HTTP 429 or 503, or a connection that never left Sherivs); every ambiguous outcome is terminal. The provider is selected by `SMS_PROVIDER=bulksmsnigeria` and configured by `BULKSMS_NG_TOKEN`, `BULKSMS_NG_SENDER`, and optionally `BULKSMS_NG_WEBHOOK_URL` plus `BULKSMS_NG_WEBHOOK_SECRET` for delivery reports. No value is stored in code, logs, results or URLs. `sms_live` stays off and no migration is added: the fabric tables already hold everything this needs. Plan gating reads the tier catalog through `tenantTierEntitlement` (Growth, Professional and Enterprise include SMS; Starter and Trial do not); the deprecated `hasTierFeature` always returns true and is not used.

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual risk:** (1) A worker that crashes between the claim and the state write leaves a row claimed and invisible to the dispatcher. It is never re-sent; an operator must reconcile it against the provider's delivery-reports endpoint, which is not built here. (2) The callback URL carries a per-message token and can appear in request logs. (3) The provider account is shared by all tenants, so its request limit is shared; a `429` halts the run and leaves rows queued. (4) Non-ASCII messages are sent as Unicode and may cost more provider pages than the 160-character metering assumes. (5) The provider offers no inbound-reply webhook, so SMS STOP replies cannot be received on this provider. (6) A message rejected or failed after metering is not refunded to the wallet.
- **The sharpest instance:** A crashed worker leaves a parent's message claimed and unsent with no automatic alarm.
- **The accepted rationale:** Double-texting a parent costs money and trust and cannot be undone; a stuck row is visible and recoverable.
- **Owner of the residual risk:** The communications owner, before `sms_live` is enabled for a tenant. Needed first: a reconciliation job over claimed rows, wallet refund on terminal failure, and an opt-out channel.

## Consequences (summary)

- **Positive:** The fabric can now send and track SMS without a second recipient path. Consent, plan and tenant membership are enforced at send time as well as queue time. Every change is audited by the existing trigger; a test fails if that trigger is dropped.
- **Negative / obligations:** Nothing calls `dispatchQueuedSms` yet; a cron or worker route is a follow-up, as for COMMS-04. The Resend webhook module in draft PR #333 defines a similar database interface; they can share one after that merges. A finding for the owner: the seed in migration `20261024000230` gives the Starter plan the `sms` feature and a 500-message quota, which disagrees with the rule that Starter does not include SMS. The dispatcher follows the tier catalog; the seed is marked as placeholder and is not changed here.
- **For the wave/program specifically:** V1 communications only. No V2 device or V3 reality work. No migration range is consumed.

## Golden Questions

- **WHO?** The communications owner rules on the provider choice and on enabling `sms_live`. The dispatcher acts as a system worker for one organization at a time. The provider's callback acts only through a verified per-message token.
- **WHAT?** One SMS provider port with BulkSMS Nigeria as its first adapter, a dispatcher for approved queued rows, and an authenticated delivery-report route.
- **WHERE?** `sms-gateway-contract.ts`, `sms-gateway.server.ts`, `bulksms-nigeria.server.ts`, `sms-fabric.server.ts`, `routes/api/public/webhooks/bulksms.ts`, and the two test files under `tests/unit/communications/`.
- **WHY?** Issue #330 requires SMS inside the fabric, behind env selection, with fail-closed credentials, verified delivery reports, consent, metering and audit.
- **UNDER WHICH POLICY?** AGENTS.md §§13, 16, 17, 19, 24–31 and 45; forced RLS stays untouched; `sms_live` default-off; ADR-067 and ADR-068 for the sibling communications missions.

## UNKNOWNs

- **Which BulkSMS did the owner mean?** BulkSMS Nigeria is implemented because the database already names it. Confirm or redirect.
- **Production request limit.** The vendor documents only the sandbox limit.
- **Callback behaviour for `callback_url` query strings.** The provider's guidance implies the query is preserved; it must be confirmed in a live test before delivery reports are relied on.
