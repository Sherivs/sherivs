# Sherivs WhatsApp n8n workflows

These n8n 2.x workflow exports are inactive and contain no credential values.
Import both JSON files as inactive workflows. The inbound webhook path
`sherivs-wa-inbound-placeholder` is a placeholder: choose the approved path and
set Vercel's `N8N_WHATSAPP_WEBHOOK_URL` to the corresponding production URL.
The n8n host must exactly match `N8N_WHATSAPP_ALLOWED_HOSTS`.

## Required n8n configuration

- Set process environment `N8N_WHATSAPP_SIGNING_SECRET` to the same server-only
  HMAC secret configured in Vercel. Use at least 32 characters.
- Allow the Code nodes' built-in crypto module with
  `NODE_FUNCTION_ALLOW_BUILTIN=crypto`.
- Set `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` so the Code nodes can read the
  signing secret from the n8n process environment. This lets workflow code read
  configured environment values; restrict workflow editing and execution access
  to trusted operators.
- Create an n8n Header Auth credential named `Sherivs CRON Authorization` for
  the tick workflow. Set the `Authorization` value to the standard `Bearer`
  prefix followed by the Vercel `CRON_SECRET`, stored only in the credential.
  Only the credential name is present in the export.

The inbound handler verifies the timestamp and raw-body HMAC before parsing the
event, rejects timestamps more than 300 seconds from now, and returns HTTP 401
on authentication or payload validation failure. The optional reply branch is
disabled by default (`reply_body` is empty). Add reviewed reply logic there only
if needed; replies are restricted to `reply_id`, `inbound_provider_ref`,
`conversation_id`, and `body`, and are signed with the same scheme. Do not send
tenant IDs, phone numbers, or Meta tokens and do not call the Graph API.

The forward tick runs every minute and uses the named Header Auth credential to
call the protected outbox endpoint. For setup, smoke-test, activation, and
rollback order, follow
[`../../docs/runbooks/whatsapp-e2e.md`](../../docs/runbooks/whatsapp-e2e.md).
