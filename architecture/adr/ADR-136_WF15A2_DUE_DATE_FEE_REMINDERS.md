# ADR-136: Due-Date-Relative Fee Reminders, Message Registry and Stop-on-Payment (WF-15a2)

- Creator: Claude Code agent, mission WF-15a2 (provenance id W-015); AI-generated

| Field      | Value                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------- |
| Status     | PROPOSED in the WF-15a2 PR; nothing applied to any hosted database, nothing enabled, nothing sent   |
| Date       | 2026-11-26                                                                                          |
| Creator    | Claude Code agent, mission WF-15a2; AI-generated                                                    |
| Decision   | Founder: Decision Pack D-01 and D-02 and the reminder-strategy answers of 26 Nov 2026               |
| Depends on | WF-05 (event sources), WF-06 (actions), WF-07 (approvals), WF-15a (pack, ADR-130)                   |
| Migration  | `database/supabase/migrations/20261117000998_sherivs_wf15a2_fee_reminder_events.sql`                |
| Rollback   | `database/supabase/rollbacks/20261117000998_sherivs_wf15a2_fee_reminder_events.sql`                 |

## Context

The v1 fee ladder ran from the issue date with 7-day waits. The founder's strategy reminds relative to the due date:
the first and last school day of each of the four weeks before it (SMS plus push, then push only), the due date
(WhatsApp, SMS, push; voice later), weekly after it, and a bursar task four weeks after.

## Decision

1. Timing lives in the database, not in workflow waits. `wf_fee_reminder_rungs(due_at)` is a pure schedule in
   Africa/Lagos wall-clock time (Monday 08:00, Friday 12:00, due date 08:00, weekly 08:00, escalation 09:00; never
   in the 20:00 to 08:00 quiet hours). `wf_fee_reminder_scan(now, limit)` emits WF-05 events for rungs in the last 36
   hours, deduplicated per invoice and rung, for organisations that have workflows enabled, never for settled invoices.
   It is service-role only and is not scheduled anywhere.
2. Five event types (week start, week end, due day, overdue, escalation) keep every pack template a straight line.
3. Stop on payment: an AFTER INSERT trigger on `cg_fee_payment` cancels open reminder runs of an invoice once recorded
   payments cover it; WF-07's run-close trigger cancels their approvals and drafts. Part payment does not stop it.
4. `fee-message-registry.ts` holds every message the pack can send and validates it: allowed variables only, SMS in
   GSM-7 within two segments with the pay link and STOP wording, push text short, WhatsApp bodies matching the Meta
   parameter order and UTILITY category, no promotional wording. A WhatsApp step stays blocked
   (`meta-templates-approved`) until its registry status is `approved`.
5. Pack version 2: `ps_fee_ladder` becomes the issue notice only (version 2); five reminder templates are added.
   Every customer-visible step stays at `draft`, so a person approves until AIN-02 evidence lifts autonomy.

## Consequences

- Invoices issued after some rungs have passed receive only the remaining rungs; a scan outage longer than 36 hours
  skips the rungs it missed (no flood on recovery).
- Tertiary dual audience (student and parent) and sponsor notices need payer roles (INST-02); their wording exists
  in the Meta pack but no template uses it yet.
- Voice calls and Hausa/Pidgin copies are out of scope until a provider and a reviewed translation exist.
- Amount in messages is the invoice amount; the overdue copy uses a derived `balance` that the sender must compute.
