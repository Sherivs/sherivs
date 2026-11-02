# Sherivs WhatsApp end-to-end runbook

This runbook uses the existing `/api/public/webhooks/whatsapp` route, the
`cg_org_communication_sender` registry, and
`frontend/src/lib/communications/whatsapp-cloud.server.ts`. Do not create a
second gateway, route, or sender registry. Tenant and organization scope come
only from the active sender mapping, never from webhook payload fields.

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

Use the Meta system-user permanent access token for the production sender.
Grant that system user the minimum required access to the WABA and phone number.
Keep development, preview, and production values separated.

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

## Reviewed onboarding and health

An organization administrator may request a link only for an existing active
organization member and must provide consent evidence. The authenticated
request action checks tenant administration and membership in the database.
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

