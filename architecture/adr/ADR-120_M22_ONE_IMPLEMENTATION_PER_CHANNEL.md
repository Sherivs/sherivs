# ADR-120: One Implementation per Channel, With Send-Time Consent, Evidence and Template Registry

| Field                      | Value                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (founder approval needed for the migration and for the SMS provider choice; nothing is applied)                                             |
| Date                       | 2026-11-19                                                                                                                                           |
| Author                     | Claude Code agent (mission M22 implementation)                                                                                                       |
| Creator                    | Claude Code agent, mission E-019 (M22 comms completion)                                                                                              |
| Mission                    | M22 (comms completion), master brief §10.3 and §12.1                                                                                                 |
| Capabilities               | One SMS port, one email path, one proactive WhatsApp gate; consent and quiet hours at send time; delivery evidence for every send; USSD result check |
| Cites                      | [ADR-112](./ADR-112_COMMS03_BULKSMS_SMS_PROVIDER.md); ADR-072 (PR #351); ADR-022 (PR #308); ADR-101; issues #330, #331, #278                         |
| Minimal ownership artifact | `database/supabase/migrations/20261117003400_sherivs_m22_comms_completion.sql`                                                                       |

## Context

Before M22 the same channel had more than one sender:

- **SMS:** PR #351's BulkSMS Nigeria gateway behind `SMS_PROVIDER`; a separate BulkSMS.com sender used only by owner alerts (`jarvis-bridge/owner-alert-bulksms.server.ts`); an unused legacy BulkSMS Nigeria class that invented provider ids (`scholar/comms/adapters.server.ts`); and an unwired Twilio SMS module.
- **Email:** one Resend adapter, but the ENGINE-23 notification cron and the owner-alert sender each built their own command, and neither recorded delivery evidence.
- **WhatsApp:** `comms_send` queued proactive rows that nothing ever sent; owner alerts sent a template named only in configuration, with the adapter's automatic 5xx retry on (a duplicate-send risk).
- `cg_delivery_evidence` accepted only `email` and `voice`.

Which BulkSMS company the founder contracted is not verified.

## Options

- **A. Pick one BulkSMS company now and delete the other adapter.** Rejected: the fact is unverified, and guessing wrong silences owner alerts or tenant SMS.
- **B. Keep both BulkSMS adapters behind the one port, chosen only by configuration.** Chosen. The ambiguous value `bulksms` is refused.
- **C. Leave owner alerts on their own senders.** Rejected: two code paths for one channel drift apart (they already had different failure semantics).

## Decision

1. **SMS:** `sms-gateway.server.ts` is the only SMS selector. Adapters: `bulksmsnigeria` (PR #351) and `bulksmscom` (moved from the owner-alert sender, same env names). The tenant dispatcher and owner alerts both call it. The owner-alert-only sender and the legacy class are deleted. Twilio SMS has no caller and is not selectable. Issue #330 told us to keep that module, so it stays until the founder decides. A guard test stops any production import of it.
2. **Email:** `email-send.server.ts` (`createTransactionalEmailSender`) is the one transactional email send. It uses the Resend adapter and the evidence sink, and both the notification cron and owner alerts use it. The government-invite mail keeps its direct adapter call, now with the evidence sink.
3. **WhatsApp:** `whatsapp-template-registry.ts` holds `sendProactiveWhatsApp`, the only proactive send. It refuses to call the provider unless the template is registered, approved, has a language set and has exactly the right number of parameters. It makes one attempt, with transient retry off. The tenant registry is `comms_templates`, with the new `wa_param_count` column enforced by a trigger. The platform registry is `PLATFORM_WHATSAPP_TEMPLATES`. The new `whatsapp-fabric.server.ts` dispatcher sends the queued rows. It claims each row through `comms_wa_claim`, which also refuses an unregistered template, and closes it through `comms_wa_settle` / `comms_wa_hold`. Money follows COMMS-03: a refund happens only when the provider provably did not accept the message, and an ambiguous outcome is held.
4. **Consent:** `send-time-consent.server.ts` is the one send-time gate for SMS and WhatsApp. It mirrors `comms_send`: an opt-out blocks; WhatsApp and marketing need an explicit opt-in in this organization and on this channel; safety messages bypass opt-out and quiet hours. Quiet hours come from `notification_preferences`, read with PR #308's `isWithinQuietHours` (UTC), and they defer a message, never drop it.
5. **Evidence:** every SMS and WhatsApp attempt or pre-send refusal writes one `cg_delivery_evidence` row, with the recipient redacted, under the organization id. Owner-alert rows use the tenant ref `platform`. Email sends through the shared paths write rows too. The migration widens the channel check.
6. **Metering:** unchanged and single. `comms_send` charges once at queue time through `meter_usage`, and the dispatchers never meter. Refunds go through `_comms_refund_charge`, which is idempotent per reference. Owner alerts are platform cost and are never metered to a tenant.
7. **USSD:** a new option, `4. Results`. The user chooses a linked child, then enters the card serial and PIN. The answer comes only from `public.check_result`, with a further limit of 5 result attempts per phone per hour. `ussd_handle` EXECUTE is now granted to service_role only.
8. **Voice:** unchanged and paused.

## Consequences

- The operator must set `SMS_PROVIDER` (`bulksmsnigeria` or `bulksmscom`) for owner-alert SMS to keep working. Until then those alerts report `provider_not_selected`.
- An approved WhatsApp template row must now carry a correct `wa_param_count`.
- The tenant email fabric dispatcher (`resend-fabric.server.ts`, PR #333) still writes `outbound_messages` with direct UPDATEs that service_role cannot make, and it does not claim rows. It is not scheduled. It needs claim/settle functions like the SMS and WhatsApp ones before it is wired (follow-up).
- Quiet hours are read as UTC, the same as PR #308. Nigeria is UTC+1, so a preference saved as local time runs one hour late. This is one shared rule to fix in one place.
