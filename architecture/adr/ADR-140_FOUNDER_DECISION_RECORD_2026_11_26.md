# ADR-140: Founder Decision Record, 26 November 2026 (A6)

- Status: ACCEPTED by the founder (signed Decision Pack, 26 Nov 2026); this file is the repository's record of it
- Date: 2026-11-26
- Authority: the signed PDF held by the founder. The wording below is a summary; where it differs from the PDF, the PDF governs and this file is corrected.

## Decisions

| ID             | Decision (summary)                                                                                | Where it lands                                                                |
| -------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| D-01           | Fee reminder ladder: options A and B, plus an overdue event and stop-on-payment                   | WF-15a2 (ADR-136), A1 (ADR-137)                                               |
| D-02           | Wallet top-up plus plan bundles. BulkSMS Nigeria for SMS; the official WhatsApp API               | WF-15a2 message registry; sender not built                                    |
| D-03           | AI route: EU, Mistral first, counsel first                                                        | WF-11 stays blocked until the route and counsel letter exist                  |
| D-04           | Options A and C                                                                                   | Not yet mapped in the repository; to be confirmed against the PDF             |
| D-05           | Confirm the order and build the tertiary roles                                                    | INST-02                                                                       |
| D-06           | Public-sector reporting is aggregate-only; Borno first                                            | INST-01                                                                       |
| D-07           | Counsel per workflow; strict tenant isolation, including a student in several organisations       | A2 (`a2-multi-org-student-isolation`); counsel per workflow is a release gate |
| D-08           | Assist mode                                                                                       | Autonomy ceilings (AIN-02); regulator exports (INT-01)                        |
| D-09           | Ratify the engine as built, add a strict agent boundary, require a passkey on sensitive decisions | A3 (ADR-138)                                                                  |
| D-10           | Build three price models as configuration; publish none                                           | PLAN-01                                                                       |
| D-11           | Request-based onboarding plus template automations                                                | Pack install (WF-15a)                                                         |
| CD-01 to CD-05 | CTO defaults accepted                                                                             | CD-01 to CD-05 PRs (ADR-131 to ADR-135)                                       |

## Open

- Item 9 (who may write super-admin): not answered. Mission A4 waits on it.
- D-04 is recorded by its letters only in this repository; its content must be read from the signed PDF before any mission relies on it.

## Standing rules this record does not change

Workflows stay disabled by default (`WORKFLOWS_ENABLED` off). No migration is applied to a hosted database without the founder's written approval of that file, a fresh backup and a restore test. Free tier only. No real sends. No external AI call without an approved route.
