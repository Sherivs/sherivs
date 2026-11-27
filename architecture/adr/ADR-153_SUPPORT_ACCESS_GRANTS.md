# ADR-153: Support Access Grants (SUP-01)

- Creator: Claude Code agent, mission SUP-01 (support access) (provenance id W-017); AI-generated
- Origin: Mission: W-017; Authority: ADR-143 Decision A (accepted by the founder in chat, 27 Nov 2026)

- Status: PROPOSED. Migration not applied anywhere. Needs the founder's approval, a backup, and Tumi's review.
- Date: 2026-11-27

## Decision

Build ADR-143 Decision A as database objects, with no standing access.

1. `support_access_grant` is a record: organisation, holder (a platform super admin), source (ticket, head request, legal or safety; `break_glass` only through its own function), reason, modules, mode (read or write), minutes.
2. **The organisation's request is required.** `support_grant_request` accepts only the three organisation sources. The grant does nothing until the organisation's own administrator confirms (`support_grant_confirm`). A platform admin cannot confirm. A request unanswered for 24 hours lapses.
3. **Read** becomes active at confirmation (default 4 hours). **Write** (default 1 hour) also needs `support_grant_second_approve` by a different platform admin, who must spend a fresh passkey step-up of kind `support_write` bound to that one grant (A3). Maximum 24 hours.
4. **Revoke** is immediate by the organisation's administrator, the holder or any grant holder with access; a grant can only end sooner, never be extended or edited.
5. **Every use is audited.** Other functions must call `support_access_log` (holder only, in module, within time, write only on an approved write grant). The audit table is append-only and hash-chained per grant. The organisation's administrator reads the same grants and trail (`support_grants_list`, `support_audit_list`).
6. **Break-glass** (`support_break_glass_open`): platform admin only, read only, one hour, high-severity audit row the organisation sees at once.
7. Agents never hold a grant: every function requires a signed-in super admin, and agent identities are not.
8. Nothing here touches RLS or SoD for anyone else. The tables are closed to every client role; only the functions act.

## Not built (open)

- No function reads organisation content yet. Each support tool must call `support_access_log` first; that is future work per module.
- No screens, and no push or WhatsApp notice to the head for break-glass (the trail is the notice).
- Open from ADR-143 for Tumi: the named alternate second approver, whether the head may confirm over WhatsApp with a signed link, and retention of the audit rows (proposed 7 years; no purge is built).
- Expiry is evaluated at use time; no scheduler is needed.

## Verification

`tests/integration/sup01-support-access.local.sql`: 48 checks (closed tables, request rules, confirmation, scope, write four-eyes with a step-up spent once, break-glass, revoke, expiry and lapse, immutability, hash chain). The TypeScript digest matches `wf_step_up_digest`. Rollback: `database/supabase/rollbacks/20261127000200_sherivs_sup01_support_access.sql`.
