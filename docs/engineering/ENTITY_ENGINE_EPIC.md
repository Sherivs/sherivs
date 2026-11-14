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
| ENGINE-02 | Sherivs Conductor (Hermes rename) and the runtime spine contracts                            | 080           |
| ENGINE-03 | Tool Broker and connector vault contracts                                                    | 081           |
| ENGINE-04 | JARVIS executive authority, escalation and oversight                                         | 082           |

## Operator actions (not done by the agent)

- Approve and apply the migrations (staging first), then run `cg_twin_reconcile()` once to backfill existing members.
- Decide the cutover from `cg_personal_twin` to contexts (follow-up ADR).
- Review the quarantine baseline entry for the new migration with the neutrality owner.
- Counsel review of staff-twin privacy against the Nigeria Data Protection Act 2023.
