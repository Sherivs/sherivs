# ADR-075: Early-childhood (creche) question pack

| Field                      | Value                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                          |
| Date                       | 2026-11-13                                                                                           |
| Author                     | Claude Code agent (R-023 implementation)                                                             |
| Creator                    | Claude Code agent, mission R-023 (issue #357)                                                        |
| Mission                    | R-023 (SV1-REALITY R23; audit finding R-23)                                                          |
| Capabilities               | Scholar runtime onboarding discovery (V1; creche)                                                    |
| Supersedes-in-part         | None                                                                                                 |
| Cites                      | ADR-051 (R1 registry), ADR-053 (R3 interview), ADR-054 (R9 website sync), `docs/v1/V1-SCOPE-LOCK.md` |
| Minimal ownership artifact | frontend/src/lib/scholar/reality/question-registry.ts                                                |

## Context

R1 shipped core, primary and secondary packs. The creche type was accepted by the interview but only asked the core questions, so a creche owner was asked about campuses and calendars but nothing about what makes early-childhood care different: the groups it runs, the youngest age admitted, care hours, meals, caregiver ratio and developmental reporting (audit finding R-23). Registry validation also did not require creche to cover the topology, academic and assessment domains.

## Decision

Add an `early` pack of seven questions visible only for the creche type: groups (day care, playgroup, nursery), youngest age in months, part-day or full-day care, meals, children per caregiver, how often development is reported, and state registration. Only the groups question is required to activate and only it is marked public-safe (`levels_offered`), so R9 can map a nursery group onto the existing nursery band; the other six stay private. Creche is added to the required branch-coverage rules (topology, academic, assessment). Primary, secondary and core questions are unchanged. No migration, no storage change, no new server function: the pack is static registry data.

## Consequences

A creche interview now asks seven more questions and must answer the groups question to be approvable. The registry content hash and question count change (25), so an interview saved against the old registry is reconciled by the existing R3 parse rules. Day care and playgroup have no place in the website generator's bands, so they are shown as approved but not published until the generator gains those bands (that is audit finding R-22). Remaining refused types: islamic, special_needs and multi_institution_group need their own packs and owner decisions. ADR-053's note that creche has only core questions is superseded by this ADR.

## Verification

Unit `reality-r23-early-childhood.test.ts` (13): pack scope and counts, unchanged primary and secondary packs, full registry validation and coverage, public-safe and activation flags, interview visibility and approval gate, boundary values, private answers kept out of the website plan, nursery band mapping, no-band case, and generated site validity for both outcomes. Three mutants caught (pack leaking to other types, groups not required, a private answer made public). With R1, R3 and R9 suites, 146 tests pass. One existing R3 seeded-walk threshold (approvals greater than 5) was relaxed to at least 3 because the walk reaches approval less often now that creche has required questions; the invariants it checks are unchanged. tsc, eslint, prettier, provenance and domain-neutrality checks pass locally.
