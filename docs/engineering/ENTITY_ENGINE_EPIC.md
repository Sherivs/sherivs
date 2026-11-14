# Entity Engine epic (ENGINE)

Status: in progress (draft pull requests only; nothing merged, applied or deployed).
Owner: Sherivs founder (the "sheriff"). Opened 2026-11-14.

## Goal

One engine that builds, for every person, a digital twin and an AI agent from the
person's roles, and a governed executive (JARVIS) that coordinates the human and
AI workforce. Everything is built inside Sherivs; outside services sit behind
Sherivs adapters with an exit plan.

## Principles (decisions of 2026-11-14)

1. The twin and agent belong to the PERSON, not the organization. Each membership
   is an isolated context of that one twin (ADR-077).
2. They are created automatically when a membership becomes active, including
   internal staff, never at invitation (no verified identity or consent yet).
3. Roles are declarative, versioned Role Packs; adding a role is publishing a pack
   (ADR-078, ADR-079).
4. Every capability starts in shadow and earns autonomy from evidence, one rung at
   a time. T3 can never be autonomous; T4 is never declarable.
5. "Hermes" becomes **Sherivs Conductor** (ADR-080): the runtime spine under JARVIS.
6. All external systems are reached only through the Tool Broker, which holds
   credentials; agents and models never see them (ADR-081).
7. JARVIS is the executive over agents and humans; its authority is severity
   based and it can never change its own powers (ADR-082).

## Stack

| Mission   | Deliverable                                                                                  | ADR           |
| --------- | -------------------------------------------------------------------------------------------- | ------------- |
| ENGINE-01 | Person Passport, membership contexts, Role Packs, autonomy ladder, tenant and internal packs | 077, 078, 079 |
| ENGINE-02 | Sherivs Conductor (Hermes rename, compatibility-first)                                       | 080           |
| ENGINE-03 | Tool Broker and connector vault contracts                                                    | 081           |
| ENGINE-04 | JARVIS executive authority, severity routing, owner alerts and workforce oversight           | 082           |
| ENGINE-05 | Playbook runner: wake events to governed steps through the broker                            | 083           |
| ENGINE-06 | Connector adapter framework, execution gate, read-only GitHub adapter                        | 084           |
| ENGINE-07 | Per-context agent model loop (draft-only, proposals only)                                    | 085           |
| ENGINE-08 | Restack: runner approval gates through the JARVIS durable approval inbox                     | 086           |

## Operator actions (not done by the agent)

- Approve and apply the migrations (staging first), then run `cg_twin_reconcile()` once to backfill existing members.
- Decide the cutover from `cg_personal_twin` to contexts (follow-up ADR).
- Review the quarantine baseline entry for the new migration with the neutrality owner.
- Counsel review of staff-twin privacy against the Nigeria Data Protection Act 2023.

## Status and what is not built

Built and tested as drafts (nothing applied, merged or deployed): ENGINE-01 to ENGINE-08 above.

Not built, and not claimed:

- A scheduler or durable queue that calls the playbook runner, persistence of run state, and bindings for the tenant and department packs (ENGINE-05 ships the runner and the JARVIS bindings only).
- Persistence and scheduling of agent turns, evaluation of proposal quality, and any model call with live credentials (ENGINE-07 ships a draft-only loop and a gateway-backed port, tested with fakes).
- Connector adapters beyond the read-only GitHub adapter (Slack, email, WhatsApp, SMS, social, payments, CRM, n8n, IAM), any write-capable adapter, and the secret manager behind the vault references (ENGINE-06 ships the gate and the GitHub read adapter only).
- Channel adapters for owner alerts (voice, WhatsApp, SMS), and the owner's consent for live outbound.
- The JARVIS service identity. ENGINE-08 wires the runner's approval gates to the JARVIS inbox and ladder; ENGINE-04 severity routing is not yet connected to the ladder's delivery planner, and the TWIN-03 sleep/wake scheduler is not wired to the runner.
- Console and shell UI for the passport, approval inbox, workforce view and kill switch.
- The `cg_personal_twin` cutover to the person passport (ADR-077).
