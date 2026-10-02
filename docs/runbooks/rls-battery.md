# RUNBOOK — RLS isolation battery (when to run, dual-posture reading, findings handling)

Status: **OPERATIONAL** — documents the live-executed battery (36/36 PASS on the
canonical project, 2026-10-02; see
`architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md` §7) plus
the H2-05 declarative posture registry and the offline CLI surface added to the script.
Script: `scripts/verify-rls-isolation-battery.mjs`
Contract: MISSION-R-85 / J-041 / V1CAP-073 (script header `:3–4`; battery dossier
`architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md`).
Authority: AGENTS.md §17 (RLS mandatory), §31 (testing standard — tenant isolation,
expired/revoked access, agent permission bounds), §29 (observability).

---

## 1. When to run

Run the battery (and record the run) whenever any of these holds:

1. **After every canonical apply** — the apply proves posture statically in-catalog;
   the battery "re-proves it live in Stage 3"
   (`scripts/apply-canonical-hardening.mjs:34–37`).
2. **After any migration touching RLS, policies, or grants** — the battery's scope is
   the declarative posture registry, applied on top of the built-in canonical posture,
   and its catalog queries re-enumerate every `cg_*` table
   (`scripts/verify-rls-isolation-battery.mjs:96–100`, `:840–866`, `:1221–1228`).
3. **Before Stage-4 launch gates** — "full live battery: RLS isolation, foundation
   loop" (`architecture/coregrid-mvp-architecture/COREGRID_V1_BUILD_ROADMAP.md` Stage 4).
4. **On suspicion of a tenant-boundary break** — this is the containment-verification
   tool named in `docs/runbooks/incident-lockdown.md` (§4 there).
5. **Periodically / on demand from an incident review** — the battery mutates nothing
   beyond logged, cleaned probe rows (script header honesty rules `:71–84`).

Serialized on exclusive canonical access: the battery's policy-backed probes seed rows
and users through the privileged management channel (`:873–1110`), so it must not run
concurrently with a canonical apply or the restore drill.

## 2. Modes and inputs (env var names only — values are never printed)

Three surfaces (`scripts/verify-rls-isolation-battery.mjs:676–749`):

| Invocation | What it does | Needs credentials? |
| --- | --- | --- |
| `node scripts/verify-rls-isolation-battery.mjs` | run the live battery | yes (`:650–654`) |
| `node scripts/verify-rls-isolation-battery.mjs --help` | print usage + posture-file schema | no — offline, no credentials touched (`:738–741`) |
| `node scripts/verify-rls-isolation-battery.mjs --dry-parse-scope` | resolve the declarative posture registry and print the battery scope (no credentials, no network, no live database) | no (`:742–745`, `:707–734`) |

The offline flags are handled BEFORE the credential gate (`:1575–1586`); importing the
module (unit tests) performs no I/O and never exits (`:574–577`, `:1580–1581`).

Live-battery env vars:

| Env var | Required | Role (cite) |
| --- | --- | --- |
| `SUPABASE_URL` | yes | data-plane base URL; project ref is derived from its hostname (`:568–572`). No project-ref argument exists for this script. |
| `SUPABASE_ACCESS_TOKEN` | yes (or in `.env.local`) | management API SQL channel; read from env then `.env.local` fallback (`:638–649`); missing → exit 2 (`:650–654`) |
| `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_ANON_KEY` | optional | env anon key; validated structurally against the project ref, role `anon`, unexpired (`:603–609`); otherwise the project's own legacy anon key is fetched through the already-authorized management API — no new credentials (`:610–623`) |
| `SUPABASE_SERVICE_ROLE_KEY` | optional | used ONLY for the §(e) opt-in contrast and the cross-tenant probe seed path (`:625–636`, `:980–983`) |
| `COREGRID_BATTERY_ALLOW_SERVICE_ROLE=1` | opt-in | enables section (e) service-role contrast; "Service-role usage is explicit and logged, never default" (`:64–68`, `:1518–1545`) |

The key values are never printed; only provenance (source, claims, 10-char prefix) is
logged (`:658–663`, `:1195`). Evidence is additionally scrubbed of token/JWT shapes
by `truncateEvidence` (`:758–766`).

## 3. The declarative posture registry (H2-05) — how scope is extended

Per-table posture is DATA, not code: every
`scripts/verification/rls-table-postures-*.json` file is parsed in lexical file-name
order and merged over the built-in canonical posture (`BUILTIN_TABLE_POSTURES`,
`scripts/verify-rls-isolation-battery.mjs:187–262` — the posture proven live 36/36 on
canonical 2026-10-02, 3 policy-backed + 33 zero-policy), so future policy migrations
extend the battery by adding data (`:96–100`).

Registry rules (never silent, `:137–140`):

- A table declared more than once (within or across files) is REJECTED — a security
  posture must have exactly one source of truth (`:457–460`).
- Every entry is validated fail-closed before use; an invalid posture file BLOCKS the
  battery instead of weakening any check (`:264–443`). Policy-backed entries MUST
  declare `tenantColumn` + the exact expected policy-name set + `forceRls: true`;
  zero-policy entries MUST NOT declare policies or FORCE (`:393–402`).
- A missing/unreadable posture directory yields the built-in canonical posture
  (`:484–503`); the run records which sources applied in `results.postureSource`
  (`:1180–1184`) and logs them (`:1199`).

Operator use: before a live run, `--dry-parse-scope` shows the resolved scope and
flags an invalid registry (exit 0 `DRY_PARSE_OK`, exit 1 `DRY_PARSE_FAIL` — `:707–734`).

## 4. Reading results — the dual posture

The battery runs five sections per table (`:18–68`): (a) ANON_REST_PROBE, (b)
CATALOG_ENFORCEMENT, (c) PRIVILEGES, (d) ISOLATION_PROOF, (e) SERVICE_ROLE_CONTRAST
(opt-in). Interpretation is posture-dependent — reading it wrong produces false
alarms:

| | zero-policy tables (33 of 36 built-in, e.g. `cg_entity`, `cg_event`, all Stage-3 substrate) | policy-backed tables (3 built-in: `cg_org_membership`, `cg_role_assignment`, `cg_role_grant` — `:196–232`) |
| --- | --- | --- |
| Pass condition | **DENY is the pass condition** — RLS on, zero permissive policies, no grants to anon/authenticated/PUBLIC, anon REST denied or zero rows (`:72–73`, `:1286–1308`, `:1345–1360`) | **tenant-scoped visibility** — RLS enabled AND forced AND exactly the declared policy set; authenticated gets SELECT/INSERT/UPDATE/DELETE, anon/PUBLIC none (`:1259–1284`, `:1310–1342`) |
| Isolation proof | strongest-form derivation: with zero policies no expression can evaluate true for any identity, so nobody reads (`:1474–1510`) | genuine §4.4 cross-tenant probes with real seeded tenants and auth principals (`:1413–1472`) |
| A "denied" read on this posture | PASS | **FINDING** — "a policy that denies Tenant A its own rows is a FINDING too" (`:75–76`, `:1435–1443`) |

Cross-tenant probe checks (`:881–1110`): Tenant A sees its own rows; Tenant B invisible;
every returned row belongs to Tenant A; expired binding (ended_on < CURRENT_DATE)
reads zero rows (`:1008–1024`, `:1058–1063`); cross-tenant INSERT denied (`:1086–1090`);
forged grantor rejected on `cg_role_grant` (`:1091–1100`); probes cleaned and
cleanup verified by re-count (`:939–976`).

Scope drift: a `cg_*` table present but outside the registry scope is INFO, not
failure (`:1221–1227`); an expected substrate table ABSENT is a FINDING (`:1228`).

## 5. Exit codes

| Code | Meaning | Cite |
| --- | --- | --- |
| `0` | PASS (live) — every table proves its declared posture; or `--help` / clean `--dry-parse-scope` | `:87`, `:741`, `:745`, `:1572` |
| `1` | FAIL (live) — at least one FINDING, "nothing is fixed"; or an invalid posture registry on `--dry-parse-scope` | `:88–89`, `:712–713`, `:1572` |
| `2` | `BLOCKED_NO_CREDENTIAL` (missing `SUPABASE_URL`/token, or no structurally valid anon key) | `:650–654`, `:664–668` |

Artifacts (outside the repo, per the header `:92–95`):
`/opt/cursor/artifacts/rls-battery-results.json` and `rls-battery-results.log` — note
the log is APPENDED per run (`:753–756`), so a run's evidence is delimited by its
`=== run <timestamp> project=<ref> ===` banner (`:1163`).

## 6. Findings handling

1. **Never auto-fix from a battery run.** The battery is a proving instrument; the
   header honesty rules state findings are recorded, not repaired (`:88–89`, `:1563–1566`).
2. Triage by finding code: `RLS_DISABLED`, `RLS_NOT_FORCED`, `POLICY_SET_MISMATCH`,
   `PERMISSIVE_POLICY_PRESENT` (`:1276–1282`, `:1299–1305`) are catalog regressions —
   fix via a new migration through `docs/runbooks/canonical-apply.md`, never by editing
   the live catalog. `STRAY_GRANTS` / `PRIVILEGE_POSTURE_MISMATCH` (`:1354–1359`,
   `:1338–1344`) mean grant drift — same treatment. `ROW_LEAK_VIA_ANON_REST`
   (`:1368–1374`) is a live leak — escalate immediately to
   `docs/runbooks/incident-lockdown.md`.
3. `INCONCLUSIVE_PROBE` is not a pass: an "Invalid API key" rejection proves nothing
   about row security (`:82–84`, `:810–816`). Re-run with a valid anon key; the key
   provenance line tells you which source was used (`:1195`).
4. Probe hygiene findings (`PROBE_CLEANUP_FAILED`, `PROBE_NOT_CLEANED`, `PROBE_ERROR` —
   `:970–976`, `:1138–1146`, `:1106–1112`) leave seeded rows/users behind. Clean them up
   manually through the management channel before the next canonical operation —
   leftover probe tenants violate the serialized-exclusive-access precondition of the
   apply and drill runbooks.
5. Record the run by keeping the artifacts and, where a mission requires it, appending
   the per-table matrix to
   `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md` (the
   dossier holds the 2026-10-01 dev record §2–§3 and the 2026-10-02 canonical record
   §5, §7).

## 7. Privileged-path discipline

The battery's seed/cleanup path mirrors `scripts/exercise-foundation-loop.mjs`
(auth-admin user management + management-channel SQL — `:77–81`, `:622–624`). The same
discipline applies here as everywhere: privileged usage is explicit, logged
(`PRIVILEGED_SEED_USED_EXPLICITLY`, `:885`), and never a default client data path;
probe data is non-secret by construction (`:1024`).