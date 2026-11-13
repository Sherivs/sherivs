# ADR-045: M08 ASC Export Field-Order Manifest

|| Field | Value |
||---|---|
|| Status | PROPOSED — draft export only; instrument verification required |
|| Date | 2026-11-03 |
|| Author | `copilot-swe-agent[bot]` (GitHub Copilot Coding Agent; issue #187) |
|| Creator | Copilot Coding Agent |
|| Mission | M08 ASC/DNEMIS-compatible export (V1 organizational capability) |
|| Capabilities | Tenant-scoped file download from existing school data |
|| Supersedes-in-part | None |
|| Cites | `AGENTS.md` §§13, 17, 26, 27, 29, 30, 31, 45; issue #187; epic #175 |
|| Minimal ownership artifact | This ADR and the versioned export manifest |

## Context

M08 requires CSV/XLSX downloads in ASC section and field order. The issue does
not identify an official ASC instrument revision or target school category. The
repository schema alone cannot establish official labels, order, definitions,
or reporting period. Claiming compatibility without that evidence would
fabricate an official government requirement.

## Recommendation (decision)

Represent export sections, field order, labels, types, and source mappings as
versioned manifest data. Ship `ng-schema-draft-2026-11` with status
`unverified-draft`; it is a schema-derived snapshot draft, **not an official ASC
order**. The order and field semantics **must be checked against the exact
official ASC form revision and school category before production use as an
official return**.

The current draft contains institution profile fields from `schools` and
`school_locations`, plus exact counts of current active student and teacher
rows. The available schema does not provide an annual census period filter for
these counts, so the draft does not claim they are year-specific. Missing
source values remain empty cells; the exporter has no estimation or
imputation path.

The server function requires authenticated school-admin scope and
`reports.academic`, reads through the caller's authenticated RLS client, and
uses the gate-resolved school id for every tenant query. Each download is
fail-closed audited with actor, tenant, timestamp, scope/filters, format, and
manifest revision. The only output is a user-initiated CSV or XLSX file; no
government API submission path exists. No database migration or production
database operation is needed.

## Replacing the draft

When the owner supplies the exact official form revision and target category:

1. Add a new `asc-manifest.<revision>.ts` with its verified ordered sections,
   field keys, labels, source mappings, and types. Preserve the draft manifest
   for auditability rather than silently rewriting its meaning.
2. Verify each source mapping against the repository schema and tenant RLS.
   Add a narrowly scoped, explicitly named derivation only when the data exists;
   never infer missing values.
3. Update the active manifest selection and CSV/XLSX golden fixtures from the
   official instrument, then review the resulting order and semantics before
   production enablement.
4. Record the official instrument citation and verification reviewer in this
   ADR or a follow-up decision.

The serializers resolve cells from manifest mappings, so changing only the
ordered fields, labels, and mappings that are already present in the source
snapshot does not require serializer changes. New data requirements require
their own schema-backed extraction and security review.

## Consequences

- **Positive:** Field ordering is data-driven, both file formats share one
  validated manifest, and golden tests pin their order.
- **Obligation:** The shipped draft must not be represented as an official or
  production-ready ASC return until its exact order and meanings are verified.
- **Security:** No cross-tenant selector is accepted from the client; RLS,
  server-resolved tenant scope, least-data aggregation, and fail-closed export
  auditing remain in force.

## Golden Questions

- **WHO?** An authenticated school administrator with `reports.academic`.
- **WHAT?** Download a current, schema-derived draft snapshot in CSV or XLSX.
- **WHERE?** Through the app shell, using the authenticated tenant's existing
  RLS-protected records.
- **WHY?** Provide an extensible export structure while official instrument
  details are pending.
- **UNDER WHICH POLICY?** AGENTS §§13, 17, 26, 27, 29, 30, 31, and 45; epic
  #175's no-fabricated-government-claims requirement; issue #187.
