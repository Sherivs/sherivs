# M2b override kinds

Status: draft PR on top of #532, not applied anywhere.
Built: migration 20261128000300 (resolver extended; workspace_template_disabled, workspace_template_min_scope_rank, workspace_effective_approval_limit, workspace_role_display_name; expense guard reads the effective limit) and rollback, harness tests/integration/m2b-override-kinds.local.sql (M2K ALL PASS: 40 checks), CI step, ADR-159.
Evidence: harness passes; rollback removes the functions and the harness fails at its presence guard; re-apply passes again; M2b resolver harness (14), M04 and M07 ledger harnesses still pass. The first version broke M07 (an unrecognised scope counted as narrower); fixed and covered by the M07 run.
Not built: TypeScript session cache; scope sets under scope_narrow; screens for overrides.
Not run: m009-a1 fails on this local chain with or without the change (needs its own database setup); b1 and b5 need their guarded database names.
Tumi to check: any hosted override already approved for these kinds (they start applying at once).
