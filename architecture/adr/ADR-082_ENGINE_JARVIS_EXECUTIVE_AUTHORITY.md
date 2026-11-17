# ADR-082: JARVIS executive authority, severity routing, owner alerts and workforce oversight

| Field | Value |
|---|---|
| Status | PROPOSED (operator ratification required before deployment) |
| Date | 2026-11-14 |
| Author | Claude Code agent (ENGINE-04 implementation) |
| Creator | Claude Code agent, mission E-001 (issue #n/a) |
| Mission | ENGINE-04 (JARVIS as digital chief executive over the human and AI workforce, within the engine's authority model) |
| Capabilities | Executive coordination and oversight (internal); alerts to the sheriff by console link; no connector is activated by this change |
| Supersedes-in-part | None |
| Cites | ADR-077 to ADR-081, JARVIS risk policy (ADR-035) and the JARVIS stack on branches `claude/jarvis-01..06`, `docs/engineering/ENTITY_ENGINE_EPIC.md` |
| Minimal ownership artifact | `frontend/src/lib/jarvis-executive/*` (executive pack, severity and routing, owner alerts, workforce oversight, work assignment) |

## Context

The owner asked for JARVIS to be Sherivs' own digital CEO: it oversees the AI and human workforce, coordinates and orchestrates the AI workforce, uses every internal and external tool including social media, reaches the owner by call, text and WhatsApp, and decides by severity whether to act alone or escalate to the sheriff. The risk is that a chief-executive agent becomes a super-user: one identity with broad reach, no ceiling, and a phone channel an attacker could spoof.

### Options considered

- **Option 1, JARVIS as a privileged service account.** Fast, but it concentrates every risk in one identity and makes its authority a matter of configuration. Rejected.
- **Option 2, JARVIS as an ordinary engine agent with a ceiling.** Same Role Pack, same ladder, same broker as every other agent; it is powerful because it coordinates, not because it is exempt. Chosen.

## Decision

**Adopt Option 2.**

- **Authority is a Role Pack.** `jarvis-executive` is validated by the same `validateRolePack` as every pack. It acts alone only up to T1 (observe, assess, coordinate, notify the owner, demote one rung, pause an agent). Customer messages are T2 with approval until the sheriff promotes them. Publishing a social post, a production deploy request, a refund request and an access-grant request are T3 with the sheriff as approver. It declares nothing over its own authority, the audit log or the kill switch (T4 is not declarable), and it starts in shadow.
- **Severity is separate from tier.** S1 to S4 say how urgently a human must hear; tier says what authority an action needs. A security incident or an irreversible platform-wide change is S1; platform scope, T3 or an irreversible tenant change is S2; T2, tenant scope or customer visibility is S3; the rest is S4.
- **Routing never raises authority.** JARVIS acts itself only on an execute verdict at T1 or below and inside its daily action budget. T2 and any exhausted budget go to the approval inbox; T3 goes to the sheriff console; shadow and propose are logged or proposed; a deny is refused, and an S1 or S2 deny alerts the owner so an attempted breach is never silent.
- **Owner alerts are notifications, not approvals.** An alert carries a severity, a short redacted title and a link to the console on the configured https origin. It refuses links with another origin, a non-https scheme, credentials, a fragment, or any token, code, key or approve parameter. S1 uses voice, WhatsApp, SMS and console and ignores quiet hours; S2 uses WhatsApp, SMS and console; S3 and S4 use the console and wait for the digest in quiet hours. Alerts are deduplicated and rate limited per severity. T3 approval needs the passkey in the console, so a spoofed or stolen message cannot approve anything.
- **Oversight recommends, it does not act.** `assessWorkforce` returns ordered, deterministic findings (stalled and near-expiry approvals, agent failure and denial spikes, budget exhaustion, stale autonomy evidence, work waiting on a suspended context). Every recommended action is T1 (notify, reassign to a human, demote, review a pack, re-evaluate, pause) and goes through the broker like any request.
- **Assignment cannot grant.** `assignTask` chooses among contexts that already hold the capability, are active and are in the task's tenant. An agent gets autonomous work only at T1 and with earned autonomy; T2 is prepared by an agent and approved by a human; T3 goes to a human; nobody eligible means unassigned.

## Consequences

- Positive: JARVIS is as strong as the engine lets any agent be and no stronger; its authority is reviewable as one declarative pack; a compromised JARVIS prompt cannot spend, publish, deploy or grant access without the sheriff passkey; every outward action leaves a ledger row (ADR-081).
- **Limit, self-contained.** This module does not import the JARVIS stack (`claude/jarvis-01..06`, which holds the risk policy, approval inbox, escalation ladder with inbound verification, briefing, playbooks and report feed). The tier vocabulary (T0 to T4) is the same by convention, with no test pinning it yet because the JARVIS files are not on this branch; add one when restacking. Wiring this layer to the real approval inbox and escalation ladder is a restack step; until then the two overlap in intent (alert planning) and must be reconciled, not run in parallel.
- **Limit, no channel is live.** Nothing here places a call or sends a text or WhatsApp message. Each channel adapter, its provider contract and the owner's consent for live outbound are separate work.
- **Limit, identity.** JARVIS needs a governed service identity and the platform roles named in the pack. Creating it is an owner action; nothing provisions it automatically, and it is not a person's twin.
- **Limit, thresholds.** The oversight thresholds (4 hour approval SLA, 20 percent failure rate, 50 percent denial rate, 90 percent budget) are starting values for the owner to ratify.
- **Owner actions:** ratify the pack and the thresholds; create the JARVIS service identity; set quiet hours and the console origin; decide the daily action budget.

## Verification

- Unit: `tests/unit/jarvis-executive.test.ts` (25), including: the pack validates and pins each outward-facing capability's tier; severity is monotone in tier and scope over the full grid; a 2000-run property test that JARVIS acts only on an execute at T1 or below inside its budget, that a sheriff_passkey always routes to the console and a deny is always refused; a 2000-run property test that an assignment is always active, in-tenant, capable, and human at T3; oversight is order-independent and sorted; owner alerts refuse eight classes of unsafe link and an http origin, hold non-S1 alerts in quiet hours (including a window that wraps midnight), dedupe, rate limit and withhold secret-shaped titles.
- Mutation: 16 source mutants (severity, routing, budget, passkey routing, query, origin and scheme checks, S1 quiet-hour bypass, secret title filter, tenant and status filters, T2 and T3 assignment rules, autonomy check, thin-data guard, AI-only findings, an outward capability's tier) were each caught; one survivor (a publishing capability downgraded to T2) led to a pinned-tier test and is now caught.
- Static: `tsc` and eslint 0 errors.
- Not verified here: the restack onto the JARVIS stack, any live channel, CI on the final branch.
