# ADR-050: SV1 Scheduling Uses the Neutral Organization Model and Existing Solver Owner

| Field                      | Value                                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED — owner authorized the narrow V1 scope; production migration apply remains separately gated                                                              |
| Date                       | 2026-11-04                                                                                                                                                        |
| Author                     | Copilot Coding Agent                                                                                                                                              |
| Mission                    | SV1-SCHED S0/S1 (#322)                                                                                                                                            |
| Capabilities               | #227's bounded V1 scheduling slice                                                                                                                                |
| Supersedes-in-part         | None                                                                                                                                                              |
| Cites                      | `docs/v1/V1-SCOPE-LOCK.md:23`; owner scope authorization on #227 (2026-11-01); `architecture/phase-12-scheduling-intelligence.md`; AGENTS.md §§13, 17, 26, 28, 45 |
| Minimal ownership artifact | This ADR and the S1 neutral schedule schema/solver extension                                                                                                      |

## Context

Phase 12 defines a broad scheduling domain, while the repository's V1 execution boundary freezes V2, V3, and future-unassigned capabilities absent explicit authorization. The owner authorized the narrow bell-designer and AI timetable workflow on #227 and recorded that bounded V1 slice in `docs/v1/V1-SCOPE-LOCK.md`; this does not unfreeze all of Phase 12. Issue #322 authorizes only S0/S1, reserves migration block `20261104016000`–`20261104016999`, and assigns ADR-050.

The existing Scholar tables `timetables` and `timetable_slots` are school-scoped, single-class records without version history or forced RLS. Existing `academic_periods` are academic terms, not daily bell periods. The existing scheduling-core has domain models, availability, constraint, validation, conflict, and quality modules, but no deterministic candidate-producing solver. Rewriting the legacy persistence path would couple a neutral V1 contract to its school-specific tenant and role policies; adding a second solver or copying identity, class, subject, or teacher records would violate the Phase 04/12 ownership boundary.

## Options

### Option 1 — Modify the legacy timetable tables in place (rejected)

Add version, bell, and neutral tenant fields directly to the single-class legacy tables and alter their existing RLS/write behavior.

- **Consequences:** preserves one physical timetable store, but the current school-scoped keys, legacy unique constraints, and role policies do not represent neutral organization ownership or schedule-wide versions. Forcing a conversion in S1 risks breaking existing reads/writes and creates a cross-domain authorization migration beyond this issue.

### Option 2 — Create a second scheduling engine and school-specific records (rejected)

Implement a separate solver and duplicate school/class/teacher/subject records beside the existing Phase 12 modules.

- **Consequences:** may appear locally convenient, but splits the authoritative solver owner, duplicates canonical Phase 04 data, and expands V1 scope beyond the owner-authorized workflow.

### Option 3 — Extend the existing Phase 12 core with a neutral versioned data envelope (selected)

Keep the legacy timetable path unchanged in S1. Add neutral, organization-linked scheduling inputs and version/placement records that reference class arms, subjects, and teachers through opaque references. Extend `scheduling-core.ts` with a pure deterministic solver.

- **Consequences:** preserves current application behavior and neutral tenant isolation while enabling versioned scheduling. Until a later bounded API integration, the legacy single-class UI and the new versioned model are not synchronized; S1 does not claim that they are.

## Recommendation (decision)

**Implement only the #322 S0/S1 V1 slice.** New rows use `tenant_id` from the existing neutral membership contract and `org_unit_id` referencing `cg_org_unit`; authenticated clients receive tenant-filtered reads only, service-role code is the sole writer, and all new tables have RLS enabled and forced. Existing class-arm/subject/teacher records remain opaque references; academic terms remain owned by the existing academic-period model. The solver extends the existing scheduling core, applies its named hard constraints before scoring soft preferences, returns an explanation for every placement and unplaced lesson, and never reports an unplaceable lesson as a placement. A draft can be published only when all configured weekly lessons are placed; published versions and placements are immutable. The migration is authored with rollback but is not applied to any database.

### Explicit residual risk

- **The residual risk:** this deterministic greedy solver is not an exhaustive infeasibility prover and does not yet produce a global optimum. Its `unplaced` output explains conflicts in the current construction; it must not be interpreted as proof that no feasible schedule exists.
- **The sharpest instance:** highly constrained schedules where one early feasible assignment blocks a combination that would have allowed more later lessons.
- **The accepted rationale:** this issue requires a deterministic, seedable core and honest placement/unplaced explanations with zero hard violations; background optimization, alternative scenarios, and UI integration are later work.
- **Owner of the residual risk:** Phase 12 / #227; S2–S5 must retain independent validation and may add improving search without weakening hard constraints or the neutral tenant boundary.

## Consequences

- **Positive:** creates a forced-RLS neutral schema for bells/periods, rooms, teaching loads, availability, qualifications, hard/soft constraints, and versioned timetables; uniqueness and publish guards preserve core feasibility invariants.
- **Negative / obligations:** future server APIs must resolve tenant and organization scope server-side, authorize and audit every mutation, and connect only canonical educational records. The migration must remain unapplied until separately approved.
- **For the program:** this is V1 organizational scheduling only. The broader Phase 12 phase classification is unchanged; device/IoT, Twin/Reality Intelligence, broad simulation, and unrequested capabilities remain deferred.

## Golden Questions

- **WHO?** Phase 12 owns scheduling semantics; Phase 03 owns tenancy; Phase 04 owns class/subject reality; Phase 08 owns authorization. The human owner rules any production apply.
- **WHAT?** S1 extends the existing scheduling core and neutral V1 tenant substrate instead of replacing legacy timetable behavior or adding a second engine.
- **WHERE?** Solver: `frontend/src/lib/scheduling-core.ts`; model and rollback: migration block `20261104016000`–`20261104016999`; evidence: S0 matrix and focused unit/local SQL tests.
- **WHY?** Existing generic models and legacy tables do not provide a tenant-neutral persisted versioned timetable or deterministic solver.
- **UNDER WHICH POLICY?** AGENTS.md §§13, 17, 26, 28, 45; the owner-authorized narrow #227 slice in `docs/v1/V1-SCOPE-LOCK.md`; Phase 12 specification and its stated domain boundaries.

## UNKNOWNs

- The owner has not authorized applying the migration to production; this ADR and its SQL are authored artifacts only.
- The legacy timetable UI/API is not integrated with the new versioned model in S1; S2+ must define the adapter and preserve existing behavior.
- Production job execution, approval workflow, communications, offline views, and exam scheduling remain outside #322 and require their own bounded implementation evidence.
