# Organization notification worker (ENGINE-23)

Authority: AGENTS.md §§12, 17, 26, 31; ADR-096 and ADR-099 (this runbook documents the worker that sends what they queue).
Origin: Claude Code agent, mission E-001 (ENGINE-23)
Creator: Claude Code agent
Created: 2026-11-15

Status: built and tested; not scheduled. Nothing in the repository schedules it, and email needs the Resend variables set.

Sends what the organization twin has queued in `org_notification_outbox`. The weekly report job
queues one email per report to the administrator (admin, then principal, then hq). Nothing else
queues yet: no organization agent runs, so there are no agent events to notify about.

## What is wired

| Channel      | Status                                                                                                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| email        | Sent through Resend. Needs `RESEND_API_KEY` and `RESEND_FROM_ADDRESS`.                                                                                                                                               |
| whatsapp     | Not wired. A proactive message needs an approved template and a recorded opt-in, and the existing send path only replies inside an inbound conversation. Rows are failed with `whatsapp_not_configured`, never sent. |
| push, in_app | No sender in this worker. Rows are failed with `channel_not_supported`.                                                                                                                                              |
| sms          | Cannot be queued (the table's channel check excludes it) and is refused in code. Off until you approve it.                                                                                                           |

## Rules the worker keeps

- The recipient must be an active member of the same organization. The address is read from that
  organization's own user row; a payload can never supply one.
- Redacted rows and safeguarding rows are sent as "you have a new item", with no detail.
- Urgent and critical items are the `escalation` category, which the notification policy bars from
  email. They are failed so a person sees them in the app, not emailed.
- Results report counts and reason codes only, never an address or provider text.
- The database owns retries: back-off of 5 minutes times the attempt, then `failed` after 5.

## Set up

1. Set `CRON_SECRET` in the deployment environment (the same secret the weekly job uses).
2. Set `RESEND_API_KEY` and `RESEND_FROM_ADDRESS` (a verified sender) in the deployment environment.
3. Call `GET` or `POST /api/public/cron/org-notifications` with `Authorization: Bearer $CRON_SECRET`
   every 5 minutes, from Vercel Cron (the plan must allow that frequency) or the n8n server.

## Check it

- No secret: the route answers 503 and does nothing.
- Wrong secret: 401.
- Response: `{ ok, claimed, sent, failed, reasons }`. `reasons` such as `email_provider_not_configured`
  mean the Resend variables are not set.
- Read-only check of the queue:
  `select channel, status, count(*) from public.org_notification_outbox group by 1, 2;`
