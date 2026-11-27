# M4 follow-up: custom role widgets in the live manifest

Status: built (database), draft PR, NOT APPLIED.

- Migration `20261127000800_sherivs_m4_custom_role_widgets_in_manifest.sql` (rollback restores the old body). `workspace_manifest` now adds the widgets listed in the `layout` of an active custom role the person holds. They go through the same catalogue filter as every widget (permission, feature, family, policy), so a custom role cannot show a widget its holder may not see. Draft roles add nothing; other organisations are unaffected.
- Harness `tests/integration/m4-custom-role-widgets.local.sql`: 7 checks pass; registered in verify.yml.
- Not built: navigation sections and actions from a custom role layout (only widgets); the blank-template decision (a role from scratch still cannot be assigned); browser check of the live shell.
- Needs: founder approval and a backup before apply; Tumi's review (the manifest drives every person's home screen).
