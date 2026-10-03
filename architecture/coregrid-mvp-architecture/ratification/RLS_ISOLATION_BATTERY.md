# RLS ISOLATION BATTERY — J-041 / V1CAP-073 (MISSION-R-85)

Status: **AUTHORED AND LIVE-EXECUTED against the approved dev project (2026-10-01), the canonical project post-M-R-100 (2026-10-02, §5), and EXTENDED with genuine cross-tenant probes on the J-005/J-006 policy-backed tables (2026-10-02, §7 — 36/36 PASS).**
Battery source: `scripts/verify-rls-isolation-battery.mjs`
Artifacts: `/opt/cursor/artifacts/rls-battery-results.json` (structured) + `/opt/cursor/artifacts/rls-battery-results.log` (human-readable)
Authority: AGENTS.md §17 (database security), §31 (testing standard); RULING-2 (deny-by-default posture approved); RULING-10 (migrations approved); STREAM J J-041; MISSION graph MISSION-R-85.

---

## 1. What the battery proves

Until this battery executed, the platform's #1 security invariant — "RLS enabled with zero
policies = deny for every client role" — was **statically reasoned, not database-proven**
(STREAM H contradiction; J-041). The battery converts it to database-proven fact using two
authorized transports and **no new credentials**:

1. **Live public data plane** — `GET $SUPABASE_URL/rest/v1/<table>` with the shared anon key
   (the credential every unauthenticated client holds). This is the probe a real attacker or
   anonymous client performs.
2. **Read-only catalog SQL** — pg_catalog / information_schema queries through the Supabase
   management API (same transport as `scripts/apply-approved-v1-migrations.mjs`), proving the
   enforcement metadata itself: `relrowsecurity = true`, zero permissive policies, and zero
   table grants to `anon` / `authenticated` / `PUBLIC`.

### Honesty rules encoded in the battery

- **DENY is the pass condition.** With deny-by-default + zero policies, the expected result
  is denial for everyone through REST. A 200-with-zero-rows (RLS-filtered empty set) or a
  Postgres permission-denied error are both genuine denials; both PASS.
- **Only genuine denials count.** An API-key rejection (`401 Invalid API key`) proves nothing
  about row security and is recorded `INCONCLUSIVE` with a finding, never a pass. The battery
  structurally validates the anon key (JWT `ref` must equal the project ref, `role` must be
  `anon`, `exp` must be in the future) before trusting any probe. (Observed live: the VM's
  injected `SUPABASE_PUBLISHABLE_KEY` was a **truncated JWT** and rejected by the data plane;
  the battery then resolved the project's own legacy anon key through the already-authorized
  management API — the anon key is public-by-design — and logged the provenance:
  `source=management-api-legacy ref=nwrflbpbhyiqdptmlccm role=anon prefix=eyJhbGciOi`.)
- **Service-role usage is explicit and logged, never default.** The only privileged data path
  is exercised solely behind the opt-in `COREGRID_BATTERY_ALLOW_SERVICE_ROLE=1` flag, and its
  use is printed as `SERVICE_ROLE_USED_EXPLICITLY`.

### Battery sections (per table)

| Section | Proves |
| --- | --- |
| (a) `anonRestProbe` | anon SELECT through the live REST endpoint returns no rows (empty set or `42501 permission denied`) — no leak on the public data plane |
| (b) `catalogEnforcement` | `relrowsecurity = true` AND zero policies total (hence zero PERMISSIVE policies) |
| (c) `privileges` | `anon`, `authenticated`, `PUBLIC` hold zero table privileges (SELECT/INSERT/UPDATE/DELETE/…) |
| (d) `isolationProof` | The explicitly-asserted invariants (below), derived from measured facts (b)+(c) and confirmed by (a) |
| (e) `serviceRoleContrast` | opt-in: the ONLY role that reaches rows is the explicit, logged service role |

### The strongest-form isolation assertion (section d)

The mission-mandated identity invariants hold here in their **strongest database-provable
form**: because `relrowsecurity = true` with **zero policies** and **zero client grants**,
there is no policy expression anywhere that could ever evaluate to true — for any `tenant_id`,
any `auth.uid()`, any credential state, or any agent. Therefore, per table:

- **Tenant A cannot read Tenant B** — no identity of ANY tenant can read a single row; there
  is no cross-tenant read path to weaken.
- **User A cannot read User B** — no `auth.uid()`-scoped expression exists at all; every
  authenticated principal is denied identically.
- **Revoked / expired access fails** — a revoked or expired credential resolves through
  PostgREST to the `anon`/`authenticated` roles, which hold no grants and are granted rows by
  no policy; every request is denied.
- **Agent cannot exceed permissions** — agents are untrusted identities operating through
  client roles (AGENTS §5); no client role — human or agent — can read or write. The only data
  path is the explicit, logged service role (section e contrast: anon → `42501`, service_role
  → `200` with rows).

---

## 2. Per-table matrix (live execution, dev project `nwrflbpbhyiqdptmlccm`, 2026-10-01)

Battery scope enumerated from the applied migrations (source migration cited per table).

| Table | Source migration | Present | (a) anon REST probe | (b) relrowsecurity / policies (permissive) | (c) anon/auth/PUBLIC grants | (d) isolation invariants | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cg_entity` | 20260903000000_coregrid_universal_kernel_substrate.sql | yes | PASS — `401` code `42501` `permission denied for table cg_entity` | PASS — `true` / 0 (0) | PASS — none | PASS (strongest form, all four invariants) | **PASS** |
| `cg_relationship` | 20260903000000_coregrid_universal_kernel_substrate.sql | yes | PASS — `401` code `42501` `permission denied for table cg_relationship` | PASS — `true` / 0 (0) | PASS — none | PASS (strongest form) | **PASS** |
| `cg_event` | 20260903000000_coregrid_universal_kernel_substrate.sql | yes | PASS — `401` code `42501` `permission denied for table cg_event` | PASS — `true` / 0 (0) | PASS — none | PASS (strongest form) | **PASS** |
| `cg_observation` | 20260903000000_coregrid_universal_kernel_substrate.sql | yes | PASS — `401` code `42501` `permission denied for table cg_observation` | PASS — `true` / 0 (0) | PASS — none | PASS (strongest form) | **PASS** |
| `cg_workspace` | 20260930000000_coregrid_v1_workspace_persistence.sql | yes | PASS — `401` code `42501` `permission denied for table cg_workspace` | PASS — `true` / 0 (0) | PASS — none | PASS (strongest form) | **PASS** |
| `cg_workspace_member` | 20260930000000_coregrid_v1_workspace_persistence.sql | yes | PASS — `401` code `42501` `permission denied for table cg_workspace_member` | PASS — `true` / 0 (0) | PASS — none | PASS (strongest form) | **PASS** |
| `cg_org_unit` | 20261001000000_coregrid_v1_org_model.sql | yes | PASS — `401` code `42501` `permission denied for table cg_org_unit` | PASS — `true` / 0 (0) | PASS — none | PASS (strongest form) | **PASS** |
| `cg_org_membership` | 20261001000000_coregrid_v1_org_model.sql | yes | PASS — `401` code `42501` `permission denied for table cg_org_membership` | PASS — `true` / 0 (0) | PASS — none | PASS (strongest form) | **PASS** |

**Summary: 8/8 PASS, 0 FAIL, 0 findings.**

Notes on `relforcerowsecurity`: all eight tables report `relforcerowsecurity = false`. This is
the Supabase default and is acceptable in this posture: table ownership is held by the
platform owner role, not by any client role, and no client role holds any privilege. When the
posture evolves to tenant-scoped policies (post J-005 policy authoring), force-RLS should be
re-evaluated in the same battery (a `FORCE ROW LEVEL SECURITY` assertion is a one-line
addition to section b).

Scope drift observed (INFO, not findings): twelve further `cg_*` tables exist on the dev
project outside this battery's migration-derived scope — `cg_conformance_assessment`,
`cg_domain_runtime`, `cg_execution_history`, `cg_execution_record`, `cg_foundation_evidence`,
`cg_identity`, `cg_mission_intent`, `cg_org_profile`, `cg_tenant`, `cg_verification_result`,
`cg_workforce_kind`, `cg_workforce_position`. Catalog enumeration additionally showed
`relrowsecurity = true` on every one of them; extending the battery list to cover them is a
scope decision for their owning missions, not a defect.

Service-role contrast (explicit, logged): `cg_entity` via `SUPABASE_SERVICE_ROLE_KEY` →
`200` with rows (BYPASSRLS), run only behind `COREGRID_BATTERY_ALLOW_SERVICE_ROLE=1` and
printed as `SERVICE_ROLE_USED_EXPLICITLY`. This is the asymmetry that proves the denial is
real and the only data path is the explicit service role.

---

## 3. Execution evidence (verbatim log excerpts)

Run header:

```
COREGRID RLS ISOLATION BATTERY — MISSION-R-85 (V1CAP-073 / J-041)
project=nwrflbpbhyiqdptmlccm transport=rest-anon + management-api(readonly catalog SQL)
anon key provenance: source=management-api-legacy ref=nwrflbpbhyiqdptmlccm role=anon prefix=eyJhbGciOi (value never printed)
honesty rule: deny-by-default + zero policies means DENY for everyone through REST — DENY IS the pass condition.
```

Per-table evidence shape (representative, `cg_entity`; identical shape for all 8):

```
PASS relrowsecurity=true relforcerowsecurity=false policies=0 permissive=0
PASS no table grants to anon / authenticated / PUBLIC
PASS anon REST probe status=401 denialForm=permission-denied-42501 evidence="{"code":"42501","details":null,"hint":"Grant the required privileges to the current role with: GRANT SELECT ON public.cg_entity TO anon;","message":"permission denied for table cg_entity"}"
PASS Tenant A cannot read Tenant B: STRONGEST FORM: relrowsecurity=true with zero policies means there is no policy expression anywhere that could evaluate to true for ANY tenant_id — no identity (any tenant) can read a single row. Anon REST probe confirms the public data plane returns no rows.
PASS User A cannot read User B: ...
PASS Revoked / expired access fails: ...
PASS Agent cannot exceed permissions: ...
VERDICT cg_entity: PASS
```

Service-role contrast (explicit run):

```
SERVICE_ROLE_USED_EXPLICITLY — opt-in via COREGRID_BATTERY_ALLOW_SERVICE_ROLE=1; contrasting the only privileged data path (never default).
INFO service_role contrast status=200 evidence="[{"id":"90fc4522-…","entity_type":"foundation-probe","tenant_id":"d8b753f4-…",…}]"
```

Verdict:

```
STATUS=PASS — 8/8 tables prove deny-by-default (RLS on, zero permissive policies, no client grants, anon REST denied). Tenant A cannot read Tenant B, User A cannot read User B, revoked/expired fails, agents cannot exceed permissions: proven against the live database, not reasoned.
```

During development the battery caught and honestly reported two failure modes rather than
masking them (both are battery-correctness events, recorded here for auditability, not
database defects):

1. A control-flow bug in the battery's first run mislabeled all 8 present tables as
   `TABLE_ABSENT`; corrected, catalog data had been read correctly all along.
2. The truncated env `SUPABASE_PUBLISHABLE_KEY` initially produced `401 Invalid API key`
   probes; the battery's honesty rule (an invalid key proves nothing about RLS) forced the
   key-provenance mechanism described in §1, after which every probe returned a genuine
   Postgres `42501 permission denied`.

---

## 4. Repetition plan — canonical environment post-apply

Dependency: **MISSION-R-100** (apply the cg_* migrations to the canonical environment and
record declared-vs-applied state truth). The battery below must run only AFTER M-R-100's
apply step completes on the canonical project; execution is serialized with M-R-85/M-R-101
per the mission graph (exclusive canonical-DB access).

1. **When M-R-100 reports the canonical apply verified**, run:
   `node scripts/verify-rls-isolation-battery.mjs <canonical-project-ref>`
   (the script already accepts a project-ref override argument; `SUPABASE_URL` must point at
   the canonical project, or pass the ref and set `SUPABASE_URL` accordingly).
2. **Expect the same 8/8 PASS matrix** — identical migrations, identical deny-by-default
   posture. Any FAIL is a FINDING with evidence (RLS off, permissive policy, stray grant, or
   leaked row); per mission law the battery never modifies the database.
3. **Record the run** as environment state truth alongside M-R-100's declared-vs-applied
   record: `rls-battery-results.json` + log, executedAt, projectRef. The battery's structural
   check that the env anon key matches the project (`ref` claim) makes cross-project
   misconfiguration impossible to miss.
4. **After J-005/J-006 tenant-scoped policies are authored** (neutral tenant-membership
   primitives), extend the battery: the zero-policy "strongest form" section is then replaced
   per table by genuine cross-tenant probes (seed Tenant A/Tenant B rows through service role,
   read as authenticated Tenant A principal, assert Tenant B rows invisible) plus a
   relforcerowsecurity assertion. Until policies exist, this document's strongest-form
   assertion is the correct and complete proof.
5. **CI wiring** (owner phase 21, credentials OPS-family): the battery is the CI step for
   V1CAP-073 — exit 0 = posture holds, exit 1 = FINDINGS (fail the build), exit 2 = blocked
   on credentials. Secrets come from the CI secret store; key values are never printed.

## 5. Canonical re-run record (post M-R-100, 2026-10-02)

Section 4's repetition plan was executed after MISSION-R-100's canonical apply reported
STATUS=PASS (see `CANONICAL_APPLY_RECORD_MR100.json`). The battery's table scope was first
extended from 8 to 16 tables to absorb the wave-3 substrate migrations applied to canonical
(`cg_role_assignment`, `cg_role_grant`, `cg_worker_invitation`, `cg_worker_registration`,
`cg_worker_session`, `cg_worker_binding`, `cg_memory_snapshot`, `cg_memory_append`),
keeping the identical four-section proof per table.

- Project: `nwrflbpbhyiqdptmlccm` (canonical; M-R-100 applied migrations verified in-catalog)
- Result: **16/16 PASS, 0 FAIL** — deny-by-default holds on every applied `cg_*` substrate table
- Anon-key provenance: resolved through the management API (`ref=nwrflbpbhyiqdptmlccm role=anon`),
  value never printed; the VM-injected `SUPABASE_PUBLISHABLE_KEY` remains a truncated/invalid
  JWT (secret-hygiene finding, not a database defect)
- Evidence: `/opt/cursor/artifacts/rls-battery-results.json` + `/opt/cursor/artifacts/rls-battery-results.log`

Foundation-loop live battery (M-R-100 T3): `scripts/exercise-foundation-loop.mjs` executed
against the canonical project through the preview server function — first call
`replayed=false status=admitted verification=verified`, second call `replayed=true` (same
execution id), 5/5 integration tests including cross-tenant rejection and governed rollback;
probe rows and auth user cleaned up (`probe_cleaned=true`).

## 6. Verdict

J-041 / V1CAP-073 is **database-proven on the dev project AND on the canonical project
post-M-R-100**: deny-by-default is no longer a static claim — it is executed evidence on both
environments. M-R-101 (backup/restore verified recovery) is serialized next per the mission
graph.

## 7. Battery extension — genuine cross-tenant probes on the J-005/J-006 policy-backed tables (canonical, 2026-10-02)

TEAM 3 (phase-08 foundation loop / classification campaign) executed §4.4's planned
extension. Migration `20261002000013_coregrid_v1_neutral_membership_policies.sql`
(rollback: `database/supabase/rollbacks/20261002000013_coregrid_v1_neutral_membership_policies.sql`)
gave the three neutral tenant-membership tables FORCED RLS with tenant-scoped policies built
ONLY on the J-005 neutral primitives (`get_my_tenant_id()`, `is_tenant_admin()` — which binds
the J-006 NEUTRAL `'role:administrator'` token; no Scholar helper, no hard-coded tenant id,
no domain role name, and the directional domain mapping stays out of the policy layer):

- `cg_role_assignment` — SELECT tenant-equality via `get_my_tenant_id()`;
  INSERT/UPDATE require the neutral ADMINISTRATOR binding in the row's tenant; no DELETE
  policy (history preserved).
- `cg_role_grant` — SELECT tenant-equality; INSERT/UPDATE additionally pin
  `granted_by = auth.uid()::text` (a client can never supply or re-attribute a grantor);
  no DELETE policy (revocation is a `revoked_on` transition).
- `cg_org_membership` (the neutral tenant-membership table the J-005 primitives resolve
  tenancy from) — SELECT tenant-equality; INSERT/UPDATE require the neutral ADMINISTRATOR
  binding; no DELETE policy.

Provenance is preserved per AGENTS §11: no policy filters, mutates, or hides a provenance
column (`granted_by/granted_on/revoked_on/created_at/started_on/ended_on`); erasure and
retention are untouched.

The battery (`scripts/verify-rls-isolation-battery.mjs`) now supports BOTH postures and
reports which posture each table proved:

- **zero-policy** (33 tables): the §1 strongest-form proof, unchanged (RLS on, zero
  policies, no client grants, anon REST denied). `relforcerowsecurity=false` is reported
  **INFO** on this posture — no policy expression exists, so force-RLS cannot strengthen it.
- **policy-backed** (3 tables): FORCED RLS asserted (`relforcerowsecurity = true`), the
  exact declared policy set asserted by name, privileges asserted
  (`authenticated` = SELECT/INSERT/UPDATE/DELETE so the policies are the operative row
  gate; `anon`/`PUBLIC` = none), and the strongest-form section is REPLACED by **genuine
  cross-tenant probes** reusing the seed/cleanup discipline of
  `scripts/exercise-foundation-loop.mjs`:
  1. Privileged seed (management-channel SQL, logged `PRIVILEGED_SEED_USED_EXPLICITLY`):
     Tenant A + Tenant B probe rows and THREE real auth principals — A (active binding in
     Tenant A), B (active binding in Tenant B), C (binding in Tenant B that **expired
     yesterday**).
  2. Authenticated Tenant A read (real password-grant JWT through the live REST endpoint):
     **Tenant A's own rows visible** (a policy that denies Tenant A its own rows is a
     FINDING too) and every returned row belongs to Tenant A.
  3. Tenant B invisible: explicit `?tenant_ref=eq.<B>` read as Tenant A returns 0 rows.
  4. Expired/revoked access fails: principal C reads 0 rows anywhere — the neutral
     primitive's time-validity excludes expired bindings.
  5. Negative write probes: cross-tenant INSERT denied at the policy layer; on
     `cg_role_grant` additionally a forged-grantor INSERT (`granted_by` = another
     principal) rejected by the WITH CHECK.
  6. Cleanup: all probe rows and users deleted through the same privileged channel and the
     cleanup verified by re-count — `probe_cleaned=true` on every policy-backed table.
     A failed cleanup is a FINDING.

### Per-table matrix — canonical `nwrflbpbhyiqdptmlccm`, 2026-10-02 (36/36 PASS, 0 findings)

| Table | Source migration | Posture | relrowsecurity | relforcerowsecurity | Policies | anon REST probe | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cg_entity` | 20260903000000 kernel substrate | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_relationship` | 20260903000000 kernel substrate | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_event` | 20260903000000 kernel substrate | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_observation` | 20260903000000 kernel substrate | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_workspace` | 20260930000000 workspace persistence | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_workspace_member` | 20260930000000 workspace persistence | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_org_unit` | 20261001000000 org model | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_org_membership` | 20261001000000 org model | **policy-backed** | true | **true** | 3 (exact declared set) | 401 / 42501 | **PASS** |
| `cg_role_assignment` | 20260907000800 role-assignment substrate | **policy-backed** | true | **true** | 3 (exact declared set) | 401 / 42501 | **PASS** |
| `cg_role_grant` | 20260907000800 role-assignment substrate | **policy-backed** | true | **true** | 3 (exact declared set) | 401 / 42501 | **PASS** |
| `cg_worker_definition` | 20261002000002 worker definitions | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_worker_capability` | 20261002000002 worker definitions | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_worker_delegation` | 20261002000002 worker definitions | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_memory_scope` | 20261002000004 memory tier | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_memory_record` | 20261002000004 memory tier | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_memory_access_log` | 20261002000004 memory tier | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_reconciliation_verdict` | 20261002000005 reconciliation | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_reconciliation_input` | 20261002000005 reconciliation | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_event_security` | 20261002000006 event security | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_event_security_denial` | 20261002000006 event security | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_event_security_redaction` | 20261002000006 event security | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_event_route_subscription` | 20261002000007 event routing | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_event_route_queue` | 20261002000007 event routing | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_event_route_cursor` | 20261002000007 event routing | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_event_route_outcome` | 20261002000007 event routing | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_evidence_record` | 20261002000008 evidence lifecycle | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_evidence_lifecycle_act` | 20261002000008 evidence lifecycle | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_reasoning_provenance_snapshot` | 20261002000009 reasoning provenance | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_usage_attribution_rollup` | 20261002000010 cost attribution | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_usage_attribution_bucket` | 20261002000010 cost attribution | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_knowledge_source` | 20261002000011 knowledge currency | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_knowledge_freshness_contract` | 20261002000011 knowledge currency | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_knowledge_invalidation` | 20261002000011 knowledge currency | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_knowledge_downgrade` | 20261002000011 knowledge currency | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_tool_runtime_tool` | 20261002000012 tool runtime | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |
| `cg_tool_runtime_invocation` | 20261002000012 tool runtime | zero-policy | true | false (INFO) | 0 | 401 / 42501 | **PASS** |

Stage-1 substrate provenance: the 20 tables from migrations 20261002000005..20261002000012
were applied to canonical through the checksummed apply pattern
(`scripts/apply-canonical-hardening.mjs`; declared-vs-applied record
`architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json`), each verified in-catalog with
`rowsecurity = true` and zero policies before this battery ran.

### Live evidence excerpts (verbatim from `/opt/cursor/artifacts/rls-battery-results.log`)

`cg_role_assignment` (policy-backed — representative; identical shape for all three):

```
PASS relrowsecurity=true relforcerowsecurity=true policies=3 exact-declared-set=true
PASS privileges match policy-backed posture: authenticated=SELECT,INSERT,UPDATE,DELETE (policies are the operative row gate); anon/PUBLIC=none
PASS anon REST probe status=401 denialForm=permission-denied-42501
seed complete: tenantA=battery-tenant-a-9b8eaa626f09 tenantB=battery-tenant-b-9b8eaa626f09 principals=3 (A active-in-A, B active-in-B, C expired-in-B)
PASS cross-tenant probe: tenantAVisible
PASS cross-tenant probe: tenantBInvisible
PASS cross-tenant probe: rowsReturnedAllTenantA
PASS cross-tenant probe: expiredAccessFails
PASS cross-tenant probe: crossTenantInsertDenied
probe cleanup: probe_cleaned=true (re-count verified=true)
VERDICT cg_role_assignment: PASS
```

`cg_role_grant` (adds the forged-grantor probe):

```
PASS cross-tenant probe: forgedGrantorInsertDenied
VERDICT cg_role_grant: PASS
```

Final verdict line (verbatim):

```
STATUS=PASS — 36/36 tables prove their declared posture: zero-policy tables prove deny-by-default (RLS on, zero permissive policies, no client grants, anon REST denied, strongest-form isolation); policy-backed tables (J-005/J-006 neutral tenant-membership policies, FORCED RLS) prove genuine cross-tenant isolation (Tenant B invisible, Tenant A own rows visible, expired binding denied, cross-tenant INSERT denied, forged grantor rejected, probes cleaned). Proven against the live database, not reasoned.
```

FINDINGS: **0**. Artifacts: `/opt/cursor/artifacts/rls-battery-results.json` (structured,
includes per-table `crossTenantProbe` details) + `/opt/cursor/artifacts/rls-battery-results.log`.

### SECURITY DEFINER interaction record (post-FORCE-RLS verification)

The role-assignment RPCs are SECURITY DEFINER; FORCE RLS binds the table owner. Mitigation
verification after applying FORCE RLS + policies: the definer owner (platform role
`postgres`) holds the sanctioned BYPASSRLS attribute (verified live in `pg_roles`:
`rolbypassrls = true`, which holds under FORCE), so the definer path is unaffected.
Re-proven live: `node scripts/verify-role-assignment-substrate.mjs` (DATABASE_URL set) →
**59/59 substrate invariants hold (mode: live)** — all six RPCs present, SECURITY DEFINER,
executable by `authenticated`; the two tables assert the post-J-005 posture (FORCED RLS,
exactly the declared neutral policies, `authenticated` privileged so the policies are the
operative gate, `anon` still denied). The verifier's zero-policy live expectations were
updated to this posture-aware form — the assertions got strictly stronger (exact policy
inventory + FORCE), never weaker.

## 8. Verdict (post-extension)

J-041 / V1CAP-073 is database-proven on the dev project, on canonical post-M-R-100, and —
after the J-005/J-006 neutral tenant-membership policy migration — on canonical with
GENUINE cross-tenant probes on the three policy-backed tables (36/36 PASS, 0 findings,
`probe_cleaned=true` on every seeded probe). Both postures (zero-policy strongest-form and
policy-backed tenant-scoped visibility) are supported by the battery and reported per
table. M-R-101 (backup/restore verified recovery) remains serialized next per the mission
graph.

## 9. H2-wave extension — declarative posture registry to 37 tables + the substrate policy layer applied (canonical, 2026-10-02)

Mission wave H2 (30 parallel engineering missions) extended this battery from the 36-table
J-005/J-006 posture to **37 tables in the dual-posture model**, applied the two pending
migrations to canonical through the checksummed apply path, and proved the whole scope live.

### Scope change (data, not code)

- `scripts/verification/rls-table-postures-substrate.json` — the H2-04 declarative posture
  file for the eight batch-A/B substrate families (20261002000005..20261002000012): four
  tables POLICY-BACKED (tenant-scoped, see below), twelve zero-policy unchanged, four
  append-only audit ledgers explicitly documented zero-policy (no client write path, ever).
- `scripts/verification/rls-table-postures-transport.json` — `transport_buses` declared
  ZERO-POLICY (H2-03 normalization).
- Battery machinery gained only two data-declared capabilities, both fail-closed:
  the §4.4 cross-tenant probe recipe (`probeSeedRows` + `probeInsertPayload`) for
  policy-backed tables outside the neutral-membership exemplar set, and
  `probeAuxTables` (privileged composite-FK parent rows, cg_* only, cleanup-verified).
  An undeclared probe stage on a policy-backed table is a FINDING, never a silent pass —
  the battery refuses to claim an unprovable isolation proof (observed live on the first
  post-apply run before the recipes were authored).

### Canonical apply (checksummed, serialized, exclusive-access)

Migrations `20261002000014_coregrid_v2_transport_buses_rls.sql` (normalization:
transport_buses → zero-policy strongest form; drops every legacy permissive policy;
revokes anon/authenticated/PUBLIC; service_role parity) and
`20261002000015_coregrid_v1_substrate_policies.sql` (FORCE RLS + eight neutral-primitive
tenant-scoped policies on the four retained client-facing substrate tables; authenticated
granted exactly SELECT+INSERT — append-only substrates) were applied to canonical via
`scripts/apply-canonical-hardening.mjs` (Management-API transport, sha256 per migration,
ALREADY_APPLIED/MIXED detection, post-apply catalog re-verification) — record:
`architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json` (11 migrations declared,
14+15 APPLIED_AND_VERIFIED, `--verify-only` re-run idempotent PASS).

### Live evidence excerpts (verbatim from `/opt/cursor/artifacts/rls-battery-results.log`)

`cg_reconciliation_input` (policy-backed — first data-declared §4.4 recipe, composite-FK
parent via probeAuxTables; identical shape for `cg_usage_attribution_bucket`):

```
probe aux seed: 1 parent row(s) inserted into cg_reconciliation_verdict via the privileged channel (composite-FK parent of the §4.4 probe; values non-secret by construction)
probe seed: 1 Tenant-A row(s) inserted into cg_reconciliation_input via the privileged channel (data-declared probe recipe; values non-secret by construction)
VERDICT cg_reconciliation_input: PASS
```

`cg_event_route_subscription` and `cg_evidence_record` (policy-backed, actor
self-derivation pinned by the INSERT policies): `VERDICT …: PASS`.

`transport_buses` (zero-policy strongest form, H2-03 normalization proven live):

```
PASS relrowsecurity=true relforcerowsecurity=false policies=0
PASS no table grants to anon / authenticated / PUBLIC
PASS anon REST probe status=401 denialForm=permission-denied-42501
VERDICT transport_buses: PASS
```

Final verdict line (verbatim):

```
STATUS=PASS — 37/37 tables prove their declared posture: zero-policy tables prove deny-by-default (RLS on, zero permissive policies, no client grants, anon REST denied, strongest-form isolation); policy-backed tables (J-005/J-006 neutral tenant-membership policies, FORCED RLS) prove genuine cross-tenant isolation (Tenant B invisible, Tenant A own rows visible, expired binding denied, cross-tenant INSERT denied, forged grantor rejected, probes cleaned). Proven against the live database, not reasoned.
```

FINDINGS: **0** (30 zero-policy / 7 policy-backed). Every one of the seven policy-backed
cross-tenant probes reports `cleaned=true` — probe rows, aux parent rows and the three
probe principals removed and re-count-verified. Posture inventory: the battery scope
enumeration is now data-declared end to end (`--dry-parse-scope` → tables=37
zero-policy=30 policy-backed=7).

### Posture matrix (canonical, post-H2-wave)

| Tables | Posture | Proof |
|---|---|---|
| 30 (incl. `transport_buses`, the four append-only audit ledgers, and the twelve out-of-scope batch-A/B tables) | zero-policy deny-by-default | RLS on, zero policies, no client grants, anon REST denied — the strongest form |
| 3 neutral-membership exemplars (`cg_role_assignment`, `cg_role_grant`, `cg_org_membership`) | policy-backed, FORCE RLS | built-in §4.4 probes |
| 4 substrate tables (`cg_reconciliation_input`, `cg_event_route_subscription`, `cg_evidence_record`, `cg_usage_attribution_bucket`) | policy-backed, FORCE RLS | data-declared §4.4 recipes |

## 10. Verdict (post H2-wave)

J-041 / V1CAP-073 is database-proven on the dev project, on canonical post-M-R-100, after
the J-005/J-006 neutral membership policies, and now after the H2-wave substrate policy
layer: **37/37 PASS, 0 findings, live**. The dual-posture model extends by authoring a
posture-file entry (data) — the next policy migration extends the battery without touching
battery code. Remaining serialized next per the mission graph: M-R-101 (backup/restore
verified recovery).

## 11. H3-wave extension — 39 tables: the file substrate + the durable idempotency substrate (canonical, 2026-10-03)

Battery steward (H3-000, coordinator): the H3-wave authored two policy-backed
substrate migrations (H3-027 L-T-011 file substrate; H3-028 L-T-012/J-030
durable idempotency substrate), applied them via the serialized canonical apply
(`scripts/apply-canonical-hardening.mjs`, migrations 12–13 of 14, checksum-bound,
`STATUS=PASS`), and merged the migrations' authored INTENDED POSTURE ENTRY into
`rls-table-postures-substrate.json` — posture/policy data only, with a full §4.4
cross-tenant probe recipe per table and the battery's `$template` value form
added (purely additive; exact-match substitution semantics unchanged — H3-088's
pins unbroken, 129/129 posture tests pass).

Serialized canonical apply record: `architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json`.

### Battery finding and correction (why 39, not 38)

The first live run at 39 tables returned **38/39** with one real finding:

```
cg_idempotency_record / privileges: PRIVILEGE_POSTURE_MISMATCH
  anon: [DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE]
  authenticated: [DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE]
  declaredAuthenticated: [SELECT, INSERT, UPDATE]
```

Root cause: `20261003000017` omitted the table-level `REVOKE ALL … FROM anon,
authenticated` that its own comment claims and every exemplar performs — while
this project carries broad `ALTER DEFAULT PRIVILEGES` on public tables. The RLS
policies remained the operative row gate (all cross-tenant probes PASSED), but
the declared defense-in-depth privilege posture did not hold. Correction:
`20261003000018_coregrid_v1_idempotency_privilege_revoke.sql` (+ rollback) —
authored, registered in the apply script with a new declarable
`privilegePostures` applied-state signature (exact per-role grant set probed
from `information_schema.table_privileges`), applied serialized
(`STATUS=PASS`), never editing the already-applied checksum-bound migration.

### Final live run (39/39)

Final verdict line (verbatim):

```
STATUS=PASS — 39/39 tables prove their declared posture: zero-policy tables prove deny-by-default (RLS on, zero permissive policies, no client grants, anon REST denied, strongest-form isolation); policy-backed tables (J-005/J-006 neutral tenant-membership policies, FORCED RLS) prove genuine cross-tenant isolation (Tenant B invisible, Tenant A own rows visible, expired binding denied, cross-tenant INSERT denied, forged grantor rejected, probes cleaned). Proven against the live database, not reasoned.
```

FINDINGS: **0** (30 zero-policy / 9 policy-backed). Posture inventory:
`--dry-parse-scope` → tables=39 zero-policy=30 policy-backed=9.

### Posture matrix (canonical, post-H3-wave)

| Tables | Posture | Proof |
|---|---|---|
| 30 (unchanged zero-policy fleet incl. `transport_buses`) | zero-policy deny-by-default | RLS on, zero policies, no client grants, anon REST denied — the strongest form |
| 3 neutral-membership exemplars (`cg_role_assignment`, `cg_role_grant`, `cg_org_membership`) | policy-backed, FORCE RLS | built-in §4.4 probes |
| 6 substrate tables (`cg_reconciliation_input`, `cg_event_route_subscription`, `cg_evidence_record`, `cg_usage_attribution_bucket`, `cg_file_object`, `cg_idempotency_record`) | policy-backed, FORCE RLS | data-declared §4.4 recipes (`cg_file_object` via the additive `$template` form for its derived `content_ref` CHECK) |

## 12. Verdict (post H3-wave)

J-041 / V1CAP-073 is database-proven on the dev project, on canonical
post-M-R-100, after the J-005/J-006 neutral membership policies, the H2-wave
substrate policy layer, and now the H3-wave file + idempotency substrates:
**39/39 PASS, 0 findings, live**. The battery caught one real authoring defect
(the missing table-level REVOKE) and the correction is itself checksum-bound
and posture-probed — the battery works as designed.
