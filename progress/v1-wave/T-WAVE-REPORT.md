# T-WAVE REPORT — post-R-wave credential-free follow-up wave (T-A…T-E)

Coordinator: integration, registration, canonical apply, live verification.
Date: 2026-10-03 · Branch: `cursor/p08-foundation-loop-classification-fe86`

Five missions, all executable without user credentials. Each team authored its
scope; the coordinator integrated (registered, applied, live-verified) and
committed per mission.

## Per-mission results

### T-A — CODEGEN-REPOINT (commit `fe1348f`)

- Official generator `scripts/generate-database-types.mjs`: read-only
  introspection → repo-prettier formatting → writes ONLY
  `packages/contracts/src/database.ts`; fail-closed on missing access token;
  `--check` drift mode (exit 2, writes nothing); `types:generate` script entry;
  README regeneration/drift docs; contracts ratchet 10/10.
- Honest schema-drift finding: live project has 136 tables/functions vs 68 in
  the committed capture (pure insertion, +3,050 lines). **Types NOT adopted** —
  the 55 new `cg_*` substrate tables require RLS posture-registry extension
  first (coordinator decision, tracked in `T-A-report.md`).

### T-B — DEPLOY-PIPELINE (commit `78ef8b6`)

- `release.yml` raw `docker run` bypass REMOVED; deploys stage the health-gated
  `deploy.sh` substrate (pinned to tagged commit, `sudo -n`,
  StrictHostKeyChecking, fail-closed `DEPLOY_SSH_HOST/USER/KEY` gate).
- `.env.example` project-id corrected; `OPERATIONS.md` drift note resolved.
- actionlint clean, YAML parse OK, inline scripts `bash -n` clean, secret scan
  clean.

### T-C — STORAGE-PROVISION (commit `1372c1d`)

- Migration `20261003000040` + exact-inverse rollback: idempotent
  `INSERT INTO storage.buckets … ON CONFLICT DO NOTHING` — PRIVATE bucket,
  8 MB + image-mime envelope, ZERO new policies (the five tenant-scoped
  school-media object policies are owned by applied migration `20260707223958`).
- **Coordinator defect fixed en route**: the canonical apply falsely reported
  zero-declared migrations `ALREADY_APPLIED` (presence-probing cannot prove a
  data-only migration applied). Zero-declared migrations now execute
  unconditionally under the manifest idempotency law; mh-06 ratchet admits
  zero-declared entries with a bytes-level idempotency invariant (12/12).
- **Frontend a11y defect fixed en route**: the CMS dialog's shadcn `Label` was
  never associated with its control (no `htmlFor`/`id`) — the gallery journey
  was unreachable by accessible name. Fixed in `crud-list.tsx`.
- Evidence: canonical apply `APPLIED_AND_VERIFIED`; live Storage probe shows
  `school-media` (private, 8388608, image/*); gallery e2e lifted from typed
  skip to REAL PASS (10.2 s); legacy suite 17 passed / 2 typed skips / 0 failed;
  posture test 9/9.

### T-D — TRANSPORT-POLICY (commit `6a6d3bd`)

- Migration `20261003000041` + exact-inverse rollback: FORCE RLS + `GRANT
  SELECT` to authenticated + exactly one least-privilege policy
  `transport_buses_select_driver_assigned` (`USING (driver_id = auth.uid())`).
  The J-005 tenant-equality shape is inexpressible on this legacy substrate
  (no neutral tenant reference; zero live neutral bindings) — recorded honestly
  in the posture file with a `conversionPath`.
- **Coordinator integration**: registered in the canonical manifest; introduced
  the SUPERSEDED model for migration `20261002000014`'s interim zero-policy
  signature (never re-executed — its own guard would fail by design; the live
  posture is owned by 41's declaration); mh-06 ratchet updated (12/12).
- **Battery extended (fail-closed)**: new IDENTITY-SCOPED probe stage — two
  real actor JWTs; the assigned actor must see exactly the row naming them, an
  unassigned principal must read zero rows, INSERT must deny on the SELECT-only
  surface, cleanup re-count verified. No silent pass: every check true or
  FINDING.
- Evidence: canonical apply `STATUS=PASS` (41 `APPLIED_AND_VERIFIED`); RLS
  battery `STATUS=PASS — 44/44` including the live `transport_buses`
  policy-backed proof; driver e2e lifted from typed skip to REAL PASS (7/7
  preview-card suite); ratchets green; tsc clean.

### T-E — HERMES-WIRE (commit `badb461`)

- `frontend/src/lib/hermes/hermes-observation-trigger.server.ts`:
  `runHermesEventObservationStep` — the real consumption point for R4's
  event→observation seam. db backend consumes PENDING `cg_event` rows
  tenant-scoped (`cg_event` strictly read-only; the outbox keeps state
  ownership); memory backend default is a typed no-op-with-reason (byte-identical
  default behavior); fail-closed typed `{ ok: false }` on every gap; exactly-once
  preserved (digest replay + partial unique `(tenant_id, event_ref)`).
- Hermes suite 88/88 (70 pre-existing + 18 new); live READ-ONLY db smoke ran
  end-to-end writing nothing.
- Recorded remaining work (outside T-E ownership): scheduled invocation needs a
  §27 server function + cadence; durable flow needs
  `HERMES_OBSERVATION_BACKEND=db`.

## Neutrality-baseline closure (ADR-012 — PROPOSED, operator ratification requested)

The full-verify gate surfaced that T-C's applied migration trips the
domain-neutrality guard's legacy **storage-contract tokens**: the bucket id
`school-media` is consumed verbatim by `crud-list.tsx`, the e2e upload
interceptor, and the five live 20260707223958 policies (whose authoring
predates the neutrality era and cites `school`/`get_my_school_id()` tokens).
19 hits in 3 baseline groups.

A neutral rename was evaluated and **rejected**: policy re-authoring is
inexpressible without the banned `school_id` structural token, and any rewrite
would orphan live applied policies (§39). Per the shrink-only ratchet's ADR
valve, the 19 pre-existing hits are quarantined into
`NEUTRALITY_GUARD_BASELINE.json` under **ADR-012**
(`architecture/coregrid-mvp-architecture/adr/ADR-012_STORAGE_CONTRACT_NEUTRALITY.md`,
status PROPOSED). The baseline remains shrink-only; every quarantined hit is
surfaced as a WARN on every run (never silent). No migration content was
altered for this.

## Final verification (coordinator gate)

- Full `npm run verify`: see the run record in this PR's final comment / commit
  message (unit + integration + builds + typecheck + secret scan).
- RLS battery: `STATUS=PASS — 44/44` against the live database.
- Canonical apply: `STATUS=PASS`, 20 migrations registered, catalog-verified.
- Legacy e2e: 18 passed / 1 typed skip / 0 failed (gallery + driver cases are
  now REAL passes; remaining skips are credential/environment gaps: T2 signup
  rate-limit raise, super-admin journey credentials).

## Remaining credential-gated work (unchanged)

- T2 signup e2e: Supabase dashboard rate-limit raise (user dashboard action).
- Super-admin e2e journey: `E2E_SUPER_ADMIN_EMAIL`/`PASSWORD` secrets.
- T8 live AI: `AI_API_KEY`.
- BLK-3 deploy (`DEPLOY_SSH_HOST/USER/KEY`), BLK-4 Paystack live, BLK-5
  Resend/Vapi, store accounts + `EXPO_TOKEN`.
- Coordinator decisions recorded: T-A schema-drift adoption (after RLS posture
  registry extension), T-E scheduled invocation, hermes db backend env.
