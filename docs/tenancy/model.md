# Tenant model

## V1 hierarchy

The existing Scholar identity model uses `public.schools` as the organization
tenant root. `public.campuses` belongs to that root through `school_id`, and
`public.school_shifts` belongs to the same tenant and may be nested under a
campus through `campus_id`. A shift without a campus remains visible as an
organization-level, unassigned shift for compatibility with existing records.
The M04 migration adds a same-tenant foreign-key invariant when a shift does
reference a campus; it does not copy or migrate existing organization data.

Membership remains the authority for tenant context. The hierarchy reader is
authenticated, resolves the active organization with `get_my_school_id()`, and
returns only that organization, its campuses, and its shifts. Campus and shift
role assignments use the existing M009-A1 assignment scope checks against
`campuses.id` and `school_shifts.id`; organization assignments use the org
scope. Client input does not select the tenant.

## Institution-authority links

`public.institution_authority_links` stores tenant-owned, effective-dated
relationships. `legal_basis` and `evidence_url` may be absent while a link is
unverified; the `source` records where the candidate information came from.
Only a caller authorized to manage institution settings can change links.
Every change requires an authenticated actor and writes an immutable audit
record. A link cannot be marked verified without a non-empty evidence URL;
the database stamps the verifying actor and timestamp.

No candidate relationships or authority names are seeded in this migration.
This avoids presenting an unverified example, legal basis, or jurisdictional
relationship as an official fact. Candidate records must be added from
source-backed material and remain `unverified` until an authorized actor
reviews the evidence.

## Migration safety

The M04 migration is forward-only and has a matching rollback file. It is
intended for disposable local migration replay and review only; it has not
been applied to a production database.
