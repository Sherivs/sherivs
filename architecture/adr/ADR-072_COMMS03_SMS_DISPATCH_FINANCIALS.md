# ADR-072: SMS Dispatch Money Rules — Refund Only What the Provider Provably Never Accepted, Hold What Is Ambiguous

|| Field | Value |
||---|---|
|| Status | PROPOSED (security review and operator approval before any production migration) |
|| Date | 2026-11-13 |
|| Author | Claude Code coding agent (Claude Sonnet 5.5) under the COMMS-03 mission authorization of 2026-11-13. Implements the proposal of the COMMS-03 financial-integrity review (`docs/proposals/comms-03-financial-entitlement/`) after FIN-01 (ADR-070) and ENT-01 (ADR-071). The paid-SMS send path it completes was delivered by `copilot-swe-agent[bot]` in PR #222 (issue #221); the BulkSMS Nigeria adapter and dispatcher by ADR-069. |
|| Mission | COMMS-03 — BulkSMS readiness: dispatcher write path, simulated-message charges, refund and reconciliation policy, plan enforcement in the database |
|| Capabilities | V1 communications fabric (`comms_send`, `outbound_messages`); wallet metering and refunds; SMS plan entitlement |
|| Supersedes-in-part | None. Corrects the ADR-069 dispatcher write path (direct `UPDATE`s that migration `20261024000270` denies) and replaces proposals 01–03 of the review. Proposals 04 and 05 are superseded by FIN-01 and ENT-01 and are not reapplied. |
|| Cites | `database/supabase/migrations/20261104052000_sherivs_comms03_sms_dispatch_financials.sql`; its rollback; `tests/integration/comms-03-sms-dispatch-financials.local.sql`; `tests/integration/comms-03-sms-concurrency.local.mjs`; `tests/unit/communications/sms-fabric.test.ts`; `frontend/src/lib/communications/sms-fabric.server.ts` |
|| Minimal ownership artifact | `database/supabase/migrations/20261104052000_sherivs_comms03_sms_dispatch_financials.sql` and its matching rollback |

## Context

SMS is paid per message. `comms_send` records an `outbound_messages` row and charges the organization's wallet (or its term pool) when it queues the message. A dispatcher then hands queued rows to the provider and a webhook receives delivery reports. Without this change a database built from the repository migrations shows these defects, each reproduced by a failing test before any fix (`comms-03-sms-dispatch-financials.local.sql`: 7 pass and 57 fail on a database that has FIN-01 and ENT-01 but not this migration):

1. **F1 — the dispatcher could not write.** Migration `20261024000270` revoked every write on `outbound_messages` from `service_role` (SELECT only). The dispatcher claimed, closed and updated rows with direct `UPDATE`s, and the webhook did the same, so in production every claim would have been denied.
2. **A simulated message was charged.** `comms_send` metered before it knew whether the message would be queued. With `sms_live` off the status was `sent_stub`, nothing was sent, yet a usage event was recorded and a term-pool allowance was consumed (reproduced: usage events +1, pool +1).
3. **A Trial or Starter organization could queue and be charged for SMS** even though the catalog says it has none. After ENT-01 the database knows the plan (`sms_plan_entitled`), but `comms_send` and the dispatcher did not ask.
4. **Money never came back.** A message the provider refused, or that failed validation at dispatch, stayed charged. The dispatcher also turned every non-retryable failure into `failed` with the claim cleared, which erases the difference between "the provider refused it" and "we do not know whether the provider accepted it".

Production state, from the read-only checks in ADR-070 and ADR-071: zero organizations, wallets and usage events. Nothing is at risk today; SMS is inactive (no `SMS_PROVIDER`, no credentials, scheduler not active).

## Options

### Option 1 — Grant `service_role` UPDATE on `outbound_messages` again (rejected)

Restores the dispatcher in one line and gives every server-side bug, and anyone holding the service key, write access to the delivery ledger with no compare-and-set. It also reopens what migration `20261024000270` closed deliberately.

### Option 2 — Refund every failed message automatically (rejected)

A timeout, a 5xx after the request was written, or a 200 without a message id can mean the provider accepted and will bill the message. Refunding those pays the school back for a message that may be delivered and then lets a resend happen: the organization is charged zero and the provider is paid twice. A duplicate report (409) is the same case: the provider holds the first copy.

### Option 3 — Narrow, service-role-only compare-and-set functions with a strict refund rule and a hold state (ruled)

All writes go through `SECURITY DEFINER` functions the client roles cannot execute. Money moves back only on an outcome the contract guarantees is "never accepted"; every other outcome is held for an operator.

## Recommendation (decision)

1. **Write path (F1).** `comms_sms_claim`, `comms_sms_settle`, `comms_sms_hold`, `comms_sms_report_delivery` and `comms_sms_reconcile` are executable by `service_role` only. Each is a compare-and-set on the claim the caller holds (claim = `provider_ref` `claim:<uuid>`), validated, and scoped by organization id. The dispatcher and webhook issue no direct `UPDATE`; a unit test pins this.
2. **Entitlement in the database.** `comms_sms_claim` returns false, so no provider call follows, when `sms_plan_entitled(org)` is false (ENT-01, catalog-derived, fails closed) or the organization's `sms_live` flag is off. `comms_send` records `blocked_plan` (cost 0, provider `stub`, never queued, never metered) for a Trial or Starter organization even with `sms_live` on.
3. **Simulated messages are free.** Only a message that will really be queued (`v_live`) is metered. A `sent_stub` message records no usage event and consumes no pool allowance. This also applies to the other metered channel in the same function (WhatsApp with `whatsapp_live` off): the rule is "simulated means free", not "SMS only".
4. **Refund rule.** A charge is refunded, in the same transaction as the close, only when the message was provably never accepted: (a) rejected before submission (recipient re-resolution, consent re-check, plan, or local payload validation: no provider call was made) — reason `rejected_before_submission`; (b) the provider definitively refused it (a non-retryable 4xx other than credentials and duplicate) — reason `provider_rejected`; (c) an operator cancels a queued message that can no longer be sent — `cancelled_unsent`; (d) an operator reconciled a held message as not accepted — `reconciled_not_accepted`. `provider_duplicate` is **not** a refund reason.
5. **Ambiguous outcomes are held, never resent, never refunded.** A timeout after the request was written, a 5xx other than 503, a 200 without a usable message id, a duplicate report, and any failure code the dispatcher does not know are all held: the message stays `queued`, keeps its claim (so no worker can claim it again), gets `error = held:<code>: …` and an `audit_logs` row, and the run stops so an outage does not turn every queued row into a held one. Held messages are reported by every scheduled run (`heldMessages`).
6. **Reconciliation.** `comms_sms_reconcile` (operator, `service_role`) resolves a held message after the provider's own records were checked: `accepted` records the provider message id (status `sent`, charge stands) or `not_accepted` (status `failed`, charge refunded once). It refuses any message that is not claimed and queued.
7. **Delivery failures do not refund.** `comms_sms_report_delivery` moves `sent` to `delivered` or `failed` exactly once; replays and contradicting reports change nothing. Whether a message that fails delivery is charged is a provider billing fact that has not been verified; no refund logic assumes either answer.
8. **Release.** A provider that was provably not asked or did not process the message (not configured, unreachable before connect, 429, 503, unusable credentials) releases the claim, keeps the message queued and halts the run. Nothing is charged twice: the single charge was taken at queue time and is idempotent by reference.
9. **Evidence and idempotency.** `usage_event_reversals` has one append-only, audited row per refunded charge (primary key organization + reference); the wallet posting replays by its own reference. Two layers, so a refund cannot be applied twice even under concurrent callers (tested with 12 concurrent refunds and 10 racing reconciliations).
10. **Scheduler.** Unchanged and inactive. Activating SMS, selecting a provider, storing credentials, applying this migration and merging remain separate decisions that need your approval.

### Explicit residual risk (stated, bounded, owned — not hidden)

- **Provider billing semantics are unverified.** Refund rule (b) treats a definitive 4xx refusal as "not accepted and not billed", which is the assumption built into the adapter's classification and the owner's policy ("provider rejection before acceptance qualifies for refund"). It has not been verified against BulkSMS Nigeria's billing terms. If the provider bills refused messages, those refunds would be wrong. Mitigation: refunds are bounded (one message price each), audited, and reversible by a ledger adjustment; the rule list is one place (`classifyGatewayFailure` and the CHECK in `comms_sms_settle`).
- **A held message waits for a human.** There is no automatic reconciliation; the provider offers no lookup by our reference. The scheduled run reports held and stale claims on every run. A queued-but-unsent message of an organization that lost its plan is not refunded automatically either; `comms_refund_unsubmitted(…, 'cancelled_unsent')` is the operator path.
- **`sms_plan_entitled` is tier-only** (ENT-01): it does not read `subscription_status`, expiry or `entitlement_overrides`. A suspended or expired subscription keeps SMS until a later mission changes that.
- **The dispatcher halts on the first ambiguous outcome.** Conservative by design; the cost is that one bad response pauses the whole run until an operator looks.

### Neutrality baseline extension (ADR-004)

The COMMS-03 migration necessarily uses the platform's existing physical column `school_id` and, in the verbatim `comms_send` body, the existing vocabulary of that function. The domain-neutrality guard reports these as new hits in a new file. Per ADR-004 an entry may be added only with a dedicated ADR recording the decision; this ADR is that record. The entries are limited to `20261104052000_sherivs_comms03_sms_dispatch_financials.sql`; no table, grant or domain code was added to a neutral surface. This follows the same decision taken in ADR-070 and ADR-071 and is flagged for reviewer confirmation because the baseline header says the baseline is shrink-only.

## Consequences (summary)

- The dispatcher works under the real privileges of production, and its every state change is atomic, compare-and-set and auditable.
- A simulated message never costs money; a blocked-by-plan message never costs money; a provably-refused message gets its money back exactly once.
- An ambiguous message is never resent and never refunded without a human who checked the provider.
- Rollback restores the previous `comms_send` byte-for-byte (verified by md5 against the production definition) and keeps refund evidence.
- Application and migration must ship in the order: FIN-01, ENT-01 (both already applied to production by approval), then this migration, then the application change. The migration refuses to run without FIN-01 and ENT-01.

## Golden Questions

1. Can the dispatcher write a status with only the privileges `service_role` has in production? Yes, only through the five functions.
2. Can an authenticated user or anonymous caller execute any of them? No (42501 under real roles).
3. Can a message be sent twice? No: claim is compare-and-set; held messages keep their claim.
4. Can a message be refunded twice or refunded after the provider accepted it? No: one reversal row per charge; refund functions refuse claimed and accepted messages.
5. Is a simulated or plan-blocked message ever charged? No.
6. Does a delivery failure refund? No.
7. Can another organization's id reach a message? No: every function matches the message id and the organization id together.

## UNKNOWNs

- BulkSMS Nigeria billing for refused and for undeliverable messages (see residual risk).
- Whether the provider supports a status lookup by our reference (the adapter assumes it does not).
- Whether the production migration chain will use apply-time version numbers (it has for FIN-01 and ENT-01) so repository file names and recorded versions differ.

## Verification

| Evidence | Result |
|---|---|
| PostgreSQL integration (real roles, one rolled-back transaction) | before: pass=7 fail=57; after: pass=65 fail=0 |
| Concurrency (committed fixture, real concurrent connections) | pass=10 fail=0 |
| Unit (dispatcher, webhook, cron against a model of the functions) | fails against the previous dispatcher; passes against this one |
| `comms_send` change | exactly two hunks against the live definition |
| Rollback | restores the previous definition (md5 `65cc85c1…`) and status CHECK; idempotent |
