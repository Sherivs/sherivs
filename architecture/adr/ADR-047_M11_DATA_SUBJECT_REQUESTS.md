# ADR-047: M11 Data-Subject Requests Are Tenant-Scoped, Identity-Verified and Hold-Gated

| Field | Value |
|---|---|
| Status | PROPOSED |
| Date | 2026-11-13 |
| Author | Claude (continuation of issue #190) |
| Creator | Claude Code agent, mission M-011 (issue #190) |
| Mission | M11 — data-subject requests (access, rectification, portability, erasure) |
| Depends on | M04 tenant substrate, M09 identity, M12 retention and legal holds (ADR-048) |
| Cites | ADR-005, ADR-008, ADR-009, ADR-048; `AGENTS.md` tenant-isolation, audit and RLS rules |
| Ownership artifact | This ADR and `database/supabase/migrations/20261104014500_sherivs_m11_data_subject_requests.sql` |

## Context

Issue #190 requires DSR intake and workflow with identity verification, a configurable SLA clock, status tracking, audit, a machine-readable export limited to the subject, and erasure that goes through M12 retention and legal-hold checks. M12 (#318) supplies `retention_legal_holds` (tenant, category, subject and record scopes) and rules that V1 "deletion" is an audited tombstone, never a physical delete (ADR-048, ADR-009).

## Options

### Option 1 — Let the DSR function tombstone or delete the subject's rows (rejected)
Contradicts the V1 tombstone-only ruling and would duplicate M12's approval and audit gates.

### Option 2 — DSR records a hold-checked erasure decision; M12 executes tombstones (ruled)
The DSR workflow verifies identity, evaluates active M12 holds that cover the subject, and records `erasure_cleared` or `erasure_blocked`. It never updates or deletes a source row.

### Option 3 — Skip holds for DSRs (rejected)
Would let a request override a legal hold.

## Decision

Option 2. All state lives in `dsr_settings`, `dsr_requests` and an append-only `dsr_request_events`, each tenant-owned with RLS ENABLED and FORCED. `authenticated` has SELECT only (tenant managers holding `roles.configure`); `anon` has nothing; every write is a SECURITY DEFINER function with `search_path = ''` that re-checks tenant authority. The SLA is `dsr_settings.sla_days` (default 30, 1–365) and is frozen onto each request as `sla_days` and `due_at`; the clock is immutable. `dsr_overdue(org, as_of)` lists open requests past `due_at`. Identity verification (method recorded) must precede export or an erasure decision. Export (`dsr_portability_export`) is limited to access and portability requests and returns only rows of the subject in the same tenant from the five M12-mapped tables; message counterparty ids are removed; the audit event keeps counts, never content. Erasure is blocked by an active tenant hold, a subject hold, a category hold where the subject has records in that category, or a record hold on one of the subject's records; it can be re-decided after a hold is released.

## Explicit residual risks

- **Erasure is not executed here.** `erasure_cleared` means "no hold blocks this subject"; the tombstones are still written by M12. M12 runs are retention-window driven and cannot yet target one subject on demand. A subject-targeted M12 run is required before erasure requests can be fulfilled end to end. Owner: V1CAP-066 / phase 14.
- **Rectification is tracked, not performed.** The workflow records and audits a rectification request; the edit itself uses the existing record-specific screens.
- **Statutory deadline is configuration, not legal advice.** The 30-day default is provisional and must be ruled by the operator's legal review.
- **Export uses whole-row JSON** of the five tables minus `school_id`. If those tables gain columns that reference other people, the export must be reviewed.
- **Migration number.** Issue #190 reserves `20261104013000`–`20261104013999`, but M12 (the required dependency) is `20261104014000`; a lower number would fail replay. This migration uses `20261104014500`. The owner should confirm or reassign.

## Golden Questions

- **WHO?** A tenant manager (`roles.configure`) opens, verifies and closes requests for subjects of that tenant.
- **WHAT?** Intake, SLA clock, identity verification, subject-only export and a hold-gated erasure decision, all audited.
- **WHERE?** One tenant per request; cross-tenant access is rejected by RLS and function checks.
- **WHY?** Meet access, portability and erasure obligations without bypassing legal holds or the V1 tombstone rule.
- **UNDER WHICH POLICY?** ADR-005/008/009/048 and AGENTS tenant isolation, RLS and audit rules.

## UNKNOWNs

- Subject-targeted M12 execution and reader redaction coverage (see residual risks).
- Statutory SLA per jurisdiction.
- No migration or database operation in this change applies to a production or hosted database.
