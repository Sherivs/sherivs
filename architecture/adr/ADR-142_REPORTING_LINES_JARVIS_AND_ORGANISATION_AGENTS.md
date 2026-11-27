# ADR-142: Reporting Lines: JARVIS to the Founder, Organisation Agents to the Organisation Head (D-12)

- Status: ACCEPTED by the founder in chat, 27 Nov 2026 (to be added to the signed record at the next pack)
- Date: 2026-11-27

## Decision

1. **JARVIS is the chief executive of the platform's agent workforce.** The internal departmental agents (Ledger, Compass, Prism, Scout, Bridge, Helm and the rest of the blueprint's 25) report up to JARVIS. JARVIS alone reports to the super admin (the founder): the daily brief and the approvals digest (AIN-07), and escalations.
2. **An organisation's twin and organisation agents (Tally, Roll, Marksheet, Intake and the others) report to the head of that organisation** (proprietor, principal, vice-chancellor or the role the organisation names), through that organisation's own approval inbox. They never report to the super admin directly.
3. **JARVIS reads no tenant content.** What reaches the founder from organisations is aggregate and health data only (counts, rates, cost, incidents by class), consistent with D-07 (strict tenant isolation) and D-06 (aggregate-only for public-sector reporting). A tenant-content view for support remains a separate, audited, time-boxed access decision (item 9, still open).

## Consequences

- AIN-06 and AIN-07 build the supervisor chain accordingly: `wf_agent.supervisor` for platform agents ends at `jarvis-executive`; JARVIS's own supervisor is the founder's super-admin identity; organisation agents have the organisation head as accountable person.
- The AIN-07 brief is assembled from aggregates; no field of it may carry a student, guardian, staff or payment detail.
- Item 9 narrows: the open question is only whether and how a super admin may ever write or read inside a tenant, not who receives reports.

## Open

- Which role is "head" for each institution type (mapping to the role catalog) is settled per pack and confirmed by the founder.
