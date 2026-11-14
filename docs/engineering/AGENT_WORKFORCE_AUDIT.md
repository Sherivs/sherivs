# Agent Workforce Audit, Recommendation and Upgrade Path

Status: PROPOSED. Date: 2026-11-15. Scope: the internal-console AI agents (seven Role Packs, built in ENGINE-01 to ENGINE-09).
Nothing here is applied, merged or deployed. Targets, thresholds and service levels are starting values for the owner to ratify, not measured performance.

## 1. Audit: what exists

Seven agents have Role Packs: Support, Engineering, Security, Finance, Sales, Operations, and the executive agent JARVIS. Each pack declares capabilities with a tier (T0 observe to T4 never autonomous), an autonomy ceiling, a required permission, a memory ceiling and playbooks. Execution runs through the tool broker, the execution gate, the draft-only model loop, the approval bridge and the alert gates.

## 2. Audit: findings

| #   | Finding                                                                                                                                         | Severity | Resolution                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| 1   | A pack states what an agent may do but not who is accountable for it, who supervises it, or how its quality is judged.                          | High     | Agent Charter v1 (ENGINE-10).                                              |
| 2   | Several T3 capabilities appear in more than one pack (deploy, refund, social post), so two agents could each believe they own the same request. | High     | Roster rule: each T3 capability has exactly one owner (ENGINE-10).         |
| 3   | Nothing requires an evaluation suite before an agent's capability is trusted above observe.                                                     | High     | Charter requires a named suite and pass-rate bar for every T1+ capability. |
| 4   | Eight gated capabilities have no mapping to a JARVIS approval action, so they cannot reach the inbox.                                           | High     | ENGINE-11 (completes the action map, with a coverage guard test).          |
| 5   | No agent independently checks the others; the executive agent supervises and is also supervised only by the owner.                              | Medium   | Assurance tier: read-only, reports to the sheriff only (ENGINE-10).        |
| 6   | Cross-agent handoffs are free text, with no declared targets.                                                                                   | Medium   | Charter handoffs with a work-order kind; the roster checks targets.        |
| 7   | Operators have no per-agent view of permissions, budget, proposals, runs and safety.                                                            | Medium   | Console workforce UI (ENGINE-12).                                          |

## 3. What ENGINE-10 builds

`frontend/src/lib/workforce-charter/charter.ts` defines the charter schema and two validators. A charter grants no authority: it is a reviewable statement that the validators hold to the pack.

Charter rules checked per agent: duties cover exactly the pack's capabilities; T3 rules cover exactly the T3 capabilities; every T1+ capability has an eval suite with a bar of at least 90 percent; the model's context ceiling stays within the pack's memory ceiling; mandatory dashboard panels are present; supervision follows the tier (the executive agent reports to the sheriff, department agents to the executive agent, assurance agents to the sheriff only); only assurance agents may verify; assurance agents cannot originate, act above T1, use external connectors or be paused as a group.

Roster rules checked across agents: unique codes, existing supervisors and handoff targets, no supervision cycle, at most one executive, and exactly one owner for every T3 capability.

`charters/existing-charters.ts` holds the seven charters. The roster check currently reports five handoffs to agents that ENGINE-11 adds (customer success, compliance, revenue assurance, reliability); this is asserted exactly in the tests, so it cannot hide other defects.

## 4. Recommended additional workforce (ENGINE-11, proposed)

| Agent                      | Tier       | Purpose                                                          | Highest tier it may reach      |
| -------------------------- | ---------- | ---------------------------------------------------------------- | ------------------------------ |
| Compliance / DPO           | Department | Personal-data requests, retention, breach assessment (NDPA 2023) | T2, notices only via approval  |
| Reliability / SRE          | Department | Incident command, status, runbooks                               | T2                             |
| Customer success           | Department | Adoption, churn signals, onboarding                              | T2                             |
| FinOps / revenue assurance | Department | Cost, collections, usage anomalies                               | T2, money movement via sheriff |
| Internal audit (Sentinel)  | Assurance  | Independent review of ledgers, approvals and agent behaviour     | T1, read-only                  |
| Knowledge (Archivist)      | Department | Runbooks, decisions, answers with sources                        | T1                             |
| Product intelligence       | Department | Usage and feedback synthesis                                     | T1                             |
| Market intelligence        | Department | Competitor and policy watch for education in Africa              | T1                             |

Each gets a Role Pack, a charter, new platform roles (seed SQL kept under `database/proposals/`, unapplied) and the dashboard panels below. The breach-notification clock and any legal wording need counsel confirmation before they are encoded.

## 5. Per-agent dashboard (ENGINE-12, proposed)

Panels: Charter, Context, Permissions, Autonomy, Budget, Proposals, Runs, Handoffs, SLOs, Safety. The first six plus Safety are mandatory for every agent. A roster view lists agents by tier and supervision line; actions stay disabled until the engine tables are applied.

## 6. Blue-ocean position

Most platforms add an assistant to a product. The proposed position is an institution whose workforce is a governed set of agents with named accountability: every action is tiered, every high-impact action needs a human decision with a passkey, every agent has a published charter and an independent auditor, and every person (parent, teacher, student, staff) has an isolated context. That governance is the product feature that schools, regulators and parents can verify, and it is hard to copy because it is built into the data model and tests, not added as policy text. Market size, pricing and willingness to pay are untested and need customer research before they are claimed.

## 7. Not built

No agent runs on a schedule, no real model call is made, no connector writes anywhere, no migration is applied, and no UI exists yet. Charter service levels have not been measured. Evaluation suites are named, not written; an eval harness is a later mission.
