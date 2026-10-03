# Posture Adjudication — `cg_memory_access_log` (H3-035)

- **Team / Role:** H3-035, Posture Adjudication Engineer (Squad D — memory-audit/reconciliation family)
- **Date:** 2026-10-03
- **Adjudicated posture:** **ZERO-POLICY BY DESIGN — CONFIRMED, no change proposed, nothing applied.**
- **Method:** read-only. Battery script inspected and run offline only (`node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope`); posture JSONs read as data; ownership traced with `rg` over migrations and server paths. No database was touched. No posture file, migration, or policy was authored or modified.

## OWNERSHIP

| Question | Answer |
|---|---|
| Creating migration | `database/supabase/migrations/20261002000004_coregrid_v1_memory_tier.sql` (MISSION-R-36 / J-017, memory tier: `cg_memory_scope`, `cg_memory_record`, `cg_memory_access_log`) |
| Posture authored by | The same migration: `ALTER TABLE public.cg_memory_access_log ENABLE ROW LEVEL SECURITY;` + `REVOKE ALL ON public.cg_memory_access_log FROM anon, authenticated;` — RLS enabled, **zero policies**, no client grants. Rollback mirrors it: `database/supabase/rollbacks/20261002000004_coregrid_v1_memory_tier.sql` |
| Owning server path (writes) | No client path exists. The retrieval contract `frontend/src/lib/memory/memory-store.ts` records every retrieval attempt — granted, partial, **and denied** — as an append-only `MemoryAccessRecord` (`store.accessLog`); the migration header (lines 36–39, 243–250) declares its future persistence into `cg_memory_access_log` is **service-role only** ("(future, service-role) will persist these rows into the cg_memory_* tables"). Scope-enforcement depth lands via `frontend/src/lib/context/memory-scope-enforcement.ts` (B-018, read-only to this adjudication). |
| Owning server path (reads) | Service-role audit/observability reads only. No authenticated client surface reads this table in V1; C-029's adversarial suite (`tests/unit/h3-029-memory-retrieval-authz.test.ts`) pins that memory retrieval is authorization-gated with no bypass path. |
| Battery ownership of the entry | Built-in canonical posture in `scripts/verify-rls-isolation-battery.mjs` (`BUILTIN_TABLE_POSTURES`, `postureSource=builtin-canonical`). The landed posture files (`rls-table-postures-substrate.json`, `rls-table-postures-transport.json`) do not re-declare it — exactly one source of truth. |

## EVIDENCE

1. **Battery scope (offline dry-parse, exit 0, no credentials/network):**
   `cg_memory_access_log posture=zero-policy forceRls=false policies=0 tenantColumn=n/a source=20261002000004_coregrid_v1_memory_tier.sql postureSource=builtin-canonical`
2. **Posture schema law** (`validatePostureEntry` in the battery script): a zero-policy entry must carry no policies and must NOT expect FORCE RLS — "zero policies IS the posture"; FORCE "cannot strengthen a posture with no policy expression." The table satisfies this exactly.
3. **Migration text** (`20261002000004_coregrid_v1_memory_tier.sql` §4 "Deny-by-default security posture", lines 273–279): all three `cg_memory_*` tables get `ENABLE ROW LEVEL SECURITY` + `REVOKE ALL ... FROM anon, authenticated` and the migration authors **no policy statements** for them.
4. **Migration table comment** (lines 243–250): "Immutable audit record (Constitution §28/§29); no UPDATE or DELETE path is authored."
5. **Registry is battery-scoped zero-policy in the unit-asserted sense:** `tests/unit/memory-store.test.ts` (line 594) pins all three memory-tier tables to the deny-by-default posture mechanically until live verification.

## DECISION

**ZERO-POLICY BY DESIGN — CONFIRMED. Keep the built-in canonical zero-policy entry; do not author a policy migration; do not add FORCE RLS (per battery law, FORCE is meaningless and inexpressible on a no-policy posture). No PROPOSED policy is recorded for V1.**

## RATIONALE

1. **Immutable audit records (AGENTS §28, §29).** `cg_memory_access_log` is the memory-plane access audit: one row per retrieval attempt, including DENIED attempts ("denied attempts are recorded, never discarded"). An audit ledger's integrity property is that nobody can rewrite it. Any tenant-scoped policy granting `authenticated` UPDATE/DELETE — even to tenant administrators — would weaken §28. The zero-policy posture makes the table unwritable and unerazable by *every* client role: there is no policy expression anywhere that can evaluate true, so not even a tenant admin can mutate or prune the ledger. This is stronger than what any V1 policy could grant while preserving immutability, and it is the posture the migration deliberately authored.
2. **Deny-by-default is the approved platform posture.** Posture selection law (recorded in `rls-table-postures-transport.json` and applied platform-wide since the J-005/J-006 neutral-primitive conversion): where no neutral tenant predicate exists that provably cannot widen reads, zero-policy deny-by-default is the approved V1 posture. No client-facing memory-audit surface is authorized in V1.
3. **Server-side ownership is complete without a client policy.** Writes arrive through the service-role channel (the only privileged data path, explicit and logged — battery section (e)); reads belong to service-role audit/observability. The retrieval contract itself fails closed before any persistence (identity AND tenant AND declared scope required, per the migration comment). §17's demand that application code not be the *only* security layer is satisfied: the database layer itself (RLS on, zero grants, zero policies) denies everything client-side.
4. **Client-facing reads are not legitimate in V1.** An access-log row carries identity, tenant, scope, purpose, returned record ids and denial reasons — high-sensitivity security data (§19 minimization, §35 realtime security). A tenant-scoped SELECT policy would need `get_my_tenant_id()` plus actor self-derivation and would still widen exposure beyond any declared V1 consumer need. If a future launch gate (e.g. tenant-admin audit view) requires it, the conversion path is the 20261002000013 exemplar: a single authorized migration introducing FORCE RLS + declared policies — never a silent widening.

## CONSTITUTION SECTIONS

- **§12** Data provenance — every row answers who/when/what was returned; posture entry provenance: `source=20261002000004_coregrid_v1_memory_tier.sql`, `postureSource=builtin-canonical`.
- **§17** Database security — RLS mandatory and enabled; application code never the only layer (zero grants + zero policies enforce at the data plane).
- **§16 / §26** Authorization model / never trust client-supplied identity — no client path exists to present credentials against; deny is unconditional.
- **§19** AI privacy law — access-log contents (identity, purpose, returned ids) are minimization-class data; not exposed to any client role.
- **§28** Immutable audit records — the decisive section: zero-policy makes the ledger unwritable/unerazable by all client roles including tenant administrators.
- **§29** Observability — the table is the observable audit trail; its protection posture is itself battery-proven.
- **§34** Frontend security — no UI is a security layer here; the data plane denies regardless.

## PROPOSED-POLICY-IF-ANY

**None for V1.** Zero-policy-by-design is the adjudicated, battery-consistent posture. If a future phase authorizes a tenant-admin audit read surface, the only sanctioned direction is a new authorized migration converting the table to policy-backed per the `20261002000013_coregrid_v1_neutral_membership_policies.sql` exemplar (FORCE RLS + exact declared policy set + declared least-privilege grants + a §4.4 probe recipe), with UPDATE/DELETE remaining absent forever (§28). This adjudication pre-authors nothing.