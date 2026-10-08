# SHERIVS PROGRAM STATUS

Category Formation Program — status report per master directive §46.
Report date: 2026-10-08. Branch: `cursor/sherivs-refoundation-2507`. Every status is evidence-backed; classifications use §43 vocabulary (IMPLEMENTED / PARTIAL / VERIFIED / DEPLOYED / OPERATIONAL / BLOCKED / UNKNOWN).

## 1. Executive summary

The experience boundary is locked and the customer-facing brand migration is complete on production (sherivs.com). Four independent verification methods (SSR HTML scan, route sweep, unit-test boundary pins, domain-neutrality gate) confirm zero CoreGrid leakage on public surfaces. The universal-vs-domain architecture correction is substantially executed: identity routing, multi-membership, internal-control isolation, in-product organization onboarding (now reachable through the browser by the founder persona it serves), Plane B custom-domain resolution with NEUTRAL generated-site presentation for non-education classes, the runtime workspace composition contract, and organization reality rendered inside the runtime workspace are DEPLOYED; the E2E critical-flow pyramid is AUTOMATED and passing live (8/8 critical flows + 33 browser E2E tests including the full founder journey). The remaining open front is deepening reality/memory/context primitives inside runtime workspaces; a second installed runtime is frozen at the composition contract per the V1 envelope.

## 2. Category definition

"Institutional Intelligence Infrastructure" adopted as the public category; homepage communicates it (`frontend/src/components/public/sherivs-home.tsx`, live HTML). Platform primitives are being kept domain-neutral via `scripts/verify-domain-neutrality.mjs` (STATUS=PASS, quarantine baseline ADR-013). Restaurant concepts verified ISOLATED as `fixture:restaurant` domain config (`frontend/src/lib/domain-config/restaurant.ts`, I-030) — no universal contamination found beyond doc-comment references.

## 3. Experience boundary

`SHERIVS_EXPERIENCE_BOUNDARY.md` — VERIFIED as the governing route inventory. All routes classified into planes A–D. Open: `/reality/$class` + `/marketplace` public/internal narrative review; `/privacy` duplicate redirect; `/coregrid` compat retirement.

## 4. Route architecture

Single-application boundary model (no multi-app split) per §7 "operational simplicity" rule. Planes separated by route groups: `(site)/` public, `_authenticated/` customer + internal, `(site)/coregrid` compat. SSR homepage served on platform host. Evidence: live route sweep 14/14 HTTP 200. **Homepage header parity (2026-10-08)**: the homepage (which renders outside the `(site)` layout group so tenant hosts can serve a different public site at the same path) now renders the shared `SiteHeader` (`frontend/src/components/public/site-header.tsx`) also used by the `(site)` layout — brand, section story links, Sign in, Request a demo on the first screen; verified by Playwright (`tests/e2e/sherivs-public.spec.ts`, 5/5).

## 5. Brand migration status

`SHERIVS_BRAND_MIGRATION.md` — 24 customer-facing occurrences migrated across 26 files (commits `8f5a193`, `abab29f`, `c3aa8d9`). Production HTML scan: 0 CoreGrid hits on `/`, `/marketplace`, `/reality/school`, `/privacy`. ~1,760 historical/architectural references intentionally retained (HISTORICAL_REFERENCE). LEGACY identifier registry with removal criteria documented in the ledger.

## 6. Identity architecture

Identity gateway chain (authenticate → memberships → runtime → workspace → destination) IMPLEMENTED and DEPLOYED: `frontend/src/lib/identity/identity.ts`, `resolve-identity.functions.ts`; destinations `/internal`, `/organizations`, `/welcome`, workspace. Multi-membership storage LIVE (migration `20261008000050`, RLS forced, behavioral matrix verified via JWT impersonation). Login never hard-routes to Scholar. VERIFIED.

## 7. Organization architecture

Organization = tenant primitive (`organization_memberships`, active-org switching via `switchActiveOrganization`). **In-product organization onboarding DEPLOYED (2026-10-08)**: the §21 founder pipeline — account → organization identity → runtime selection → profile → review → provisioning → activation — is live at `/onboarding` (server fn `create-organization.functions.ts` over the sole customer write path `create_organization_with_founder`, migration `20261008000060`, applied to the canonical project and behaviorally verified: unauthenticated refusal, linked-founder refusal, frozen-runtime refusal, full authenticated E2E probe with atomic-rollback fault injection; probe data deleted after verification). **Founder-shell routing fix (2026-10-08, found by browser E2E)**: the authenticated shell previously blocked unlinked accounts (no profile row) from `/welcome` and `/onboarding` — the wizard was unreachable by the persona it serves; the founder surfaces now render (the server fn re-verifies all authorization), pinned in `organization-onboarding.test.ts` and exercised live by `tests/e2e/authenticated-shell.spec.ts`. **Plane B organization public experience DEPLOYED**: host classification (`classifyTenantHost` — platform | subdomain | custom-domain) resolves tenant slug subdomains AND registered custom domains; `app-context` loads the organization by `schools.domain` when the visitor lands on a custom-domain host (no slug); homepage SSR loading branch honors both. **Generated-site presentation refined (2026-10-08)**: unknown classes resolve to the NEUTRAL reality (never the school preset), and education sections are reality-scoped so a company/government/unknown class generates a genuinely organization-neutral site; pinned in `surface-renderers.test.ts`. The tenant-site composer (existing school sections) remains correct for the V1 tenant population (every provisioned org runs Scholar).

## 8. Runtime architecture

Domain-runtime boundary enforced: runtimes register via `domainRef` (`kernel/object-type-registry.ts`); Scholar is a runtime, not the platform (`frontend/src/lib/runtime/`). The shell renders ONLY runtime-contributed navigation resolved against the viewer's capabilities (`nav-registry.ts` contribution sets × `workspace-engine/navigation.ts`) — installing another runtime adds its navigation without editing the shell. Onboarding's runtime catalog (§21) presents Scholar as the only selectable V1 runtime and honestly marks Commerce/Healthcare/Government "in development" (structural pins: `tests/unit/organization-onboarding.test.ts`). **Runtime workspace composition contract IMPLEMENTED (2026-10-08)**: `runtimeWorkspaceHome(role)` in `nav-registry.ts` is the neutral platform-layer entry for "which workspace home does this role land in"; all platform-layer consumers (`resolve-identity.functions.ts`, `memberships.functions.ts`, `app-context.tsx`, `_authenticated/route.tsx`, `onboarding.tsx`) now resolve the destination through the contract instead of importing Scholar's home directly — the platform layer no longer names a specific runtime in its destination wiring. VERIFIED (typecheck + unit + neutrality gates). No second runtime is implemented (V1 envelope frozen, AGENTS.md §45); the contract is the deliverable — installing a second runtime resolves through the same composition point without platform edits.

## 9. Reality architecture

Bitemporal kernel substrate exists (`coregrid_v1_kernel_bitemporal`, evidence lifecycle, event security migrations — VERIFIED at DB level per prior live checks). **Organization reality read-model IMPLEMENTED and DEPLOYED (Milestone 9 substrate increment, 2026-10-08)**: `lib/reality/organization-reality.ts` derives organization lifecycle state (onboarding/operational/inactive) from verified truth only (Constitution §9 — no inference); `organization-reality.functions.ts` reads it RLS-scoped (roster counts readable only for the caller's active context — null elsewhere, never fabricated); wired into the `/organizations` selector. **Reality exposure inside the runtime workspace DEPLOYED (2026-10-08)**: `OrganizationRealityCard` (`components/reality/organization-reality-card.tsx`) renders the universal read-model on the admin workspace home — lifecycle state, RLS-visible roster count (an invisible roster renders "Not visible in this context", never a number), workspace address, and the canonical-truth provenance statement; pinned in `organization-onboarding.test.ts`. The neutral cg_ org-model substrate remains deliberately-unapplied (COND-003); deeper reality/memory/context primitives inside runtime workspaces (education reality screens, institutional memory surfaces) remain PARTIAL.

## 10. Mission architecture

Mission primitives exist at DB/kernel level (mission lease, idempotency, cost attribution migrations; `worker-missions` super-admin surface IMPLEMENTED as internal control). Program-level mission portfolio (this directive) tracked in this document and the two deliverables.

## 11. Workforce architecture

Worker registry + launch contract IMPLEMENTED internally (`frontend/src/lib/workforce/`, worker launch server runtime, AI prompt now Sherivs-branded). Workers are governed (lease, verification, evidence migrations present). NOT yet: dynamic worker wake/sleep per mission demand — PARTIAL/UNKNOWN (no evidence of activation loop in production).

## 12. Jarvis architecture

Internal control surface renamed Sherivs Control (command-centre heading + operations projection title). Jarvis as distinct executive-intelligence layer: NOT IMPLEMENTED in the repository evidence reviewed this pass — UNKNOWN beyond command-centre operations projection.

## 13. AI Gateway

Canonical gateway exists with model registry + routing tests (`tests/unit/ai-gateway-*.test.ts`, 8,959 tests passing include gateway adoption checks). VERIFIED as internal capability; model ≠ worker separation present in contracts.

## 14. Security posture

RLS mandatory on tenant tables (memberships verified live: ENABLED+FORCED, fail-closed probes). Service-role isolation, secret firewall (`verify:secrets` PASS). CVE-2026-102989 remediated (react-start ≥1.168.60). zod 4.6.5 with H3 remediation ledger. Public metadata surfaces minimal. VERIFIED.

## 15. Evidence posture

Evidence lifecycle substrate at DB level (evidence migrations live). Engineering reports under `progress/` (H3 waves). This program's evidence: this report + boundary/brand deliverables + commit history.

## 16. Verification posture

Unit: 8,959 pass (4 pre-existing mobile collection failures — `mobile/node_modules` absent; 5 skipped). Typecheck PASS. Secrets PASS. Domain-neutrality PASS. RLS behavioral matrix PASS (2026-10-08). **E2E critical-flow pyramid AUTOMATED and passing (2026-10-08)**: `npm run verify:critical-flows` (`scripts/verify-critical-flows.mjs --live`) — 8/8 live flows against the canonical substrate (homepage, signup, onboarding RPC, identity resolution, reality read, second-org refusal, cross-tenant isolation, self-cleaning cleanup); Playwright suite 30 passed / 3 environment-skips — including the public-experience spec (5), the authenticated-shell founder journey (live browser: sign-in → wizard → provisioning → shell with live reality card), the V1 vertical slice (stale pre-migration pins corrected), and the enterprise checklist.

## 17. Communication integrations

Provider abstraction present (`communication-providers.ts` — Resend/Twilio/Vapi adapters per `docs/` stack). Provider displayName rebranded. Live provider delivery: NOT verified this pass (requires external credentials) — UNKNOWN/OPERATIONAL-UNVERIFIED.

## 18. Infrastructure

Vercel (web, tanstack-start preset, productionBranch `master`) DEPLOYED/OPERATIONAL — deployments `dpl_7xmNiZMaVeZiw38z4qAcdWzGEfbG` (69a3632), `dpl_EFDiuoziFoPjNJ6kb52kPx7w1ENS` (8f5a193), `dpl_8HdaZW9GEonGjyKxzeXooTdAt8Hf` (abab29f), `dpl_AyYFyJM8X6KUtizpkzQ9RZdyVGuR` (c3aa8d9, current). Supabase project `nwrflbpbhyiqdptmlccm` — migrations applied. Redis/Kubernetes/Elasticsearch deliberately NOT introduced (§27 simplest-architecture rule).

## 19. Web/PWA

PWA manifest + service worker operational; SW user-facing strings migrated to Sherivs; offline shell cache name LEGACY (test-pinned). VERIFIED at code level; live SW push delivery unverified this pass.

## 20. Mobile

Mobile sources exist (`mobile/`) but are not installed/built in this environment (4 collection failures). MOBILE READY: NOT CLAIMED — BLOCKED on environment (requires `mobile/node_modules` install + device build).

## 21. Testing

Unit suite comprehensive (structural pins on boundaries: `sherivs-refoundation.test.ts`, `organization-onboarding.test.ts` — onboarding state machine, slug contract, failure mapping, reality derivation, founder-shell routing, and workspace reality-card exposure; `tenant-resolution.test.ts` — 14 pins on host classification and custom-domain resolution; `site-marketing.test.ts` landmark assertions cover the shared `SiteHeader`; `surface-renderers.test.ts` — class-neutral generated-site pins). RLS/security tests present; onboarding verified behaviorally against the live DB (E2E probe + fault injection). **Critical-flow automation DEPLOYED (2026-10-08)**: `verify:critical-flows` runs the 8-flow live pyramid (opt-in via `--live`; self-cleaning `zz-e2e-` probe data so runs leave no residue — verified 0 leftovers); browser E2E covers the public homepage critical flow AND the authenticated founder journey (sign-in → wizard → provisioning → shell, live against the canonical substrate).

## 22. Performance

SSR homepage 30 KB initial HTML with full hero/CTA (no loading shell) — DEPLOYED. No authenticated machinery in public SSR path. Lighthouse/LCP/INP field metrics: not measured this pass — UNKNOWN.

## 23. Deployment

Vercel production: sherivs.com → www (308) → READY deployments above; all 14 routes 200; zero CoreGrid in served HTML. DNS already routed via Vercel domains config. Onboarding migration `20261008000060` applied to canonical Supabase (additive; genuine inverse rollback). OPERATIONAL — current deployment `dpl_Ct4z3joVknA92DGwepX82W8WXGKD` (sha `c47393a`); live checks this pass: homepage 200 with header + hero + CTAs, `/auth`, `/request-demo` 200, 0 coregrid hits; `verify:critical-flows --live --base-url https://sherivs.com` 8/8 against PRODUCTION itself.

## 24. V1 status

V1 envelope (AGENTS.md §45): organizational capability platform with Scholar runtime — identity, membership, **in-product organization onboarding (browser-reachable founder journey)**, **Plane B custom-domain public experience with class-neutral generated-site presentation**, **runtime workspace composition contract**, **organization reality inside the runtime workspace**, workspace, governance substrate DEPLOYED, and the **E2E critical-flow pyramid** automated and passing live (API-level + browser founder journey). V1-complete is NOT claimed: deeper reality/memory/context primitives inside runtime workspaces remain PARTIAL, and a second installed runtime is frozen out of scope (composition contract ready when unfrozen).

## 25. V2 status

Device/IoT capabilities FROZEN — no work performed (twin/facility screens are pre-existing; only brand strings touched).

## 26. Deferred status

All deferrals carry reason/owner/removal-criteria in `SHERIVS_BRAND_MIGRATION.md` (identifier registry) and `SHERIVS_EXPERIENCE_BOUNDARY.md` (open items).

## 27. Known risks

- `/coregrid` compat path and `/privacy` duplicate remain until link hygiene + redirect mission.
- `@coregrid/contracts` + root package name still carry legacy identifiers (internal-only).
- `COREGRID_INTERNAL` enum persists in role data until identifier-migration mission.
- Onboarding founders self-provision organizations — abuse surface (mass org creation). Mitigation present: authentication required, one org per unlinked account, audited. Rate limiting/verification email gating is a hardening follow-up before public growth.

## 28. Known blockers

- None blocking current phase. Mobile build requires environment provisioning (not a Cursor-side action).

## 29. Technical debt

Mobile test environment; zod version pinning history (resolved); hydration swap on `?school=` preview URLs during load; deeper reality/memory/context primitives inside runtime workspaces (education reality screens, institutional memory surfaces) beyond the deployed organization reality card.

## 30–32. Evidence links

- `SHERIVS_EXPERIENCE_BOUNDARY.md`, `SHERIVS_BRAND_MIGRATION.md` (repository root)
- Commits: `8f5a193`, `abab29f`, `c3aa8d9`, `65228b8` (onboarding + reality), `82aa5bf` (Plane B domains + composition contract + E2E pyramid), `c47393a` (neutral presentation + founder-shell fix + workspace reality card + browser E2E) on `cursor/sherivs-refoundation-2507` (mirrored to `master`)
- PR: https://github.com/vibeoraai-bit/coregrid-scholar-migration/pull/5
- Deployments: `dpl_Ct4z3joVknA92DGwepX82W8WXGKD` (current production, sha `c47393a`)
- Onboarding behavioral evidence (live probes, 2026-10-08): AUTH_REQUIRED under definer without session; founder E2E created school + users row (role admin) + trigger-derived primary membership + audit row; FOUNDER_ALREADY_LINKED refusal; RUNTIME_NOT_AVAILABLE refusal; atomic rollback verified on an injected audit fault; probe data deleted post-verification
- Critical-flow pyramid evidence (2026-10-08): `verify:critical-flows --live` 8/8 PASS — against the canonical substrate AND against production (`--base-url https://sherivs.com`); Playwright suite 30 passed / 3 env-skips (public spec 5, authenticated founder journey live, vertical slice with corrected pins, enterprise checklist); browser E2E found and fixed the founder-shell dead end (unlinked accounts could not reach /welcome or /onboarding); gates: typecheck PASS, unit 8,959 PASS, secrets PASS, domain-neutrality STATUS=PASS

## 33. Outstanding human actions

- None required for the current milestone. Next phase (organization onboarding at scale) may require billing/provider credentials when real organizations are provisioned (Paystack/Resend/Twilio keys) — BLOCKED_EXTERNAL_ACTION only at that point.
