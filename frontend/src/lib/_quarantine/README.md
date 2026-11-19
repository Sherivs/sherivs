# `frontend/src/lib/_quarantine`

Authority: SHERIVS MASTER EXECUTION PROMPT v1.0 (16 Nov 2026), §4.3 "Speculative modules" and §12.1 M1; founder decision "quarantine, do not delete".
Origin: Claude Code agent, mission E-005 (M1b quarantine speculative modules)
Creator: Claude Code agent
Created: 2026-11-17

Status: ACTIVE. Holding area for speculative library modules that no product code can reach.

## What is here

| Module                     | Former path                                  | Tests that still exercise it                                        |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| `planetary-infrastructure` | `frontend/src/lib/planetary-infrastructure/` | `tests/unit/h3-064-*`, `tests/unit/h3-079-*`                        |
| `autonomous-economy`       | `frontend/src/lib/autonomous-economy/`       | `tests/unit/h3-069-*`                                               |
| `twin-civilization`        | `frontend/src/lib/twin-civilization/`        | `tests/unit/h3-066-*`, `tests/unit/h3-080-*`, `tests/unit/h3-096-*` |
| `multi-agent-society`      | `frontend/src/lib/multi-agent-society/`      | `tests/unit/h3-055-*`, `tests/unit/h3-073-*`                        |
| `simulation-engine`        | `frontend/src/lib/simulation-engine/`        | `tests/unit/h3-057-*`, `tests/unit/h3-075-*`                        |
| `cognitive-architecture`   | `frontend/src/lib/cognitive-architecture/`   | `tests/unit/h3-054-*`, `tests/unit/h3-072-*`                        |
| `reality-os-kernel`        | `frontend/src/lib/reality-os-kernel/`        | `tests/unit/h3-071-*`                                               |
| `evolution-engine`         | `frontend/src/lib/evolution-engine/`         | `tests/unit/h3-058-*`                                               |

Each module is a single `contracts.ts` written by the H3 wave (Squad G). The files were moved with
`git mv`; only their relative imports changed (one more `../`). Their behaviour and their tests are
unchanged.

## Why

`node scripts/trace-module-reachability.mjs` proved that no file under `frontend/src/routes`,
`frontend/src/components`, or a server entry reaches any of them through any chain of imports
(static, dynamic, type-only, re-export). Only unit tests import them. Keeping them beside live code
made the library look larger and more finished than it is. The founder chose to quarantine rather
than delete, so the work can be revived if a real product need appears.

Two other candidates were left in place on purpose (see `progress/missions/M1b.md`):
`hardware-core.ts` (listed in the neutrality baseline, a phase-acceptance probe and a runtime
evidence list) and `marketplace-core.ts` (imported by four files in other library areas).

## The rule

**Nothing outside `_quarantine` may import from `_quarantine`.** Only the module's own tests may.
`tests/unit/quarantine-isolation.test.ts` fails if any product file, script or other test outside
the quarantined module's test list imports a file in this folder.

To revive a module: move it back with `git mv`, wire it to a real route or component, and remove
it from the table above and from the allow list in that test.
