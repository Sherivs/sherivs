# Sherivs WhatsApp end-to-end runbook

Authority: AGENTS.md §§12, 17, 26, 31; this runbook documents the existing
WhatsApp integration contracts.
Creator: copilot-swe-agent[bot]
Created: 2026-11-02

## Verification

Focused WhatsApp tests passed; the migration and rollback were exercised on
PostgreSQL 17.2.

This runbook uses the existing `/api/public/webhooks/whatsapp` route, the
`cg_org_communication_sender` registry, and
`frontend/src/lib/communications/whatsapp-cloud.server.ts`. Do not create a
second Meta callback, send gateway, or sender registry. The authenticated n8n
reply endpoint and the Cron outbox worker are internal routes, not Meta
callbacks or alternate send paths. Tenant and organization scope come only
from the active sender mapping, never from webhook payload fields.

## Vercel environment variable names

Set server-side values in the intended Vercel environment. Do not put values in
this runbook, commits, tickets, or logs. Never use a `VITE_`, `NEXT_PUBLIC_`, or
`PUBLIC_` prefix for these variables.

- `WHATSAPP_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_GRAPH_VERSION` (optional; defaults to `v21.0`)
- `WHATSAPP_AUTO_ACK_TEXT` (short reply; an empty value disables auto-ack)
- `N8N_WHATSAPP_WEBHOOK_URL` (HTTPS n8n webhook URL)
- `N8N_WHATSAPP_ALLOWED_HOSTS` (comma-separated exact hostnames, e.g. `automate.sherivs.com`; no wildcards)
- `N8N_WHATSAPP_SIGNING_SECRET` (random server-side HMAC key; minimum 32 characters)
- `CRON_SECRET` (bearer secret for the protected outbox dispatcher)

Use the Meta system-user permanent access token for the production sender.
Grant that system user the minimum required access to the WABA and phone number.
Keep development, preview, and production values separated.
The n8n dispatcher fails closed unless the URL is HTTPS and its hostname exactly
matches an entry in `N8N_WHATSAPP_ALLOWED_HOSTS`; it rejects wildcard entries,
lookalike hosts, URL credentials, and nonstandard ports. In n8n, use a Schedule
Trigger node set to every minute, followed by an HTTP Request node that calls
`https://www.sherivs.com/api/public/cron/whatsapp-n8n-forward` using `GET`.
Use the standard bearer authorization scheme and source its credential from
`CRON_SECRET`. This protected endpoint claims
durable outbox rows and uses bounded retries and dead-letter storage. Vercel
Hobby cron is not used.

## n8n import and activation order

The workflow exports in `automation/n8n/` are inactive. The inbound export uses
`sherivs-wa-inbound-placeholder` as a placeholder path; select the approved n8n
path before import/activation, then set the Vercel webhook URL to the resulting
production URL (`/webhook/…`, not the test URL). Keep the exact host in the
allowed-host list.

1. Set the Vercel `N8N_WHATSAPP_SIGNING_SECRET`, `N8N_WHATSAPP_WEBHOOK_URL`,
   `N8N_WHATSAPP_ALLOWED_HOSTS`, and `CRON_SECRET` values, then redeploy.
2. Import both workflow exports into n8n and leave them inactive.
3. Create the Header Auth credential named `Sherivs CRON Authorization` with
   header name `Authorization` and a bearer value sourced from `CRON_SECRET`,
   stored only in the credential. Configure the n8n process environment
   `N8N_WHATSAPP_SIGNING_SECRET` with the same signing secret as Vercel.
4. Manually run the forward tick and expect HTTP 200 with `delivered: 0` when the
   outbox is empty. Send a correctly signed test POST to n8n's test URL: a valid
   request is accepted, while a stale timestamp or bad signature is rejected
   with HTTP 401.
5. Run `sv1-create-root-tenant` first with `dry_run: true`, then with
   `dry_run: false`.
6. Run `sv1-wa-create-root-org` first with `dry_run: true`, then with
   `dry_run: false`, passing it the tenant ID printed by the root-tenant
   workflow.
7. Run `sv1-wa-map-sender` first with `dry_run: true`, then with
   `dry_run: false`.
8. Activate the inbound handler, then activate the forward tick.
9. Perform the real-message test below with an authorized, consenting test
   sender.
10. To roll back, deactivate both n8n workflows. The durable outbox continues
    buffering inbound events for later delivery.

The inbound workflow requires the n8n process settings
`NODE_FUNCTION_ALLOW_BUILTIN=crypto` and `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`
for its Code nodes to use HMAC and read `N8N_WHATSAPP_SIGNING_SECRET`. This
enables Code-node access to the crypto module and process environment; keep the
n8n instance trusted and restrict workflow editing because those nodes can read
configured environment values. No secrets are stored in the exports.

## Migration and code deployment order

These additive migrations retain the existing four-argument receive RPC and
five-argument send RPC as service-role-only compatibility wrappers. The wrappers
delegate to the new tenant-bound functions; the legacy send wrapper additionally
requires a recent stored inbound message. Apply migrations
`20261103000100_sherivs_whatsapp_e2e_durable.sql` and then
`20261103000200_sherivs_whatsapp_tenant_binding_n8n.sql` before deploying/merging
the code that calls their expanded signatures. This ordering keeps the currently
deployed webhook RPC calls working throughout deployment. Keep both wrappers
until a separate reviewed cleanup migration is approved.

## Meta webhook configuration

In the Meta app dashboard:

1. Use callback URL `https://www.sherivs.com/api/public/webhooks/whatsapp`.
2. Set the verify-token field to the value configured as `WHATSAPP_VERIFY_TOKEN`.
3. Subscribe the app to the `messages` webhook field and subscribe the WABA to
   the app.
4. Confirm the app is in **Live** mode and that the system user has access to
   the intended WABA and phone number.
5. Configure and approve the utility template needed for any business-initiated
   messages outside the customer-service window. Automatic acknowledgements use
   free-form text only inside the 24-hour window.

The webhook validates `X-Hub-Signature-256` against the raw request body before
processing it. The GET verification handshake uses the configured verify token.
Only sender-registry-resolved, stored inbound events enter the n8n outbox. The
event includes tenant and organization IDs, the conversation/message IDs, body,
timestamp, and a recipient hash; it excludes the plaintext phone number and Meta
credentials. The outbox lease and claim token make concurrent dispatch safe.
Delivery failures use capped exponential backoff and move to a tenant-scoped
dead-letter table after eight attempts.

The app signs the exact UTF-8 JSON bytes using the timestamp-prefixed form
`HMAC-SHA256(secret, timestamp + "." + raw_body)`. n8n must reject stale or
future timestamps outside five minutes before processing:

```python
import hashlib
import hmac
import os
import time

def verify_sherivs(raw_body: bytes, timestamp: str, signature: str) -> bool:
    if not timestamp.isdigit() or abs(int(time.time()) - int(timestamp)) > 300:
        return False
    expected = "sha256=" + hmac.new(
        os.environ["N8N_WHATSAPP_SIGNING_SECRET"].encode(),
        timestamp.encode() + b"." + raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
```

For an automated reply, n8n POSTs a signed JSON body to
`https://www.sherivs.com/api/public/webhooks/whatsapp-reply` with `reply_id`,
`inbound_provider_ref`, `conversation_id`, and `body`, plus
`X-Sherivs-Timestamp` and `X-Sherivs-Signature`. The reply signature uses the
same five-minute timestamp format. Do not send tenant IDs, a phone number, a
Meta token, or call Graph from n8n. Sherivs resolves tenant, sender, active
membership, opt-in, conversation, and recipient again; replies outside the
24-hour window or after opt-out are rejected.
Retry transient failures with the same `reply_id` and identical body. A failed
claim is released immediately; an abandoned claim is retryable after its
five-minute lease. Reusing an ID with changed content is rejected.

## Reviewed onboarding and health

An organization administrator may request a link only for an existing active
organization member and must provide consent evidence. The authenticated
request action checks tenant administration and membership in the database.
Numbers are normalized before linking: `+234…`, `234…`, and Nigerian local
`0…` form (for example `09015056201`) are stored and compared as canonical
`+234…` E.164 values. Meta sends the same number without the leading `+`.
An authorized Internal Console reviewer approves or rejects the request; the
requester cannot approve their own request. Approval creates the recipient link
and opted-in record. It does not create an account or provision a principal.

The Internal Console WhatsApp page reports only configured/not-configured
booleans, mapped sender count, last inbound/status timestamps, and unmapped
sender count. It never displays credential values.

## Real-message test

Perform this only after reviewed deployment and sender setup, with an authorized
operator and a consenting test sender. Do not enable a sender mapping or run
production workflows as part of a code review.

1. Confirm the intended root organization and WhatsApp sender mapping are active
   using the gated workflows. Keep their `dry_run` input enabled for rehearsals;
   disabling it requires the Production environment review and explicit typed
   confirmation.
2. In the Internal Console, verify the expected configured flags and mapped
   sender count. Submit a recipient-link request for an existing test principal
   with documented consent; have a different authorized reviewer approve it.
3. From that opted-in number, send a short text to the Sherivs WhatsApp number.
   Confirm the inbound message is stored under the registry-resolved tenant and
   organization, and that exactly one configured acknowledgement arrives.
4. Send a second distinct message and confirm it is stored and acknowledged.
   Resend the same provider event only through an approved test harness; confirm
   it does not create another inbound message or acknowledgement.
5. Send `STOP`. Confirm the inbound STOP is stored, opt-in changes to opted out,
   and no automatic acknowledgement is sent. Verify that outbound delivery is
   denied until consent is explicitly restored with `START` or a newly reviewed
   link request.
6. If practical, send a non-text message. Confirm a typed placeholder is stored
   and no media is downloaded. Check delivery-status callbacks update the shared
   ledger and the health report timestamps.
7. Check the health report for unmapped senders or dead-letter events. Investigate
   failures using sanitized error codes only; never export tokens, webhook
   signatures, full payloads, or unnecessary phone/message content into logs.
