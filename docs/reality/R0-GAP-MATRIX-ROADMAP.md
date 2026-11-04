# SV1-REALITY R0 — gap matrix and proposed roadmap

**Version target:** R0 audit/design only. No migration, runtime change, or production operation is authorized by this document. R1–R10 require Muhammad's written approval on [issue #229](https://github.com/vibeoraai-bit/coregrid-scholar-migration/issues/229). Existing-source evidence and the reuse map are in [R0-REUSE-MAP.md](R0-REUSE-MAP.md).

## Status semantics

- **B — built (bounded):** a current repository building block and focused tests exist for the narrow behavior. This is not a claim that the full issue scenario is complete.
- **P — partial:** a related reusable primitive exists, but an integrated path, institution-specific coverage, or security/evidence behavior is incomplete or unproven.
- **M — missing:** the audit found no implemented institution-specific workflow for the stated need; a generic primitive alone does not count as built.
- **V2 — frozen overlay:** physical-device/IoT, sensor-derived reality, or physical Reality Intelligence. V2 is frozen under [`AGENTS.md` §45](../../AGENTS.md#45-v1-execution-boundary), not authorized by this R0.

The matrix is a source review of the current `master` tree, not an implementation, test, deployment, or production verification report. The broad domain foundations are cited in the [reuse map](R0-REUSE-MAP.md#domain-reuse-map). Template evidence for religious/Islamic, agricultural, vocational/technical, boarding, double-shift, and multi-campus profiles is [`scholar-school-templates.ts`](https://github.com/vibeoraai-bit/coregrid-scholar-migration/blob/master/frontend/src/lib/runtime/scholar-school-templates.ts); it is a feature/template catalog, not proof of end-to-end institutional workflows. Missing cells denote a missing *specific workflow*, not a claim that no related code exists.

## Institution-by-domain gap matrix

Columns are **identity**, **org topology**, **academic topology**, **temporal**, **human**, **teaching assignments**, **assessment/grading**, **finance**, **operations**, **governance/external bodies**, and the excluded **V2 physical-reality overlay**, respectively.

| Institution type | Identity | Org topology | Academic topology | Temporal | Human | Teaching assignments | Assessment / grading | Finance | Operations | Governance / external bodies | Physical reality (V2 overlay) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Creche / early years | B | P | P | P | P | P | M | B | P | M | V2 |
| Primary | B | P | P | P | P | P | B | B | P | P | V2 |
| Junior secondary (JSS) | B | P | P | P | P | P | B | B | P | B | V2 |
| Senior secondary (SSS) | B | P | P | P | P | P | B | B | P | B | V2 |
| University | B | P | P | P | P | P | B | B | P | P | V2 |
| Polytechnic | B | P | P | P | P | P | P | B | P | P | V2 |
| College of education | B | P | P | P | P | M | P | B | P | M | V2 |
| Nursing institution | B | P | P | M | P | M | P | B | M | M | V2 |
| Other health institution | B | P | P | M | P | M | P | B | M | M | V2 |
| Agriculture institution | B | P | P | P | P | P | P | B | M | P | V2 |
| Islamic institution | B | P | P | P | P | P | P | B | P | P | V2 |
| Special-needs institution | B | P | P | P | P | P | P | B | M | P | V2 |
| Multi-institution group | B | P | P | P | P | P | P | P | P | P | V2 |

### Matrix notes

1. `B` for identity is limited to current users/organization membership and the universal identity substrate; it does not assert a completed group-to-institution identity resolution path. `B` for finance is limited to fee/payment/ledger building blocks, not a fully configurable institution manifest.
2. `B` for primary/JSS/SSS assessment reflects the existing grades and exam substrate; `B` for university reflects the existing tertiary CGPA, degree-band and standing rules. Both still need R1's shared versioned assessment configuration and full scenario tests.
3. The explicit Islamic/religious template and curriculum feature demonstrate a reusable curriculum option, but do not by themselves establish complete Islamic academic topology; that cell remains partial.
4. The creche/early-years assessment gap is formative-development workflow; the CoE and nursing/health assignment gaps are practicum/clinical placement workflows; the nursing/health temporal and operations gaps are rotation/resource workflows; the agriculture operations gap is farm-operation/resource scheduling; and the special-needs operations gap is accommodations/access-resource workflow. Related generic code does not close these gaps. R1 must confirm these domain assumptions with the owner before converting them into implementation requirements.
5. **V2 overlay column (all institution types):** device/IoT telemetry, sensor-backed physical-state assertions, physical twins, and V3-style physical Reality Intelligence remain frozen. They are intentionally not used as evidence to mark a V1 domain cell built.

## Proposed DB changes (R0 design only)

No DDL is authored or authorized here. If R1+ is approved, prefer extending the kernel and existing domain owners rather than adding parallel organization, identity, HR, role, workspace, website, scheduling, twin, finance, or academic stores.

1. **Reuse `cg_entity` for versioned Reality manifests.** Extend the current `scholar.institution.operating_model` entity contract and its namespaced `attributes` with schema version, manifest version, and separate `discovered` / `approved` / `operational` status. Keep the kernel row `state` as the record lifecycle, rather than overloading it with these three domain states. Retain `valid_from`/`valid_to`, source/evidence references, and the existing `superseded_by` history chain. Do not create another manifest table. Current entity and version-chain evidence: [`20260903000000_coregrid_universal_kernel_substrate.sql`](https://github.com/vibeoraai-bit/coregrid-scholar-migration/blob/master/database/supabase/migrations/20260903000000_coregrid_universal_kernel_substrate.sql) and [`scholar-institution-config.functions.ts`](https://github.com/vibeoraai-bit/coregrid-scholar-migration/blob/master/frontend/src/lib/runtime/scholar/scholar-institution-config.functions.ts).
2. **Reuse `cg_relationship` for typed topology and dependencies.** Add only reviewed Scholar relation types to the existing runtime ontology. Carry effective dates and the same tenant scope on each edge. Before introducing composite endpoint constraints, audit and reconcile existing rows; require source and target entities to share the same tenant so cross-tenant graph edges cannot be formed. Current graph projection validates declared ontology relations in [`structure-graph.ts`](https://github.com/vibeoraai-bit/coregrid-scholar-migration/blob/master/frontend/src/lib/scholar/structure-graph.ts); the shared relationship table is defined in the kernel migration above.
3. **Reuse `cg_observation` for discovery evidence.** Preserve the kernel distinction among `observed`, `reported`, `inferred`, `predicted`, and `simulated`; add a separate domain-level resolution classification (`confirmed`, `inferred`, `unknown`, `conflicting`, `pending`) to the Scholar observation contract rather than treating those vocabularies as interchangeable. Link evidence and actor/source provenance. Do not let inference overwrite canonical truth. The existing observation types and evidence references are defined in the kernel migration above and exercised by [`runtime-scholar-reality.test.ts`](https://github.com/vibeoraai-bit/coregrid-scholar-migration/blob/master/tests/unit/runtime-scholar-reality.test.ts).
4. **Reuse `cg_event` for transitions and audit.** Record manifest publication, approval, activation, rejection, and supersession with actor, tenant, event version, idempotency key and reason. Keep mutation/approval behavior server-side and idempotent; use the existing audited operating-model publisher as the starting point.
5. **Tenant key and RLS are mandatory design gates.** Use the server-resolved neutral `tenant_id`/organization scope (the existing kernel uses `text` tenant identifiers), never client-supplied tenant context or new `school_id` columns for the Reality extension. Every scoped read/write must also check tenant ownership in backend code. Any approved follow-on must explicitly set `ENABLE ROW LEVEL SECURITY` **and `FORCE ROW LEVEL SECURITY`** on all affected tenant-bearing tables, implement deny-by-default policies, restrict grants, test member/owner/bypass behavior, and prevent cross-tenant graph traversal. Do not infer this is already true for `cg_entity`, `cg_relationship`, `cg_observation`, or `cg_event`: their base migration enables RLS and revokes direct `anon`/`authenticated` access but does not declare `FORCE`. Existing admin/service-role paths still need backend tenant checks because privileged roles can bypass RLS.
6. **No duplicate capability owners.** Academic periods and grades continue to use their existing tables; workforce and role assignments remain under HR/#196; workspace, site publication, scheduling, and twins remain under #207/#135/#227/#223. A Reality manifest describes configuration and dependencies and references those owner records; it does not become an alternative source of truth.

Any eventual migration proposal must include a data audit/backfill plan, constraints and indexes, forced-RLS policies, tenant-isolation and bypass tests, immutable audit/history behavior, rollback, and deployment authorization. None of that is performed in R0.

## Dependencies and sequencing

| Dependency | Why it blocks or constrains later work | Existing owner / evidence |
|---|---|---|
| Canonical tenant identity and neutral org resolution | Every stored manifest, observation and edge must be scoped from authenticated server context; group traversal must not create tenant crossing. | `cg_tenant`, `cg_identity`, `cg_org_unit`, and `organization_memberships`; see the identity and topology rows in the [reuse map](R0-REUSE-MAP.md#domain-reuse-map). |
| Stable educational taxonomy and ontology | Topology, discovery questions, validators, relation types, and scenario test fixtures need one domain vocabulary. Avoid baking Scholar terms into the universal kernel. | Kernel-neutral `cg_entity`/`cg_relationship`; Scholar ontology adapter and graph projection in [`scholar-reality.ts`](https://github.com/vibeoraai-bit/coregrid-scholar-migration/blob/master/frontend/src/lib/runtime/scholar-reality.ts) and [`structure-graph.ts`](https://github.com/vibeoraai-bit/coregrid-scholar-migration/blob/master/frontend/src/lib/scholar/structure-graph.ts). |
| Role and responsibility authorization (#196) | Reality approvals, HR context, and writes need existing effective role/responsibility/permission decisions; roles are not responsibilities or workspace layouts. | [`20261101000010_sherivs_m009_a1_role_responsibility_engine.sql`](https://github.com/vibeoraai-bit/coregrid-scholar-migration/blob/master/database/supabase/migrations/20261101000010_sherivs_m009_a1_role_responsibility_engine.sql), [`m009-a1-role-engine.test.ts`](https://github.com/vibeoraai-bit/coregrid-scholar-migration/blob/master/tests/unit/m009-a1-role-engine.test.ts). |
| Workspace shell (#207) | Approved configuration may project to workspace surfaces, but workspace membership/layout remains owned by the existing shell. | [`20261025100210_sherivs_ux1_workspace_manifest.sql`](https://github.com/vibeoraai-bit/coregrid-scholar-migration/blob/master/database/supabase/migrations/20261025100210_sherivs_ux1_workspace_manifest.sql). |
| Scheduling (#227) | Timetable, availability, shift and teaching-resource conflict behaviors must extend the authorized scheduling epic, not fork it. | Existing period/shift/timetable sources in the [reuse map](R0-REUSE-MAP.md#domain-reuse-map); phase R7 is dependent on #227 approval/contract. |
| Existing finance and operational services | Manifests may declare choices or links; existing ledgers and operational records retain transaction and inventory truth. | `cg_fee_*`, transport, hostel, facility and other records cited in the [reuse map](R0-REUSE-MAP.md#domain-reuse-map). |
| Evidence, temporal model and RLS | Conflicting answers, effective dates, history, retries, and tenant isolation must be enforceable and testable before mutations or AI-assisted extraction. | Kernel primitives and existing config governance tests in [`scholar-reality-governance.test.ts`](https://github.com/vibeoraai-bit/coregrid-scholar-migration/blob/master/tests/unit/scholar-reality-governance.test.ts). |
| Human approval and phase authorization | Simulation and AI proposals must not become operational truth; R1+ is separately gated by written owner approval. | Current version boundary in [`AGENTS.md` §45](../../AGENTS.md#45-v1-execution-boundary) and issue #229. |

## R1–R10 phased plan

Estimates are rough **person-day engineering sizes**, not commitments. They assume the R0 audit is reviewed, prerequisite contracts are available, and each phase is separately authorized. They exclude unfreezing V2/V3 and production rollout work.

| Phase | Scope / completion evidence | Size | Key dependencies | Principal risks |
|---|---|---:|---|---|
| **R1 — Taxonomy and definitions** | Confirm domain taxonomy, typed entities/relationships, question metadata, confidence/evidence shape, institution profiles, state transitions and ownership contracts. Deliver reviewed schemas/contracts and representative unit tests; do not add duplicate storage. | M (5–10 d) | Explicit R1 approval; identity/org key; #196 contracts | Ontology churn; conflating domain status with canonical truth; taxonomy overfitting. |
| **R2 — Reality graph** | Extend existing graph projection with temporal edges, tenant-safe validation, dependency resolution and impact analysis; add graph invariants and isolation tests. | L (10–20 d) | R1; RLS design; canonical tenant resolver | Cross-tenant edges; cycles/ambiguous ownership; unbounded traversal. |
| **R3 — Adaptive discovery** | Branching question registry, save/resume, confidence and contradiction handling, evidence capture, and natural-language extraction only as untrusted proposals. | L (10–20 d) | R1/R2; privacy/data minimization | Inference mistaken for fact; sensitive-data overcollection; resumptions leaking tenant context. |
| **R4 — Blueprint review and approval** | Build on current operating-model entity/version chain for diff, validation, preview, visual review and human approval; keep discovered, approved and operational distinct. | M–L (8–15 d) | R1–R3; #196 authorization | Approval bypass; stale preview; version history or tenant mismatch. |
| **R5 — Simulation and transactional implementation** | Deterministic simulation and idempotent, transactional apply/reconcile/rollback with append-only audit and repeat-run tests; simulation cannot mutate production. | L (12–22 d) | R1–R4; forced-RLS and audit tests | Partial writes; replay; irreversible effects; privileged service-role bypass. |
| **R6 — HR/workforce intelligence** | Extend existing HR and #196 role/responsibility/workspace behavior with context-specific staffing proposals and authorized provisioning; never add a parallel role or HR engine. | L (10–18 d) | R1–R5; #196 and #207 | Permission escalation; effective-date gaps; duplicate identity/position records. |
| **R7 — Teaching/resource conflict engine** | Integrate cross-campus teacher, timetable, room/resource and placement constraints into #227 scheduling, including shift and institution-specific resource constraints. | L (12–20 d) | R1/R2/R4/R5; #227 | Schedule inconsistency; conflicting resource ownership; scope creep into V2 physical telemetry. |
| **R8 — Evolution/change proposals** | Compare observed/reported evidence with approved configuration; propose versioned changes, explain uncertainty and require policy/human approval. | M–L (8–16 d) | R1–R5; evidence and audit | Feedback loop promotes inference into fact; historical result rewritten; alert fatigue. |
| **R9 — Website synchronization** | Publish only approved, permitted configuration to existing #135 website/catalog surfaces, with provenance and no website-as-source-of-truth behavior. | M (5–10 d) | R4/R5; #135 publication contracts | Public disclosure of restricted data; stale or unapproved content; duplicate catalog state. |
| **R10 — Twin assistant context** | Supply a minimized, tenant-authorized read-only context to the #223 personal twin; recommendations remain proposals and sensitive actions require existing approvals. | M (5–10 d) | R4–R8; #223; AI/privacy gateway | Context leakage; unauthorized retrieval; AI output treated as canonical truth. |

### Cross-phase release gates

- Each phase requires written owner approval before implementation; this R0 report itself authorizes no R1–R10 work.
- Each phase must include unit/integration and failure tests appropriate to its surface. Security tests must prove tenant A cannot read/write tenant B, including graph traversal, retries, service-role routes, and archived/revoked access.
- Every answer/observation retains provenance and an explicit truth status. Contradictions stay visible until authorized resolution. Historical versions and prior computed outcomes are not rewritten.
- R5 simulation and repeated execution must be idempotent and recoverable. Any live data mutation requires separate deployment authorization and rollback evidence.
- Physical device/IoT, physical twin and V3 Reality Intelligence remain excluded unless separately unfrozen by an explicit human record.

## Acceptance scenarios A–L to phases

These letters follow the order of the twelve scenarios in issue #229. A phase assignment is a proposed satisfaction map, not a claim that a scenario is currently implemented or tested. Each scenario's end-to-end acceptance would also require the R5 mutation/rollback tests when it changes live configuration.

| Scenario | Required behavior | Planned phases that contribute | Additional acceptance gates |
|---|---|---|---|
| **A — Single-campus primary** | Discover and approve a basic primary hierarchy; validate a single campus and preserve the original version. | R1–R5 | Tenant isolation, conflicting answers, repeated apply, historical version retained. |
| **B — Two-shift primary** | Represent and validate both shifts, time windows, enrolment and resource constraints without conflating shift with role/workspace. | R1–R5, R7 | Overlap/conflict rejection; prior approved schedule remains available. |
| **C — Mixed JSS with separate SSS** | Represent distinct junior/senior levels/programmes and applicable examination rules. | R1–R5 | Typed boundary validation; per-level assessment mapping; history preserved. |
| **D — Three-campus group** | Model a group/institution/campus graph and scope configuration per tenant and campus. | R1–R6 | Same-tenant edge constraints; no cross-tenant graph traversal; role scope checks. |
| **E — Cross-campus teachers** | Propose effective-dated assignments across campuses and resolve workload/timetable conflicts. | R1–R7 | Existing #196 authorization; schedule conflict tests; no duplicate staff identity. |
| **F — Boarding school** | Configure boarding/residential modes and validate dependencies against existing hostel/operations records. | R1–R5, R7 | Do not infer capacity or resident status; tenant-bound hostel references; audit changes. |
| **G — University with CGPA** | Bind a configured programme/semester model to existing published-grade and CGPA rules without rewriting historical results. | R1–R5, R8 | Versioned scale/degree rules; published outcomes immutable; regression against existing CGPA behavior. |
| **H — Polytechnic with SIWES** | Represent programmes, prerequisites and placements, linking to existing SIWES/workflow owners. | R1–R5, R7, R8 | Validate placement dates and authority; protect learner/employer information. |
| **I — College of education with teaching practice** | Model school/practicum placements, mentors, periods and workload; detect incompatible assignments. | R1–R5, R7 | Effective-dated placement approvals; no unsupported assumptions about external partner authority. |
| **J — Nursing college with clinical rotations** | Model rotation blocks, clinical placements, supervisors and capacity as configuration/resource dependencies. | R1–R5, R7, R8 | Health/learner data minimization; validated authority; no sensor/device behavior (V2). |
| **K — Agriculture college with farms** | Represent farm/practical-learning resources and teaching schedules; link to existing facilities without asserting live physical state. | R1–R5, R7, R8 | Explicit evidence and human confirmation; farm telemetry/physical twin remains V2. |
| **L — Multi-institution group** | Configure multiple institution profiles under one tenant/group with scoped policies, separate histories and no data mixing. | R1–R6, with R7 where shared scheduling applies | Cross-tenant denial; per-institution permissions; repeatable apply/rollback; immutable histories. |

**Cross-cutting issue #229 checks:** contradictory answers and explicit truth classification are R1/R3/R4; cross-tenant attempts are R2 and every phase's security suite; repeated implementation and rollback are R5; historical preservation is R1/R4/R5/R8. These checks are mandatory across A–L rather than standalone alternatives to the scenarios.

## R0 validation record

- Scope is documentation-only; no schema, runtime, or production files are changed.
- Repository file links in the reuse map point to `master`; the source tree is evidence of code presence only, not a claim of CI or production status.
- Suggested change for any future implementation PR: include its exact authorized phase, migration/RLS tests, unit/integration results, security review, rollback plan, and deployment evidence.
