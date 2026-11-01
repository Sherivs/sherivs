# Internal Console audit-event catalogue

**Version target:** V1 organizational capability envelope.  
**Status:** Uses the existing shared `public.audit_logs`; no second audit store was added.

## Canonical record

Human actions and governed-agent proposals use the shared
[`writeAuditRecord()`](../../frontend/src/lib/server/write-audit.ts) path and
the existing `public.audit_logs` table. Its existing schema stores actor,
action, target, time, before, and after using `user_id`, `action`,
`table_name`, `record_id`, `created_at`, `old_value`, and `new_value`.

The shared writer records additional event metadata in `new_value`:

| Contract field         | Stored representation                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actor                  | `user_id` for a canonical user; `new_value.actor_kind`, `actor_id`, `actor_email`, and/or `actor_ref` identify human, agent, or system attribution. |
| Action                 | `action`                                                                                                                                            |
| Target                 | `table_name` and `record_id`                                                                                                                        |
| Timestamp              | `created_at`; the writer also records `new_value.recorded_at`                                                                                       |
| Outcome                | `new_value.outcome` (`succeeded`, `failed`, or `denied`)                                                                                            |
| Correlation ID         | `new_value.correlation_id`; callers may supply a request correlation ID, otherwise the writer creates a UUID.                                       |
| Before                 | `old_value`, when an allow-listed prior-state snapshot applies                                                                                      |
| After / proposal       | `new_value.after`, when an allow-listed resulting state or proposal applies                                                                         |
| Authorization evidence | `new_value.gate`                                                                                                                                    |
| Non-sensitive context  | `new_value.details`                                                                                                                                 |

Before/after data is optional for events that do not change or propose a
resource state, such as opening an audit view. Callers must provide only the
minimum allow-listed state required to explain a change. Passwords, tokens,
secrets, and unnecessary personal content must not be recorded.

## Console event families

The console reader is `listConsoleAudit()` in
[`activity.functions.ts`](../../frontend/src/lib/internal-console/activity.functions.ts).
It requires authenticated platform staff, checks `platform.audit.read`, and
requires AAL2. It filters to control-plane action prefixes and records its own
successful view action.

| Event family                  | Action prefixes / examples                                       | Expected target and outcome                                                                              |
| ----------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Staff lifecycle and roles     | `platform_staff.*`                                               | Staff identity; invitation, role, status, and outcome details                                            |
| Support and access review     | `platform_support.*`, `platform_access_review.*`                 | Grant/revoke or reviewed access record; outcome and scope                                                |
| Workspace administration      | `platform_workspace.*`                                           | Workspace or membership record; outcome                                                                  |
| Organization lifecycle        | `platform_organization.*`                                        | Organization case; prior/current lifecycle state where available                                         |
| Audit access                  | `platform_console.audit.view`                                    | `audit_logs`; selected scope and returned count                                                          |
| Incidents, tickets, billing   | `platform_incident.*`, `platform_ticket.*`, `platform_billing.*` | Corresponding control-plane record; outcome and approved details                                         |
| Agent proposals (design only) | Namespaced `agent.*` action                                      | Agent reference, target, correlation ID, and before/after proposal; human decision is separately audited |

Historical audit rows may predate the writer metadata and therefore may not
have correlation IDs or before/after payloads. Missing legacy values are
unknown; they must not be inferred.

## Immutability and access

SHERIVS-016 already installs a `BEFORE UPDATE OR DELETE` trigger and a
`BEFORE TRUNCATE` trigger on `public.audit_logs`, and revokes direct
`UPDATE`, `DELETE`, and `TRUNCATE` from `PUBLIC`, `anon`, and `authenticated`.
Do not edit that migration or weaken its grants, trigger, or existing RLS.
`tests/sql/console-audit-append-only.sql` is a synthetic local-database proof
that attempts both UPDATE and DELETE and expects both to be rejected.

Audit reads remain capability-gated server operations; workspace membership
does not grant audit access. No live database was used to execute this proof.
