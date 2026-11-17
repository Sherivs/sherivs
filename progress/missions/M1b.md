# Mission M1b: Quarantine speculative library modules

Authority: SHERIVS MASTER EXECUTION PROMPT v1.0 (16 Nov 2026), §4.3 "Speculative modules" and §12.1 M1; founder decision "quarantine, do not delete".
Origin: Claude Code agent, mission E-005 (M1b quarantine speculative modules)
Creator: Claude Code agent
Created: 2026-11-17

Status: IMPLEMENTED and TESTED on branch `mission/M1b-quarantine-modules`; not merged. No migration, no ADR.

## Objective

Move speculative modules in `frontend/src/lib` that no route, component or server entry can reach
into `frontend/src/lib/_quarantine/<same name>`, without deleting tests or changing behaviour, and
add a guard so nothing outside the quarantine imports from it.

## Method

`scripts/trace-module-reachability.mjs` (new, with unit tests in
`tests/unit/trace-module-reachability.test.ts`) reads every source file under `frontend/src`,
`tests`, `scripts`, `api`, `backend`, `mobile`, `packages` and the root Vite configs, extracts every
module specifier with the TypeScript pre-processor (static, `import type`, `export ... from`
re-exports and barrels, dynamic `import()`, `require()`, `import("...")` type queries), resolves
relative paths, the `@/` alias, `.js`-for-`.ts` and folder `index` files, then walks importers
breadth-first. An entry is any file under `frontend/src/routes` or `frontend/src/components`,
`frontend/src/{server,start,router,routeTree.gen}`, `vite.config.ts`, or any source under `api/`,
`backend/`, `mobile/`, `packages/`. Tests are importers but never entries. Type-only edges count
(errs towards REACHABLE).

Limit: it traces module specifiers only. Path strings in JSON registries or `readFileSync` calls are
not imports; those were checked by hand with `git grep` (below).

### Why the first scan found importers

The earlier scan counted name matches. For the eight folder modules the matches were capability
names and file names in `frontend/src/lib/kernel/phase-contracts/*` (for example
`phase-38-evolution-engine.ts`, imported by `phase-contracts/index.ts`). Those files do not import
the modules. The module `evolution-engine/contracts.ts` imports the phase-38 contract, not the other
way round. `marketplace-core` really has four importers (see below).

## Reachability (output after the move, `node scripts/trace-module-reachability.mjs`)

```
files scanned: 2101
planetary-infrastructure: UNREACHABLE
  files: frontend/src/lib/_quarantine/planetary-infrastructure/contracts.ts
  direct importers (non-test): 0
  transitive importers (non-test): 0; test files that import it directly: 2
  location: frontend/src/lib/_quarantine
autonomous-economy: UNREACHABLE
  files: frontend/src/lib/_quarantine/autonomous-economy/contracts.ts
  direct importers (non-test): 0
  transitive importers (non-test): 0; test files that import it directly: 1
  location: frontend/src/lib/_quarantine
twin-civilization: UNREACHABLE
  files: frontend/src/lib/_quarantine/twin-civilization/contracts.ts
  direct importers (non-test): 0
  transitive importers (non-test): 0; test files that import it directly: 3
  location: frontend/src/lib/_quarantine
multi-agent-society: UNREACHABLE
  files: frontend/src/lib/_quarantine/multi-agent-society/contracts.ts
  direct importers (non-test): 0
  transitive importers (non-test): 0; test files that import it directly: 2
  location: frontend/src/lib/_quarantine
simulation-engine: UNREACHABLE
  files: frontend/src/lib/_quarantine/simulation-engine/contracts.ts
  direct importers (non-test): 0
  transitive importers (non-test): 0; test files that import it directly: 2
  location: frontend/src/lib/_quarantine
hardware-core: UNREACHABLE
  files: frontend/src/lib/hardware-core.ts
  direct importers (non-test): 0
  transitive importers (non-test): 0; test files that import it directly: 1
cognitive-architecture: UNREACHABLE
  files: frontend/src/lib/_quarantine/cognitive-architecture/contracts.ts
  direct importers (non-test): 0
  transitive importers (non-test): 0; test files that import it directly: 2
  location: frontend/src/lib/_quarantine
reality-os-kernel: UNREACHABLE
  files: frontend/src/lib/_quarantine/reality-os-kernel/contracts.ts
  direct importers (non-test): 0
  transitive importers (non-test): 0; test files that import it directly: 1
  location: frontend/src/lib/_quarantine
evolution-engine: UNREACHABLE
  files: frontend/src/lib/_quarantine/evolution-engine/contracts.ts
  direct importers (non-test): 0
  transitive importers (non-test): 0; test files that import it directly: 1
  location: frontend/src/lib/_quarantine
marketplace-core: UNREACHABLE
  files: frontend/src/lib/marketplace-core.ts
  direct importers (non-test): 4 [frontend/src/lib/marketplace-entitlement.ts, frontend/src/lib/marketplace-governance.ts, frontend/src/lib/scholar/marketplace/listing-publisher.ts, frontend/src/lib/surfaces/marketplace-view.ts]
  transitive importers (non-test): 5; test files that import it directly: 3
SUMMARY reachable=0 unreachable=10 missing=0
```

No candidate is REACHABLE. There is therefore no REACHABLE list with chains.

## Decisions per module

| Module                   | Result      | Action        | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ----------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| planetary-infrastructure | UNREACHABLE | moved         | only `tests/unit/h3-064`, `h3-079` import it                                                                                                                                                                                                                                                                                                                                                                                                                      |
| autonomous-economy       | UNREACHABLE | moved         | only `tests/unit/h3-069`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| twin-civilization        | UNREACHABLE | moved         | only `tests/unit/h3-066`, `h3-080`, `h3-096`                                                                                                                                                                                                                                                                                                                                                                                                                      |
| multi-agent-society      | UNREACHABLE | moved         | only `tests/unit/h3-055`, `h3-073`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| simulation-engine        | UNREACHABLE | moved         | only `tests/unit/h3-057`, `h3-075`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| cognitive-architecture   | UNREACHABLE | moved         | only `tests/unit/h3-054`, `h3-072`                                                                                                                                                                                                                                                                                                                                                                                                                                |
| reality-os-kernel        | UNREACHABLE | moved         | only `tests/unit/h3-071`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| evolution-engine         | UNREACHABLE | moved         | only `tests/unit/h3-058`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| hardware-core            | UNREACHABLE | LEFT IN PLACE | path is pinned by guards this mission may not or cannot update without weakening them: `architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json` (per-file count and two entries; must never be hand-edited), `architecture/phase-acceptance/phase-15-hardware-integration.json` (two `kind: module` probes on `frontend/src/lib/hardware-core.ts`), and `frontend/src/lib/runtime/scholar-vertical-bindings.ts` evidence list (another lib area)   |
| marketplace-core         | UNREACHABLE | LEFT IN PLACE | four non-test importers in other lib areas outside this mission's boundary: `lib/marketplace-entitlement.ts`, `lib/marketplace-governance.ts`, `lib/scholar/marketplace/listing-publisher.ts`, `lib/surfaces/marketplace-view.ts` (plus `lib/scholar/marketplace/install-gate.ts` transitively). All five are themselves UNREACHABLE, but they are their own modules, not helpers that exist only to serve `marketplace-core`. Moving them is a separate decision |

Hand checks for path references (`git grep "lib/<name>"`) for the eight moved modules: only unit
tests (updated), and historical docs (`architecture/campaigns/H3-WAVE-CAMPAIGN.md`,
`architecture/campaigns/h3/MISSION-GRAPH.md`, `architecture/campaigns/h3/strict-ts-sweep.md`,
`progress/h3-wave/H3-0xx.report.md`). Historical records were left as written. `architecture/registry.json`,
`scripts/verification/registry-drift-declaration.json` and `scripts/verification/registry-test-attribution.mjs`
name capabilities and test-file prefixes, not module paths, so they needed no change; registry and drift
checks pass unchanged.

## What changed

- `git mv frontend/src/lib/<m> frontend/src/lib/_quarantine/<m>` for the eight modules above. Only
  change inside them: relative imports gain one `../` (`../identity`, `../kernel/...`).
- 14 existing tests: import paths (and path comments) rewritten from `frontend/src/lib/<m>/` to
  `frontend/src/lib/_quarantine/<m>/`. No assertion changed, no test removed:
  h3-054, h3-055, h3-057 (also the `new URL(...)` source read), h3-058, h3-064, h3-066, h3-069,
  h3-071, h3-072, h3-073, h3-075, h3-079, h3-080 (also a dynamic import), h3-096.
- New `scripts/trace-module-reachability.mjs` and its type declaration `scripts/trace-module-reachability.d.mts`
  (same pattern as `scripts/lib/pg-ssl.d.mts`).
- New `tests/unit/trace-module-reachability.test.ts` (11 tests, in-memory fixtures).
- New `tests/unit/quarantine-isolation.test.ts` (2 tests): fails if any file outside `_quarantine`
  imports from it, except the fixed list of the 14 pre-existing tests above; also asserts every
  quarantined module is still UNREACHABLE with zero non-test importers.
- New `frontend/src/lib/_quarantine/README.md` (what, why, rule, how to revive).

Interpretation to note: "nothing may import from `_quarantine`" is enforced for all product code,
scripts and tests, with an explicit allow list for the 14 tests that already pinned these modules,
because the brief also requires every existing test to keep passing with the same assertions.

## Founder decisions needed

1. `hardware-core.ts`: quarantining it needs a neutrality-baseline regeneration by its own tool and
   an update of the phase-15 acceptance probes. Approve that as a follow-up, or keep it.
2. `marketplace-core.ts` and its five importers are all unreachable from the product. Approve
   quarantining the whole marketplace cluster (touches `lib/scholar/marketplace` and `lib/surfaces`),
   or keep it. Note: the `architecture/registry.json` phase-27 note says "the /marketplace route
   renders"; no `/marketplace` route exists on master (only `Disallow: /marketplace` in `robots[.]txt.ts`).
