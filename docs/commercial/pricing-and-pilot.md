# Pricing by plan, school-director demo and first paying pilot

Authority: AGENTS.md §§12, 17, 26, 31; ADR-095 (plan packaging of organization agents).
Origin: Claude Code agent, mission E-001 (commercial pack)
Creator: Claude Code agent
Created: 2026-11-15

Status: draft for the founder's decision. Prices below are read from the plan catalog in `frontend/src/lib/subscription-tiers.ts` and the organization agent catalog in production. Nothing here has been offered to a school. The pilot terms in section 4 are a recommendation, not a decision.

## 1. Plans as the product enforces them

| Plan         | Monthly (NGN) | Annual (NGN) | Students  | Teachers  | Classes   | Organization agents |
| ------------ | ------------- | ------------ | --------- | --------- | --------- | ------------------- |
| Trial        | 0             | 0            | 50        | 5         | 5         | 1                   |
| Starter      | 15,000        | 150,000      | 200       | 20        | 20        | 5                   |
| Growth       | 35,000        | 350,000      | 500       | 50        | 50        | 12                  |
| Professional | 75,000        | 750,000      | 1,000     | 100       | 100       | 16                  |
| Enterprise   | custom        | custom       | unlimited | unlimited | unlimited | 17                  |

- The trial lasts 30 days and has the admin portal only.
- Annual is ten times monthly (two months free) on every paid plan.
- Agent counts come from `org_agent_catalog` (1 at trial, 4 more at Starter, 7 more at Growth, 4 more at Professional, 1 more at Enterprise). A school can only enable an agent its plan allows, and only while its subscription is active.

## 2. Decisions the founder must make before quoting anyone

1. **Per-student fees.** The catalog lists a per-student monthly fee (Starter 200, Growth 350, Professional 500, Enterprise 800), and `school_platform_pricing` also holds wallet rates for SMS, WhatsApp, AI messages and voice. That table is empty in production, so none of these fees is configured for billing today. Decide whether the per-student fee is charged on top of the monthly price, and fill the table. Until then quote the monthly price only.
2. **Enterprise price.** It is zero in the catalog because it is custom. Set a floor so a group deal does not undercut Professional.
3. **Agent claims.** All organization and platform agents start in shadow mode and nothing runs them yet. Sell the weekly report, the twin and the governed workflow now. Describe agents as "arriving in shadow mode, earning autonomy through evaluation", never as live automation.

## 3. School-director demo (15 minutes, using only what exists)

1. **The problem (2 min).** Ask how many hours a week the proprietor spends on reports, fee follow-up and staff queries.
2. **Create the school (3 min).** Sign up, pick the plan, invite the administrator. Show that the administrator's personal assistant is created at the same time.
3. **The weekly report (3 min).** Show the report the school receives by email each week and what it contains. Say plainly that the first report builds after the first full week of data.
4. **Plan gating (3 min).** Open the agent roster. Enable an agent the plan allows; try one it does not and show the refusal with the reason. This is the upgrade conversation.
5. **Control and safety (3 min).** Show that every agent starts in shadow, that approvals sit with the school's own role owner, and that safeguarding and refunds are propose-only.
6. **Close (1 min).** Offer the pilot in section 4.

Do not demonstrate anything that sends SMS, calls parents, or moves money.

## 4. First paying pilot (recommendation, needs approval)

- **Who:** one school of 200 to 500 students whose director you already know, so support cost stays low.
- **Plan:** Growth, because it unlocks 12 agents without a Professional price. Offer the 30-day trial first, then convert.
- **Terms to consider:** a 90-day paid pilot at the Growth monthly price (35,000 NGN), with a written agreement that the school is an early customer, agents are in shadow mode, and feedback sessions happen every two weeks. A discount should be time-boxed and written down, not implied.
- **Success criteria, measured with evidence:** administrator logs in weekly; the weekly report arrives and is opened for four weeks; at least three agents enabled; no security incident; the school renews or upgrades at day 90.
- **What you need first:** the owner actions in `docs/runbooks/go-live-readiness.md`, a signed pilot agreement reviewed by counsel, and a decision on per-student fees.

## 5. Unit economics are not in this file

The repository holds no record of model, messaging or hosting cost per school, so this file makes no margin claim. Before the pilot, record real cost for one week of pilot traffic (email via Resend, model calls, hosting) and set the price floor from that.
