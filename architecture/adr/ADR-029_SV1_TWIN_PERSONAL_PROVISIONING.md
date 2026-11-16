# ADR-029: SV1 Personal Twin Provisioning (TWIN-01)

| Field | Value |
|---|---|
| Status | PROPOSED (operator ratification required before deployment) |
| Date | 2026-11-04 |
| Author | Copilot Coding Agent |
| Creator | `copilot-swe-agent[bot]` |
| Mission | SV1-TWIN-01 (ACTIVE-V1 organizational capability; personal twin provisioning) |
| Capabilities | One identity-bound personal twin per Scholar tenant; existing practical-memory scope consumed |
| Supersedes-in-part | None |
| Cites | [Issue #223](https://github.com/vibeoraai-bit/coregrid-scholar-migration/issues/223); [TWIN-01 issue #285](https://github.com/vibeoraai-bit/coregrid-scholar-migration/issues/285); [V1 scope lock](../../docs/v1/V1-SCOPE-LOCK.md); [T0 inventory](../SV1_TWIN_T0_INVENTORY.md); [CORE-06 issue #277](https://github.com/vibeoraai-bit/coregrid-scholar-migration/issues/277); [CORE-06 ADR-021](./ADR-021_PRACTICAL_MEMORY_CONTEXT_BOUNDARY.md); [identity/membership migration](../../database/supabase/migrations/20261008000050_coregrid_organization_memberships.sql); [ADR-004 neutrality guard](../coregrid-mvp-architecture/adr/ADR-004_RELOCATION_TIMING.md); [neutrality baseline](../coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json); AGENTS.md §§17, 27, 28, 31, 45 |
| Minimal ownership artifact | `cg_personal_twin`, its provisioning RPC/policy, and exactly observed migration-only neutrality entries |

## Context

The bounded #223 personal-twin capability is explicitly authorized within the ACTIVE-V1 organizational envelope; physical/device twins and V3 Reality Intelligence remain frozen (`docs/v1/V1-SCOPE-LOCK.md`, #223; AGENTS.md §45). T0 found that the generic twin contracts and legacy school-level `digital_twin_config`/`digital_twin_calls` do not represent one identity-bound personal twin (`architecture/SV1_TWIN_T0_INVENTORY.md`).

CORE-06 reconciles use of the existing `cg_memory_scope`, `cg_memory_record`, and `cg_memory_access_log` model and prohibits a parallel memory store (#277; ADR-021). Scholar identity is represented by `public.users.id` (the authenticated user id), and the active tenant is resolved through the existing `public.users.school_id` and `organization_memberships` model. A twin therefore needs a uniqueness rule over identity and tenant, owner-only reads within active tenant context, and a server-only provisioning path.

The required migration-only references to `school_id`, `get_my_school_id`, and Scholar vocabulary are detected by the domain-neutrality guard. The established quarantine helper accepts only named SQL migration files and records exact observed findings; ADR-004 requires a separate ADR for any baseline increase.

## Options

### Option 1 — Reuse legacy `digital_twin_*` configuration (rejected)

Treat the school configuration or call-history tables as a user's personal twin.

- **Consequences:** neither table establishes identity ownership or one-per-identity/tenant uniqueness; the call history contains personal communication data and is not the memory model. This would conflate unrelated purposes and violate CORE-06's explicit no-legacy-memory rule.

### Option 2 — Create a parallel twin-memory store (rejected)

Add twin-specific memory tables and policy machinery.

- **Consequences:** would duplicate the reconciled `cg_memory_*` model, split its access audit, and violate the issue's no-parallel-memory constraint. It could simplify twin-specific queries, but only by creating an unauthorized second store.

### Option 3 — Add a personal-twin identity row linked to existing scope (ruled)

Create one `cg_personal_twin` row per `(identity_id, school_id)` and reference the existing tenant-bound `cg_memory_scope`. Force RLS on the row, allow only the identity to read it within their active tenant, and provision through a service-role-only RPC invoked by an authenticated server function.

- **Consequences:** database uniqueness and forced RLS make identity/tenant isolation independently enforceable; the service-only RPC makes client-supplied identity and tenant insufficient to provision a row. The additional schema and mapping are a small maintenance cost, and twin memory remains bounded by CORE-06's independent scope and audit rules.

### Option 4 — Replace the established Scholar tenant binding to avoid migration-only vocabulary (rejected)

Use an unbound or newly introduced neutral tenant model solely to make the migration pass the neutrality guard without recording its migration-specific findings.

- **Consequences:** avoids a narrowly scoped SQL-only baseline entry, but changes the existing identity/active-tenant contract and adds a new tenant resolution path outside this issue. The quarantine helper exists for unavoidable vocabulary in a named database migration; it never authorizes weakening tenant isolation or adding vocabulary to shared application code.

## Recommendation (decision)

**Use Option 3 for ACTIVE-V1 TWIN-01 only. Bind `public.users.id` to the existing Scholar tenant using a database uniqueness constraint, expose only owner/active-tenant reads under FORCE RLS, and create the row and its `cg_memory_scope` atomically through a service-role-only provisioning RPC. The authenticated server function must resolve identity from verified auth context and tenant from the canonical active-tenant helper; successful, idempotent, and denied provisioning attempts must be audited. Quarantine only the exact, observed terms in this SQL migration using the existing helper; this ADR does not authorize expanding the baseline for other files or vocabulary. Do not add a memory table, use legacy `digital_twin_*`, broaden support access, or implement role lenses, physical/device twins, autonomous actions, or later Twin phases here.**

### Explicit residual risk

- **The residual risk:** this migration is authored only; no production deployment or verification is claimed, and CORE-06's memory rows remain governed by their own server-side scope/audit contract.
- **The sharpest instance:** rollback removes personal-twin identity rows but intentionally retains `cg_memory_scope` rows and any records in those scopes so that rollback does not delete memory owned by CORE-06.
- **The accepted rationale:** no production database access is authorized, and memory retention/deletion belongs to CORE-06 rather than this identity migration.
- **Owner of the residual risk:** SV1-TWIN-01 reports migration and test status; CORE-06 owns any future memory lifecycle/retention policy.

## Consequences (summary)

- **Positive:** one twin per identity/tenant is database-enforced; client reads cannot cross identities or the active tenant; retries preserve the same row; memory is attached to the existing declared-scope model; successful and denied provisioning attempts are audited.
- **Negative / obligations:** the server-only function and service-role boundary remain security-critical. Any later role lens must further restrict the already-authorized workspace scope and cannot change this row's owner or tenant.
- **For the wave/program specifically:** this decision implements only the identity/provisioning slice of T1; it does not claim role-lens, sleep/wake, recommendations, UI, deployment, or production verification.

## Golden Questions

- **WHO?** SV1-TWIN-01 owns the personal-twin identity row; CORE-06 continues to own practical-memory scopes, records, and access audits.
- **WHAT?** Provision one tenant-bound twin per authenticated identity and link its memory only through `cg_memory_scope`.
- **WHERE?** This ADR; `database/supabase/migrations/20261103154000_sv1_twin_personal_provisioning.sql`; `frontend/src/lib/runtime/scholar/personal-twin.functions.ts`; the disposable SQL harness and unit tests.
- **WHY?** Generic/legacy twin structures do not enforce identity-plus-tenant uniqueness, while CORE-06 forbids parallel memory tables.
- **UNDER WHICH POLICY?** AGENTS.md §§17, 27, 28, 31, 45; ADR-004 and the exact migration-only quarantine helper; issue #223's bounded V1 authorization; TWIN-01 hard constraints; CORE-06 issue #277 and ADR-021.

## UNKNOWNs

- Operator ratification and migration application remain outstanding; close only through explicit authorization and separate deployment verification.
- No live database, production Twin provisioning, or authenticated end-to-end request is exercised by this change; the SQL harness is limited to a marked loopback disposable database.
- CORE-06 owns the future memory-scope lifecycle when a twin is deprovisioned; this migration's rollback deliberately does not delete memory scopes or records.
