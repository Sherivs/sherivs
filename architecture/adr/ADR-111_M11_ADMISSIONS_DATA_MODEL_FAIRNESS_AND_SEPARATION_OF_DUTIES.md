# ADR-111: Admissions Data Model, Blind Scoring and Separation of Duties

| Field                      | Value                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (founder approval and an independent review are required before any apply)                                                   |
| Date                       | 2026-11-17                                                                                                                            |
| Author                     | Claude Code agent (mission M11 part A implementation)                                                                                 |
| Creator                    | Claude Code agent, mission E-014 (M11a admissions model)                                                                              |
| Mission                    | M11 part A (admissions data model), master brief §4.5, §9.1 to §9.3, §12.1 M11                                                        |
| Capabilities               | Cycles, programmes, versioned forms, question bank, screenings, append-only scores, offers, documents; rules enforced in the database |
| Cites                      | [ADR-101](./ADR-101_SEC_M0_ANONYMOUS_SURFACE_AND_PRIVATE_BY_DEFAULT.md); ADR-102 (organization root); SHERIVS-002; `sherivs_020`      |
| Minimal ownership artifact | `database/supabase/migrations/20261117001400_sherivs_m11_admissions_model.sql`                                                        |

## Context

`admission_applications` holds one flat, primary-and-secondary-shaped application per row, with an anonymous INSERT
for the public form (SHERIVS-002) and staff reads limited to admissions managers. Since SEC-M0 (applied 2026-11-17)
anon holds only INSERT on it. Cycles, programmes and quotas, versioned forms, a question bank, rubric scoring, offers
with four-eyes approval, document metadata and tertiary fields do not exist. The brief requires the rules
(fairness, separation of duties, expiry, immutability) to hold in the database, not only in the UI.

## Options

- **A. A new applications table for the new model.** Rejected: two sources of truth, and the anonymous path and
  its policy would have to be rebuilt.
- **B. Rules in server code only.** Rejected: one missed check in a later screen would break separation of duties.
- **C. Extend `admission_applications` with nullable links; nine new tables keyed by `org_id`; rules in triggers,
  composite foreign keys and policies.** Chosen.

## Decision

1. **Model.** `admission_settings`, `admission_cycles`, `admission_programmes`, `admission_forms`,
   `admission_question_bank`, `admission_screenings`, `admission_scores`, `admission_offers`, `admission_documents`.
   Tenant column `org_id` references `public.schools(id)` (ADR-102). Amounts are integers in minor units (kobo),
   currency defaults to `NGN`.
2. **Tenant integrity is structural.** Each parent exposes `UNIQUE (id, org_id)` and children reference
   `(id, org_id)`; `admission_applications` gains `UNIQUE (id, school_id)`. A programme, form, screening, score,
   offer or document cannot point at another organization's row.
3. **Applications are extended, not replaced.** Seven nullable columns: `cycle_id`, `programme_id`, `form_version`
   (links, with composite keys to the same organization) and `jamb_reg_no`, `utme_score`, `caps_status`,
   `entry_mode` (tertiary, with format checks). A trigger refuses them from anon and from signed-in callers without
   `admissions.process`, so anon keeps exactly the surface it had; the insert policy is not touched.
4. **Tertiary fields are readable only with `admissions.view`.** Signed-in callers lose column SELECT on the four
   tertiary columns and read them through `admission_application_tertiary(application_id)`. Every other column keeps
   its SELECT. Consequence: `SELECT *` on `admission_applications` as `authenticated` is refused; callers name columns.
5. **Cycles.** One open cycle per organization and intake (partial unique index). A cycle never returns to draft and
   an archived cycle is final.
6. **Forms.** A published version is immutable for every role. Once its cycle leaves draft, nothing about that
   cycle's forms changes: no edit, no publish, no new version. Version numbers are unique within a cycle.
7. **Fairness (blind scoring).** Scorers use `admission_blind_applications(cycle_id)`, an allowlist that omits names,
   sex, date of birth, religion, nationality, blood group, genotype, address, disability, medical and allergy fields,
   parent and guardian details and occupations, previous institution, discipline history, AI review fields and the
   tertiary fields. A scorer without admissions management rights reads no row of the base table.
8. **Scores are append-only.** The scorer is the caller; a correction is a new row that references the old one on the
   same application, keeps its criterion, carries a reason, and a row is corrected at most once.
9. **Separation of duties on offers.** An offer starts as a draft; `drafted_by`, `approved_by`, `issued_by` are set
   from the caller, never from the client. Issuing requires an approver different from the drafter; when
   `score_offer_separation` is on (the default, also when no settings row exists) a person who scored the application
   cannot approve its offer. The server cannot issue an offer without a named approver. Terms are fixed once the offer
   leaves draft. An expired offer cannot be issued or accepted. One live offer per application.
10. **Documents.** Metadata only; bytes live in the private bucket `admission-documents` (10 MiB, PDF/JPEG/PNG/WebP).
    The path must start with `<org_id>/<application_id>/`. Staff see a row, and can download the object, only when
    `scan_status = 'clean'` and they hold `admissions.view`. Rows are written by the server only.
11. **Access.** Staff read and write by permission (`admissions.view`, `.configure`, `.screen`, `.score`, `.offer`)
    within their own organization only; no client DELETE. Settings are written by the server (the role pack
    installer). Applicants get no direct table access. Every table: FORCE RLS, explicit grants, `scholar_audit`.

## Consequences

- `admissions.configure`, `admissions.screen` and `admissions.score` must exist in `permission_catalog` before the
  apply. Until a role holds them, only organization admins and principals (the legacy bridge in `scholar_can`) pass.
- The legacy bridge gives admins every admissions permission, so separation of duties is enforced on identity (who
  scored, who drafted), not on permission sets.
- Append-only scores block a cascaded delete of an application or organization that has scores, as
  `admission_stage_events` already does. Erasure must anonymize, not delete; retention rules for the new tables are
  not written yet.
- Any future reader of `admission_applications` as `authenticated` must list its columns.
- Freezing forms once a cycle opens means a correction mid-cycle needs a new cycle or a founder-approved relaxation.
- The free-text `interview_responses` and `academic_achievements` are on the blind surface; form designers must not
  ask protected questions in scored fields. Marking form fields as protected is deferred.

## Deferred

Applicant OTP accounts and the applicant portal; payments (application and acceptance fees, Paystack, webhooks);
conversion of an accepted applicant to an enrolled record; JAMB/CAPS CSV import and O-level verification; the public
`/admissions` portal and form builder UI; CBT reuse from `sherivs_022`; notifications; malware scanner integration.

## Golden Questions

- **WHO** may act: staff of the same organization holding the named permission; the server for settings, documents
  and later the applicant portal. Anon may only submit an application as before.
- **WHAT** is protected: protected attributes during scoring, tertiary identifiers, unscanned documents, the approval
  of offers.
- **WHERE** enforced: Postgres policies, column privileges, triggers and composite keys.
- **WHY**: the brief's fairness and separation-of-duties rules (§9.3, Appendix C) must survive any UI defect.
- **UNDER WHICH POLICY**: ADR-101 private-by-default, ADR-102 organization root, this ADR.

## UNKNOWNs

- UNVERIFIED: JAMB registration number formats (`^[0-9]{8,12}[A-Z]{2}$` accepts the older 8-digit and newer
  12-digit forms as understood), the CAPS status vocabulary, and entry-mode codes. Adjust after checking JAMB sources.
- Nothing is applied by this ADR.
