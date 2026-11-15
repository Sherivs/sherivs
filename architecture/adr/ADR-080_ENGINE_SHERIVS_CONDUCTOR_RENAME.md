# ADR-080: Hermes becomes the Sherivs Conductor (compatibility-first rename)

| Field | Value |
|---|---|
| Status | PROPOSED (operator ratification required before deployment) |
| Date | 2026-11-14 |
| Author | Claude Code agent (ENGINE-02 implementation) |
| Creator | Claude Code agent, mission E-001 (issue #n/a) |
| Mission | ENGINE-02 (rename Hermes to the Sherivs Conductor and keep every dependent building) |
| Capabilities | Orchestration runtime (internal); no customer-visible capability change |
| Supersedes-in-part | None (renames the Hermes component named in V1 R4 and SV1-JARVIS-05) |
| Cites | ADR-077, ADR-078, ADR-079 (engine), `docs/engineering/ENTITY_ENGINE_EPIC.md`, V1 R4 observation substrate (`20261003000030_coregrid_hermes_observation_substrate.sql`), SV1-JARVIS-05 routing |
| Minimal ownership artifact | `frontend/src/lib/conductor/*` (moved from `lib/hermes/*`), deprecated re-export shims at `frontend/src/lib/hermes/*`, view `cg_conductor_observation` |

## Context

The owner asked for Hermes to be renamed to Sherivs and for the platform to be built without depending on an external provider's brand. An audit showed Hermes is not a third-party agent: it is a deterministic, in-repo orchestration cycle (classifier, cycle, observation port, event source, memory) of about 2,900 lines with 87 exported identifiers. Its name survives in code identifiers, a few persisted wire values (actor reference, repair mission prefix, idempotency and memory-scope keys), one production table (`cg_hermes_observation`, with RLS, a guard trigger and a V1 apply-record manifest that names it), the JARVIS routing module on another branch, and historical reports.

### Options considered

- **Option 1, rename everything including the table and the applied migration.** Rewrites an applied migration and its manifest, breaks the V1 apply-record hash, and needs a table rename in production. Rejected: high risk for no product value.
- **Option 2, rename code only and leave the legacy path.** Leaves two names for one thing indefinitely. Rejected.
- **Option 3, rename code and wire values, keep the physical table, expose the new name as a read-only view, and leave deprecated re-export shims.** Chosen.

## Decision

**Adopt Option 3.**

- Code moves to `lib/conductor/conductor-*.ts` with every identifier renamed (`HermesFinding` to `ConductorFinding`, `runHermesCycle` to `runConductorCycle`, and so on). Tests move to `tests/unit/conductor/`.
- Persisted wire values change with the name: actor reference `conductor`, repair mission prefix `conductor-repair-`, and the `conductor:` idempotency, scope and approval keys. This is safe only because production holds zero rows in `cg_hermes_observation` and zero in `cg_memory_scope` (checked read-only, 2026-11-14); if that ever stops being true, a data migration must precede deployment.
- The physical table and the applied migration keep their names. Migration `20261110000200` adds the security-invoker, service-role-read-only view `cg_conductor_observation`; the table's RLS and guard trigger still govern it. A physical rename is a separate, owner-approved operation.
- `lib/hermes/*` becomes re-export shims only (legacy names pointing at the Conductor bindings). A test forbids logic in them. They are removed when the JARVIS stack is restacked onto this branch.
- The Conductor is the runtime spine for the person-level twins of ENGINE-01: it observes, classifies and routes; it never executes a T3 or T4 action. JARVIS (ENGINE-04) sits above it as executive.

## Consequences

- Positive: one name, in-repo, no external brand; nothing outside the rename moves; the table, trigger, RLS and manifests are untouched; the rename is reversible by dropping a view and restoring the paths.
- **Limit, JARVIS stack:** `jarvis/hermes-routing.ts` and two JARVIS tests live on another branch. They keep compiling through the shims, but tests that assert the literal strings `hermes` and `hermes-repair-` will need the new values when that stack is restacked.
- **Limit, historical records:** progress reports, simulation results and the V1 apply-record manifest still say Hermes; they are history and are not rewritten.
- **Owner action:** apply the view migration (staging first); decide when to rename the physical table, if ever.

## Verification

- Unit: the moved Hermes suites pass unchanged in substance (88 tests) plus `tests/unit/conductor-rename.test.ts` (4: no Hermes naming left except the table and migration identifiers, Conductor wire values, every shim re-exports the identical binding, shims contain re-exports only).
- Real Postgres: `tests/integration/engine02-conductor-compat.local.sql` (view is security-invoker, closed to anon and authenticated, service-role read-only, row parity with the base table); three mutants (security-invoker removed, authenticated granted SELECT, service role granted INSERT) each fail the harness.
- Static: `tsc` 0 errors on the branch.
- Not verified here: CI on PG17 and the JARVIS stack restack.
