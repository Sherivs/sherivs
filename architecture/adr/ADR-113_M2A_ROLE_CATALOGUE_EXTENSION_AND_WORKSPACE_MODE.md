# ADR-113: Role Catalogue Extension and the workspace_mode Rule

| Field                      | Value                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (founder approval required before the migration is applied)                                                                                                |
| Date                       | 2026-11-17                                                                                                                                                          |
| Author                     | Claude Code agent (mission M2 part A)                                                                                                                               |
| Creator                    | Claude Code agent, mission E-006 (M2a role catalogue extension)                                                                                                     |
| Mission                    | M2 part A (master brief §6, §7.5, Appendix A–D)                                                                                                                     |
| Capabilities               | One generated Nigerian role catalogue that covers every §6.1 institution type, says how each role uses Sherivs, and keeps oversight off until a mandate is verified |
| Cites                      | SHERIVS-017 (`20261024000240`); M009 B-1/B-5 authority gate (`20261103145000`, `20261103153000`); ADR-101                                                           |
| Minimal ownership artifact | `tools/role-catalog/catalog.py`                                                                                                                                     |

## Context

SHERIVS-017 shipped 572 roles, 56 templates and 94 permissions for nine coarse institution types. It is applied in production: a read-only `information_schema` query on 2026-11-17 showed `role_catalog`, `role_templates`, `permission_catalog` and `sod_permission_rules`, plus the M009 B-1 column `role_catalog.requires_verified_authority_link`. The brief asks for the missing institution types, the Appendix A/B templates, the Appendix C permissions and SoD rules, and a `workspace_mode` per role.

## Options

- **A. Edit migration 017's seed in place.** Rejected: 017 is applied, and editing an applied migration changes history.
- **B. Leave the seed under `tools/role-catalog` only.** Rejected: the repository convention, which a test enforces, is that the generated seed ships in a migration.
- **C. Keep `catalog.py` as the single source. Generate the TS mirror, the seed, the reserved migration `20261117001000` and its rollback from it.** Chosen.

## Decision

1. **Institution types.** 65 types. The 9 original codes stay on every original role. Each new code has a `family` of original types, so original generic roles also apply to it. For example, `public_primary` inherits roles tagged `primary`, and proprietor roles are excluded from publicly owned types. Health, nursing, agriculture, IEI, VEI and distance colleges inherit only institution-wide roles plus registry, exams and records, student affairs and SIWES. Section 6.1 names the regulators and exam bodies without codes, so their codes are derived (`nuc`, `waec`, …) and marked `codeSource: "derived"`.
2. **Oversight.** Government, agency, regulator and exam-body types are oversight types (25). A role whose types are all oversight types ships with `default_enabled = false`, `mandate_status = 'unverified'` and `requires_verified_authority_link = true`. No role mixes oversight and institution types.
3. **workspace_mode** ∈ {full, task_surface, none} applies to every template and every role. A role inherits its template's mode and may only narrow it (Messenger and Security Guard → none; Hostel Porter → task_surface). Task-surface templates: driver, gate_officer, security_staff, farm_attendant_task, tp_mentor_external. No-login template: support_staff. Every `full` template has exactly three nav sections, and each is marked `navSource` `appendix_b` or `derived` (derived where Appendix B gives none).
4. **Templates.** 52 new templates (108 in total). 36 follow Appendix B. 16 are named ★ in Appendix A only; their permissions use existing codes and are marked `specSource: "appendix_a"`.
5. **Permissions.** 66 new permissions (160 in total, 54 protected), with `protected` set exactly where Appendix C writes (P). On an original template, a new permission is only ever **optional and off by default**, so nobody who already holds a role gains anything.
6. **SoD.** The five Appendix C rules are added (9 in total). The rule "ethics approval × being the applicant" is encoded as `research.manage × research.ethics_approve` per application. `admissions.score × admissions.offer` is flagged `optionalPerPack`. One role pair is added, auditor × produce_sales (8 in total), under the existing `auditor_independence` guardrail. One guardrail is added: `no_patient_data` (14 in total; recorded as data, DB enforcement not added here).
7. **Remap.** 31 original titles that Appendix A maps to a ★ template move to that template (for example Sub-Dean → `sub_dean`, Technologist → `technologist`, the WAEC/NECO/NABTEB liaison officers → `exam_body_liaison`). The original template is kept as `previousTemplate`. **The migration refuses to run if any remapped role has an active assignment.**
8. **Titles.** 77 new titles, all taken from Appendix A. Anything marked [VERIFY] is carried as a `verify` string, never asserted.
9. **Out of scope.** Role-pack tables and the resolver (§7.2, owned by another agent), responsibilities and Appendix D add-ons, and DB enforcement of `default_enabled`.

## Consequences

- Determinism: `python3 tools/role-catalog/catalog.py --check` fails CI through a unit test if any output is stale.
- The rollback disables the 017 delete guards inside one transaction, restores the original 572 rows exactly and drops the new columns. If anything new is in use, it fails rather than losing data.
- Two role vocabularies still exist (`role-template-catalog.ts` V1 envelope and this catalogue). Reconciling them is M2's dedupe task.

## Golden Questions

- **WHO** may change it: catalogue data only, through the generator. Org admins can only toggle optional permissions (017 guards).
- **WHAT**: catalogue rows and four columns. No tenant data, tables, functions or grants.
- **WHERE**: `tools/role-catalog/`, `frontend/src/lib/scholar/roles/ng-role-catalog.generated.ts`, migration `20261117001000`.
- **WHY**: §6 and §7.5 of the master brief.
- **UNDER WHICH POLICY**: NOT APPLIED until the founder approves the file in writing.

## UNKNOWNs

- Whether the 31 remaps are wanted for tenants that already use those titles (the guard blocks the apply if any are assigned).
- State-specific names of teaching service commissions, secondary and Arabic/Islamic education boards, and the CHPRBN/MLSCN-type boards [VERIFY].
- Military/para-military schools and adult literacy centres have types but no roles, because Appendix A gives no titles for them. `tvet_board`, `agency_for_mass_literacy` and `multi_shift` also have no roles.
