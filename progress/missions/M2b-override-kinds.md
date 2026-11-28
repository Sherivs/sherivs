# M2b override kinds

Status: draft PR on top of #532, not applied anywhere.
Built: migration 20261128000300 (resolver extended; workspace_template_disabled, workspace_template_min_scope_rank, workspace_effective_approval_limit, workspace_role_display_name; expense guard reads the effective limit) and rollback, harness tests/integration/m2b-override-kinds.local.sql (M2K ALL PASS: 46 checks), CI step, ADR-159.
Evidence: harness passes; rollback removes the functions and the harness fails at its presence guard; re-apply passes again; M2b resolver harness (14), M04 and M07 ledger harnesses still pass. The first version broke M07 (an unrecognised scope counted as narrower); fixed and covered by the M07 run.
Scope sets: narrowing applies to them (campus and class only count as hierarchy dimensions).
Guarded harnesses: tools/run-guarded-harnesses.sh clones a built chain into each required database name and runs a1, b1, b5, engine01-03, memory-isolation, sv1-twin x2, comms-03, fin-01, ent-01: 12 of 12 pass on this branch. m009-a1 was stale (its principal role now needs a verified authority link); the harness now uses a head-teacher role.
Not built: TypeScript session cache; screens for overrides.
Tumi to check: any hosted override already approved for these kinds (they start applying at once).
