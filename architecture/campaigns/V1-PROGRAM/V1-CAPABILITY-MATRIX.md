# COREGRID V1 CAPABILITY MATRIX

Sources: Phase 01–51 registry + contracts + Phase 52 corpus (413 blueprints) + Phase A discovery. Disposition law (§7): V1 = launch-critical; V2 = valuable, not launch-critical; DEFERRED-BEYOND-V2 requires an explicit dependency/safety/maturity reason.

Status: IMPLEMENTED (code + evidence) · PARTIAL (code exists, gap documented) · ABSENT (must be built for V1).

## V1 (41)

| ID | Capability | Source | Status | Gap |
|----|-----------|--------|--------|-----|
| V1CAP-01 | Multi-tenant organizations/workspaces | P01/P13 | IMPLEMENTED | — |
| V1CAP-02 | Authentication (email/password, JWT, reset, audit) | P02 | IMPLEMENTED | — |
| V1CAP-03 | Role/permission model (RBAC) | P03 | PARTIAL | education-hardcoded roles in platform layer |
| V1CAP-04 | RLS deny-by-default | P31 | PARTIAL | 30/39 tables zero-policy |
| V1CAP-05 | Entity/state/relationship/event primitives | P04 | IMPLEMENTED | — |
| V1CAP-06 | Provenance + evidence records | P05 | PARTIAL | evidence not persisted by mission executor |
| V1CAP-07 | Mission lifecycle FSM (15-state) | P06 | IMPLEMENTED | pure contract; execution path DB-wired for foundation-loop only |
| V1CAP-08 | Mission execution: leases, heartbeats, retries, idempotency | P06 | ABSENT | build generalization of foundation-loop (V1-004) |
| V1CAP-09 | Governed worker identity (cg_worker_*) | P07 | PARTIAL | tables exist; no code writes them (V1-003) |
| V1CAP-10 | Agent lifecycle WAKE→EXECUTE→SLEEP | P07/P52 | ABSENT | V1-003 |
| V1CAP-11 | Hermes orchestrator (observe→delegate→verify) | P08/P52 | ABSENT | V1-002 |
| V1CAP-12 | Memory persistence (DB adapter) | P09 | PARTIAL | in-memory only; adapter documented at memory-store.ts:227 (V1-005) |
| V1CAP-13 | Governed context assembly | P10 | IMPLEMENTED | compiler real; unwired to live prompts |
| V1CAP-14 | AI gateway (budgets, registry, fail-closed) | P11 | IMPLEMENTED | — |
| V1CAP-15 | Model provider abstraction + fallback | P11 | IMPLEMENTED | — |
| V1CAP-16 | Cost/token metering | P11 | PARTIAL | accounting exists; per-org rollups absent |
| V1CAP-17 | Independent verification of mission output | P12 | ABSENT | verifier role in execution path (V1-004) |
| V1CAP-18 | Organization onboarding/provisioning | P14 | PARTIAL | Scholar-only; platform engine from neutral DomainDefinition (V1-008) |
| V1CAP-19 | Dynamic internal workspace | P15 | PARTIAL | DB-backed for Scholar; not runtime-config-generated |
| V1CAP-20 | Public platform website (visitor→signup) | — (§39, V1 rule) | ABSENT | V1-007 |
| V1CAP-21 | Dynamic org public website engine | §16 | PARTIAL | per-tenant Scholar site exists; generalize behind neutral config |
| V1CAP-22 | Web push notifications (VAPID) | P16 | IMPLEMENTED | — |
| V1CAP-23 | Email adapter (Resend behind contract) | P16 | PARTIAL | contract + stub only (V1-009) |
| V1CAP-24 | Telephony adapter (Twilio/Vapi abstraction) | P16 | PARTIAL | one Twilio call site; no adapter boundary (V1-009) |
| V1CAP-25 | Payments (Paystack webhook, provider abstraction) | P17 | IMPLEMENTED | live keys external (BLK-4) |
| V1CAP-26 | Event fabric | P18 | PARTIAL | events recorded; delivery pass manual |
| V1CAP-27 | Audit trail (immutable) | P19 | IMPLEMENTED | — |
| V1CAP-28 | Secrets hygiene / fail-closed semantics | P20 | IMPLEMENTED | rotation of exposed NVIDIA keys still owed |
| V1CAP-29 | Observability (structured logs, health) | P21 | IMPLEMENTED | Sentry/PostHog deferred to V2 |
| V1CAP-30 | PWA installable | P22 | PARTIAL | sw.js/robots.txt build bug + offline shell (V1-001) |
| V1CAP-31 | Mobile client (shared contracts, iOS+Android) | §21/§22 | ABSENT | V1-010 |
| V1CAP-32 | E2E vertical slice | §37 | PARTIAL | foundation-loop is a slice; full visitor→outcome journey untested (F-13) |
| V1CAP-33 | Deployment artifact (Docker + healthcheck + release fail-closed) | P23 | IMPLEMENTED | live deploy external (BLK-3) |
| V1CAP-34 | CI/CD verify battery | P23 | IMPLEMENTED | 6 workflows |
| V1CAP-35 | Contamination isolation (restaurant fixture) | §2 | IMPLEMENTED | — |
| V1CAP-36 | Platform-layer domain neutrality | P25/P49 | PARTIAL | education vocab in authorization.ts etc. (V1-006) |
| V1CAP-37 | Worker delegation model (authority, scope, revocation, quarantine) | P07 | PARTIAL | contracts exist; no runtime enforcement wiring (V1-003) |
| V1CAP-38 | Data governance: retention/export/classification | P24 | PARTIAL | classification exists; export/deletion flows absent → V2 if not launch-critical, export is V1 |
| V1CAP-39 | Command centre backed by real state | §26 | ABSENT | V1-012 |
| V1CAP-40 | Placeholder pages disposition | §57 | ABSENT | V1-011 |
| V1CAP-41 | Store release artifacts (AAB/IPA readiness) | §49 | ABSENT | V1-010 |

## V2 (24)

Sentry + PostHog vendors; pgvector semantic retrieval; advanced scheduling/cron UI; billing UI self-serve; per-org cost rollup dashboards; organization website SEO suite; accessibility audit cycle; load/resilience harness beyond smoke; Redis-backed queue scale-out; multi-region; granular notification preferences; knowledge graph UI; digital-twin projections UI; template marketplace; n8n adapter polish; support ticket lifecycle UI; SSO/SAML; org-level audit export UI; custom domain provisioning; content governance workflow; i18n; dark-mode design pass; e2e mobile device farm; backup/restore drill automation.

## DEFERRED-BEYOND-V2 (17) — with explicit reasons

Kubernetes orchestration (no scale evidence); Kafka/event-broker (Postgres queues suffice); separate vector DB (pgvector when needed); separate graph DB; GPU inference cluster (provider APIs suffice); multi-region active-active; offline-first mobile sync engine (store-and-forward later); voice-first conversational UI; real-time collaborative editing; marketplace economics; white-label reseller program; regulatory certification pack (SOC2/ISO — process, not code); hardware/device MDM; natural-language schema builder; federated learning; on-prem deployment mode; legacy restaurant runtime promotion.

Counts: **V1 41 · V2 24 · DEFERRED 17 · total 82 dispositions.**
