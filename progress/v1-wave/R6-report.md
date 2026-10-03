# R6 (COMMS-EVIDENCE) — V1-009 Follow-ups (§42 Report)

Team R6 (COMMS-EVIDENCE), CoreGrid V1 remediation wave. Date: 2026-10-03. Branch: `cursor/p08-foundation-loop-classification-fe86` (unchanged, per mission law; no git commit/push performed).

## Implemented

Both V1-009 recorded follow-ups, plus the test posture that pins them.

**1. Delivery-evidence substrate (migration + exact-inverse rollback)**
- `database/supabase/migrations/20261003000031_coregrid_delivery_evidence.sql` (new): table `cg_delivery_evidence` — one row per outbound delivery ATTEMPT, including fail-closed blocks (the evidence that a send was BLOCKED is itself evidence). Columns: `channel` (CHECK `email|voice`), `adapter` (registry provider id), `notification_ref` (nullable correlation), `recipient_redacted` (NOT NULL — the row shape exists ONLY for redacted values; full addresses/numbers never enter evidence), `provider_message_id` (null exactly when the provider did not confirm — never fabricated), `outcome` (CHECK `delivered|failed|undeliverable`), `outcome_code`, bounded secret-free `reason`, §12 provenance (`triggered_by`, `trigger_source`, `ai_generated boolean NOT NULL DEFAULT false`), `created_at`. Outcome-coherence CHECK: a `delivered` row MUST carry `provider_message_id`; failed/undeliverable rows MUST NOT.
- **Append-only evidence law (§12, §28), database-enforced:** a `BEFORE UPDATE OR DELETE` trigger (`cg_delivery_evidence_append_only` → `cg_delivery_evidence_forbid_mutation()`) rejects every mutation at the database boundary. No UPDATE path, no DELETE path, no `updated_at` column — a correction is a NEW row, never an overwrite.
- **Deny-by-default posture** (style exemplar `20261003000019_coregrid_v1_mission_lease.sql`): RLS ENABLED, ZERO policies authored, `REVOKE ALL … FROM anon, authenticated`. Service-role server functions (the adapters' evidence sink) are the only intended writer. Status: AUTHORED, NOT APPLIED (per mission law, never applied to any database).
- `database/supabase/rollbacks/20261003000031_coregrid_delivery_evidence.sql` (new): genuine inverse — drops trigger, guard function and table in one transaction, then restores the documented pre-migration privilege posture (same `GRANT ALL … TO anon, authenticated` restoration pattern as the 20261003000019 rollback, per the posture 20261003000018 documents). Rollback plan included, with a §12-honest DATA NOTE: dropping the table discards durable attempt evidence (not reconstructible; a pre-rollback `\copy` export is documented as the preferred alternative).

**2. Adapter wiring — evidence on every attempt, non-fatally (§29, fail-closed never fail-open)**
- `frontend/src/lib/communications/delivery-evidence.server.ts` (new):
  - `DeliveryEvidenceSink` PORT (§24) — adapters never depend on a vendor. Concrete sink `createPostgrestDeliveryEvidenceSink` appends the row through ONE bounded PostgREST fetch under service-role credentials (§25 adapter style, no SDK import); `deliveryEvidenceConfigFromEnv`/`deliveryEvidenceSinkFromEnv` resolve `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` and return null (substrate absent — the caller's fail-closed signal) when either is missing.
  - Recipient redaction BEFORE persistence (§19): `redactEmailRecipient` (`p***@example.edu`), `redactPhoneRecipient` (`+15***67`); unparseable/short inputs degrade to the opaque sentinel `***` — redaction is never skipped for an unexpected shape.
  - `emailEvidenceRecord` / `telephonyEvidenceRecord` map typed results (via the contracts' own type guards) to evidence rows: receipts → `delivered` + provider id; failures AND typed BLOCKED_NO_CREDENTIAL blocks → `undeliverable`/`failed` with the code and bounded reason. `aiGenerated` pinned `false` (adapters are deterministic infrastructure, not intelligence — §12).
  - `withEmailDeliveryEvidence` / `withTelephonyDeliveryEvidence` (J-045-style composition): EVERY attempt records one row; a sink error NEVER changes the typed result and is reported through the existing structured-log path (`logStructured`, component `communications.delivery-evidence`, msg `evidence_write_failed`, §29). A null sink is an identity — the adapter is returned unchanged.
- `resend-email.server.ts`, `twilio-voice.server.ts`, `vapi-voice.server.ts`: factories take an optional second parameter `evidence: DeliveryEvidenceSink | null = null` (backward compatible — all existing call sites and tests unchanged). The evidence wrap sits OUTSIDE the J-045 failure policy so the recorded row reflects the attempt's FINAL typed outcome, including a transport failure the policy contained as a structured failure. Default remains null: no substrate configured → no evidence write attempted, typed results exactly as before.

**3. `.env.example` additions** (appended at the end; existing entries untouched, not reordered): `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `VAPI_API_KEY`, each with a one-line server-side-only comment (never `VITE_`-prefixed).

**4. Tests** — `tests/unit/communications/delivery-evidence.test.ts` (18 tests) and `tests/unit/communications/delivery-evidence-migration-posture.test.ts` (9 tests, text-level deny-by-default signature in the `tests/unit/h3-040-posture-adjudication.test.ts` pattern).

## Files Changed

- `database/supabase/migrations/20261003000031_coregrid_delivery_evidence.sql` (new, OWNERSHIP)
- `database/supabase/rollbacks/20261003000031_coregrid_delivery_evidence.sql` (new, OWNERSHIP)
- `frontend/src/lib/communications/delivery-evidence.server.ts` (new, OWNERSHIP)
- `frontend/src/lib/communications/resend-email.server.ts` (modified, OWNERSHIP — optional evidence param + composition)
- `frontend/src/lib/communications/twilio-voice.server.ts` (modified, OWNERSHIP — same)
- `frontend/src/lib/communications/vapi-voice.server.ts` (modified, OWNERSHIP — same)
- `tests/unit/communications/delivery-evidence.test.ts` (new, OWNERSHIP)
- `tests/unit/communications/delivery-evidence-migration-posture.test.ts` (new, OWNERSHIP)
- `.env.example` (modified, OWNERSHIP — appended 3 entries only)
- `progress/v1-wave/R6-report.md` (this report, OWNERSHIP)

Not touched (deliberately): `scripts/apply-canonical-hardening.mjs` (coordinator registers + applies the migration), `frontend/src/lib/notifications/email-adapter-contract.ts` (consumed, not modified), `frontend/src/lib/env.ts` (`SERVER_ONLY_VARS` addition for the three new vars remains an authorized follow-up — outside this mission's ownership), all other lib/ dirs, `tests/e2e`, `mobile/`. No migration was applied to any database. No git commands run.

**Drift flagged, not fixed (outside my scope):** `.env.example` line 9 comments the Supabase project as `(project: srhmfaoyhpvhdfxmagho)`, while the canonical project referenced by the wave is `nwrflbpbhyiqdptmlccm`. Reported only — the project-id comment is not my file scope beyond the three appended entries.

## Architecture Impact

- Closes the V1-009 GAP: email delivery evidence now has a durable, append-only substrate and the adapters emit it. Telephony attempts get the same durable evidence through the same port (the `digital_twin_calls` table keeps persisting the untouched call site independently).
- New table follows the established zero-policy substrate family posture; the coordinator's canonical hardening registration is required before it exists in any database.
- The evidence PORT keeps the adapter layer vendor-free; only the concrete sink knows PostgREST (§24/§25). The notification dispatch pipeline can later construct adapters with `deliveryEvidenceSinkFromEnv(process.env)` — no further adapter changes needed.

## Tests

`npx vitest run tests/unit/communications` — **61/61 passed, 4 files passed** (offline, ~1.5s; evidence log `/opt/cursor/artifacts/r6-vitest-communications.log`). Fetch is mocked everywhere; no network, no database. The pre-existing 34 tests remain green (my factory signature change is backward compatible).

- **Evidence on every attempt (new, 18):** Resend success → one `delivered` row with provider message id, channel/adapter/tenant/notification correlation; missing `RESEND_API_KEY` → typed BLOCKED result preserved exactly AND an `undeliverable` evidence row naming the block (the block is evidence); 429 → `failed` row. Twilio success → `delivered` row with gateway `sid`; null-config block → evidence row; Vapi stub → evidence rows in BOTH credential states (`provider_not_configured`, `provider_not_live`) with zero fetch. Redaction: full address/number never appears in any serialized evidence record (`j***@school.example.edu`, `+15***43`); unparseable inputs → `***`. §12 provenance: `triggeredBy`/`triggerSource` present, `aiGenerated` pinned false. Non-fatal degradation: null sink → adapter identity, typed results unchanged; throwing sink → send STILL resolves to its typed receipt/block and exactly one structured `evidence_write_failed` warn is emitted (console spy asserts msg, component, tenant, err). Concrete sink: exact snake_case row mapping (no field added/dropped), one bounded POST to `cg_delivery_evidence` with service-role `Authorization`/`apikey` headers, key value never in the payload, non-2xx → structured error carrying the status only (untrusted body never echoed), config resolution fails closed to null per missing env var.
- **Migration posture (new, 9):** table created + RLS enabled; ZERO `CREATE POLICY`; `REVOKE ALL … FROM anon, authenticated;` present; append-only trigger + `RAISE EXCEPTION` present and no `updated_at` column declared; §12 provenance columns with `ai_generated boolean NOT NULL DEFAULT false`; `recipient_redacted` NOT NULL; rollback drops trigger/function/table, restores the documented privilege posture, runs in one transaction; both files declare AUTHORED-NOT-APPLIED.

Regression: `npx vitest run tests/unit/notifications-email-adapter.test.ts tests/unit/communication-core.test.ts tests/unit/communication-providers.test.ts tests/unit/mh-02-validation-hardening.test.ts tests/unit/scholar-invariant-tenant-gated.test.ts` — **164/164 passed**.

Typecheck (`npm run typecheck`, evidence log `/opt/cursor/artifacts/r6-typecheck.log`): **ZERO errors in any of my owned paths** (`frontend/src/lib/communications/**`, `tests/unit/communications/**`). The typecheck as a whole currently reports errors ONLY in files other remediation teams are concurrently editing in this shared working tree (e.g. `identity-registry.ts`, `control-plane/foundation-mission.ts` / `foundation-loop.ts`, `workforce/worker-launch.functions.ts`, `tests/e2e/helpers.ts`, `mobile/` contracts, regenerated `supabase/types.ts`) — none touched by this mission, and none present when my work started (my first typecheck run flagged only my own two then-unfixed errors). Honesty note: I cannot produce a zero-error full-repo typecheck while other teams' in-flight edits land in the shared tree; my slice is clean.

## Security Validation

- Deny-by-default substrate: RLS enabled, zero policies, all client privileges revoked — pinned by the posture test. Evidence rows are tenant-sensitive audit material; no client-role read/write path exists.
- Append-only at the database boundary (trigger), not just by convention — §28's "do not rely only on application logic" honored. No `updated_at`, no UPDATE/DELETE path.
- Recipient minimization (§19): redaction happens BEFORE the record exists; the substrate's row shape carries only `recipient_redacted`. Verified by sentinel assertions that full addresses/numbers never serialize into evidence.
- Secret hygiene (§30): the PostgREST sink carries the service-role key in memory/headers only; the test asserts the key value never appears in the appended payload; non-2xx errors report status only (untrusted body never echoed). No secret values in any reason string or log line.
- Fail-closed, never fail-open: an evidence-write failure can NEVER upgrade a blocked attempt into a delivery — the typed result is returned first and the wrap only observes it. A missing substrate is an identity composition, not a silent promise.
- §12 provenance honored end-to-end: who/what triggered (`triggered_by`/`trigger_source`), AI flag false by default (`DEFAULT false`, CHECK-free but pinned by the adapter layer and tested), record instant from the kernel time authority.
- Migration never applied; no database, no live Resend/Vapi call attempted anywhere (no credentials — expected; everything fail-closed by design).

## Known Risks

- The migration is AUTHORED, NOT APPLIED: until the coordinator registers it with `scripts/apply-canonical-hardening.mjs` and applies it, adapter sends constructed WITH a sink will log `evidence_write_failed` warns on every attempt (non-fatal, by design). Default factory wiring (null sink) is unaffected.
- The `.env.example` project-id drift (srhmfaoyhpvhdfxmagho vs canonical nwrflbpbhyiqdptmlccm) is flagged, not fixed — an authorized follow-up should correct that comment.
- `frontend/src/lib/env.ts` `SERVER_ONLY_VARS` still lacks the three new variable names (outside this mission's ownership); until added, the `exposedServerOnlyVars` guard won't cover a hypothetical `VITE_RESEND_API_KEY`.
- The shared working tree is being edited by other remediation teams concurrently; the repo-wide typecheck errors cited above are theirs and fluctuate run-to-run. My slice is verified clean.
- The tenant_id type follows the substrate family's `text` convention; a future COND-003 uuid ruling would need a follow-up conversion migration (same caveat the evidence-lifecycle substrate records).

## Remaining Work

- Coordinator: register + apply `20261003000031_coregrid_delivery_evidence.sql` via `scripts/apply-canonical-hardening.mjs` under explicit authorization; then run the post-apply verification listed in the migration footer (RLS/policy/privilege checks, append-only trigger rejects UPDATE/DELETE, outcome-coherence CHECK).
- Notification dispatch pipeline: construct adapters with `deliveryEvidenceSinkFromEnv(process.env)` to activate durable evidence now that the port exists.
- Authorized follow-up: add `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `VAPI_API_KEY` to `SERVER_ONLY_VARS` in `frontend/src/lib/env.ts`; correct the `.env.example` Supabase project-id comment (canonical `nwrflbpbhyiqdptmlccm`).
- Retention/purge for evidence rows (ADR-005-style policy binding) remains a separate, explicitly authorized concern — this migration authors no deletion path by design.
