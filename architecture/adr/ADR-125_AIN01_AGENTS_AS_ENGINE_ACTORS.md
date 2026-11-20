# ADR-125: Agents as Engine Actors: Identity, Capabilities and Budgets (AIN-01)

| Field          | Value                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status         | PROPOSED in the AIN-01 PR; nothing applied to any hosted database                                                                                                                                                                                          |
| Date           | 2026-11-20                                                                                                                                                                                                                                                 |
| Creator        | Claude Code agent, mission AIN-01 (provenance id A-001, issue #472); AI-generated                                                                                                                                                                          |
| Version target | V1 organizational workflows, Phase 2 (AI-native core)                                                                                                                                                                                                      |
| Depends on     | [ADR-088](ADR-088_ENGINE_AGENT_CHARTER_AND_ROSTER.md), [ADR-095](ADR-095_ENGINE_ORGANIZATION_WORKFORCE_AND_PLAN_PACKAGING.md), [ADR-105](ADR-105_WF03_WORKFLOW_RUNTIME_CORE.md), [ADR-124](ADR-124_WF12_QUOTAS_WALLET_CAPS_RETENTION.md) (stacked on #471) |
| Migration      | `database/supabase/migrations/20261117000970_sherivs_ain01_agents_as_engine_actors.sql` (`..000960` is WF-12; `..001000` is used by PRs #448, #461, #462 and #464; the founder confirms the number before apply)                                           |
| Rollback       | `database/supabase/rollbacks/20261117000970_sherivs_ain01_agents_as_engine_actors.sql`                                                                                                                                                                     |

## Provenance

| Item                   | Source                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement            | Issue #472; the AIN-01 roadmap entry ("agents as engine actors: identity, capabilities, budgets from charters and org packs") in the workflow hand-off                                                          |
| Platform workforce     | 25 role packs (`twin-engine/packs/*`) and charters (`workforce-charter/*`, ADR-088); pause state `agent_pause_rules`, `is_agent_paused` (ENGINE-16, applied)                                                    |
| Organization workforce | 17 `org-*` packs (`org-workforce/org-agents.ts`, ADR-095) and the applied add-on state `org_agent_catalog`, `org_agent_addon_events`, `org_agent_state()` (ENGINE-20/22, applied outside the migrations folder) |
| Engine                 | `wf_agent_autonomy`, `wf_autonomy_guard`, `agent_ref` on runs, steps and templates (WF-03); `wf_can`, `wf_act_as`, `wf_audit_append` (WF-01, WF-07)                                                             |
| Open founder decisions | 3 (AI route), 9 (who promotes autonomy); neither is decided here                                                                                                                                                |

## Context

Until now an engine agent was a free-text `agent_ref`. Nothing said whether the name was a real agent, whether
it may act in this organization, what it is allowed to do, or how much. The packs and charters answer those
questions for the 42 agents the product already defines, but only in TypeScript and only for documents. The
engine needs the same answers in the database, where a bug in a runtime, a template or a prompt cannot skip them.

## Decision

1. **One registry, derived from the existing definitions.** `wf_agent` (identity, family, tier, accountable role,
   supervisor, highest capability tier, context ceiling, daily budgets), `wf_agent_capability` and
   `wf_agent_tier_action_class` are seeded from the packs and charters by `engine-actors.ts`. The seed sits in the
   migration between two marker lines; `scripts/ops/generate-ain01-agent-seed.mjs` writes it and a unit test fails
   when the migration and the definitions differ. The identity key is the pack code, which is already the agent
   code used by pause state and by the organization add-ons, so no second naming scheme exists.
2. **Charter rules are constraints, not conventions.** Executive agents answer to the sheriff, assurance agents to
   the sheriff and never above T1, an agent cannot supervise itself, organization agents are never above T2, no
   capability above T1 is autonomous, and a capability cannot exceed its agent's tier. They hold even if a seed
   script is wrong.
3. **Two families, two sources of state, no second switch.**
   - Organization agents (`org-*`): enable, disable, pause and the plan check stay in the add-on state that
     already exists. The step guard reads it; it does not add an enable switch of its own. That state lives in
     objects applied outside the migrations folder, so it is read by name with dynamic SQL; when it is absent,
     or its shape is not the reviewed one, the answer is `org_state_unavailable` and the step is refused.
   - Platform (Sherivs-internal) agents: they may act only inside an organization they are granted to
     (`wf_agent_platform_grant`), and only while not paused (`is_agent_paused`, which already fails closed for an
     agent it does not know). The grant table is empty and has no write path for any client role, so no tenant
     administrator can bring an internal agent into a tenant. The sheriff-gated path to grant one is WF-13.
4. **The step guard.** `wf_step_run_07_agent` (BEFORE INSERT, after the autonomy guard, before the identity guard)
   finds the effective agent the way the autonomy guard does (run, else step, else template) and refuses with a
   stable code, failing closed:
   `agent_unknown`, `agent_not_granted`, `agent_not_enabled`, `agent_paused`, `org_state_unavailable`,
   `class_not_allowed`, `budget_daily_actions`. It writes the effective agent onto the step. It applies to new
   steps only: a pause stops new work and does not strand a step that already exists. A replay of an existing
   idempotency key is neither counted nor refused. A per-organization-and-agent advisory lock serializes the count
   and the insert; a concurrency test (20 connections, budget 5) gets exactly 5. A second trigger,
   `wf_step_run_07_agent_immutable` (BEFORE UPDATE OF `action_class`, `kind`, `agent_ref`), rejects any change to
   those columns of an existing step, so a step classified at insert cannot be reclassified by a plain UPDATE or by
   the update half of `INSERT ... ON CONFLICT (org_id, idempotency_key) DO UPDATE` (review B1; setting a column to
   the value it already has is allowed). The AI tripwire refuses both `kind = 'ai'` and `action_class = 'ai_model'`
   while `wf_ai_route_approved()` is false, for steps with or without an agent, so WF-11 cannot be reached as a
   `kind = 'action'` step.
5. **Capabilities bound action classes.** `wf_agent_tier_action_class` says which engine action classes a tier may
   use: T0 internal and waits; T1 adds tasks, unclassified actions and the reserved `ai_model` class; T2 adds
   communications; T3 adds the six capped classes (money, safeguarding, credentials, publishing, mass messages,
   authority sharing). The autonomy guard still caps those six at draft whatever this table says. Only steps that
   act (`action`, `notify`, `ai`) are classified; conditions, waits and approvals are not. This mapping is an
   engineering default for the founder to ratify.
6. **Budgets.** The daily action budget (rolling 24 hours, counted from the agent's own steps in the organization)
   is enforced now. The model-call and cost budgets are recorded but not enforced: no model call exists to meter
   until WF-11.
7. **Autonomy is untouched (decision 9).** Nothing here writes `wf_agent_autonomy`. An agent with no row stays at
   `suggest`, and registering, granting or enabling an agent cannot change that. The scale, per-step enforcement
   and the promotion gate are AIN-02.
8. **The AI route stays closed (decision 3).** `wf_ai_route_approved()` returns false. While it does, no step of
   kind `ai` can be inserted, for any agent or none. Approving the route is a reviewed migration that replaces
   that function; it does not bypass identity, grant, pause, class or budget checks, which still apply.
9. **Read surface.** `wf_agent_registry_get(actor)` (needs `workflows.view`; `SECURITY DEFINER`, empty
   `search_path`, EXECUTE for the service role only; the person is bound with `wf_act_as` and the organization is
   derived from them) returns the organization agents plus the platform agents granted to that organization, with
   capabilities, budgets, live state and effective autonomy. The registry tables themselves are readable by the
   service role only: the roster of internal agents is not shown to tenants.
10. **Audit.** Platform grants and revocations write `workflow.agent_grant.granted` and `.revoked` through
    `wf_audit_append`.

## Assumptions (open)

- The tier-to-class table, the 24-hour rolling window and treating every step of an agent as one budget action
  are engineering defaults.
- Organization agents carry no charter; their supervisor is null and their accountable role comes from ADR-095.
- The add-on state shape was checked against the reviewed source (`database/proposals/ENGINE-20_...sql`), not
  against production.

## Accepted limitations and follow-ups (review notes)

- A pause blocks new steps only (a step that already exists finishes, retries or is cancelled). Stopping in-flight
  work is a separate, deliberate action (cancel the run).
- `wf_run.agent_ref` can still be changed by the service role. That was true before AIN-01 and is not widened by it;
  the guard resolves the agent from the run first, so a follow-up should freeze the column after the first step.
- The daily budget is per organization and agent (the count and the lock are scoped that way), not a global cap per
  agent across organizations.
- Capability rows (`connector`, `approver`, `requires_permission`, `autonomy_mode`) are informational in this
  slice. Only the tier of the agent drives enforcement; per-capability enforcement is a follow-up.
- Organization add-on state is written by the ENGINE-20 objects, which are applied outside the migrations folder
  and can be written by the service role. AIN-01 reads that state and fails closed; it does not own or harden it.
- A plan downgrade or a removed add-on is read at the next new step; steps already created are not revoked.

## Consequences

- An agent step with an unregistered identity is now refused. Existing harnesses and e2e scripts that made up an
  agent name register a throwaway platform agent first (fixture only; no assertion changed).
- Until the AI route is decided and an organization has enabled an agent, no agent can run in a tenant: platform
  agents have no grant, organization agents have no add-on state in the CI database.
- A refused step inside `wf_create_event_run` fails event processing, so an event for a disabled, paused or
  over-budget agent is retried and eventually dead-lettered, as any failing event is. Deferring instead (as WF-12
  does for the daily run quota) is a follow-up.
- Changing the registry (a new agent, a new tier mapping, a retired agent) is a reviewed migration.
- The rollback refuses while a platform grant exists. It leaves `agent_ref` values on steps as plain text.
