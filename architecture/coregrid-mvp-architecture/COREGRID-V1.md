# CoreGrid V1 — Constitution of the MVP Execution Layer

Status: ACTIVE-V1 architecture under the V5.3 MVP execution profile.
Master directives preserved: V5.1 Parts 0–109, V5.2 Parts 110–141.
Adoption authority: `../COREGRID_V53_DIRECTIVE_RECONCILIATION.json`.

## 1. What CoreGrid V1 is

CoreGrid V1 is an **AI-native organizational operating platform**: a single,
domain-neutral, multi-tenant substrate from which an organization instantiates and
operates its own digital institutional environment — identities, teams, workspaces,
members, customers, entities, records, workflows, applications, automations, AI
workers, communication, transactions, reporting, and audit.

The same substrate supports many organization types through **domain configuration**,
never through hard-coded domain universal concepts (V5.3 Part 46: no
`student_table` as universal infrastructure).

## 2. The V1 golden rule

**DO NOT BUILD FUTURE COMPLEXITY EARLY.** (V5.3 Part 5)

DISCOVER → CLASSIFY → PRESERVE → ASSIGN FUTURE VERSION → FREEZE → DO NOT IMPLEMENT.

## 3. Versioned maturity boundary

| Layer | Status | Contents |
| --- | --- | --- |
| V1 | ACTIVE — build now | Identity, tenancy, organization, entity system, state/events, authorization, workspace runtime, workflow engine, mission system, worker system, intelligence gateway, context, practical memory, ephemeral agent runtime, action/tool execution, evidence/audit, verification, application builder (minimal), website, customer workspace, communication, payments, files, notifications, integrations, metering (minimal), observability (minimal), security, domain configuration |
| V2 | FROZEN — preserve, don't build | Device integration, IoT, sensors, telemetry, connected assets, edge computing, device identity/commands |
| V3 | FROZEN — preserve, don't build | Geospatial, geophysics, geology, mining, satellite, agricultural-satellite, environmental, biological, chemical intelligence, physical digital twins, causal/scientific simulation, planetary intelligence |
| FUTURE-UNASSIGNED | FROZEN — preserve, don't build | Civilization-scale cognition, agent civilizations, autonomous economy, civilization knowledge graph, autonomous engineering self-hosting, universal reality OS kernel, planetary infrastructure, AI compute civilization, human civilization interface |
| RESEARCH / EXPERIMENTAL / HISTORICAL / REJECTED | Classified per artifact | Full vocabulary in the scope lock |

Version targets are machine-enforced in `../registry.json` (`version_target` per phase)
and validated by the V1 scope guard in `scripts/verification/registry-validate.mjs`.

## 4. The V1 vertical slice (Part 62)

```
USER → AUTHENTICATION → ORGANIZATION → ENTITY → WORKSPACE → WORKFLOW
     → AI WORKER → MISSION → CONTEXT → AUTHORIZED ACTION → STATE CHANGE
     → EVIDENCE → VERIFICATION → USER RESULT
```

Evidence state (2026-09-30): the governed tail (mission → authorized action →
state change → evidence → verification, with idempotent replay and rollback) is
**live-verified**. The missing spine is organization binding → workspace
persistence → AI worker identity/delegation → governed context → result surfacing.
See `foundation/COREGRID_V1_MASTER_IMPLEMENTATION_PLAN.json`.

## 5. Runtime laws V1 inherits and enforces

- **MODEL ≠ WORKER, WORKER ≠ AUTHORITY, WORKER ≠ MISSION, WORKER ≠ VERIFICATION.**
- **Agents are ephemeral** (Part 14): definition persists; runtime does not.
- **Jarvis is the executive orchestrator, not a god-agent** (Part 15): coordinate,
  escalate, summarize — never bypass authorization, reveal secrets, or self-authorize.
- **Context cannot grant authority** (Part 26).
- **Worker/agent claims are never verification** (Part 52).
- **No fake data** (Part 54): fixtures are explicitly marked; the platform is real.
- **Adapters, not vendors** (Parts 50–51): every external service sits behind a
  CoreGrid contract.

## 6. Reconciliation duties

- 13 mothers and 7 governance files carry the V1 boundary banner (V5.3 Parts 41–42, 77).
- Phase 52 corpus is classified through the V1 filter
  (`../COREGRID_PHASE_52_V1_FUTURE_CLASSIFICATION.json`); frozen portions are
  preserved under `../future/`, never deleted.
- Future architecture register: `../future/COREGRID_FUTURE_ARCHITECTURE_REGISTER.json`.
