# Organization weekly reports (ENGINE-21)

Authority: AGENTS.md §§12, 17, 26, 31; ADR-099 (this runbook documents the job it defines).
Origin: Claude Code agent, mission E-001 (ENGINE-21)
Creator: Claude Code agent
Created: 2026-11-15

Status: not scheduled. This describes how to run the job once the ENGINE-20 proposal is applied and a runner is chosen. Nothing in the repository schedules it.

## What the job does

`/api/public/cron/org-weekly-reports` opens one report request per organization that has an agent switched on, builds each report from that organization's agent events for the seven days ending at the most recent Monday 06:30 UTC, and stores it. It sends nothing. A repeat call in the same week asks for the same window and builds nothing new.

## When

Monday 06:30 UTC, which is 07:30 in Lagos (Lagos has no daylight saving). The window ends at that moment, so calling it later in the week still produces the same report.

## Before the first run

1. The ENGINE-20 proposal is applied (staging first). Until then the route answers 503 with `org_agent_tables_not_applied`.
2. `CRON_SECRET` is set in the deployment. Until then the route answers 503. The secret is the same one the other cron routes use; never put it in a URL or a log.
3. The deployment uses the service-role key already configured for the other server routes.

## Choose a runner (owner decision)

| Runner                  | Fits when                                                   | Notes                                                                                                            |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Vercel Cron             | The app is on Vercel and a cron entry in its config is fine | Vercel sends the secret as a Bearer header. Cron expressions run in UTC: `30 6 * * 1`.                           |
| n8n                     | n8n already runs the other ticks                            | Schedule trigger set to UTC, one HTTP Request node with the `Sherivs CRON Authorization` Header Auth credential. |
| `pg_cron` with `pg_net` | Extensions are available and approved on the project        | The repository does not use `pg_cron` today. It would need the secret stored in the database.                    |

The route accepts GET and POST. Any runner works; the first two need no database extension.

## Checking a run

A successful call returns JSON with `ok`, `windowEnd`, `newlyRequested`, `built`, `failed` and `sent` (always 0). `ok` is false when any organization failed; `failed` lists the report id and a short reason. A second call in the same week returns `newlyRequested: 0` and `built: 0`.

## Not done

- Sending. The notification worker is not built, so a report stays at status `built`.
- WhatsApp. Reports are addressed to email until a verified opt-in is read.
