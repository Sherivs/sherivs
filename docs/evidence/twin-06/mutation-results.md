# SV1-TWIN-06 mutation results (local, 2026-11-13)

Each mutant breaks the code on purpose; the gate must fail; the file is then restored from a copy.

## Unit gate (`tests/unit/sv1-twin-gate.test.ts`, 26 tests)

| # | Mutant | Result |
|---|---|---|
| G1 | owner check removed from approve/dismiss/acknowledge | caught (1 failed) |
| G2 | tenant check removed from the execution handoff | caught (1 failed) |
| G3 | held-permission check removed from the handoff | caught (2 failed) |
| G4 | role lens no longer filtered to the assignment's permissions | caught (4 failed) |
| G5 | `completeRun` on an unknown run no longer audited | caught (1 failed) |
| G6 | `advanceRun` on an unknown run no longer audited | caught (1 failed) |
| G7 | undeclared operation id accepted at proposal creation | caught (2 failed) |
| G8 | wake event-type allowlist removed | caught (1 failed) |
| G9 | `twin` allowed as a wake event source | caught (1 failed) |

Note: the first run of G6 used a pattern identical to its replacement (a no-op) and reported "26 passed". It was a mistake in the mutant, not a gap in the suite; the corrected G6 was caught.

## Database harness (`tests/integration/sv1-twin-gate.local.sql`)

9 mutants of the provisioning path, grants and policies were applied to a disposable local PG16 database; all 9 were caught and each was reverted (recorded when the harness was authored). The raw harness output is in `db-harness-output.txt`.
