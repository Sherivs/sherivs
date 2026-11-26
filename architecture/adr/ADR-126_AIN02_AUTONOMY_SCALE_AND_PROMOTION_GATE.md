# ADR-126: One Autonomy Scale, Per-Step Enforcement and the Promotion Gate (AIN-02)

| Field          | Value                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status         | PROPOSED in the AIN-02 PR; nothing applied to any hosted database                                                                                                                                                                                          |
| Date           | 2026-11-20                                                                                                                                                                                                                                                 |
| Creator        | Claude Code agent, mission AIN-02 (provenance id A-001, issue #474); AI-generated                                                                                                                                                                          |
| Version target | V1 organizational workflows, Phase 2 (AI-native core)                                                                                                                                                                                                      |
| Depends on     | [ADR-078](ADR-078_ENGINE_ROLE_PACKS_AND_EARNED_AUTONOMY.md) (the ladder), [ADR-105](ADR-105_WF03_WORKFLOW_RUNTIME_CORE.md), [ADR-124](ADR-124_WF12_QUOTAS_WALLET_CAPS_RETENTION.md), [ADR-125](ADR-125_AIN01_AGENTS_AS_ENGINE_ACTORS.md) (stacked on #473) |
| Migration      | `database/supabase/migrations/20261117000980_sherivs_ain02_autonomy_scale_and_promotion_gate.sql` (`..000970` is AIN-01; `..001000` is used by open PRs; the founder confirms the number before apply)                                                     |
| Rollback       | `database/supabase/rollbacks/20261117000980_sherivs_ain02_autonomy_scale_and_promotion_gate.sql`                                                                                                                                                           |

## Provenance

| Item                   | Source                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement            | Issue #474; the AIN-02 roadmap entry ("one autonomy scale in the engine, per-step enforcement, promotion gate") in the workflow hand-off, Part B section 7                |
| The ladder             | `twin-engine/autonomy-ladder.ts` (ENGINE-01): states shadow, propose, assist, autonomous; bars 20 / 0.90, 50 / 0.95, 200 / 0.98 within 30 days; demote below 0.90         |
| The engine scale       | `suggest`, `draft`, `act_with_approval`, `act_and_report` (`workflow-actions.ts`, WF-06); `wf_agent_autonomy` and `wf_autonomy_guard` (WF-03, WF-06)                      |
| Registry               | `wf_agent`, `wf_agent_state_code`, tiers and grants (AIN-01, ADR-125)                                                                                                     |
| Open founder decisions | 9 (only the founder promotes an agent) is implemented as decided; the ceiling tables, step-up and evidence rules below are engineering defaults for the founder to ratify |

## Context

Two scales existed. The engine (WF-03, WF-06) had four levels and a per-step guard that read `wf_agent_autonomy`;
the twin engine had a four-state ladder with evidence bars and demotion. Nothing connected them: any database
writer, including the service role, could set an earned level directly, and no evidence was required. Per-step
enforcement stopped at the dispatcher in TypeScript.

## Decision

1. **One scale.** `wf_autonomy_scale` holds `suggest < draft < act_with_approval < act_and_report`, each mapped to
   one ladder state (shadow, propose, assist, autonomous). `wf_autonomy_rank` and `wf_autonomy_level_of` are the
   only ordering in SQL; `autonomy-scale.ts` restates the data and a unit test parses the migration seed and fails
   on drift. The bars are restated from the ladder, never a second source.
2. **One effective-level function.** `wf_effective_autonomy` is the lowest of the template level, the organization
   ceiling, the earned level, the agent's ceiling (its tier) and the action class cap. The step guard
   (`wf_autonomy_guard`, now SECURITY DEFINER with an empty `search_path`) uses it on insert and on update. An
   update can keep or lower a step's level, never raise it, so a plain UPDATE or an upsert cannot raise it. The six
   capped classes and `unclassified` are `draft`; `ai_model` is `suggest`; a class the table does not know is `draft`.
3. **Where an effect is recorded.** `wf_action_sandbox_outbox_90_autonomy` (insert and update) refuses an executed
   record unless the step is at `act_and_report` or a person approved a draft for this very step and idempotency key.
   It is ordered after the other outbox guards so their error codes are unchanged. This is the SQL backstop for the
   dispatcher's rule. It uses the lower of the step's stored level and its current effective level, so a step made
   before a demotion cannot execute at its old level.
4. **The earned level changes only through the gate.** `wf_agent_autonomy` is no longer writable by the service role
   (SELECT only). A trigger on insert, update and delete accepts a rise only when a matching ledger row exists from
   the same transaction (`txid_current()`), a fall only with a ledger row, never a delete or a key change, and never
   a level above the agent's ceiling. A ledger row from an earlier transaction authorizes nothing.
5. **Promotion (decision 9).** `wf_autonomy_promote(actor, org, agent, to, evidence, reason)`: the server passes the
   verified person, SQL binds it (`wf_act_as`) and the person must be an active super admin. One rung at a time, with
   the agent usable in that organization (AIN-01 state), a reason of at least ten characters, and evidence that is
   for this agent, no older than 30 days, free of critical failures, at or over the bar for the target level and,
   above `draft`, free of ungraded model cases. Each piece of evidence promotes once (unique index). Evidence is also superseded by anything newer: a promotion is
   refused when the agent has later evidence (good or bad) or the organization has a later demotion of it, so good
   evidence cannot be used after a regression was recorded (`ain02:evidence_superseded`; the ledger guard repeats it). An advisory lock
   per organization and agent serializes concurrent promotions.
6. **The ledger restates every rule.** `wf_autonomy_change` is append-only and its guard re-checks the founder, the
   ceiling, the bar, the age, the critical failures, the ungraded cases and the `from` level, so a direct insert by
   a database owner is held to the same rules as the function.
7. **Evidence and automatic demotion.** `wf_autonomy_record_evidence` (service role) stores numbers only: counts, a
   suite id, a time and a content hash (no content, no tenant data). A pass rate below 0.90, any critical failure
   or nothing graded is a regression and lowers the agent one rung in every organization that holds a level for it,
   with a ledger row, without a person. A replay of the same result lowers nothing a second time. The target level is derived inside
   `wf_autonomy_apply` from the level re-read under the per-agent lock, so a promotion that commits concurrently
   cannot make the regression call abort and lose its evidence.
8. **Demotion by people.** `wf_autonomy_demote` lowers (never raises) to any lower level. The founder may do it
   anywhere; an administrator of the organization (`workflows.manage`) may do it for their own organization. A
   demotion uses up no evidence, and the climb starts again one rung from where it landed.
9. **Run actor frozen.** `wf_run_08_freeze_actor` rejects any change of a run's agent or template once set,
   including the update half of an upsert, closing the WF-03 follow-up noted in ADR-125.
10. **Audit.** Every ledger row writes `workflow.autonomy.promote`, `.demote` or `.auto_demote` through
    `wf_audit_append`; the level change itself is audited by the existing table audit.

## Trust model (read this before relying on the gate)

- The gate defends against tenants and against bugs in the runtime. It does **not** defend against the service key.
- `service_role` holds a pre-existing GRANT ALL on `super_admins` (from before AIN-02; the application uses it to
  manage staff). It can therefore read a real founder id **and add an active founder row itself**, then promote as
  that person. Revoking the write is not done here because application code writes that table; the follow-up is a
  founder list that only a reviewed migration can change (decision for the founder).
- The numbers passed to `wf_autonomy_record_evidence` are asserted by its caller; SQL cannot check that an
  evaluation happened. A holder of the service key can mint evidence, promote with a real founder id (the person is
  trusted exactly as in WF-07), or demote any agent in every organization.
- What the gate does guarantee: no tenant role, no direct table write and no runtime bug can raise a level; every
  change leaves an append-only ledger row and an audit-chain entry, so misuse is visible after the fact.
- Whoever can run SQL as the database owner or hold the service key can edit reference data the gate reads
  (ceilings, the organization ceiling, the template cap before any run uses it). The edits that would hand an agent
  more than it earned after runs exist are refused (finding 5 below); the rest is the accepted trust model.
- Pre-production follow-up: a passkey step-up on promotion, and an evaluation runner whose evidence is signed or
  produced inside the database boundary.

## Review round 2 (independent adversarial review of head 638a6ef1)

Fixed; each has a harness case, and the two races have e2e scenarios H and I (mutation-checked):

1. A first promotion (suggest to draft) that had not committed was invisible to a regression recorded meanwhile, so
   the regression missed it and the agent kept the level. Recording evidence now takes an agent-wide advisory lock
   exclusively, a promotion takes it shared before its per-organization lock, so each side sees the other's committed
   state. E2E scenario H.
2. The executed-record guard read the level without holding anything: a demotion could commit between the guard and
   the record's commit. The guard now holds the organization-and-agent lock shared until its transaction ends; a
   demotion takes it exclusively, so it waits for a record in flight and a later record sees the lowered level.
   E2E scenario I. Not covered by this lock: edits of the organization ceiling, the tier-cap table (migration only)
   and the template cap.
3. An approved draft for the same step and key authorized any row, not the draft's own content. Below
   `act_and_report` the row must now name that draft (`draft_id`); WF-07's draft guard then checks the content equals
   the draft.
4. The write gate applied the agent ceiling to every write, so a retired agent, or one whose tier cap was lowered, could
   not be lowered and a regression aborted and lost its evidence. The ceiling now limits a rise only.
5. A run with no agent of its own takes the template's agent and cap, and the service role can update `wf_template`. A
   template that any run uses can no longer change its agent or raise its cap (lowering stays allowed). Before the
   first run uses it, a template is still configuration.
6. The trust model understated the service role: it can insert an active `super_admins` row (see above). Reworded;
   not changed in SQL.
7. Evidence recorded later as a regression with the same evaluation time now supersedes the good evidence. The check
   runs last, so bad evidence is still reported as bad. Evidence that is merely recorded later, or evaluated earlier,
   does not supersede.
8. `wf_agent_autonomy` has a BEFORE TRUNCATE trigger like the history tables.
9. The rollback header says how to remove history deliberately (disable the append-only triggers first).

Noted, not changed: the executed-record guard ignores an AIN-01 pause, so a step already at `act_and_report` can still
record a result after the agent is paused (a pause stops new steps); a replayed insert after a demotion now fails with
`42501` instead of conflicting quietly (the dispatcher checks the recorded outcome first).

## Ceilings (engineering defaults for the founder to ratify)

| Agent tier   | Highest level       | Why                                                                     |
| ------------ | ------------------- | ----------------------------------------------------------------------- |
| executive    | `act_with_approval` | Executive agents answer to the sheriff; they never act without a person |
| department   | `act_and_report`    | Only for the four plain classes; the six capped classes stay at `draft` |
| assurance    | `draft`             | Assurance agents check others; they do not act                          |
| organization | `act_and_report`    | Subject to the plan and the add-on state of AIN-01                      |

## Assumptions (open)

- The ceiling table above, the 30-day evidence window and "evidence promotes once" are engineering defaults.
- Evidence is per agent, not per organization or per capability.
- The founder decision 9 text is implemented as: only an active super admin promotes.

## Accepted limitations and follow-ups

- Promotion trusts the identity the server passes, exactly as WF-07 does. There is no passkey step-up on promotion
  (follow-up); the service role is the only caller.
- Pausing an agent does not reset its earned level (follow-up: decide whether a pause should).
- `wf_agent_registry_get` still displays the raw earned level, not the ceiling-bounded one.
- The action-type maximum is not restated in SQL; the dispatcher still applies it.
- The evaluation runner that produces evidence does not exist yet. Evidence arrives through
  `wf_autonomy_record_evidence`; nothing here calls a model.
- A promotion needs the agent to be usable in the organization (AIN-01 state): an organization agent without add-on
  state cannot be promoted.

## Consequences

- No client can set an earned level. Harnesses and e2e fixtures that seeded one now switch the gate off for that one
  statement as the database owner and back on straight after (fixture only; no assertion weakened).
- WF-03's pinned privilege assertion on `wf_agent_autonomy` changed from "service role can update" to "SELECT only".
- Test fixtures that insert steps needing an executed record mark them executable through a fixture function.
- The rollback refuses while the ledger or the evidence table holds a row, and leaves every earned level as is.
