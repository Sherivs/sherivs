# A5: finished_at write-once and a whole-file review of verify.yml

| Field     | Value                                                                               |
| --------- | ----------------------------------------------------------------------------------- |
| Status    | Draft PR stacked on A3 (#515); NOT APPLIED                                          |
| Decision  | [ADR-139](../../architecture/adr/ADR-139_A5_FINISHED_AT_WRITE_ONCE.md)              |
| Migration | `database/supabase/migrations/20261117001001_sherivs_a5_finished_at_write_once.sql` |
| Rollback  | `database/supabase/rollbacks/20261117001001_sherivs_a5_finished_at_write_once.sql`  |

## Evidence (26 Nov 2026; local PostgreSQL 16, 205 migrations)

- `A5 ALL PASS: 15 checks`. Before the migration the first refusal check fails ("statement was allowed"); after it, all pass.
- WF01, WF02, WF03, WF05, WF06, WF07, WF08, WF12, WF15a, WF15a2, AIN01 to AIN05 pass unchanged.

## verify.yml review (whole file, 694 lines, 11 jobs; the migrations-sim job has 44 steps)

Checked: YAML parses; every WF, AIN, A2, A3 and A5 harness step has `set -euo pipefail`, a negative `FAIL` grep and a positive `ALL PASS` grep (the privilege steps rely on `ON_ERROR_STOP` plus pipefail plus the positive grep).

- Fixed: the WF-01 SKIP LOCKED concurrency step piped to `tee` without `pipefail`; it now has `set -euo pipefail`.
- Added: the A2, A3 and A5 harness steps.
- Not changed (not workflow missions; noted for Tumi): about ten older steps (WhatsApp ambiguity fix, M11, M12, FIN-01, ENT-01, SEC-02, DB-12) run `psql | tee` with no `pipefail` and rely on a trailing grep. The WhatsApp step only requires at least ten `WA-FIX PASS` lines, so a harness that failed after ten passes would go green.

## UNVERIFIED

- Not run in CI. Production data was not read; rows already final keep their stored times.
- The review is by script and reading, not by running the workflow.
