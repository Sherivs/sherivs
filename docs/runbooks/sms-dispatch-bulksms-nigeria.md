# Sherivs SMS dispatch runbook (BulkSMS Nigeria)

Authority: AGENTS.md §§12, 17, 26, 31; ADR-069 (`architecture/adr/ADR-069_COMMS03_BULKSMS_SMS_PROVIDER.md`); issue #330.
Creator: Claude Code coding agent (Claude Sonnet 5.5) for mission COMMS-03, following the runbook conventions of copilot-swe-agent[bot] in `docs/runbooks/whatsapp-e2e.md`.
Created: 2026-11-13

## Verification

Status: PREPARED, NOT ACTIVATED. Nothing in this runbook has been executed against production. No schedule is active, no provider credential is configured, `sms_live` is off, and no real message has been sent. The code paths it describes are covered by `tests/unit/communications/sms-fabric.test.ts`, `tests/unit/communications/bulksms-nigeria-adapter.test.ts` and `tests/unit/communications/sms-dispatch-schedule.test.ts`. Every step marked **(needs authorization)** changes production state and needs the owner's separate, explicit approval.

## What runs

| Piece                                                               | Where                                                                 | Purpose                                                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Fabric (`comms_propose_send` → `comms_approve_send` → `comms_send`) | Database                                                              | Decides what may be texted; meters usage; writes a `queued` row only when the organization's `sms_live` flag is on. |
| Dispatcher                                                          | `GET/POST /api/public/cron/sms-dispatch`                              | Turns `queued` rows into provider calls. Bearer `CRON_SECRET`. At most 20 messages and 10 organizations per run.    |
| Delivery reports                                                    | `POST /api/public/webhooks/bulksms`                                   | Provider callback; authenticated by a per-message token in the URL.                                                 |
| Scheduler                                                           | n8n export `automation/n8n/sherivs-sms-dispatch-tick.json` (inactive) | Calls the dispatcher every minute.                                                                                  |

Nothing drains the queue until a scheduler calls the dispatcher. Do not activate one until the gates below are met.

## Gates before any organization goes live

The owner decides each gate. Until they are met, keep `sms_live` off for every organization.

1. Migrations `20261101001000` (communication scope lock) and its predecessors are applied to the target database. Confirm with a read-only migration listing.
2. Plan rule settled. Issue #330 says only Growth, Professional and Enterprise include SMS; the database still lets Trial and Starter through (see ADR-069, "Production readiness review"). Enable `sms_live` only for organizations on an SMS plan.
3. Refund policy settled. A message rejected or failed after metering is not credited back, and metering also happens while `sms_live` is off (the row becomes `sent_stub`). Decide the policy first.
4. An opt-out path exists. The provider documents no inbound-reply webhook, so an SMS STOP reply cannot reach the system; confirm the regulatory position with counsel.
5. A live delivery-report test has passed against a test organization (needs credentials).

## Environment variables (names only)

Set server-side values in the intended Vercel environment. Never put values in this runbook, commits, tickets, logs or chat. Never use a `VITE_`, `NEXT_PUBLIC_` or `PUBLIC_` prefix.

- `SMS_PROVIDER` — must be `bulksmsnigeria`. Unset sends nothing; any other value sends nothing.
- `BULKSMS_NG_TOKEN` — provider bearer token.
- `BULKSMS_NG_SENDER` — sender ID, 1 to 11 printable ASCII characters.
- `BULKSMS_NG_WEBHOOK_URL` — optional; the HTTPS URL of `/api/public/webhooks/bulksms` with no query string or credentials. Without it, no delivery reports are requested.
- `BULKSMS_NG_WEBHOOK_SECRET` — optional; random server-only key used to mint per-message tokens. Needed together with the URL.
- `CRON_SECRET` — bearer secret, shared with the other cron routes.

## Scheduler options

### Option A — n8n (recommended; repository precedent)

Same pattern as `docs/runbooks/whatsapp-e2e.md`. It works on any Vercel plan and does not depend on a deployment to change the cadence.

1. Import `automation/n8n/sherivs-sms-dispatch-tick.json` into n8n and leave it inactive. **(needs authorization)**
2. Reuse the Header Auth credential `Sherivs CRON Authorization` (header `Authorization`, value `Bearer ` followed by the Vercel `CRON_SECRET`, stored only in the credential). The export contains only the credential name.
3. Run the workflow manually once and expect HTTP 200. With no provider selected the body is `{"ok":true,"status":"skipped","reason":"provider_not_selected",...}`.
4. Activate it only when the gates above are met. **(needs authorization)**

### Option B — Vercel Cron (not committed)

Vercel registers cron entries from `vercel.json` on the next production deployment and runs them only on production deployments. Vercel sends `CRON_SECRET` as the `Authorization` header, runs Hobby crons at most once per day, does not retry a failed invocation, and can occasionally miss or repeat a run. A committed `vercel.json` would start the schedule at the next production deploy, so this repository does not contain one, and a test fails if one mentions the dispatcher. If the owner chooses this option, add it as its own reviewed change:

```json
{
  "crons": [{ "path": "/api/public/cron/sms-dispatch", "schedule": "* * * * *" }]
}
```

The function's `maxDuration` must cover the worst case of 20 sends at the provider's 15 second timeout. A missed or doubled run is safe: each row is claimed atomically before sending, so at most one worker can send it.

## Smoke tests that send nothing

Use placeholders; never paste a secret into a terminal history you do not control.

1. Unauthenticated: `curl -i https://www.sherivs.com/api/public/cron/sms-dispatch` returns 401 (or 503 if `CRON_SECRET` is not set).
2. Authenticated with `SMS_PROVIDER` unset returns 200 with `"status":"skipped"`.
3. Webhook without a token: `curl -i -X POST https://www.sherivs.com/api/public/webhooks/bulksms` returns 403 (or 503 if the webhook secret is not set).

## Monitoring

The dispatcher returns counts only: `orgsVisited`, `orgErrors`, `sent`, `failed`, `rejected`, `skipped`, `haltedReason`, `staleClaims` (message ids). It never returns message text, numbers or credentials. Alert on:

- `haltedReason` of `provider_auth_failed` (credentials unusable; rows stay queued) or a rate-limit code.
- `orgErrors` above 0 (a state write failed for one organization).
- any `staleClaims`.

Read-only queries for an operator with database access:

```sql
-- Queue depth by organization
select org_id, count(*) as queued
from public.outbound_messages
where channel = 'sms' and status = 'queued' and provider_ref is null
group by org_id;

-- Claims with no provider id for more than 15 minutes
select id, org_id, updated_at
from public.outbound_messages
where channel = 'sms' and status = 'queued' and provider_ref like 'claim:%'
  and updated_at < now() - interval '15 minutes';

-- Sent but no delivery report after 24 hours
select id, org_id, provider_ref, updated_at
from public.outbound_messages
where channel = 'sms' and provider = 'bulksmsnigeria' and status = 'sent'
  and updated_at < now() - interval '24 hours';
```

## Stale claims

A claim that never receives a provider id means the worker stopped between claiming the row and recording the provider's answer. We cannot tell whether the provider accepted the message, and the provider looks messages up by its own `message_id` only. The dispatcher therefore reports these rows and never re-sends them.

For each stale row an operator with database authority and the owner's approval **(needs authorization)** checks the BulkSMS Nigeria dashboard for a message to that recipient around that time, then:

- Message found: record it as sent with the provider's id, so a late delivery report can still finalize it.

```sql
update public.outbound_messages
set status = 'sent', provider_ref = '<provider message_id>', error = null, updated_at = now()
where id = '<row id>' and org_id = '<org id>'
  and status = 'queued' and provider_ref like 'claim:%';
```

- No message found: close it as failed. Do not put it back in the queue. If the parent still needs the message, create a new proposal so it goes through approval, consent and metering again.

```sql
update public.outbound_messages
set status = 'failed', provider_ref = null, error = 'operator_reconciled_not_sent', updated_at = now()
where id = '<row id>' and org_id = '<org id>'
  and status = 'queued' and provider_ref like 'claim:%';
```

- Unsure: leave it. A stuck row costs nothing; a double text to a parent cannot be undone.

The audit trigger on `outbound_messages` records each update in `audit_chain`.

## Rotating `CRON_SECRET`

`CRON_SECRET` is shared by every cron route (`wallet-topup-reconcile`, `integrations-sync`, `whatsapp-n8n-forward`, `sms-dispatch`) and by the n8n credential `Sherivs CRON Authorization`. There is no window where both an old and a new value are accepted, so rotate it as one step. A rejected tick returns 401 and is simply skipped; no message state changes.

1. Generate a new value of at least 16 letters and digits only (Vercel warns that a header value must not contain line breaks or leading or trailing spaces). Record it in your own secret manager first. **(needs authorization)**
2. Set it in Vercel for Production and redeploy. A deployment captures the value when it builds and keeps that copy for its life, so editing the variable changes nothing until the next deployment.
3. When the new deployment is Current, update the n8n credential value to the same secret.
4. Confirm the next tick returns 200.
5. Rolling back a deployment restores that deployment's older secret; update the n8n credential to match.

## Rotating `BULKSMS_NG_WEBHOOK_SECRET`

Tokens are minted per message from this secret. After a rotation, a delivery report for a message that was sent under the old secret fails verification with 403, and the row stays `sent`. Rotate when few messages await reports (use the third query above), or accept that those rows will not finalize.

## Kill switches (fastest first)

1. Disable the n8n workflow (or use Vercel's Disable Cron Jobs if Option B was chosen). The queue stops draining; nothing else changes.
2. Turn `sms_live` off for the organization. The dispatcher skips it. New messages for that organization become `sent_stub` and are still metered.
3. Unset `SMS_PROVIDER`. The dispatcher skips every organization.
4. Remove `CRON_SECRET`. Every cron route returns 503.

Rows already `queued` stay queued through all four; they send only after the switch is reversed, and each row is re-checked for membership, plan and consent at that time.

## First live test **(needs authorization)**

One organization on an SMS plan, one consenting internal test recipient, one message. Confirm the row moves `queued` → `sent` → `delivered`, the callback arrived with a valid token, the wallet debit matches the price book, and `audit_chain` holds the changes. Only then consider a second organization.
