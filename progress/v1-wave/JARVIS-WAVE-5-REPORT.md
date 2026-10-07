# JARVIS Wave 5 Report — PLATFORM-019 (DECISIONS.md #210)

Date: 2026-10-07 · Executing agent: JARVIS wave 5 · Version-target classification: **V1** (organizational capability envelope; AGENTS.md §45)

## Operator instruction

"I subscribed to the twilio business plan and I top up with $20 but I haven't verified my business identity because my CAC is still pending … so now can we skip the twilio but you will add all these capabilities so after the CAC is out then i will grab the twilio phone number and also we should set it for every organization that connects to CoreGrid and then also I want you to create CoreGrid API keys different API keys with their functions like for supabase. So now add all these also in the architecture and the engineering and build everything professionally."

## Implemented

1. **Operator hold recorded (config-only law)**: Twilio business plan is subscribed and funded ($20 top-up, 2026-10-07); sender-number purchase is deliberately deferred until CAC business-identity verification clears (supersedes the #209(d) error-21404 trial limitation — the account is no longer Trial). The Twilio SMS adapter is deliberately left UNCHANGED: when the number is grabbed, activation is secrets + database rows only.
2. **Per-org sender data substrate**: `cg_org_communication_sender` (migration `20261007000050_coregrid_org_communication_sender.sql` + mirrored rollback) — one row per (tenant, org, channel=sms, provider=twilio); E.164-CHECKed `from_number`; `credential_ref` restricted to `env://` (§30 — secrets never in the database); provenance JSONB; **partial unique index enforces exactly one ACTIVE sender per org+channel+provider** (race authority). Zero-policy posture (RLS on, zero policies, full anon/authenticated revoke). Applied to the dev project (`scripts/db-apply-one.mjs`, exit 0).
3. **Per-org sender resolution contract (pure)**: `frontend/src/lib/communications/org-sender-config.ts` — deterministic precedence: ACTIVE org sender (newest created_at, sender_ref asc tiebreak) → platform default (`TWILIO_FROM_NUMBER`) → fail-closed unresolved with explicit reason. Malformed rows and cross-tenant rows are excluded AND counted (`excludedMalformed`, `excludedCrossTenant`) — never repaired, never trusted. Every candidate passes `validateOrgCommunicationSender` (rejects non-E.164, non-`env://` refs, secret-shaped values).
4. **Per-org sender service store**: `frontend/src/lib/communications/org-sender-store.server.ts` — injected SupabaseClient, Zod-validated read-backs; `upsertOrgSender` validates the candidate BEFORE any write, demotes the prior ACTIVE row, then inserts; `twilioConfigForOrg` composes platform credentials + resolved sender into the exact `TwilioSmsConfig` the existing adapter consumes.
5. **CoreGrid API-key contract (pure)**: `frontend/src/lib/apikeys/apikey-contract.ts` — two key classes with different functions, like Supabase's model: `cg_publishable_` (client-safe identifier; inherent ceiling `org:identify`) and `cg_secret_` (server-only privileged key; all scopes). Scope vocabulary: `org:identify, org:read, org:write, missions:read, missions:write, communications:send, webhooks:verify` (unknown scopes fail validation). 32-byte entropy → 43-char base64url material; storage facts = keyHash (sha256 hex — the ONLY lookup form), keyPreview, fingerprint. Fail-closed verify chain `malformed_key → unknown_key → revoked_key → expired_key → scope_outside_class_ceiling/scope_not_granted`; revocation terminal; time/revocation always win; publishable class ceiling re-checked against the PRESENTED key even on a corrupted row.
6. **API-key data substrate**: `cg_api_key` (migration `20261007000051_coregrid_api_key_substrate.sql` + mirrored rollback) — tenant-scoped, class CHECK, key_hash UNIQUE sha256-hex, fingerprint 12-hex, scopes non-empty, **revocation-coherence CHECK** (revoked-without-provenance and active-with-revocation-fields are un-storable — §28 at the database layer). Zero-policy posture. Applied (exit 0).
7. **API-key service**: `frontend/src/lib/apikeys/apikey-service.server.ts` — `issueCoreGridApiKey` (scopes/expiry validated BEFORE key material exists; plaintext returned EXACTLY ONCE, never logged), `verifyCoreGridApiKeyForTenant` (hash lookup tenant-scoped: a foreign tenant's key ≡ unknown key), `revokeCoreGridApiKey` (update predicate includes `status='active'` — a racing revocation cannot overwrite provenance; transition confirmed by read-back), `listOrgApiKeyMetadata` (metadata only; hash never exposed). PLAINTEXT KEYS ARE NEVER STORED (§30).
8. **Registry/runbook/architecture**: TWILIO entries in `provider-credentials.ts` updated to the funded-business-plan status (BLOCKED = deliberate operator hold, activation config-only); `docs/runbooks/provider-onboarding-guide.md` §2 rewritten (business plan, CAC hold, per-org sender menu); architecture brief `architecture/jarvis-workforce/PLATFORM-019-ORG-SENDER-AND-API-KEY-BRIEF.md`.

## Files Changed

- `frontend/src/lib/communications/org-sender-config.ts` (new, pure)
- `frontend/src/lib/communications/org-sender-store.server.ts` (new, server)
- `frontend/src/lib/apikeys/apikey-contract.ts` (new, pure)
- `frontend/src/lib/apikeys/apikey-service.server.ts` (new, server)
- `database/supabase/migrations/20261007000050_coregrid_org_communication_sender.sql` (new, applied)
- `database/supabase/migrations/20261007000051_coregrid_api_key_substrate.sql` (new, applied)
- `database/supabase/rollbacks/20261007000050_coregrid_org_communication_sender.sql` (new)
- `database/supabase/rollbacks/20261007000051_coregrid_api_key_substrate.sql` (new)
- `scripts/verification/rls-table-postures-platform-019.json` (new posture registry)
- `frontend/src/lib/providers/provider-credentials.ts` (TWILIO status notes)
- `docs/runbooks/provider-onboarding-guide.md` (§2 rewrite, changelog, checklist)
- `architecture/jarvis-workforce/PLATFORM-019-ORG-SENDER-AND-API-KEY-BRIEF.md` (new)
- `tests/unit/org-sender-config.test.ts` (new, 10 tests)
- `tests/unit/apikey-contract.test.ts` (new, 9 tests)
- `DECISIONS.md` (#210), `progress/v1-wave/JARVIS-WAVE-5-REPORT.md` (this file)

## Tests

- Focused: `tests/unit/org-sender-config.test.ts` (10/10) + `tests/unit/apikey-contract.test.ts` (9/9) — 19/19 pass. Covers: E.164/env-only validation, precedence + deterministic tie-break, platform fallback, fail-closed unresolved, malformed/cross-tenant exclusion counts, key generation/parsing, full deny chain (malformed/unknown/class-mismatch/hash-mismatch), revoked-wins, expired-vs-window, publishable-ceiling corruption defense, unknown/ungranted scope denial, record coherence.
- Database: both migrations applied to dev project `nwrflbpbhyiqdptmlccm` (single-file runner, exit 0 each).
- RLS isolation battery re-run post-apply: **STATUS=PASS — 46/46 tables** prove their declared posture; `cg_org_communication_sender` and `cg_api_key` both PASS zero-policy (RLS on, zero permissive policies, no client grants, anon REST denied, strongest-form tenant isolation). Artifacts: `/opt/cursor/artifacts/rls-battery-results.json` + `.log`. (First battery attempt aborted early on an `/opt/cursor/artifacts` EIO before reaching the new tables — directory created, full re-run clean.)
- Full gate `npm run verify` run before commit (typecheck + all suites + registry/workforce/drift/neutrality/secrets gates + production build).

## Security Validation

- §30: no secret value or plaintext key ever stored, logged, or committed; `cg_api_key` stores sha256 hash + preview + fingerprint only; `credential_ref` is `env://`-only.
- §13 multi-tenancy: API-key hash lookup is tenant-scoped (foreign-tenant key ≡ unknown key); sender resolution excludes AND counts cross-tenant rows; both tables are zero-policy (deny-by-default) — battery-proven.
- §28: revocation provenance coherence enforced by database CHECK; racing revocations cannot overwrite provenance (status-guarded update + read-back confirmation).
- §16: layered authorization — key class ceiling + explicit scope vector + tenant binding; class ceiling survives corrupted rows.
- §65 honesty: no fabricated capability — the sender number does NOT exist yet; sending stays impossible until the operator grabs it (deliberate hold, not a code gap).

## Known Risks

- **Redis credentials are STILL NOT INJECTED in this VM** (carried honestly from wave 4): verified again this session against the injected secret-names list and the VM environment — only SENTRY_AUTH_TOKEN, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN matched the probe list. The rate limiter remains in-process (Part 31) until the operator adds `REDIS_REST_URL`/`REDIS_REST_TOKEN` to Cursor Secrets; no fabricated success (§65).
- `org_ref` remains opaque text (org-model migration `20261001000000` authored-not-applied) — FK to `cg_org_unit` becomes a follow-up migration when the org model lands.
- Sender number absent until CAC clears: the substrate is live and battery-verified, but SMS send remains BLOCKED by the operator's deliberate hold. When the CAC clears: buy the number → `TWILIO_FROM_NUMBER` secret → `node scripts/provision-vercel-env.mjs`, and optionally insert per-org sender rows (org rows win over the platform default).

## Remaining Work

- Operator (human-only): CAC verification → Twilio Trust Hub business profile → buy sender number → set `TWILIO_FROM_NUMBER` (+ per-org sender rows as wanted).
- Operator: Redis secrets (`REDIS_REST_URL`, `REDIS_REST_TOKEN`) still not registered on the platform (see Known Risks).
- Follow-up (agent-eligible after org model applies): FK from `cg_org_communication_sender.org_ref` to `cg_org_unit`; wired-in issuing UI/API route for `cg_api_key` (substrate + service are ready; no V1 route claims to exist that doesn't).