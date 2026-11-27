# ADR-137: Fee Reminder Scan Route and Message Renderer (WF-15a3)

- Creator: Claude Code agent, mission WF-15a3 (provenance id W-015); AI-generated
- Origin: Mission: W-015; Authority: founder decision record 2026-11-26 (ADR-140) and the Sherivs Automation Vision blueprint

- Status: PROPOSED
- Date: 2026-11-26
- Builds on: ADR-136 (WF-15a2)

## Context

ADR-136 left two gaps: the scanner `wf_fee_reminder_scan` had no scheduled caller, and the derived variables (guardian, student, school, pay_link, balance) had no code that filled them into registry messages.

## Decision

1. A cron route `/api/public/cron/workflow-fee-reminders` follows the WF-12 retention route pattern: constant-time bearer check on `CRON_SECRET`, 503 when unset, 401 when wrong, a no-op unless `WORKFLOWS_ENABLED=true`. It calls the scanner with a fixed limit of 500 and returns counts only. It takes no organisation, window or invoice from the request. It is not registered in the Cloudflare cron worker here.
2. A pure renderer `renderFeeMessage` fills a registry message from caller-resolved values. It refuses a missing or blank value, a value over 120 characters, braces or control characters, a link in any field except `pay_link`, a `pay_link` that is not a plain https path, an unknown template, and an SMS over two segments. For WhatsApp it returns parameters in Meta order and gives the button only the link token.
3. `formatNaira` and `formatDueDate` are strict (integer kobo, `YYYY-MM-DD`).

## Consequences

- Nothing is sent: the renderer is not wired to a channel, and the scan only emits events.
- Switching on the schedule needs a separate, approved change (cron entry, `WORKFLOWS_ENABLED`, per-organisation enablement).
- The sender that resolves values from the invoice and calls BulkSMS or the WhatsApp API is a later mission (it needs the approved Meta templates).

## Rollback

Delete the route, the renderer, their test and regenerate `routeTree.gen.ts`. No database change.
