# COREGRID V1 BUILD ROADMAP

Authority: CTO DIRECTIVE (Parts 8/10/18/19/35) + V1 scope lock (`reconstruction/COREGRID_V1_V2_SCOPE_LOCK.json` — SCOPE_LOCKED_WITH_RECORDED_CONDITIONS).
Mandate: we build from the ACTUAL CoreGrid foundation — the universal substrate that makes CoreGrid work — in strict dependency order. We do NOT start at phase 01 (legacy CI/standards material) and we do NOT invent something else. Every stage below is grounded in the reconstructed capability graph (93 V1 capabilities) and the 50-mission graph (13 teams).

## The principle

COREGRID FOUNDATION FIRST:

```
IDENTITY/AUTHORITY (who can act, in which tenant, with which neutral role)
   -> REALITY KERNEL (entities, events, observations, envelope, type gate)
   -> EVENT/TEMPORAL FABRIC (ordering, causation, idempotency)
   -> EVIDENCE + VERIFICATION (what happened, was it correct)
   -> MISSION + DELEGATION SPINE (objective -> tasks -> governed workers)
   -> WORKFORCE (persistent definitions, ephemeral runtimes)
   -> CONTEXT (governed, permission-bound)
   -> INTELLIGENCE (gateway, metered, fail-closed)
   -> MEMORY (durable, authorization-gated)
   -> OUTCOME/OBSERVATION CLOSURE (command centre: loop closes)
```

The completeness loop (CTO Part 9) is the acceptance test for the whole roadmap:
Reality -> Observation -> Representation -> Context -> Intelligence -> Decision -> Mission -> Delegation -> Worker Execution -> Action -> State Change -> Evidence -> Verification -> Outcome -> Memory -> Observation.

## Already standing (reused, never rebuilt — STREAM H verified foundations)

- Kernel substrate `cg_entity/cg_relationship/cg_event/cg_observation` — live, domain-neutral, CI-purity-enforced
- Identity/tenancy L2 (`cg_identity`/`cg_tenant`) + authorization stack (`cg_role_assignment`/`cg_role_grant`, capability gates)
- Foundation mission loop — the ONLY live-verified governed tail (5/5 on dev, idempotent replay, rollback)
- V1 contract layer built overnight: org model, workspace persistence (APPLIED), payments, files, notifications, workflow engine, agent runtime, Jarvis, context assembly, metering, observability, Dockerfile + release pipeline

## Stage 1 — FOUNDATION SPINE (wave 1 + critical path; zero credentials)

Dependency-correct build order (from `graph.criticalPath`), NOT phase order:

| # | Mission | Team | Capability | Deliverable |
| --- | --- | --- | --- | --- |
| 1.1 | MISSION-R-20 | Identity | V1CAP-013 | Neutral tenant-membership DB primitives (`get_my_tenant_id()` + tenant-admin predicate), re-point every universal RPC gate off Scholar helpers |
| 1.2 | MISSION-R-21 | Identity | V1CAP-014 | Neutral universal role vocabulary (ACTOR..SYSTEM) + directional domain mapping; capability gate off AppRole |
| 1.3 | MISSION-R-100 | Data | V1CAP-072 | Substrate applied to canonical DB + environment state truth (BLOCKED — SECRET REQUIRED until you share keys; authoring/rehearsal proceeds) |
| 1.4 | MISSION-R-01/02/03 | Architecture | V1CAP-046/034/013/022 | Ratification dossiers + ADR bundle (mission owner, memory owner, tenant_id type, trust wiring, shell, retention-vs-immutability) |
| 1.5 | MISSION-R-50 | Mission | V1CAP-046/047 | Mission/Delegation contracts (per CTO RULING-3 chain) |
| 1.6 | MISSION-R-40 | Workforce | V1CAP-048 | Persistent governed worker definitions (identity/authority/history durable; runtime ephemeral) |
| 1.7 | MISSION-R-32 | Intelligence | V1CAP-027 | First live governed inference (BLOCKED on BLK-2; fail-closed proof + dry-run harness now) |
| 1.8 | MISSION-R-36 | Memory | V1CAP-035 | Persisted, authorization-gated memory store |
| 1.9 | MISSION-R-10/11/15 | Kernel | V1CAP-002/003/042 | Canonical envelope, type-allowlist gate, event kernel semantics |
| 1.10 | MISSION-R-81/90 | Assurance | V1CAP-044/059 | Per-event security contract; evidence-class capture discipline |
| 1.11 | MISSION-R-110 | Experience | V1CAP-089 | Command centre — Outcome -> Observation closure |
| 1.12 | MISSION-R-05/04/22/80/30 | parallel | guard rails | Neutrality CI guard, registry reconciliation, identity lifecycle proofs, authorization exhaustive suite, context completeness |

## Stage 2 — HORIZONTAL BUILD-OUT (wave 2: 15 missions)

Bi-temporal reality, memory/knowledge depth, worker substrate completion, idempotency/leases, adapter failure semantics, financial reconciliation, credential broker, evidence-class capture, RLS battery authoring, failure/SLOs, shell under ruled ownership, domain-runtime recertification (Scholar WITHOUT contaminating the substrate).

## Stage 3 — PRODUCTION LEGITIMACY (wave 3: 21 missions)

Migration apply to canonical DB (needs your keys), backup/restore drills, command centre, module relocation, security hardening bundle, threat mitigations L-T-001..014, cost metering breadth, data lifecycle (retention/erasure-vs-immutability), operational runbooks.

## Stage 4 — LIVE VALIDATION (wave 4: 2 missions + gates)

Live governed inference (BLK-2), first real deploy (BLK-3), full live battery: RLS isolation, foundation loop, launch criteria (Part 74, 18 criteria), then V1 RELEASE.

## Credential gates (BLOCKED — SECRET REQUIRED; nothing bypassed)

| Gate | Blocks | Fallback running now |
| --- | --- | --- |
| OPS-1 `DATABASE_URL` + CA | canonical apply, secure-TLS proof | posture records, rehearsal scripts |
| BLK-1 Supabase prod | production migrations | dev-verified everything |
| BLK-2 AI key | live inference | fail-closed proofs + dry-run harness |
| BLK-3 deploy creds | serving URL, 10 Oct date | release rehearsal to human gate |
| BLK-4/5 payments/email | live rails | fail-closed contracts, never faked |

## Rules of the road (binding)

1. Wave 1 runs at max safe concurrency 10 (graph honesty record); kernel one-writer rule; registry single-writer.
2. Every mission reports "reached verified state Y with evidence Z" — never "agent finished".
3. Shared contracts change only via PROPOSE -> IMPACT -> DEPENDENCY -> AUTHORITY -> APPROVAL -> IMPLEMENT -> VERIFY.
4. Migrations are AUTHORED NOT APPLIED unless you authorize (Part 30 precedent).
5. No new V1 capability enters casually (freeze rule, 8-part entry bar).
