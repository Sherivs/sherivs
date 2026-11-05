# Sherivs Master Engineering Audit

**Audit status:** Provisional; all 16 read-only workstreams have reported. Evidence reconciliation is in progress; the focused webhook security finding has been remediated locally and awaits CI/review.  
**Baseline:** `master` at `e4be19c` (2026-11-05).  
**Decision:** **NO-GO for full commercial production launch on evidence currently available.** This is not a claim that every deployed Scholar function is broken; the repository does not yet demonstrate all launch-critical workflows and production controls end to end.

## Executive findings

1. **User-facing workspaces are incomplete.** Role navigation advertises web routes that do not exist for parents, teachers, and students. Parent, bursar, and driver route surfaces are absent; many non-teaching staff roles have permissions but no workspace chrome. The workspace preview is explicitly synthetic. The admin shell has functional role-management and special-case mobility/ASC screens, but most responsibility sections render only generic empty-state content rather than records/actions. Evidence: `frontend/src/lib/runtime/scholar-nav-catalog.ts:20-149,180-287,295-432,442-507,663-690`; `frontend/src/components/workspaces/fixtures/workspace-preview.tsx:129-167`; `frontend/src/lib/runtime/scholar-workforce-nav.ts:24-40`; `frontend/src/components/app-shell/section-screen.tsx:23-69`; `frontend/src/components/app-shell/role-management-screen.tsx:112-171,226-343`. Student mobile results, attendance, and CBT are service-backed, but mobile teacher flows are not.
2. **The canonical tenant/data substrate is unresolved across domains.** Several CoreGrid migrations explicitly say authored, not applied; the CoreGrid schema uses `tenant_id text` while the Scholar tenant uses `schools.id uuid`, and other domains use `org_id`, `school_id`, or `org_ref`. Migration prerequisites and deployment state require a canonical, read-only reconciliation before any production migration. Evidence: `database/supabase/migrations/20261002000000_coregrid_v1_kernel_envelope.sql:5,48-67`; `20261002000001_coregrid_v1_neutral_tenant_primitives.sql:4,65-71`; `20261002000003_coregrid_v1_kernel_bitemporal.sql:5-18`; `20261103130000_sv1_m07_fees_ledger_receipts.sql:4-35,49-111`; `20261022000200_sherivs_013_payments_audit_entitlements.sql:15-35,83-113`.
3. **Production operations are configured but not proven operational.** A fail-closed release workflow, Docker deployment, Terraform, and encrypted backup workflow exist, but required credentials/configuration are operator-supplied; monitoring is explicitly not deployed, alert routing is unverified, and no independent restore drill was evidenced. No production endpoint, cloud resource, credential, or backup artifact was contacted during this audit. Evidence: `.github/workflows/release.yml:86-125`; `infrastructure/deploy/deploy.sh:76-123`; `.github/workflows/nightly-db-backup.yml:1-119`; `infrastructure/monitoring/README.md:20-27`; `docs/architecture/observability.md:3-19`.
4. **AI and digital-twin capabilities are chiefly contracts/prototypes.** Role context and digital-twin models exist, but the twin, durable memory, approvals, agent missions, and tool audit are not demonstrated as one durable production runtime. Several approval and tool-runtime paths are in-memory; memory and CoreGrid migrations are authored but not applied. The AI gateway has a legacy direct-model path when no model registry is wired. These advanced capabilities should be staged, not represented as launch-ready. Evidence: `frontend/src/lib/twin-core.ts:82-139`; `frontend/src/lib/scholar/roles/role-context-engine.ts:14-17,74-153`; `frontend/src/lib/runtime-approval.ts:55-70,80-110,180-230`; `frontend/src/lib/workforce/tool-runtime.ts:199-223,351-356`; `frontend/src/lib/ai-gateway.server.ts:590-608,770-778`; `database/supabase/migrations/20261002000004_coregrid_v1_memory_tier.sql:1-20,223-291`.
5. **Communication channels have uneven completeness.** Resend has a tested adapter, WhatsApp is inbound-focused with an unapplied migration, voice is gated with an unapplied migration, outbound SMS was not found, and escalation is not a durable configurable on-call workflow. Evidence: `frontend/src/lib/communication-channels.ts:20-220`; `database/supabase/migrations/20261101000020_sherivs_whatsapp_cloud.sql:1-110`; `database/supabase/migrations/20261031000010_sherivs_107_voice_ai_support_line.sql:1-24`; `frontend/src/lib/communications/africas-talking-voice.server.ts:78-106`.
6. **Serverless is implemented as application API routes, not Supabase Edge Functions.** Paystack and WhatsApp handlers include signature and payload controls, but the repository has no Supabase Edge Function surface. One report flags the integrations-sync cron authorization construction while another finds fail-closed cron checks; this discrepancy is not treated as a confirmed defect until reconciled. Evidence: `database/supabase/config.toml:1-5`; `frontend/src/routes/api/public/webhooks/paystack.ts:78-130`; `frontend/src/routes/api/public/webhooks/whatsapp.ts:239-343`; `frontend/src/routes/api/public/cron/integrations-sync.ts:8-46`.
7. **Financial operation is not production-proven.** The M07 ledger/invoice schema is authored but not applied; payment adapters and webhook tests cover contracts, but actual provider settlement is unverified and refunds are disabled. A focused review confirmed the generic webhook verifier did not authenticate request content and the signer was not cryptographic; no in-repo production caller was found. The helper is now HMAC-SHA256 over the exact raw body and timestamp with constant-time comparison, with focused tests passing locally; CI/review remain pending. Evidence: `database/supabase/migrations/20261103130000_sv1_m07_fees_ledger_receipts.sql:1-3,73-276`; `frontend/src/lib/payments/paystack-adapter.ts:170-234,262-264`; `frontend/src/lib/runtime-webhooks.ts`; `tests/unit/runtime-extended.test.ts`.
8. **Automated testing is broad but does not prove all launch journeys.** Verify runs unit tests and selected E2E/integration/security checks, but the full Playwright suite is not CI-gated, the critical-flow script can exit as `SKIPPED` without `--live`, and several local SQL/failure/chaos tests are not wired into CI. Live RLS/recovery batteries are credential-gated and may be blocked rather than failed. Evidence: `.github/workflows/verify.yml:21-245`; `.github/workflows/security-batteries.yml:48-76,92-171,173-260`; `scripts/verify-critical-flows.mjs:22-51`; `package.json:12-20,50-52`.
9. **R1 is progressing; R3/R9 remain dependent work.** The current `master` baseline has no #332 registry implementation. Draft PR #336 holds the R1 implementation and had a provenance failure because ADR-051 did not use an accepted creator identity. The attribution is fixed in commit `21f2fd5`; 47 focused tests, typecheck, provenance validation, and whitespace validation passed locally. Updated-head remote CI is pending. R3 (#334) is authorized but needs a reviewed persistence/migration decision; R9 (#335) depends on R3 and must extend the existing website generator, not create a parallel one.

## Existing strengths

- CI includes typecheck, unit tests, secret scanning, registry/drift/neutrality checks, migration simulation, and UI/E2E checks; infrastructure verification has separate Terraform and Kubernetes validation.
- The release workflow is approval-gated and fails closed if deployment credentials are absent; deployment scripts include health checks and rollback.
- Paystack webhook validation includes signature checking, bounded input, schema validation, and server-side settlement checks.
- AI provider routing, tool permissions, tenant checks, leases, budgets, and denial paths have substantial unit-test coverage.
- Student mobile results, attendance, and CBT are connected to service calls; some finance and messaging surfaces remain partial.
- The RLS design includes forced-RLS, deny-by-default patterns, service-role-only access for sensitive surfaces, and local cross-tenant SQL batteries; however, effective deployed state and whether all batteries block CI remain unverified.

## Go-live blockers, ranked

### P0 — Required for any controlled production launch

- Implement or explicitly remove/disable advertised dead-end user journeys; at minimum define and prove the launch-critical admin, teacher, student, guardian, and finance flows.
- Reconcile the deployed schema and migration ledger read-only; resolve canonical tenant-key ownership and prove tenant authorization at API/database boundaries before authorizing any apply.
- Provision and verify production configuration, release credentials, monitoring/alerts, backup artifact custody, and restore/recovery evidence through an approved operational window.
- Complete a documented launch scope and acceptance matrix; current repository artifacts make incompatible claims about deployed Scholar state versus unapplied CoreGrid substrate.
- Fix and verify the integrations-sync cron authentication construction before treating the job as operational.
- Complete CI/review for the generic webhook HMAC change before enabling any caller that depends on that generic signature contract.

### P1 — Required where those channels are part of launch

- Finish outbound communication delivery and its audit/delivery-status behavior; establish consent, destination verification, retry/idempotency, rate and spend limits.
- Replace non-runnable/partial parent and staff experience declarations with tested routes or remove them from exposed navigation until complete.
- Verify payment webhook, reconciliation, refunds, and receipts against provider sandbox evidence; no live payment test was performed.
- Complete review/CI for generic webhook HMAC signing and test both valid and invalid signatures without weakening provider-specific HMAC checks.

### P2 — Stage after the minimum operational product is safe

- Integrate durable role-aware digital twins, JARVIS, school AI workforce, and central intelligence only after their authorization, durable state, approval enforcement, audit, and restart/replay paths are demonstrated.
- Live AI provider validation is a gated operational test and requires explicit credential availability, budget, and an approved window; none was performed.

## Audit limits and next checks

- This report remains provisional until the master orchestrator reconciles all 16 reports, resolves the cron discrepancy, and verifies the HMAC remediation on CI.
- The audit used repository source, tests, and CI definitions; it did not inspect production databases, cloud accounts, secret values, customer data, or live provider systems.
- Agent findings are preliminary until independently reviewed. A passing unit test or workflow definition is not proof of production deployment.
- The next evidence pass must reconcile migration state and tenant keys read-only, run the relevant local isolation batteries, inspect the current CI head, and obtain owner-approved launch scope, RTO/RPO, alert routing, cost bounds, and restore-test window.
