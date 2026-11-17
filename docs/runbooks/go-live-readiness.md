# Go-live readiness: the 25 Sherivs agents and the 17 organization agents

Authority: AGENTS.md §§12, 17, 26, 31; ADR-077, ADR-078, ADR-091, ADR-095, ADR-096 and ADR-099.
Origin: Claude Code agent, mission E-001 (go-live readiness)
Creator: Claude Code agent
Created: 2026-11-15

Status: evidence snapshot taken from production on 2026-11-15. It lists what is built and verified, what only needs a decision from the founder, and what is not built. Read it before deciding to go live.

## 1. Verified in production (queried, not assumed)

| Item                                 | State                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------- |
| Role packs published                 | 31: 25 platform (24 departments plus JARVIS) and 6 school-role packs, all starting in shadow |
| Platform roles                       | 25 roles; one privileged (platform_admin); the 18 added on 2026-11-15 are non-privileged     |
| Organization agent catalog           | 17 rows (`org_agent_catalog`), gated by plan tier through `change_org_agent`                 |
| Organization packs in `cg_role_pack` | 0, by design (ADR-095: definitions only, kept out of the pack registry)                      |
| Twin provisioning failures           | 0 (`twin.provision.failed` in `audit_logs`)                                                  |
| Schools                              | 0 (production has no organization or user yet)                                               |
| Notification outbox                  | 0 rows; the worker is built and merged (ENGINE-23)                                           |

All 17 organization packs pass `validateRolePack` with no problems. Tenant roles are capped at T2, every pack starts in shadow, and nothing crosses tenants.

## 2. What go-live means today

Nothing runs an agent. There is no agent runtime, no scheduler for agent playbooks and no live connector for any agent. Going live therefore turns on three things only: schools can sign up, each person gets a twin that sits in `pending_pack` or shadow, and the weekly report plus its email run. Every agent action above read-only needs a runtime that does not exist yet.

## 3. Owner actions (only the founder can do these)

1. Fix GitHub billing so Actions run again. Until then `npm run verify` locally is the only evidence, and it is not independent.
2. Set `CRON_SECRET` in the Vercel project (production). The cron routes return 503 without it.
3. Set `RESEND_API_KEY` and `RESEND_FROM_ADDRESS`, and verify the sending domain in Resend. Without them the worker leaves email rows queued and reports `email_not_configured`.
4. Schedule the two routes with an external scheduler that sends `Authorization: Bearer <CRON_SECRET>`: `/api/public/cron/org-weekly-reports` weekly and `/api/public/cron/org-notifications` every few minutes. Nothing in the repository schedules them.
5. Delete the unused 21st.dev API key in that provider's dashboard.
6. Decide on SMS and COMMS-03 (PR #351). It stays held; it needs provider billing behaviour verified first.

## 4. Decisions that need counsel or the founder

- Safeguarding, legal and compliance agent wording needs counsel review before any of those agents is wired (ADR-091).
- Retention defaults of 2555 days need a legal review.
- WhatsApp proactive sending needs an approved message template and a recorded opt-in path. The worker refuses it until a port is supplied.

## 5. Not built yet (be honest with schools about it)

- An agent runtime and playbook scheduler.
- Connectors the packs name (email for agents, social, IAM, owner-alert).
- A governed service identity for JARVIS, and staff or service identities for each department role. A department agent binds only when a staff member holds its role, and today only the founder exists.
- Evaluation suites that let an agent earn autonomy beyond shadow.
- The workspace-scope and pause-state proposals (`ENGINE-13_agent_workspace_scope.sql`, `ENGINE-16_agent_pause_state.sql`) are not applied.
- Push and in-app delivery in the notification worker. It rejects those channels.

## 6. Go-live checklist

Tick each line with evidence (a query result, a response code or a screenshot) before telling a school it is live.

- [ ] Section 3 items 1 to 4 done.
- [ ] `GET /api/public/cron/org-notifications` without the secret returns 401; with it, 200.
- [ ] One pilot school created; its administrator invited; the twin appears in `cg_twin_context`.
- [ ] The weekly report for the pilot builds and one email reaches the administrator.
- [ ] `select count(*) from audit_logs where action = 'twin.provision.failed'` is still 0.
- [ ] The pilot school can enable one agent its plan allows and is refused one it does not.

## 7. Rollback

- Packs: set `status = 'retired'` on the pack rows (published packs cannot be edited or deleted). SQL is in `ops/2026-11-15-seed-platform-packs/` and `ops/2026-11-15-publish-remaining-internal-agents/`.
- Roles: `database/supabase/rollbacks/20261115000700_sherivs_engine11_13_platform_roles.sql`, after the packs are retired and no staff member holds those roles.
- Notifications: unset `CRON_SECRET` or remove the scheduler entry; the routes then refuse to run.
