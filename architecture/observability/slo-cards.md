# CoreGrid V1 — SLO Cards (H3 wave, MISSION F-051)

Role: SLO Card Author (team H3-051, Squad F — Observability & Operations).
Authority: AGENTS.md §29 (Observability), §42 (Agent Report), §43 (Golden Questions);
H3 wave campaign law (architecture/campaigns/H3-WAVE-CAMPAIGN.md).

## Scope and honesty law

- **Card areas.** One card per V1 launch-criterion area — the 18 areas enumerated as data in
  `scripts/verify-launch-criteria.mjs` (canonical record:
  `architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_LAUNCH_CRITERIA.json`,
  status `CRITERIA_DEFINED_NOT_MET` at capture 2026-09-30). These areas are the V1 phase areas
  the harness maps to repo evidence.
- **Targets are PROPOSED.** No continuous measurement pipeline is deployed:
  `infrastructure/monitoring/README.md` records the observability stack as **"Not deployed."**
  (CF-9 pending), and the canonical criteria record is `CRITERIA_DEFINED_NOT_MET`. Therefore
  **every target in this document is PROPOSED**. No measured SLO attainment baseline exists and
  none is invented here.
- **Recorded single-run evidence is not a baseline.** Where a recorded live result exists
  (e.g. the RLS isolation battery ratification record), it is cited as one-shot recorded
  evidence, never converted into a continuous SLO target.
- **Grounding.** Every indicator names its measurement source as an existing repo artifact by
  path. Modules authored concurrently by H3 sibling teams (`metrics-registry.ts` H3-046,
  `trace-context.ts` H3-047, `deployment-gate.ts` H3-042, `health-map.ts` H3-049) are cited by
  path as the intended signal substrate; their content was not verified by this team.
- **Secrecy.** No card, indicator, or measurement source may carry secrets or identifiers into
  telemetry (AGENTS §19, §29, §30). Measurement sources cited here are, by their own contracts,
  redaction-gated: `frontend/src/lib/observability/structured-log.ts` (secret-key redaction,
  `Name: message` errors, pathname-only request logging) and
  `frontend/src/lib/observability/metrics-registry.ts` (structural no-secrets / no-identifier
  gate on every label value).

## Card fields

Every card carries exactly six fields: **Objective** (user-visible outcome), **Indicator**
(the service-level indicator and how it is computed), **Target** (PROPOSED), **Measurement
source** (existing path evidence), **Owner phase** (the V1 criterion area owning the outcome,
per the harness), **Error-budget policy** (PROPOSED action on budget exhaustion, tied to
existing fail-closed semantics — never a bypass of recorded gates).

## Error-budget policy — wave-wide PROPOSED posture

Until a criterion's measurement source is continuously observed, **no error budget is claimed
for that criterion** (AGENTS §10 honesty law; never claim applied/proven what was not
executed). When measurement comes online, the PROPOSED policy is:

1. **Budget definition (PROPOSED):** budget = 100% minus SLO attainment, tracked per criterion
   over a rolling 30-day window, using only signals from the cited measurement sources.
2. **Fail-closed priority (binding today):** verdicts of `degraded`/`failing` already have
   fail-closed semantics in the cited sources — `/health.json` serves 503 on `failing`
   (`frontend/src/routes/health[.]json.ts`), the Dockerfile HEALTHCHECK fails the container on
   non-ok fetch (`Dockerfile`), and the deployment gate blocks on anything but an unambiguous
   `ok` aggregate (`frontend/src/lib/observability/deployment-gate.ts`). Budget exhaustion must
   *tighten* these gates, never loosen them.
3. **Recorded gates are never bypassed:** budget exhaustion does not clear any recorded
   external gate (`BLK-2` AI provider key, `BLK-3` deployment credentials, `BLK-4` Paystack
   keys, `BLK-5` communication provider keys, `OPS-1` secure-TLS proof, `OPS-RISK-1/2` ops
   debt, `GOV-P63-DEFER-MINIMIZE` application-builder deferral — all recorded in
   `architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_BLOCKERS.json` and resolved
   only by the harness's recorded-gate rule).
4. **Launch verdicts are separate from budgets:** the harness verdict semantics
   (`proven` / `blocked` / `unproven`, exit 0/1/2 in `scripts/verify-launch-criteria.mjs`)
   remain the launch-readiness authority; SLO budgets are the operational authority once
   measurement is live. The two are never folded into each other (harness header law).

---

## SLO-01 PLATFORM

- **Objective:** an organization can be created end-to-end on a deployed environment.
- **Indicator:** share of organization-creation server invocations that complete with a
  success verdict (contract-complete, no fail-closed rejection).
- **Target:** PROPOSED — no measured baseline exists (criterion baseline `PARTIAL`; live
  dimension owned by recorded gate `BLK-3`).
- **Measurement source:** `frontend/src/lib/onboarding/onboarding-flow.ts`
  (`createOrganizationOnboarding`); `frontend/src/lib/org-model.ts` (universal org model,
  fails closed); outcome lines via `frontend/src/lib/observability/structured-log.ts`;
  serving availability via `frontend/src/routes/health[.]json.ts`.
- **Owner phase:** PLATFORM criterion (V1 launch definition, V5.3 Part 53/74); org-model
  substrate MISSION-V1-006.
- **Error-budget policy:** PROPOSED — a failed creation attempt consumes budget; repeated
  failure escalates to the recorded gate `BLK-3` owner rather than any code bypass.

## SLO-02 IDENTITY

- **Objective:** users and roles are securely managed with zero unauthorized identity actions.
- **Indicator:** (a) RLS isolation battery invariants pass rate over identity/role tables;
  (b) share of authorization decisions that resolve from the closed universal role vocabulary.
- **Target:** PROPOSED — one recorded live run exists (36/36 invariants PASS, findings 0, in
  `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md`); that is
  single-run recorded evidence, not a continuous baseline.
- **Measurement source:** `frontend/src/lib/universal-roles.ts` (closed role vocabulary,
  RULING-4); `scripts/run-rls-isolation-check.mjs` + recorded battery record;
  `tests/unit/role-substrate-proof.test.ts`.
- **Owner phase:** IDENTITY criterion (V5.3 Part 74; recorded VERIFIED substrate).
- **Error-budget policy:** PROPOSED — any cross-identity grant observed consumes 100% of that
  window's budget and triggers immediate incident review; no threshold softening permitted.

## SLO-03 ORGANIZATION

- **Objective:** organizational structures are represented by the universal, domain-neutral
  model without tenant bleed.
- **Indicator:** share of org unit/membership operations that resolve a server-side tenant
  and complete without a structural rejection; RLS pass rate over
  `cg_org_unit`/`cg_org_membership`.
- **Target:** PROPOSED — criterion baseline `PARTIAL`; `OPS-2` records the org tables applied
  with `rowsecurity=true` (recorded state, not a continuous measurement).
- **Measurement source:** `frontend/src/lib/org-model.ts` (`OrgUnitRef`, `OrgMembershipRef`,
  `principalRef`); `database/supabase/migrations/20261002000013_coregrid_v1_neutral_membership_policies.sql`;
  `COREGRID_V1_BLOCKERS.json` (OPS-2 entry); `tests/unit/domain-runtime-recertification.test.ts`.
- **Owner phase:** ORGANIZATION criterion (V5.3 Part 74).
- **Error-budget policy:** PROPOSED — any tenant-bleed observation is a zero-budget event
  (RLS battery law: findings must be 0, never absorbed).

## SLO-04 ENTITY

- **Objective:** domain entities, relationships, events and observations configure correctly
  on the universal kernel substrate.
- **Indicator:** kernel envelope + event-semantics suite pass rate; share of kernel writes
  landing with a valid envelope.
- **Target:** PROPOSED — substrate recorded VERIFIED (live-tested), but no continuous
  measurement pipeline exists.
- **Measurement source:** `database/supabase/migrations/20260903000000_coregrid_universal_kernel_substrate.sql`;
  `database/supabase/migrations/20261002000000_coregrid_v1_kernel_envelope.sql`;
  `tests/unit/kernel-envelope.test.ts` + `tests/unit/kernel-event-semantics.test.ts`.
- **Owner phase:** ENTITY criterion (V5.3 Part 74).
- **Error-budget policy:** PROPOSED — envelope-invalid writes must remain hard rejections
  (fail-closed); they consume budget and open findings, never get absorbed.

## SLO-05 WORKSPACE

- **Objective:** different actors receive appropriate experiences from durable workspace state.
- **Indicator:** share of workspace view resolutions served from persisted state with correct
  actor scoping; RLS pass rate over `cg_workspace`/`cg_workspace_member`.
- **Target:** PROPOSED — criterion baseline `PARTIAL` (durable persistence recorded but the
  actor-experience completeness is not continuously measured).
- **Measurement source:** `database/supabase/migrations/20260930000000_coregrid_v1_workspace_persistence.sql`
  (MISSION-V1-007); `frontend/src/lib/workspace-core.ts` + `frontend/src/lib/workspace-engine/views.ts`;
  `tests/unit/workspace.test.ts`.
- **Owner phase:** WORKSPACE criterion (V5.3 Part 74).
- **Error-budget policy:** PROPOSED — a cross-actor view resolution is a zero-budget event
  and routes to the multi-tenancy incident path (SLO-12).

## SLO-06 APPLICATION

- **Objective:** the Core Application Runtime substrate is available and healthy for the
  applications V1 actually serves (the application builder is deferred by recorded decision).
- **Indicator:** runtime contract conformance (suite pass rate) + runtime substrate serving
  health.
- **Target:** PROPOSED and explicitly DEFERRED-SCOPED — the authoring capability is
  deferred/minimized by recorded gate `GOV-P63-DEFER-MINIMIZE` (V5.3 Part 63
  `deferOrMinimize`); no target is set for unbuilt authoring capability, and none is claimed.
- **Measurement source:** `frontend/src/lib/kernel/phase-contracts/phase-05-application-runtime.ts`
  (status `implemented`); `frontend/src/lib/runtime-core.ts`; `tests/unit/runtime.test.ts`.
- **Owner phase:** APPLICATION criterion (gated by GOV-P63-DEFER-MINIMIZE).
- **Error-budget policy:** PROPOSED — budget applies only to the runtime substrate, never to
  the deferred builder; resuming builder work requires the gate owner, not budget recovery.

## SLO-07 WORKFLOW

- **Objective:** work is automated through governed workflow contracts with durable-execution
  semantics recorded honestly.
- **Indicator:** automation suite pass rate (core / actions / governance) as the contract
  conformance signal; in-memory engine contract is the declared layer (durable execution not
  persisted — recorded in the master implementation plan part63OrderCorrections).
- **Target:** PROPOSED — no continuous measurement; suites are the only current signal.
- **Measurement source:** `frontend/src/lib/automation-workflow.ts`;
  `frontend/src/lib/workflow/workflow-engine.ts` + `workflow-contract.ts`;
  `tests/unit/automation-core.test.ts`, `tests/unit/automation-actions.test.ts`,
  `tests/unit/automation-governance.test.ts`.
- **Owner phase:** WORKFLOW criterion (V5.3 Part 74).
- **Error-budget policy:** PROPOSED — a governance-suite failure (automation acting outside
  governance) consumes budget and blocks the workflow path fail-closed.

## SLO-08 AI

- **Objective:** AI workers perform only authorized missions through the centralized gateway.
- **Indicator:** (a) governed-inference attempt success rate under the gateway (live calls
  currently BLOCKED); (b) output-trust pipeline rejection correctness (proposals never
  executed unvalidated).
- **Target:** PROPOSED — live dimension owned by recorded gate `BLK-2` (AI provider key,
  recorded open and never bypassed). No live success-rate baseline exists or is claimed.
- **Measurement source:** `frontend/src/lib/ai-gateway/model-registry.ts`,
  `output-trust-pipeline.ts`, `reasoning-provenance.ts`; offline fail-closed/dry-run proofs
  recorded in `COREGRID_V1_BLOCKERS.json` (BLK-2); `tests/unit/ai-gateway*.test.ts`.
- **Owner phase:** AI criterion (gated by BLK-2).
- **Error-budget policy:** PROPOSED — an unvalidated-output execution attempt is a
  zero-budget event (AI Output Trust, AGENTS §21); live budget accounting starts only after
  BLK-2 clears and the E-041 live drill produces recorded evidence.

## SLO-09 EXECUTION

- **Objective:** agents perform governed actions with recorded execution and verification
  results.
- **Indicator:** governed loop replay success rate (the foundation loop is the recorded
  live-verified governed tail); AI-proposed action path is excluded from any claimed target
  until BLK-2 clears.
- **Target:** PROPOSED — one recorded live run exists (5/5 on dev, idempotent replay,
  rollback — recorded in `architecture/coregrid-mvp-architecture/COREGRID_V1_BUILD_ROADMAP.md`); not a continuous baseline.
- **Measurement source:** `scripts/exercise-foundation-loop.mjs`;
  `database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql`
  (`cg_mission_intent`/`cg_execution_record`/`cg_verification_result`);
  `tests/unit/foundation.test.ts`.
- **Owner phase:** EXECUTION criterion (residual gate: BLK-2 for AI-proposed actions).
- **Error-budget policy:** PROPOSED — a replay divergence consumes budget and freezes new
  mission intake until reconciled; the canonical-truth principle (AGENTS §9) forbids AI
  inference overwriting execution records.

## SLO-10 EVIDENCE

- **Objective:** CoreGrid can show what happened through append-only evidence history.
- **Indicator:** share of lifecycle acts recorded with complete evidence-lifecycle metadata;
  append-only integrity (zero mutations to historical evidence).
- **Target:** PROPOSED — substrate recorded VERIFIED; no continuous measurement deployed.
- **Measurement source:** `database/supabase/migrations/20261002000008_coregrid_v1_evidence_lifecycle.sql`;
  `frontend/src/lib/adapters/evidence-capture-store.adapter.ts`;
  `tests/unit/evidence-lifecycle.test.ts` + `tests/unit/evidence-capture.test.ts`.
- **Owner phase:** EVIDENCE criterion (V5.3 Part 74).
- **Error-budget policy:** PROPOSED — any mutation or silent loss of append-only evidence is
  a zero-budget event (immutable audit records, AGENTS §28).

## SLO-11 VERIFICATION

- **Objective:** CoreGrid determines whether results satisfy criteria through recorded,
  independent verification.
- **Indicator:** share of mission outcomes carrying a `cg_verification_result` verdict;
  independence-suite conformance.
- **Target:** PROPOSED — substrate recorded VERIFIED; not continuously measured.
- **Measurement source:** `frontend/src/lib/verification.ts`;
  `database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql`;
  `tests/unit/verification-independence.test.ts`.
- **Owner phase:** VERIFICATION criterion (V5.3 Part 74).
- **Error-budget policy:** PROPOSED — a verification bypass (self-verification) is a
  zero-budget event (worker independence law).

## SLO-12 MULTI-TENANCY

- **Objective:** organizations are isolated — deny-by-default, zero cross-tenant reachability.
- **Indicator:** cross-tenant probe rejection rate (RLS battery invariants); share of
  requests resolving a server-side tenant before data access.
- **Target:** PROPOSED — recorded single-run evidence: 36/36 invariants PASS, findings 0
  (cross-tenant probes), in `architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md`.
  Continuous target remains PROPOSED at 100% (probes rejected), never negotiated.
- **Measurement source:** `scripts/run-rls-isolation-check.mjs` + recorded battery record +
  structured artifact at `/opt/cursor/artifacts/rls-battery-results.json` when present
  (consumed read-only by `scripts/verify-launch-criteria.mjs`);
  `frontend/src/lib/tenancy/tenant-resolution.ts`.
- **Owner phase:** MULTI-TENANCY criterion (V5.3 Part 74).
- **Error-budget policy:** BINDING-floor proposal — any cross-tenant reachability consumes
  the entire budget for all windows and halts the owning change stream; tenant isolation has
  no spendable error budget by design (CoreGrid mandatory-testing law, AGENTS §31).

## SLO-13 SECURITY

- **Objective:** permissions are enforced server-side; no authorization bypass exists.
- **Indicator:** security/authorization suite conformance; retention-schedule gate pass;
  secure-TLS database proof (currently owned by `OPS-1`).
- **Target:** PROPOSED — core recorded VERIFIED with recorded ops debt (`OPS-RISK-1/2`); the
  unmeasured ops dimensions stay PROPOSED and gated, never claimed.
- **Measurement source:** `tests/unit/security-core.test.ts`, `tests/unit/security-events.test.ts`,
  `tests/unit/authorization-exhaustive.test.ts`; `frontend/src/lib/security/credential-broker.ts`;
  `scripts/verify-retention-schedule.mjs` (ADR-005 gate);
  `COREGRID_V1_BLOCKERS.json` (OPS-1, OPS-RISK-1/2).
- **Owner phase:** SECURITY criterion (residual gates OPS-1, OPS-RISK-1/2).
- **Error-budget policy:** PROPOSED — a credential-broker over-scoping or revoked-access
  success is a zero-budget event; the TLS gap is closed only by clearing OPS-1 with recorded
  evidence, never by policy relaxation.

## SLO-14 COMMUNICATION

- **Objective:** organizations reach users through governed communication channels.
- **Indicator:** per-channel dispatch outcome rate (success / degraded / fail-closed) by
  channel; web push is the only live-verified channel today.
- **Target:** PROPOSED — live email/SMS/voice dimensions owned by recorded gate `BLK-5`
  (provider keys, recorded open). Web-push target is PROPOSED; no measured baseline exists.
- **Measurement source:** `frontend/src/lib/communication-core.ts`,
  `frontend/src/lib/communication-providers.ts`, `frontend/src/lib/push.server.ts`;
  `frontend/src/lib/notifications/notification-contract.ts`; dispatch outcomes via
  `frontend/src/lib/observability/structured-log.ts` (no content, no addresses in logs).
- **Owner phase:** COMMUNICATION criterion (gated by BLK-5).
- **Error-budget policy:** PROPOSED — a delivery provider outage degrades the channel to
  fail-closed rather than retrying without bound; budget accounting per channel starts after
  BLK-5 clears and the E-044 communication probe records evidence.

## SLO-15 PAYMENTS

- **Objective:** supported organizations process transactions with signature-validated,
  idempotent, replay-safe rails.
- **Indicator:** (a) webhook signature-validation rejection correctness; (b) duplicate-payment
  replay attempt rejection rate; (c) live transaction success rate (currently BLOCKED).
- **Target:** PROPOSED — live dimension owned by recorded gate `BLK-4` (Paystack live/secret
  key, recorded open). Contract-conformance signal exists; no live baseline exists.
- **Measurement source:** `frontend/src/lib/payments/payment-contract.ts`,
  `paystack-adapter.ts`, `replay-guard.ts`; `tests/unit/payments-contract.test.ts`,
  `tests/unit/payments-replay-guard.test.ts`; live evidence procedure per the BLK-4 drill
  (payment-rail drill runbook, Squad E-043).
- **Owner phase:** PAYMENTS criterion (gated by BLK-4).
- **Error-budget policy:** PROPOSED — a replayed transaction that succeeds, or a signature
  check that passes an invalid payload, is a zero-budget event (payment security, AGENTS §36);
  frontend payment state is never trusted.

## SLO-16 OBSERVABILITY

- **Objective:** operators know whether the system works — health, metrics, traces, logs.
- **Indicator:** (a) `/health.json` endpoint availability + freshness (200 ok|degraded, 503
  failing); (b) container HEALTHCHECK pass rate; (c) serving-URL deployment-gate verdicts;
  (d) dependency-health map posture coverage (declared vs observed checks); (e) metric
  observation acceptance rate with bounded cardinality and zero secret-shaped labels.
- **Target:** PROPOSED — the monitoring stack is recorded "Not deployed" (`infrastructure/monitoring/README.md`)
  and the live serving-URL dimension is owned by recorded gate `BLK-3`. The signal contracts
  below exist; no attainment baseline exists.
- **Measurement source:** `frontend/src/routes/health[.]json.ts` + `frontend/src/lib/observability/health.ts`
  (fixed whitelist, fail-closed to `failing`); `Dockerfile` HEALTHCHECK contract;
  `frontend/src/lib/observability/deployment-gate.ts` (BLK-3 gate contract, H3-042);
  `frontend/src/lib/observability/health-map.ts` (dead/unknown checks force `failing`, H3-049);
  `frontend/src/lib/observability/metrics-registry.ts` (closed metric vocabulary, bounded
  label cardinality, no-PII gate, H3-046); `frontend/src/lib/observability/trace-context.ts`
  (trace_id/correlation_id propagation, H3-047);
  `frontend/src/lib/observability/substrate-telemetry.ts` (adapter policy-event aggregation,
  H2-27); `infrastructure/monitoring/README.md` (signal retention: metrics 30d, logs 30d,
  traces 7d; API latency/error-rate SLO-based with an error budget — the recorded contract
  this card instantiates).
- **Owner phase:** OBSERVABILITY criterion (V5.3 Part 30 observability-minimal substrate;
  current in-flight construction by Squad F).
- **Error-budget policy:** PROPOSED — this card's own family: when health reports `failing`,
  the budget is spent for the window and the serving gate must block (503 + HEALTHCHECK fail
  + deployment gate BLOCKED); `degraded` continues serving with recorded budget consumption.

## SLO-17 ECONOMICS

- **Objective:** AI/resource consumption is measured and attributed with roll-up conservation.
- **Indicator:** metering roll-up conservation rate — every in-scope consumption record lands
  in exactly one attribution bucket (defects surface, never absorbed).
- **Target:** PROPOSED — criterion baseline `NO` (V1-minimal required); substrate is being
  built (usage ledger, cost attribution migration) with no continuous measurement yet.
- **Measurement source:** `frontend/src/lib/metering/usage-ledger.ts` +
  `frontend/src/lib/metering/cost-attribution.ts`;
  `database/supabase/migrations/20261002000010_coregrid_v1_cost_attribution.sql`;
  `frontend/src/lib/adapters/cost-attribution-store.adapter.ts`;
  `tests/unit/adapter-cost-attribution.test.ts` (metering-reconciliation depth is Squad I-093).
- **Owner phase:** ECONOMICS criterion (V5.3 Part 74).
- **Error-budget policy:** PROPOSED — an absorbed or double-counted consumption record is a
  zero-budget event (conservation law, J-043); costs are attributed, never estimated away.

## SLO-18 EXTENSIBILITY

- **Objective:** another domain can be added without rebuilding CoreGrid (domain neutrality).
- **Indicator:** domain-neutrality guard pass rate; second-domain recertification oracle
  conformance (Scholar + restaurant runtimes).
- **Target:** PROPOSED — criterion baseline `PARTIAL`; second-domain proof is Part 64 scope.
  The standing guard is a repo gate, not a continuously observed SLO signal.
- **Measurement source:** `frontend/src/lib/domain-config/restaurant.ts` (second-domain fixture);
  `tests/unit/domain-runtime-recertification.test.ts`; `architecture/registry.json`
  (runtimes: scholar + restaurant); `scripts/verify-domain-neutrality.mjs` (shrink-only ratchet).
- **Owner phase:** EXTENSIBILITY criterion (V5.3 Part 74; Part 64 second-domain proof).
- **Error-budget policy:** PROPOSED — a neutrality-guard failure blocks the change stream
  (shrink-only ratchet); domain vocabulary leaking into the substrate is a zero-budget event.

---

## Evidence summary

| Card | Area (harness id) | Recorded state today | Key measurement sources |
| --- | --- | --- | --- |
| SLO-01 | PLATFORM | PARTIAL; gate BLK-3 | onboarding-flow.ts, org-model.ts, health[.]json.ts |
| SLO-02 | IDENTITY | VERIFIED (recorded 36/36 battery run) | universal-roles.ts, run-rls-isolation-check.mjs, RLS_ISOLATION_BATTERY.md |
| SLO-03 | ORGANIZATION | PARTIAL; OPS-2 recorded | org-model.ts, neutral membership policies, blockers JSON |
| SLO-04 | ENTITY | VERIFIED | kernel substrate + envelope migrations, kernel suites |
| SLO-05 | WORKSPACE | PARTIAL | workspace persistence migration, workspace-engine/views.ts |
| SLO-06 | APPLICATION | deferred (GOV-P63) | phase-05 contract, runtime-core.ts |
| SLO-07 | WORKFLOW | PARTIAL | automation/workflow modules + suites |
| SLO-08 | AI | PARTIAL; gate BLK-2 | ai-gateway/* modules, blockers JSON |
| SLO-09 | EXECUTION | VERIFIED (recorded 5/5 loop run); residual BLK-2 | exercise-foundation-loop.mjs, mission substrate migration |
| SLO-10 | EVIDENCE | VERIFIED | evidence lifecycle migration, evidence-capture adapter |
| SLO-11 | VERIFICATION | VERIFIED | verification.ts, cg_verification_result substrate |
| SLO-12 | MULTI-TENANCY | VERIFIED (recorded 36/36, findings 0) | run-rls-isolation-check.mjs, tenant-resolution.ts |
| SLO-13 | SECURITY | VERIFIED core; OPS-1/OPS-RISK debt | security suites, credential-broker.ts, retention gate |
| SLO-14 | COMMUNICATION | PARTIAL; gate BLK-5 | communication-core.ts, notifications contract |
| SLO-15 | PAYMENTS | PARTIAL; gate BLK-4 | payment-contract.ts, paystack-adapter.ts, replay-guard.ts |
| SLO-16 | OBSERVABILITY | stack "Not deployed"; gate BLK-3 for serving URL | health[.]json.ts, health.ts, Dockerfile, deployment-gate.ts, health-map.ts, metrics-registry.ts, trace-context.ts, substrate-telemetry.ts, monitoring README |
| SLO-17 | ECONOMICS | NO (V1-minimal required) | metering usage-ledger/cost-attribution, cost attribution migration |
| SLO-18 | EXTENSIBILITY | PARTIAL (Part 64 pending) | domain-config/restaurant.ts, recertification oracle, neutrality guard |

## Golden Questions (§43)

- **WHO?** Operators and phase owners; per-card owner = the V1 criterion area's owning phase
  substrate as recorded in the harness evidence.
- **WHAT?** SLO cards (objective/indicator/target/measurement source/owner phase/error-budget
  policy) per V1 criterion area.
- **WHERE?** `architecture/observability/slo-cards.md`; signals live in the cited
  `frontend/src/lib/observability/*` contracts, `/health.json`, the Dockerfile HEALTHCHECK,
  and the recorded battery/ratification records.
- **WHY?** Launch rule (V5.3 Part 53) requires operational evidence on a deployed
  environment; SLOs make "operational" measurable once deployment and monitoring come online.
- **UNDER WHICH POLICY?** AGENTS §29 (observability), §31 (testing standards), §42 (report
  honesty), §10 campaign law (no faked evidence); error budgets defer to recorded gates and
  fail-closed verdicts, never bypass them.

## Provenance

- Authored by team H3-051 (SLO Card Author), H3 wave, 2026-10-03.
- Sources read (no code modified beyond this file + the §42 report):
  `scripts/verify-launch-criteria.mjs`;
  `architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_LAUNCH_CRITERIA.json`;
  `architecture/campaigns/H3-WAVE-CAMPAIGN.md`; `frontend/src/lib/observability/*`
  (health.ts, structured-log.ts, substrate-telemetry.ts, metrics-registry.ts, trace-context.ts,
  deployment-gate.ts, health-map.ts — the latter four are sibling-team in-flight work, cited
  by path only); `frontend/src/routes/health[.]json.ts`; `Dockerfile`;
  `infrastructure/monitoring/README.md`.
- Every target in this document is PROPOSED. No measured SLO baseline exists.