# Mission M2a: Nigerian role catalogue extension

Authority: SHERIVS MASTER EXECUTION PROMPT v1.0 (16 Nov 2026), §6, §7.5, Appendix A–D; AGENTS.md §§12, 17, 26.
Origin: Claude Code agent, mission E-006 (M2a role catalogue extension)
Creator: Claude Code agent
Created: 2026-11-17

Status: IMPLEMENTED and TESTED on branch `mission/M2a-role-catalog`; not merged. Migration 20261117001000 is NOT APPLIED.
Active persona: Principal Architect, with the Postgres and RLS Security Engineer.

## Plan

1. Extend `tools/role-catalog/catalog.py` (single source) without editing the SHERIVS-017 data: §6.1 institution types, Appendix A/B templates, Appendix C permissions and SoD rules, and `workspace_mode`.
2. Generate the TS mirror, the seed, the reserved migration `20261117001000` and its rollback from it. Make generation deterministic and add a `--check` mode.
3. Add golden unit tests and an SQL behaviour test, update the one pinned seed assertion, and write ADR-113.

## Report

- Totals: 649 roles (572 + 77), 46 categories, 108 templates (56 + 52), 160 permissions (94 + 66; 54 protected), 14 guardrails, 8 SoD role pairs, 9 SoD permission rules, 65 institution types (25 oversight). Oversight roles: 91, all disabled with mandate_status 'unverified'. Remapped original roles: 31. Workspace modes: 624 full, 13 task_surface, 12 none.
- Determinism: two runs give byte-identical outputs (md5 compared); `catalog.py --check` is run by a unit test.
- Production read: one read-only `information_schema.columns` SELECT confirmed that 017 and the M009 B-1 column are applied. That is why the seed ships in a new migration and 017 is left untouched.
- Not done: role-pack tables and resolver (§7.2, another agent); responsibilities and Appendix D add-ons; DB enforcement of `default_enabled` and `no_patient_data`; reconciliation with `role-template-catalog.ts` and `docs/workspaces/role-catalog.md`'s V1 vocabulary.
