# ADR-127: Tenant Memory and Context Scopes, Audited Writes, Retention (AIN-03)

| Field          | Value                                                                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status         | PROPOSED in the AIN-03 PR; nothing applied to any hosted database                                                                                                                                                                                       |
| Date           | 2026-11-20                                                                                                                                                                                                                                              |
| Creator        | Claude Code agent, mission AIN-03 (provenance id A-001, issue #476); AI-generated                                                                                                                                                                       |
| Version target | V1 organizational workflows, Phase 2 (AI-native core)                                                                                                                                                                                                   |
| Depends on     | [ADR-124](ADR-124_WF12_QUOTAS_WALLET_CAPS_RETENTION.md) (legal hold, retention style), [ADR-125](ADR-125_AIN01_AGENTS_AS_ENGINE_ACTORS.md) (registry, closed AI route), [ADR-126](ADR-126_AIN02_AUTONOMY_SCALE_AND_PROMOTION_GATE.md) (stacked on #475) |
| Migration      | `database/supabase/migrations/20261117000990_sherivs_ain03_tenant_memory_context_scopes.sql` (`..000980` is AIN-02; `..001000` is used by open PRs; the founder confirms the number before apply)                                                       |
| Rollback       | `database/supabase/rollbacks/20261117000990_sherivs_ain03_tenant_memory_context_scopes.sql`                                                                                                                                                             |

## Provenance

| Item                   | Source                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Requirement            | Issue #476; the AIN-03 roadmap entry ("tenant memory and context scopes, audited writes, retention") in the workflow hand-off, Part B section 5                                            |
| Existing work checked  | No `wf_memory*` objects and no open PR for the capability (2026-11-20). ENGINE-13 `agent_memory` scope rows and the twin proposals are platform-side, unapplied and have no tenant anchor  |
| Open founder decisions | 3 (AI route) is respected: the only agent read path is closed behind it. 7 (minors, lawful basis) bounds what may be stored. Retention windows, caps and ceilings are engineering defaults |

## Context

The engine has agents with identity and budgets (AIN-01) and one autonomy scale (AIN-02), but nowhere to keep what a
tenant wants an agent or a workflow to remember, and no rule for who may write it, how long it lives or who may read
it. Without one, each later mission (AI steps, the console, the packs) would invent its own store. Memory is tenant
data, and the AI route (founder decision 3) is not decided, so the store must exist and be safe before any model can
touch it.

## Decision

1. **Four context scopes** (`wf_memory_scope_kind`): `organization` (shared), `workflow` (one workflow key), `agent`
   (one agent's own notebook inside the organization) and `run` (one run). Each has a default and a maximum lifetime
   and an item cap. Every item expires: there is no memory without an end date.
2. **One table, one live row per key** (`wf_memory_item`), tenant column `org_id` referencing `wf_org_settings`, RLS
   enabled and forced. A value is a flat object of 1 to 20 entries, at most 4096 bytes. In class `reference` every
   string is an id or a code (no spaces, no `@`), the same rule as the event payloads of WF-05; in class `note` it is
   short text (300 characters). `ai_readable` is allowed only on a person's active `reference` item (CHECK).
3. **Writes only through functions.** The service role has no privilege on `wf_memory_item` at all (not even SELECT):
   the engine cannot read a stored value except through `wf_memory_agent_read`. Signed-in members read their own
   organization's live, unexpired items through RLS (`workflows.view`). Six SECURITY DEFINER entry points are
   executable by the service role only: `wf_memory_put`, `wf_memory_agent_propose`, `wf_memory_decide`,
   `wf_memory_retire`, `wf_memory_agent_read`, `wf_memory_purge_expired`. The server passes the verified person or
   the run; SQL binds the person (`wf_act_as`), derives the organization from it (or from the run) and checks
   `workflows.manage`.
4. **The guard trigger restates everything where no path skips it** (`wf_memory_item_guard`, BEFORE INSERT OR UPDATE;
   `INSERT ... ON CONFLICT DO UPDATE` is covered by its update half): the write must happen inside a
   transaction-local window opened by an entry point and naming the writer, and the writer must be the source the
   row claims; the scope reference must name something real in the organization; the lifetime must stay within the
   scope maximum on insert AND update; identity (organization, scope, reference, key, source) never changes; retired
   is terminal; the version advances by exactly one on any change and not otherwise; the per-scope item cap, the
   per-organization cap (2000) and the per-agent daily proposal cap (50) are counted under a per-organization
   advisory lock. The caps live in SQL; `tenant-memory.ts` restates them and a unit test ties it to the migration.
5. **Agents propose, people decide.** `wf_memory_agent_propose` takes a run, derives the organization and the agent
   from it, and writes a `note` with status `proposed` into the agent's own notebook or the run scope (never
   `organization` or `workflow`: a CHECK on the scope table). The run must be active and the agent usable here
   (AIN-01 state). A proposal's content never changes; only a person with `workflows.manage` (`wf_memory_decide`)
   can accept it (the window must name that person) or reject it. An agent cannot accept its own proposal, cannot
   overwrite a key and cannot make anything readable by an agent. This is at least as strict as the `draft` cap of
   AIN-02, whatever level the agent has earned.
6. **The agent read path is closed (decision 3).** `wf_memory_agent_read` refuses first with
   `ain03:ai_route_closed` while `wf_ai_route_approved()` (AIN-01) is false. When a later reviewed migration opens the
   route, it still returns only a person's active, unexpired, `ai_readable` `reference` items from the scopes the
   run belongs to: the organization, the agent's own notebook, the run's workflow and the run itself.
7. **Audited writes.** An AFTER trigger writes one `wf_memory_change` ledger row (operation, actor kind, person or
   agent, class, version, a SHA-256 of the value, never the value) and one `audit_chain` entry
   (`workflow.memory.write|update|propose|accept|reject|retire|purge`) for every change, whatever path made it. The
   ledger is append-only (update, delete and truncate refused). A change with no named actor is refused.
8. **Retention.** Retiring or rejecting an item wipes its content (a CHECK requires an empty value on a retired row)
   and switches the AI flag off. An expired row is invisible at once (member policy, every function) and is deleted
   by `wf_memory_purge_expired` (scheduler-callable, bounded batch, per-organization isolation); so is a row retired
   more than 30 days ago. Deletion is possible only inside the purge's own transaction-local marker for that
   organization and only for such rows; TRUNCATE is refused. An organization under a legal hold (`retention_legal_holds`,
   the WF-12 check) is skipped. The ledger and `audit_chain` are never purged.
9. **Workflows must be on.** Writing or changing memory needs the organization's `workflows_enabled`; retiring and
   purging do not (so an organization can be wound down). With `WORKFLOWS_ENABLED` off nothing writes.

## Lifetimes and caps (engineering defaults for the founder to ratify)

| Scope        | Default | Maximum | Items | Agent may propose |
| ------------ | ------- | ------- | ----- | ----------------- |
| organization | 365 d   | 1095 d  | 300   | no                |
| workflow     | 180 d   | 730 d   | 200   | no                |
| agent        | 90 d    | 365 d   | 200   | yes               |
| run          | 7 d     | 30 d    | 50    | yes               |

Also: 2000 live items per organization, 50 proposals per agent and organization in any 24 hours, 4096 bytes and 20
entries per value.

## Assumptions (open)

- The lifetimes, caps and the 30-day retired window above are engineering defaults.
- Memory holds ids, codes and short notes. Whether it may ever hold personal data (founder decision 7) and when
  `ai_readable` may be used (decision 3) are open. The `reference` shape rule stops names and free text; it cannot
  recognise an id that is itself personal. Do not store personal data in memory until decision 7 is made.

## Accepted limitations and follow-ups

- A memory key can itself be a word a person typed; keys are lower-case identifiers, not free text, but are kept in
  the ledger and the audit chain. They are never purged with the ledger.
- An agent adds new keys only: it cannot revise its own accepted note. It proposes a new key and a person retires the
  old one. (Follow-up: a revision workflow.)
- Pausing or retiring an agent does not remove its notebook; a person retires items, or they expire.
- `run`-scope memory refers to a run by text, without a foreign key (run retention deletes runs). It expires within 30
  days regardless.
- Nothing calls `wf_memory_purge_expired` yet: the scheduler route (`sherivs-cron`, switch off) and the server
  functions that call the entry points are a follow-up, as for AIN-01 and AIN-02. There is no UI.
- Passkey step-up is not required for accepting a proposal (as for promotion in AIN-02); the accepted note is never
  readable by an agent in any case.
- Advisory locks serialize writes per organization; one very busy organization's writes queue behind each other.

## Consequences

- With `wf_ai_route_approved()` false no agent reads any memory and no AI step can exist (AIN-01), so no tenant data
  reaches a model.
- `wf12-default-privileges` lists six more functions the service role may execute; the AIN-01 default-privileges CI
  step now undoes and re-applies AIN-03 around AIN-01 and AIN-02 (AIN-03 holds a foreign key to `wf_agent`).
- The rollback refuses while an item or a ledger row exists; remove them deliberately first.
