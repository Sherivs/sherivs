# RUNBOOK — Incident lockdown (credential leak / suspected tenant-boundary break)

Status: **OPERATIONAL (operator procedure)** — this is the OPERATOR side of the
lockdown mission's contract. The lockdown subsystem itself is now implemented as
contracts; this runbook tells the operator how to drive them during an incident. No
code is authored here.
Contract mapped: MISSION-R-82 "Credential lifecycle, per-agent broker & emergency
lockdown" (J-007 no universal master credential; J-010 bounded authorized audited
emergency revocation/kill-switch) — mission-graph
`architecture/coregrid-mvp-architecture/reconstruction/COREGRID_V1_MISSION_GRAPH.json`
(`MISSION-R-82`, T2/T3): the lockdown is an "authorized kill-switch that suspends
execution classes, itself audited and itself revocable"; evidence required: "lockdown
denies execution; lockdown event audited; unauthenticated lockdown denied"; the
containment verifier proves "a compromised worker credential cannot reach resources
outside its scope".
Implemented contracts this procedure drives:
- `frontend/src/lib/security/lockdown.ts` — the typed, bounded, fail-closed LOCKDOWN at
  the authorization-decision boundary (J-010/G-034).
- `frontend/src/lib/security/credential-broker.ts` — per-agent credential broker with
  the per-lease kill switch (J-007/G-033): rotation invalidates all outstanding leases;
  the broker lockdown revokes ALL outstanding leases for the target and blocks further
  grants while active (module header `:29–37`).
Evidence suites: `tests/unit/mh-21-lockdown.test.ts`, `tests/unit/mh-25-credential-broker.test.ts`.
Also required by: L-H-027 ("minimal operational runbook set: incident/failure playbook …,
lockdown drill (J-010), and an applied-state reporting rule for operators",
`COREGRID_V1_ARCHITECTURE_HARDENING.json`).
Authority: AGENTS.md §5 (agents are untrusted by default), §15–18 (identity /
authorization / security fabric), §21 (AI output trust), §26 (never trust client
identifiers), §29 (observability — never log secrets), §30 (secrets), §31 (failure
tests: revoked access fails, agent cannot exceed permissions).

---

## 0. Triggers — declare an incident when

- A credential VALUE may have been exposed (committed, logged, pasted, leaked in an
  error page or transcript): any key matching the env names in §2's table, or any raw
  secret that should only ever have existed behind the credential broker's lease
  interface (`frontend/src/lib/security/credential-broker.ts:8–18`: agents never
  receive raw credentials, only scoped leases).
- A tenant boundary is suspected broken: a user reports cross-tenant rows, an anon REST
  probe returns rows, or the RLS battery records `ROW_LEAK_VIA_ANON_REST`
  (`scripts/verify-rls-isolation-battery.mjs:1368–1374`).
- A worker/agent behaves outside its permission scope (AGENTS §5; the mission graph's
  containment invariant T3; the broker's typed no-master invariant — a universal
  master credential cannot even be expressed,
  `frontend/src/lib/security/credential-broker.ts:40–46`).

Do NOT wait for confirmation to start Phase 1. False alarms cost minutes; a live leak
costs tenants.

## 1. The operator loop (security fabric, AGENTS §18)

Every phase below maps to the fabric lifecycle: Observe → Evaluate → Policy Check →
Decision → Enforcement → Audit → Re-evaluation. All operator actions are logged with
timestamps and actor; no secret value is ever written to logs, tickets, or this runbook
(AGENTS §29).

### Phase 1 — OBSERVE (confirm scope, without touching data)

1. Identify which credentials are in scope by NAME only. The project's secret surface
   is exactly these env var names (names only — never quote values):
   `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`. An anon key is public by design
   (`scripts/verify-rls-isolation-battery.mjs:582–589`); the service key and the access
   token are the privileged ones; `DATABASE_URL` is a direct-Postgres credential whose
   transport policy lives in `scripts/lib/pg-ssl.mjs` / `scripts/lib/pg-connect.mjs`.
2. Determine what the exposed credential could reach:
   - `SUPABASE_ACCESS_TOKEN` → management API (SQL channel used by
     `scripts/apply-canonical-hardening.mjs:92`,
     `scripts/restore-recovery-drill.mjs:64`, the battery
     `scripts/verify-rls-isolation-battery.mjs:638–649`, and
     `scripts/exercise-foundation-loop.mjs:45`) — highest blast radius.
   - `SUPABASE_SERVICE_ROLE_KEY` → BYPASSRLS data path; the battery proves it is the
     ONLY privileged data path and that its use is explicit and logged, never default
     (`scripts/verify-rls-isolation-battery.mjs:1518–1545`).
   - anon key → by itself no row access on a healthy posture (battery section (a));
     treat its leak as hygiene, not breach, unless the posture is broken.
3. Capture evidence first: the battery's `/opt/cursor/artifacts/rls-battery-results.*`
   and the apply record
   `architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json` are the pre-incident
   posture baseline; re-run the apply in `--verify-only` mode to detect any checksum
   drift before trusting them (`scripts/apply-canonical-hardening.mjs:15–17`,
   `:496–504`).

### Phase 2 — DECIDE + ENFORCE (containment)

Order of operations, fastest-reversible first. The lockdown contract's law is the
operator's checklist (`frontend/src/lib/security/lockdown.ts:11–41`):

1. **Revoke / rotate the leaked credential** — Supabase Dashboard → API keys / access
   tokens: rotate the named key. At the broker layer, rotation invalidates ALL
   outstanding leases on the old version immediately — no lease survives past the
   version it was granted against
   (`frontend/src/lib/security/credential-broker.ts:29–31`). Document the rotation time
   (audit trail, AGENTS §12 provenance).
2. **Declare the lockdown (kill-switch)** — through the contract, with its invariants:
   - **Guardian-only declaration**: the declaring identity MUST be on the
     caller-supplied authorized-guardian allowlist; there is no implicit, inferred, or
     self-claimed guardian authority
     (`frontend/src/lib/security/lockdown.ts:13–16`, `:306–315`). Unauthenticated or
     non-guardian lockdown attempts are refused AND audited (`LOCKDOWN_DECLARE_DENIED`,
     `:153–159`) — the mission-graph T2 evidence bar.
   - **Bounded scope**: exactly one of global / per-tenant / per-agent /
     per-capability (optionally narrowed to one tenant); scope/discriminator
     contradictions are refused (`:17–20`, `:324–347`). Prefer the narrowest scope that
     contains the blast radius; escalate to `tenant` or `global` only on evidence.
   - **Immediate fail-closed effect**: every request in scope is DENIED at the lockdown
     check, which runs BEFORE role/capability evaluation; CLEAR never means allowed
     (`:21–27`, `:460–470`).
   - **Exemptions are enumerated, never wildcards**: exact conjunction-matched tuples
     with a mandatory reason, frozen at creation; there is no runtime widening — the
     only mutation is lift (`:28–32`, `:261–282`). Use an exemption to keep the incident
     responder's own diagnostic capability alive, never a `*`.
   - **Mandatory audit**: declaration, every denied request, every exemption, lift, and
     every denied declaration/lift attempt flows through the audit sink — there is no
     unlogged lockdown (`:33–36`, `:141–207`).
   - **Bounded window**: an emergency lockdown always decays — a future `expiresAt` is
     mandatory (`:99–100`, `:316–318`). Set it to the incident's containment horizon and
     re-declare deliberately if containment runs long.
   Until the lockdown contract is wired into the live serving path, the equivalent
   manual enforcement is: revoke/rotate every credential in the affected class's scope
   AND suspend the workers/agents holding them (AGENTS §6 lifecycle: SUSPENDED). The
   broker lockdown is the mechanism for the lease half: it requires an explicitly
   authorized revoker, cannot be invoked by the agent it locks out, revokes ALL
   outstanding leases for the target, blocks further grants while active, and records
   itself as evidence-bearing audit material
   (`frontend/src/lib/security/credential-broker.ts:32–37`).
3. **Freeze canonical operations** — apply the exclusive-access law in its strictest
   form: no canonical apply, no drill, no battery seed path runs during active
   containment (`docs/runbooks/canonical-apply.md` §1; the lockdown "supersedes all
   other authorization outcomes",
   `COREGRID_V1_RECONSTRUCTED_ARCHITECTURE.json`, revocation/lockdown subsystem entry).
4. If data-plane writes must stop entirely, revoke the grants rather than editing
   rows — grants/policies change ONLY through migration + the canonical-apply runbook,
   never by editing the live catalog (`docs/runbooks/rls-battery.md` §5.2).

### Phase 3 — EVALUATE (prove or refute the boundary break)

1. Run the RLS isolation battery against the project
   (`docs/runbooks/rls-battery.md`), with the service-role contrast section ON this
   once (`COREGRID_BATTERY_ALLOW_SERVICE_ROLE=1`) so the privileged path is explicitly
   characterized (`scripts/verify-rls-isolation-battery.mjs:1518–1545`).
2. Read results by posture (`docs/runbooks/rls-battery.md` §3). A `ROW_LEAK_VIA_ANON_REST`
   or `tenantBInvisible=false` (the "TENANT B ROWS VISIBLE" invariant,
   `scripts/verify-rls-isolation-battery.mjs:1118`) is confirmed breach evidence; remember an
   "Invalid API key" response is INCONCLUSIVE, not a pass (`:82–84`).
3. Query the audit/event stores for the incident window (read-only, management
   channel). Event-security substrate families from the hardening wave
   (`cg_event_security`, `cg_event_security_denial`, `cg_event_security_redaction` —
   declared in `scripts/apply-canonical-hardening.mjs:130–147`) and the append-only
   `cg_execution_history` (append-only trigger re-created by
   `scripts/exercise-foundation-loop.mjs:101–109, 265–270`) are the records of denial
   and execution activity. The lockdown's own audit events (`LOCKDOWN_DECLARED`,
   `LOCKDOWN_REQUEST_DENIED`, `LOCKDOWN_REQUEST_EXEMPTED`, `LOCKDOWN_LIFTED`, and the
   denied variants — `frontend/src/lib/security/lockdown.ts:141–190`) are the incident
   decision log. Never modify any of them (AGENTS §28; ADR-005: tombstone, not delete).

### Phase 4 — REMEDIATE

1. If rows leaked across tenants: classify the exposure per the ADR-005 retention
   schedule (`architecture/coregrid-mvp-architecture/RETENTION_POLICY_SCHEDULE.md`).
   Erasure/removal of exposed personal data goes through the tombstone mechanism —
   append the erasure audit event, redact via the projection layer; never delete
   immutable records (ADR-005; ADR-008 E-4: tombstone-not-delete at every scope — see
   `architecture/coregrid-mvp-architecture/adr/ADR-008_CROSS_TENANT_ERASURE_AND_BACKUP_EXPIRY.md`).
   A subject spanning several tenants is erased per-tenant (ADR-008 Option 3: erasure
   is global-by-request, per-tenant-by-execution — no data operation ever crosses a
   tenant boundary), and each executed erasure event carries `erasureScope` =
   `tenant-scoped` or `platform-scoped` under a resolvable policy ID (E-1/E-2).
2. If schema posture regressed (policies missing, grants stray): author a corrective
   migration + rollback pair and apply it via `docs/runbooks/canonical-apply.md`
   (plan → execute → catalog verify → record, exclusive access).
3. If evidence/audit stores were damaged by the incident: recovery goes through
   `docs/runbooks/restore-recovery.md` — with the ADR-008 backup obligations of §5
   there (manifest completeness B-1, expiry bound B-2, redaction-layer reads B-3,
   restore re-applies redaction state B-4).
4. Re-run `scripts/exercise-foundation-loop.mjs` when the mission loop itself is
   suspected (it exercises the governed tail live and cleans its probe; exit 2 =
   `BLOCKED_NO_CREDENTIAL`, else the vitest exit code —
   `scripts/exercise-foundation-loop.mjs:39–42, 281`). It needs the built app being
   served at `FOUNDATION_LOOP_BASE_URL` (default `http://localhost:4173`, i.e.
   `npm run build && npm run preview` — `:184`).

### Phase 5 — RELEASE (the lockdown is itself revocable)

Release is an independent lift, not an off switch (`frontend/src/lib/security/lockdown.ts:36–39`,
`542–600`):

1. The lifter must be an authorized guardian AND must NOT be the declarer
   (`lift_independence_denied`, `:575–579`) — the emergency authority that declared the
   incident does not adjudicate its own end. An agent-scope lockdown cannot be lifted
   by the targeted agent (`self_lift_denied`, `:580–582`). A non-empty lift reason is
   mandatory (`:565`).
2. Preconditions recorded in the incident record before lifting: rotation complete,
   battery PASS with zero findings, remediation evidence recorded. The lift returns a
   NEW frozen declaration and is audited (`LOCKDOWN_LIFTED`, `:592–598`).
3. If containment runs long, prefer expiry-plus-re-declare over widening the original
   declaration — declarations and their exemption lists are frozen at creation and
   cannot be widened (`:30–32`); an active lockdown id can never be shadowed by a
   wider re-declaration (`:364–370`).
4. After lift: restore worker lifecycle states per AGENTS §6, lift the canonical
   freeze.

### Phase 6 — AUDIT + RE-EVALUATE

Write the incident record: timeline, credentials rotated (names + times only), the
lockdown declaration/lift chain (ids, scopes, guardians, reasons — from the audit
sink), battery verdicts (before/after), remediation migrations (with their apply record
paths), and the ADR-005/008 dispositions. Then re-evaluate controls (AGENTS §18 last
step): assign findings to the threat register (L-T family) and, if this was a drill,
record it as the J-010 lockdown-drill evidence L-H-027 requires. The lockdown and
credential-broker suites (`tests/unit/mh-21-lockdown.test.ts`,
`tests/unit/mh-25-credential-broker.test.ts`) are the standing proof that unauthenticated
lockdown is denied, denial is audited, and self-declaration/self-lift fail closed;
any incident that contradicts them is a contract regression, not just an operational
finding.

## 2. Operator rules of engagement (hard constraints)

1. **Never print, commit, or paste secret values** — including in tickets and this
   runbook (AGENTS §29/§30). Reference credentials by env-var NAME only. Scripts in
   this repo already scrub token/JWT shapes from evidence
   (`scripts/verify-rls-isolation-battery.mjs:758–766`,
   `scripts/exercise-foundation-loop.mjs:20–25`); keep that standard in incident
   artifacts. The broker's branded types make raw-secret leakage a type error
   (`frontend/src/lib/security/credential-broker.ts:62–75`) — don't route around it.
2. **Never weaken TLS during an incident** — `COREGRID_DB_INSECURE_TLS=1` is the
   explicitly logged last resort and must never be enabled against production; secure
   remediation is `COREGRID_DB_CA_CERT` or `NODE_EXTRA_CA_CERTS`
   (`scripts/lib/pg-ssl.mjs:10–15, 17–25, 31–34`;
   `scripts/lib/pg-connect.mjs:91, 109`).
3. **No ungoverned data access** — the operator reaches rows only through the
   privileged management channel (logged, explicit) or the service role when
   strictly necessary and logged as the `SERVICE_ROLE_USED_EXPLICITLY` discipline
   demands (`scripts/verify-rls-isolation-battery.mjs:1531`). Frontend checks,
   hidden routes, and UI state are not security (AGENTS §34).
4. **One canonical operation at a time** — even during incidents, serialize; a
   mid-incident concurrent apply is a second incident.
5. **AI output is untrusted** — any AI-assisted analysis of incident data is a
   proposal requiring validation before action (AGENTS §21); send only authorized,
   minimized, redacted context to models (AGENTS §19).

## 3. Quick reference — what to run, in order

| Step | Command / action | Exit codes | Evidence |
| --- | --- | --- | --- |
| Contain | rotate/revoke credentials (provider console); broker lockdown + contract lockdown declaration by an authorized guardian | n/a | rotation timestamp; `LOCKDOWN_DECLARED` audit event |
| Prove posture | `SUPABASE_URL=... SUPABASE_ACCESS_TOKEN=... node scripts/verify-rls-isolation-battery.mjs` (add `COREGRID_BATTERY_ALLOW_SERVICE_ROLE=1` once) | 0 PASS / 1 FAIL / 2 BLOCKED | `/opt/cursor/artifacts/rls-battery-results.{json,log}` (`scripts/verify-rls-isolation-battery.mjs:86–91`) |
| Check record drift | `SUPABASE_ACCESS_TOKEN=... node scripts/apply-canonical-hardening.mjs --verify-only` | 0 VERIFY_PASS / 1 VERIFY_FINDINGS / 2 BLOCKED | `<artifactsDir>/canonical-apply-hardening-verify.json` (`scripts/apply-canonical-hardening.mjs:522–540`) |
| Fix posture (if needed) | migration + `SUPABASE_ACCESS_TOKEN=... node scripts/apply-canonical-hardening.mjs [project-ref]` | 0 / 1 FINDING / 2 BLOCKED | `architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json` (`scripts/apply-canonical-hardening.mjs:47–51`) |
| Restore evidence (if needed) | `SUPABASE_ACCESS_TOKEN=... node scripts/restore-recovery-drill.mjs [project-ref]` | 0 PASS / 1 FAIL / 2 BLOCKED | `/opt/cursor/artifacts/restore-recovery-{transcript.log,results.json}` (`scripts/restore-recovery-drill.mjs:34–35`) |
| Live-loop sanity (if needed) | `SUPABASE_ACCESS_TOKEN=... node scripts/exercise-foundation-loop.mjs` against a served build | 2 BLOCKED / vitest exit | console transcript (`scripts/exercise-foundation-loop.mjs:39–42, 281`) |
| Release | independent guardian lift (lifter ≠ declarer, reason mandatory, audited) | n/a | `LOCKDOWN_LIFTED` audit event; incident record |

Runbooks referenced: `docs/runbooks/canonical-apply.md`,
`docs/runbooks/rls-battery.md`, `docs/runbooks/restore-recovery.md`.