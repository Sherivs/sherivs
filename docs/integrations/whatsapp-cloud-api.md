# WhatsApp Cloud API (V1 organizational messaging)

The shared communications gateway owns tenant scope, consent, queued outbound
messages, inbound replies, and delivery status. Meta is a provider adapter;
webhook routing uses the registered Meta `phone_number_id` and resolves
`tenant_id` + `org_ref` from the sender registry, never from tenant values in
webhook payloads.

## Server environment

Configure these only in the server runtime. Never expose them through a
`VITE_`, `NEXT_PUBLIC_`, or `PUBLIC_` variable:

| Variable                   | Purpose                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WHATSAPP_TOKEN`           | Meta system-user access token used by the Cloud API sender.                                                                                      |
| `WHATSAPP_PHONE_NUMBER_ID` | Default Cloud API phone number ID for local/single-sender setups. The gateway uses the active sender registry reference for tenant-scoped sends. |
| `WHATSAPP_APP_SECRET`      | Meta app secret used to validate `X-Hub-Signature-256`.                                                                                          |
| `WHATSAPP_VERIFY_TOKEN`    | Random webhook subscription token; configure the same value in Meta.                                                                             |

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

Inbound sender resolution uses the service-only
`cg_org_communication_sender` registry. Message, conversation, consent, and
recipient records are scoped by the shared text `tenant_id` and `org_ref`;
recipient links are accepted only when the principal has an active
`cg_org_membership` row for that same tenant and organization. The recipient
address is server-resolved, not accepted from a client send request. STOP/START
updates the tenant/org-scoped consent record. Provider status updates resolve
only an existing outbound message for that same registered sender. RLS is
enabled and forced on communication records, direct client access is revoked,
and privacy-minimized changes are appended to `audit_chain`.

This migration is review-only until explicitly approved and applied by an
authorized operator. No production database change is performed by this
integration work.
