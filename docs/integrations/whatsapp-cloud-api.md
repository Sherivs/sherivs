# WhatsApp Cloud API (V1 organizational messaging)

The existing communications system owns templates, tenant scope, consent, queued
outbound messages, inbound replies, and delivery status. Meta is a provider
adapter; webhook tenant resolution comes from the registered WhatsApp sender
number, never from webhook payload fields.

## Server environment

Configure these only in the server runtime. Never expose them through a
`VITE_`, `NEXT_PUBLIC_`, or `PUBLIC_` variable:

| Variable | Purpose |
| --- | --- |
| `WHATSAPP_TOKEN` | Meta system-user access token used by the Cloud API sender. |
| `WHATSAPP_PHONE_NUMBER_ID` | Cloud API phone number ID used for sends. |
| `WHATSAPP_APP_SECRET` | Meta app secret used to validate `X-Hub-Signature-256`. |
| `WHATSAPP_VERIFY_TOKEN` | Random webhook subscription token; configure the same value in Meta. |

No credential is stored in the repository or database. The sample entries in
`.env.example` are blank.

## Meta webhook

Set the callback URL to:

```text
https://<deployed-app-host>/api/public/webhooks/whatsapp
```

Replace `<deployed-app-host>` with the deployed application host, then use the
same random value as `WHATSAPP_VERIFY_TOKEN` in Meta's verification-token field.
Subscribe the app to the `messages` webhook field. The `GET` handshake echoes
the challenge only after a constant-time verify-token comparison. The `POST`
handler validates the raw request body against `X-Hub-Signature-256` before
processing either inbound messages or delivery statuses.

Inbound senders are mapped to a school (the canonical V1 organization ID) by
the registered `comms_sender_numbers` row. A conversation is linked to a user
only when exactly one user in that organization has the matching phone number.
STOP/START consent handling remains in `comms_inbound`; provider status updates
resolve only an existing WhatsApp outbound message in that same organization.
Message bodies and phone numbers are excluded from the new append-only audit
summaries.

This migration is review-only until explicitly approved and applied by an
authorized operator. No production database change is performed by this
integration work.
