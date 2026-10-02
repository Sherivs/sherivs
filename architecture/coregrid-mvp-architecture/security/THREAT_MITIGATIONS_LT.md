# THREAT_MITIGATIONS_LT — Threat-Mitigation Bundle L-T-001..014 (MISSION H2-14)

- **Artifact:** `architecture/coregrid-mvp-architecture/security/THREAT_MITIGATIONS_LT.md`
- **Mission:** H2-14 (Threat Modeling Engineer)
- **Source of truth:** `architecture/coregrid-mvp-architecture/reconstruction/COREGRID_V1_ARCHITECTURE_HARDENING.json`, `analyses.threat[]` (L-T-001..016; this bundle covers the roadmap-bounded scope **L-T-001..014** per `COREGRID_V1_BUILD_ROADMAP.md` line 58). L-T-015 (memory retrieval authorization bypass) and L-T-016 (context-switch bleed) are **out of this bundle's scope** and are NOT claimed here — they remain owned by L-H-019 / L-H-021 respectively.
- **Machine check:** `tests/unit/mh-14-threat-registry.test.ts` parses this document and asserts every L-T-0xx id in scope carries a verdict from `ENFORCED | PARTIAL | OPEN`.
- **Verdict semantics:**
  - `ENFORCED` — the required mitigation exists in THIS repo and has a concrete proof test or executed evidence artifact cited below.
  - `PARTIAL` — enforced in one layer with evidence, with a named OPEN remainder (with owner).
  - `OPEN` — no enforcement exists; owner proposal only.
- **Honesty law:** no verdict below is claimed ENFORCED without a cited enforcing file/contract AND a cited test or executed evidence artifact. Where a mitigation or its test is missing, it is registered as a finding with an owner proposal.

---

## L-T-001 — Scholar-fused universal authorization primitives

- **Threat:** Every universal cg_ substrate RPC (role assignment, org profile, workforce positions) was gated on `is_school_admin()` / `get_my_school_id()` resolved from `public.users.school_id` — a non-Scholar tenant could neither hold nor administer any role assignment, and platform authorization truth was anchored to a domain slice table (ElevationOfPrivilege, V1CAP-013, critical; I-001..I-005).
- **Evidence:** `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[L-T-001]`; STREAM_I findings I-002..I-005.
- **Verdict:** `ENFORCED` — the neutral tenant-membership primitives migration is authored AND applied to the authorized dev project, every universal RPC is re-gated on the neutral predicate, and the membership RLS policies use the neutral helpers. Residual (tracked, not a relaxation): the COND-003 tenant_id type ruling remains unresolved by design; the helpers take/return `text` with explicit casts and survive either ruling outcome unchanged.
- **Enforcing mechanism:**
  - `database/supabase/migrations/20261002000001_coregrid_v1_neutral_tenant_primitives.sql` (MISSION-R-20): `get_my_tenant_id()`, `holds_tenant_role(p_tenant, p_role_ref)`, `is_tenant_admin(p_tenant)` resolved only from `cg_org_membership` / `cg_role_assignment`; SECURITY DEFINER with EXECUTE revoked from PUBLIC/anon; missing substrate raises (fail-closed, observable); actor re-derived inside the helpers from `auth.uid()` — no client-supplied tenant/identity/role is ever trusted (Constitution §26). Re-gates (CREATE OR REPLACE, bodies otherwise byte-equivalent) every universal RPC: `list_workforce_positions`, `assign_workforce_position`, `end_workforce_position`, `get_org_profile`, `upsert_org_profile`, `list_role_assignments`, `assign_role`, `end_role_assignment`, `list_role_grants`, `grant_role_capability`, `revoke_role_capability`.
  - `database/supabase/migrations/20261002000013_coregrid_v1_neutral_membership_policies.sql`: RLS on the org substrate via `get_my_tenant_id()` / `is_tenant_admin()` — never the legacy domain helpers.
  - Applied posture: `architecture/coregrid-mvp-architecture/ratification/CANONICAL_APPLY_RECORD_MR100.json` (20261002000001 → ALREADY_APPLIED on project `nwrflbpbhyiqdptmlccm` via the authorized management-API transport) and `architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json` (20261002000013 → ALREADY_APPLIED, executed 2026-10-02).
- **Proof test:** `scripts/verify-neutral-tenant-primitives.mjs` (MISSION-R-20, read-only catalog verification: helpers exist, every re-pointed RPC body references the neutral predicate and no longer references `get_my_school_id`/`is_school_admin`, tenancy resolved only from the neutral substrate).
- **Missing test finding (OPEN):** no dedicated vitest unit suite guards the neutral helpers' source neutrality (e.g. that no gate predicate regresses to a domain helper). `tests/unit/kernel-purity.test.ts` covers the kernel only. Owner proposal: extend the domain-neutrality guard to the RPC migration bodies (L-H-001 follow-up, hardening stream).

---

## L-T-002 — Cross-tenant information disclosure via unproven RLS

- **Threat:** The "RLS enabled with zero policies = deny" posture on every cg_ table was statically reasoned, not database-proven in CI. A single malformed future policy could grant Tenant A access to Tenant B — the mandatory AGENTS §31 invariant — with no CI gate to catch it (InformationDisclosure, V1CAP-012, critical).
- **Evidence:** `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[L-T-002]`; STREAM H `unverifiedImplementations`.
- **Verdict:** `PARTIAL` — the RLS isolation battery exists in this repo and the enforcement posture is now database-proven (executed today via the hardening apply record), but the battery is credential-gated and is NOT wired to run automatically on every merge. The CI-on-every-merge requirement remains OPEN.
- **Enforcing mechanism:**
  - `scripts/verify-rls-isolation-battery.mjs` (MISSION-R-85 / J-041 / V1CAP-073): converts deny-by-default from statically reasoned to database-proven through two authorized transports — (1) Supabase REST with the shared publishable key (no rows leak through the public data plane), (2) management-API catalog queries (`relrowsecurity`, permissive-policy counts, privilege grants). Battery sections: ANON_REST_PROBE, CATALOG_ENFORCEMENT (zero-policy and policy-backed postures), PRIVILEGES.
  - Executed evidence: `architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json` `rlsPosture[]` — catalog-proven on 2026-10-02: every surveyed cg_ table has `rlsEnabled: true`, deny-by-default holds, posture ok.
  - Server-side tenant resolution (tenant spoofing impossible via API governance, Constitution §26) and the earlier dev-project RLS isolation check (`scripts/run-rls-isolation-check.mjs`) remain in place.
- **Proof test:** the battery script itself (live-credential-gated; not part of `npm test`). No offline unit test can prove database RLS by construction — that is exactly the threat.
- **Missing test finding (OPEN):** the battery must execute with live credentials in CI on every merge and block merge on failure (AGENTS §31: Tenant A cannot access Tenant B, revoked fails, expired fails). Owner: L-H-008 / J-041 (V1CAP-073). Until wired, verdict stays PARTIAL.

---

## L-T-003 — Delegation privilege escalation

- **Threat:** A worker (AI or human) receives a delegation and performs actions beyond the principal's authority, or re-delegates to expand its own reach. Mission/Delegation object contracts were unowned (J-024/J-025) and persistent governed worker definitions with authority bounds did not exist (J-027, LAUNCH_BLOCKER) (ElevationOfPrivilege, V1CAP-021, critical).
- **Evidence:** `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[L-T-003]`; STREAM_J gaps J-024/J-025/J-027.
- **Verdict:** `ENFORCED` — first-class bounded, revocable, non-escalating delegation contracts with acting-on-behalf-of semantics exist and are execution-gated; persistent worker definitions exist as code and as an applied substrate migration.
- **Enforcing mechanism:**
  - `frontend/src/lib/mission/delegation-contract.ts` (J-025): typed MissionDelegation contracts — bounded capability scope, expiry/notBefore, revocation with transitive chain invalidation, non-escalating (a delegate can never widen its reach beyond the chain it carries); contracts are stamped, validated and evaluated as-of an explicit instant (no implicit `Date.now()`).
  - `frontend/src/lib/agent-runtime/mission-runner.ts` (DEFECT-4 / V1CAP-021): `evaluateDelegatedStepGate` validates the delegation at execution time — expired/revoked/insufficient delegations block with a typed failure and the verdict is recorded as a mission lifecycle signal; re-evaluated on the next gated action of a long-running step.
  - Worker definitions (J-027): `frontend/src/lib/workforce/worker-definition.ts` + `database/supabase/migrations/20261002000002_coregrid_v1_worker_definitions.sql` — identity-linked capability set with explicit authority bounds; applied per `CANONICAL_APPLY_RECORD_MR100.json` (ALREADY_APPLIED).
  - Plan/execution separation preserved: `frontend/src/lib/control-plane/foundation-loop.ts` is a pure plan engine (the caller cannot supply tenant or verification decision); `frontend/src/lib/authorization.ts` Invariant 12 (role membership is never a source of agent authority; agents require explicit delegation).
- **Proof test:** `tests/unit/delegation-contract.test.ts`, `tests/unit/delegation-enforcement.test.ts` (expiry enforcement, revocation propagation, execution-time gate verdicts), `tests/unit/mission-contract.test.ts`, `tests/unit/agent-runtime-mission-runner.test.ts`, `tests/unit/authorization-exhaustive.test.ts` (Invariant 12: agent authority requires explicit delegation, never role membership).

---

## L-T-004 — Self-verification

- **Threat:** A worker verifies its own output inside the loop, converting generated claims into "verified" status without independent judgment (E-050); verification independence was declared but not enforced anywhere (J-035) (Repudiation, V1CAP-061, high).
- **Evidence:** `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[L-T-004]`; corpus rule E-050.
- **Verdict:** `ENFORCED` — verifier-identity independence is a checked contract in this repo, applied through the foundation loop's admit/verify separation, with violations raised as typed, observable errors.
- **Enforcing mechanism:**
  - `frontend/src/lib/verification.ts` (J-035): `checkVerificationIndependence` requires verifier identity ≠ producer identity for every verification result, including delegated-agent equivalence (a delegated worker's TRUE executor principal is resolved through the identity equivalence registry, so a delegation cannot launder self-verification); violations raise typed `VerificationIndependenceError`.
  - `frontend/src/lib/control-plane/foundation-mission.ts`: pure admit/verify engine; `frontend/src/lib/control-plane/foundation-loop.ts` refuses caller-supplied verification decisions (structurally separates admission from verification).
  - `cg_verification_result` is a distinct table: `database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql`.
- **Proof test:** `tests/unit/verification-independence.test.ts` (independence check across human/AI/delegated identities; foundation-loop integration of the independence rule).

---

## L-T-005 — Prompt injection through untrusted context

- **Threat:** Attacker-controlled content smuggles instructions into AI context and redirects model behavior into unauthorized actions. AI-specific runtime defenses (injection defense, exfiltration control, malicious-artifact defense) were declared but not implemented (J-036) (ElevationOfPrivilege, V1CAP-023, high).
- **Evidence:** `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[L-T-005]`; STREAM_J gap J-036.
- **Verdict:** `ENFORCED` — the three first-class defense families (E-062) are implemented at the gateway/runtime layer and unit-proven. Residual (tracked): supply-chain checks on tool/model integrations are registry-contract level (model registry + tool runtime substrate applied); deep artifact content scanning depth grows with the file plane (see L-T-011 finding).
- **Enforcing mechanism:**
  - `frontend/src/lib/ai-gateway/runtime-defenses.ts` (J-036 / L-H-014 / MISSION-R-84): injection guards (canary detection + block, instruction-source separation — untrusted instructions demoted to delimited data), malicious-artifact guards (unclassified/unscannable artifacts quarantined, never silently included in context), exfiltration guards (secret-shaped output blocked, never redacted; cross-tenant exfiltration blocked).
  - `frontend/src/lib/context-assembly.ts`: UNTRUSTED wrapping of externally-derived content with enforced downstream delimitation; the assembler never re-classifies untrusted content into trusted instructions, never grants authority, and every dropped candidate is audited with an explicit reason.
  - Tool runtime substrate: `database/supabase/migrations/20261002000012_coregrid_v1_tool_runtime.sql` (applied per `CANONICAL_APPLY_RECORD_HARDENING.json`).
- **Proof test:** `tests/unit/ai-gateway-runtime-defenses.test.ts` (all three defense families, negative-first), `tests/unit/context-assembly.test.ts`, `tests/unit/ai-gateway-output-trust.test.ts`.

---

## L-T-006 — Evidence-class laundering

- **Threat:** AI-generated, simulated or predicted content silently enters the record as direct observation, so downstream verification and canonical truth rest on fabricated provenance (J-034; Constitution §9 canonical-truth principle) (Tampering, V1CAP-059, high).
- **Evidence:** `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[L-T-006]`; Constitution §9.
- **Verdict:** `ENFORCED` — capture-time class discipline is implemented in code and backed by an applied substrate migration; laundering paths are rejected at capture.
- **Enforcing mechanism:**
  - `frontend/src/lib/evidence/capture.ts` (J-034 / L-H-010 / MISSION-R-90): the class is set at capture time; only `direct_observation` is canonical-truth eligible, the other classes are quarantine-classed; fail-closed capture (no anonymous evidence, no invented classes, no envelope violations); laundering prevention — direct_observation claims carrying AI-generated provenance markers are REJECTED (the same provenance is accepted for the correct class); promotion of quarantined classes requires an explicit governed verification step, never silent.
  - Substrate: `database/supabase/migrations/20261002000008_coregrid_v1_evidence_lifecycle.sql` — applied per `CANONICAL_APPLY_RECORD_HARDENING.json` (ALREADY_APPLIED, 9 declared objects verified).
  - Assembly-time trust classification: `frontend/src/lib/ai-context.ts` (`classifyContextTrust` marks source kinds at assembly time).
- **Proof test:** `tests/unit/evidence-capture.test.ts` (class discipline, fail-closed capture, laundering prevention), `tests/unit/adapter-evidence-capture-store.test.ts`.

---

## L-T-007 — Gateway bypass

- **Threat:** A caller invokes a model provider directly (or through a fallback path), escaping authorization, budget pre-check, rate limiting and metering — unmetered, unlogged, unauthorized AI spend and data flow (ElevationOfPrivilege, V1CAP-026, medium).
- **Evidence:** `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[L-T-007]`.
- **Verdict:** `PARTIAL` — gateway centralization is mechanically test-enforced at the import/adopt level and the registry keeps fallback routing inside the gateway perimeter; RUNTIME network egress enforcement (network policy allowing provider calls only from the gateway) does not exist in this repo and remains OPEN.
- **Enforcing mechanism (enforced part):**
  - Import-lint adoption tests: `tests/unit/ai-gateway-adoption-expense-insights.test.ts`, `tests/unit/ai-gateway-adoption-lesson-plan.test.ts`, `tests/unit/ai-gateway-adoption-timetable.test.ts` — no `@ai-sdk` provider factory may be constructed outside `ai-gateway*`; the gateway seam is the only model invocation path.
  - `frontend/src/lib/ai-gateway.server.ts`: fail-closed invariants (missing key → explicit unconfigured decision, never a live attempt); budget pre-check and rate limiting inside `invokeAiGateway`; fallback execution stays inside the gateway (model-level failover, not a blind retry) so every attempt passes the same gates.
  - `frontend/src/lib/ai-gateway/model-registry.ts` (J-014 / V1CAP-028 / MISSION-R-31): ALL routing lives inside the gateway perimeter; fail-closed construction; typed denials for unknown/unregistered routes; purpose-scoped fallback chains.
- **Proof test:** the three adoption suites above plus `tests/unit/ai-gateway-model-registry.test.ts` and `tests/unit/ai-gateway.test.ts`.
- **Missing test finding (OPEN):** runtime egress enforcement — no network-policy layer proves that provider endpoints are reachable only from the gateway process (J-014 runtime half). Owner: L-H-018. Until a runtime egress control exists, verdict stays PARTIAL.

---

## L-T-008 — Secret exfiltration through logs, context payloads, or the AI gateway

- **Threat:** Credential material (AI_API_KEY, deploy credentials, payment keys) leaks into structured logs, model prompts, or worker memory — a reusable exfiltration channel to external providers (InformationDisclosure, V1CAP-017, high).
- **Evidence:** `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[L-T-008]`.
- **Verdict:** `ENFORCED` — layered: keys never reach logs (scrubbed against the live key as defense in depth), the secret-redacting JSON-line logger is standard, secret scan runs in `npm run verify`, secrets are provisioned only via the Cursor Dashboard (RULING-11/COND-006), the per-agent credential broker (J-007) exists with no universal master credential and blast-radius containment, and secret-shaped AI outputs are blocked by the runtime defenses.
- **Enforcing mechanism:**
  - `frontend/src/lib/ai-gateway.server.ts`: no key material ever reaches a log line; every emitted field is scrubbed against the live key.
  - `frontend/src/lib/observability/structured-log.ts`: secret-redacting JSON-line logger (Constitution §29 — never log passwords/tokens/secrets).
  - `scripts/verification/secret-scan.mjs`: runs in `npm run verify`; secrets provisioned only via Cursor Dashboard, never in repo.
  - `frontend/src/lib/security/credential-broker.ts` (J-007 / MISSION-R-82): authority-scoped lease grant/deny, TTL expiry, usage budget exhaustion, rotation invalidation, non-observability (no raw secret ever serializes through a handle or the audit log), fail-closed on missing vault entries; pairs with `frontend/src/lib/security/lockdown.ts` (J-010) for blast-radius containment.
  - `frontend/src/lib/ai-gateway/runtime-defenses.ts`: secret-shaped output is BLOCKED (never redacted) on the exfiltration axis.
- **Proof test:** `tests/unit/credential-broker.test.ts` (non-observability, rotation, lockdown semantics), `tests/unit/observability-structured-log.test.ts`, `tests/unit/ai-gateway-runtime-defenses.test.ts`.
- **Residual note (tracked, not OPEN):** the broker is currently consumed as a contract/pure module; full credential-path rewiring onto brokered leases proceeds with the L-H-015 subsystem integration. The log/context exfiltration axes are enforced and tested today.

---

## L-T-009 — Payment webhook forgery or replay

- **Threat:** An attacker posts a forged or replayed webhook to convert it into a financial effect (credit, entitlement, settlement) without a real charge. Live signature verification had never been exercised (BLK-4) and idempotency existed only on the foundation loop, not as a cross-module standard (J-030) (Tampering, V1CAP-079, high).
- **Evidence:** `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[L-T-009]`; BLK-4.
- **Verdict:** `PARTIAL` — signature verification and replay rejection are implemented and unit-proven; the universal idempotency standard exists (see L-T-012). OPEN remainder: live signature-verified webhook evidence under BLK-4 before any live rail is enabled.
- **Enforcing mechanism (enforced part):**
  - `frontend/src/lib/payments/paystack-adapter.ts`: fail-closed HMAC-SHA512 signature verification against `x-paystack-signature` — missing/malformed/mismatching signatures and tampered bodies are rejected with typed error codes before any effect.
  - `frontend/src/lib/payments/replay-guard.ts`: two rejection axes — seen event ids (duplicates) and event timestamps outside the 300s tolerance (stale/future replay indicators); stateless-in/stateless-out.
  - Universal idempotency: `frontend/src/lib/command/idempotency.ts` (J-030), consumed by the payment adapters (`frontend/src/lib/payments/payment-contract.ts`).
  - Webhook source-of-truth posture: AGENTS §36 (never trust frontend payment state).
- **Proof test:** `tests/unit/payments-replay-guard.test.ts`, `tests/unit/payments-paystack-adapter.test.ts` (rejects a forged signature signed with the wrong secret, rejects a tampered body whose signature was computed over the original, fails closed on missing/malformed signature headers), `tests/unit/payments-paystack-testmode-live.test.ts` (credential-gated live TEST-MODE round — live keys are refused by the gate; no real money can move).
- **Missing test finding (OPEN):** live signature-verified webhook evidence under BLK-4 (COND-006) before any live payment rail — an operational proof, not a unit test. Owner: L-H-020. Until captured, verdict stays PARTIAL.

---

## L-T-010 — Cross-tenant event/realtime broadcast

- **Threat:** An event, subscription or notification delivers another tenant's state change to a subscriber — the realtime plane leaks what the RLS plane denies (AGENTS §35: never broadcast unauthorized events). Per-event security contract and tenant-scoped routing were unbuilt (J-021/J-022) (InformationDisclosure, V1CAP-043, high).
- **Evidence:** `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[L-T-010]`; AGENTS §35.
- **Verdict:** `ENFORCED` — the per-event security contract and tenant-scoped subscription routing are implemented, unit-proven, and backed by applied substrate migrations.
- **Enforcing mechanism:**
  - `frontend/src/lib/kernel/event-security.ts` (V1CAP-044 / J-022 / MISSION-R-81): an event WITHOUT its security contract is UNDELIVERABLE — denied to every subscriber, never broadcast with default security fields (fail-closed per AGENTS §35); the consumption gate authorizes per subscriber and per axis (tenant, declared visibility scope, sensitivity ceiling) with auditable DENY/REDACT records — no silent drops, no broadcast primitive; cross-tenant delivery never happens, including tenant-less events.
  - `frontend/src/lib/kernel/event-routing.ts` (V1CAP-043 / J-021 / MISSION-R-63): subscriptions are declared objects; every declaration field fails closed (taxonomy-registered type filters, visibility scopes, sensitivity ceiling, bounded queue); routing evaluates every event against every matching subscription THROUGH the security consumption gate — the routing layer never forks the gate's decision; zero subscriptions ⇒ zero deliveries; delivery authorization evaluated per-subscriber, not per-channel.
  - Substrate: `database/supabase/migrations/20261002000006_coregrid_v1_event_security.sql` and `20261002000007_coregrid_v1_event_routing.sql` — applied per `CANONICAL_APPLY_RECORD_HARDENING.json` (ALREADY_APPLIED, declared objects verified; catalog RLS posture deny-by-default, `rlsEnabled: true`).
- **Proof test:** `tests/unit/kernel-event-security.test.ts`, `tests/unit/kernel-event-routing.test.ts`, `tests/unit/adapter-event-security-store.test.ts`, `tests/unit/adapter-event-routing-store.test.ts`.

---

## L-T-011 — File-plane path escape

- **Threat:** A crafted contentRef/storage path escapes the tenant path prefix in the storage adapter, reading or writing another tenant's object. The V1 file plane has no substrate migration — the adapter's path-convention prefix was the only tenant enforcement below the pure access policy (InformationDisclosure, V1CAP-012, medium).
- **Evidence:** `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[L-T-011]`.
- **Verdict:** `PARTIAL` — the pure access policy and the adapter path convention are deny-by-default and adversarially tested; the V1 file substrate table with tenant-scoped RLS (so the database — not only a path convention — carries the boundary) does not exist in this repo and remains OPEN.
- **Enforcing mechanism (enforced part):**
  - `frontend/src/lib/files/access-policy.ts`: deny-by-default with explicit reasons; cross-tenant access ALWAYS denied including for platform super-admins (no control-plane bypass in V1); grants honored only while unexpired (`grant_expired` denial).
  - `frontend/src/lib/files/storage-adapter.server.ts`: `assertTenantScopedPath` — the tenant path convention holds even against a hostile or missing RLS policy; cross-tenant paths, traversal segments and bad expiries never reach the storage layer.
- **Proof test:** `tests/unit/files-storage-adapter.test.ts` (denies traversal and empty-segment paths; rejects `../../etc/passwd`; boundary negative-first), `tests/unit/files-access-policy.test.ts`, `tests/unit/files-contract.test.ts`.
- **Missing test finding (OPEN):** a V1 file substrate table with tenant-scoped RLS is missing (no file/storage substrate migration exists), so the database-level boundary cannot be battery-tested; grants are also not yet bound to V1CAP-016 authorization decisions at the DB layer. Owner proposal: author the file substrate migration + extend `scripts/verify-rls-isolation-battery.mjs` coverage to it (hardening stream, under L-T-011/L-H-008). Until then, verdict stays PARTIAL.

---

## L-T-012 — Command replay outside the foundation loop

- **Threat:** Consequential commands (workflow transitions, payment operations, notifications, worker tasks) are retried or maliciously re-submitted, double-executing financial or state effects because idempotency keys were not a cross-module standard (J-030) (Tampering, V1CAP-054, medium).
- **Evidence:** `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[L-T-012]`; STREAM_J gap J-030.
- **Verdict:** `PARTIAL` — the cross-module idempotency contract exists and is enforced at registration/replay semantics level (consequential commands without key enforcement are rejected at registration; replay returns the recorded outcome; collisions are rejected; TTL bounds replay trust), and the foundation loop's idempotent replay is live-verified. OPEN remainder: the durable DB-backed idempotency store (today's contract store is in-memory).
- **Enforcing mechanism (enforced part):**
  - `frontend/src/lib/command/idempotency.ts` (J-030 / V1CAP-054): a consequential command MUST declare idempotency key enforcement — anything else is rejected at registration, never registered; replay (same key + same payload) returns the RECORDED outcome with no new external effect (the executor is not invoked again); key collision (same key + DIFFERENT payload) is rejected explicitly; bounded TTL (expired records never replay stale outcomes); keys are tenant/actor-scoped and derived deterministically (`canonicalJson` + SHA-256).
  - Foundation loop: idempotent replay live-verified on the dev project (second call returned `replayed=true` with the same executionId).
  - Payments consume idempotency keys via `frontend/src/lib/payments/payment-contract.ts` and the adapters.
- **Proof test:** `tests/unit/command-idempotency.test.ts` (exactly-once replay, collision rejection, TTL expiry, key derivation determinism, registration rejection of non-idempotent consequential commands, tenant/actor scoping), `tests/integration/foundation-loop.live.test.ts` (credential-gated live replay proof).
- **Missing test finding (OPEN):** durable idempotency persistence — the contract store's interface is designed for a DB-backed store, but no durable idempotency substrate migration exists yet; the exactly-once guarantee under process restart is therefore not yet provable. Owner: L-H-017. Until landed, verdict stays PARTIAL.

---

## L-T-013 — Escalation and approval abuse

- **Threat:** The ESCALATE and REQUIRE_APPROVAL decision outcomes had no wired approval chains (J-032) and no emergency lockdown path (J-010), so an escalation either dead-ends (DoS on legitimate operations) or is resolved by an ungoverned shortcut; guardians themselves could become an unmonitored privilege path (ElevationOfPrivilege, V1CAP-032, high).
- **Evidence:** `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[L-T-013]`; STREAM_J gaps J-032/J-010.
- **Verdict:** `ENFORCED` — risk-classified human approval chains are wired to high-risk actions with a fail-closed executor gate; the workflow engine blocks AI-satisfied approvals; the five-valued decision model and agent self-escalation invariant are enforced; emergency lockdown exists at the authorization-decision boundary.
- **Enforcing mechanism:**
  - `frontend/src/lib/governance/approval-chains.ts` (J-032 / MISSION H2-20): risk → mandated-depth vocabulary (single-approver / two-person / quorum); approver eligibility requires capability + tenant scope + independence (NOT the proposer, never AI); approval record provenance per Constitution §12 (who approved what, under which policy, expiry); the executor gate is fail-closed — missing approval DENIED + audited, self-approval DENIED, expired approval DENIED, wrong-tenant approver DENIED.
  - `frontend/src/lib/workflow/workflow-engine.ts`: approval steps are blocked behind an approval record referencing a human — an AI actor can NEVER satisfy an approval step (Part 13 law; typed failures `ai_cannot_satisfy_approval`, `approval_not_awaited`).
  - `frontend/src/lib/authorization.ts`: five-valued decision model (ALLOW|DENY|REDACT|ESCALATE|REQUIRE_APPROVAL) with Invariant 12 — no autonomous agent may silently escalate its own authority (role membership is never a source of agent authority; agent authority requires explicit delegation).
  - `frontend/src/lib/jarvis/jarvis-contract.ts`: the Part 15 executive-orchestrator boundary where every MUST-NOT is an enforced deny.
  - `frontend/src/lib/security/lockdown.ts` (J-010 / G-034): typed, bounded, fail-closed LOCKDOWN denying execution at the authorization-decision boundary; the credential broker owns the per-lease kill switch.
- **Proof test:** `tests/unit/mh-20-approval-chains.test.ts`, `tests/unit/workflow-engine.test.ts`, `tests/unit/authorization-exhaustive.test.ts` (all five decision values), `tests/unit/jarvis-contract.test.ts`, `tests/unit/jarvis-escalation.test.ts` (critical severity forces human approval; no record may auto-resolve), `tests/unit/credential-broker.test.ts` (lockdown: revokes everything, audited, the locked-out agent cannot invoke it).

---

## L-T-014 — Environment-state falsification

- **Threat:** Claims of "live-verified" resting on a database whose canonical posture is "AUTHORED, NOT APPLIED" let insecure or drifted schema be treated as deployed truth (Repudiation, V1CAP-072, critical).
- **Evidence:** `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[L-T-014]`; STREAM H dev/canonical evidence-class split.
- **Verdict:** `ENFORCED` — the applied-migration manifest exists as environment state truth (J-040): every authorized apply records declared-vs-applied state with checksums and catalog verification, and the full cg_ V1 substrate (20261002000000..20261002000013 plus the role-assignment prerequisite) is recorded APPLIED to the approved dev project. Reporting conflating "live-verified once" with "deployed" is barred by the V1CAP-072 security boundary (drift = blocking nonconformance).
- **Enforcing mechanism:**
  - `architecture/coregrid-mvp-architecture/ratification/CANONICAL_APPLY_RECORD_MR100.json` (J-040, V1CAP-072): authorized management-API transport, exclusive serialized access; declared-vs-applied per file with sha256 checksums and rollback checksums; `20261002000000..20261002000004` + `20260907000800` recorded ALREADY_APPLIED / APPLIED_AND_VERIFIED (all declared objects present by pre-flight catalog probe).
  - `architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json` (MISSION-R-100 continuation, executed 2026-10-02): `20261002000005..20261002000013` recorded ALREADY_APPLIED with verification (`missingCount: 0`) and a catalog `rlsPosture[]` proving `relrowsecurity = true` deny-by-default on every surveyed cg_ table.
  - `scripts/apply-approved-v1-migrations.mjs`: applies ONLY the CTO-approved file list via the authorized management-API path — no unapproved migration can be applied by script.
  - Forward-only migration law: `frontend/src/lib/data-migration.ts` — an applied migration whose checksum no longer matches what the file offers is detected and rejected (a migration is never edited or re-run).
- **Proof test:** `tests/unit/mh-06-apply-marshal.test.ts` (checksum-honest apply manifest: every manifest checksum must equal the sha256 of the exact on-disk migration/rollback bytes; `--verify-only` credential-gated), `tests/unit/db-tooling-coherence.test.ts`; operational proof: the two apply records above (executed, checksummed, catalog-verified).
- **Missing test finding (OPEN):** no automated CI check asserts that every authored cg_ substrate migration file appears in an executed apply record with an APPLIED state (the manifest could silently fall behind future authored migrations). Owner proposal: registry-drift style guard over apply records (extend `scripts/verify-registry-drift.mjs` scope or a dedicated verify script; hardening stream, under L-H-003 follow-up). Verdict remains ENFORCED on the applied posture itself (recorded today with evidence), with this coverage gap tracked.

---

## Scope note

- `COREGRID_V1_ARCHITECTURE_HARDENING.json` `analyses.threat[]` additionally contains **L-T-015** (memory retrieval authorization bypass; owner L-H-019) and **L-T-016** (context-switch bleed; owner L-H-021). Both are outside the roadmap-bounded bundle L-T-001..014 and are deliberately NOT given verdicts here — they must not be read as claimed or dropped.
- Every citation above was verified against the repository at authoring time (file and test existence checked; verdicts downgraded to PARTIAL where an enforced layer was partial).