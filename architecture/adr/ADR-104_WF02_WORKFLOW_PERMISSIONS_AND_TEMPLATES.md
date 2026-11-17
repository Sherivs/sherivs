# ADR-104: Workflow Permissions, Separation of Duties, and Templates (WF-02)

| Field | Value |
| --- | --- |
| Status | ACCEPTED and applied. Merged in #431 (`e6811075`) and applied to production on 2026-11-17 at 16:49 WAT (ledger `20261117154912`) after a fresh backup, under the founder's standing written approval (16:18 WAT, 2026-11-17). Rollback file not run. |
| Date | 2026-11-17 |
| Author | GitHub Copilot coding agent (WF-02) |
| Creator | `copilot-swe-agent[bot]` (GitHub Copilot coding agent, mission WF-02, issue #430) |
| Mission | WF-02 (workflow permissions, separation of duties, and template catalogue; issue #430) |
| Scope | V1 organizational workflow authorization and reusable templates |
| Depends on | [ADR-103](ADR-103_WF01_POSTGRES_WORKFLOW_ENGINE_AND_RUNTIME_PORT.md), ADR-101, SHERIVS-017, M009-A1 |

## Context

WF-01 deliberately made `wf_can` fail closed for people without a catalog grant. The workflow permission codes were accepted by `wf_can`, but were not yet present in `permission_catalog`; administrators retained the existing organization-administrator path. WF-01 also made publishing a service-path operation and approvals console-only, but it did not persist the last draft editor or prevent that person from publishing or deciding an approval for the same version.

WF-02 is a V1 extension for organizational workflows. It does not introduce a second authorization catalog, change tenant keys, alter WF-01 policies, or implement later workflow runtime features.

## Decisions

1. Add `workflows.view`, `workflows.manage`, `workflows.run`, and `workflows.approve` to the existing permission catalog. Keep `wf_can` unchanged, including its accepted `workflows.run` permission.
2. Grant view/manage/run to the existing `proprietor` and `head_of_institution` templates. Grant view/approve to `governance_board` and `auditor`; no template receives both manage and approve. Add the manage/approve pair to `sod_permission_rules`. A migration preflight rejects active assignments that would become conflicting when the template grants are introduced.
3. Keep the existing service-only publication path. Add `wf_version.updated_by`, stamp the authenticated author/editor on draft insert/edit, and retain service-provided actor identity for service-created drafts. A database trigger requires `published_by` and rejects publication by either `created_by` or `updated_by`. A second trigger rejects a console decision when the deciding person authored or last edited the version backing that approval's run. Existing self-request and console decision constraints remain unchanged.
4. Add a global `wf_template` catalogue with a key/version uniqueness constraint. It has no tenant column, is forced through RLS, is readable by `authenticated`, and is writable only by `service_role`. Seed three generic platform examples: a payment-due reminder ladder, a Paystack payment receipt, and a member absence alert.
5. Keep workflow-template examples generic in migration source so the repository's migration vocabulary guard remains effective.

## Security and operational consequences

- The new per-version guards apply regardless of the user's organization-admin status. They complement, and do not replace, catalog role SoD.
- Service publishing must identify its human actor in `published_by`. Draft creation requires a recorded author and last editor; a service-created draft may use the author as its initial editor. Drafts with unknown author or editor provenance fail closed for publication and approval decisions.
- New global permission assignments may reveal a pre-existing manage/approve combination. The migration fails closed when its preflight detects one; it does not silently rewrite role assignments.
- Authenticated users cannot publish, start runs, write steps, or decide approvals. `wf_claim_due_steps` remains service-role-only. Existing audit behavior and `audit_chain` are unchanged.
- The rollback removes WF-02 permissions, template data, and added guard objects/column only. It does not modify WF-01 workflow tables or audit records.
- The migration has not been applied to local hosted, staging, or production projects. Any hosted apply is a separate authorized operation.

## Validation

Static posture checks are in `tests/unit/wf02-workflow-permissions.test.ts`. Database checks run only against the disposable local simulation database in `tests/integration/wf02-workflow-permissions.local.sql`; no hosted database is an allowed target.
