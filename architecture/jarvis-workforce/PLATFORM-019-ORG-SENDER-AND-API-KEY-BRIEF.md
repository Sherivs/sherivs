# DESIGN BRIEF — PLATFORM-019: per-organization communication sender identity + CoreGrid platform API-key substrate

Prepared by: JARVIS wave 5 (autonomous, directive-authorized) | 2026-10-07
Governing record: DECISIONS.md #210 (PLATFORM-019)
Authority note: built inside the V1 organizational capability envelope (Constitution §45). No V2/V3/FUTURE capability is touched: the Twilio sender substrate is the V1 communication plane's existing SMS adapter gaining an org-scoped sender identity; the API-key substrate is V1 platform credentialing.

## Operator context (2026-10-07)

The operator subscribed to a Twilio **business plan** and topped up **$20**,
but is holding the sender-number purchase until the **CAC business-identity
verification** clears — so the number is issued to a verified business rather
than an individual. Two consequences, both ratified by the operator's
directive:

1. The sender number is **config-only infrastructure**: no adapter change
   may be required when the number is finally grabbed.
2. Sender identity must be **per-organization**: every organization that
   connects to CoreGrid can carry its own Twilio sender number instead of
   borrowing a single platform-wide default.

The same directive ordered a **CoreGrid API-key system — different keys with
different functions, like Supabase's key model** — so third-party and
client integrations are bounded by key class and scope rather than sharing
the service role.

## Capability 1 — per-org communication sender identity

### Data substrate

`cg_org_communication_sender`
(`database/supabase/migrations/20261007000050_coregrid_org_communication_sender.sql`):

- one row per `(tenant_id, org_ref, channel, provider)`; `channel='sms'`,
  `provider='twilio'` in V1; `from_number` is E.164-CHECKed;
  `credential_ref` must be an `env://` reference (secrets never live in the
  database — §30); `provenance` JSONB records who/why.
- **Only one ACTIVE sender per org+channel+provider** — enforced by a partial
  unique index `WHERE status='active'`; switching senders is a demote-then-
  insert transition, and the index is the final authority even under a race.
- Zero-policy posture: RLS ENABLED, zero policies, all privileges revoked
  from anon/authenticated. Reads/writes go through the service-role store
  module only. Battery-verified by `scripts/verify-rls-isolation-battery.mjs`
  (posture registry `scripts/verification/rls-table-postures-platform-019.json`).

### Resolution contract

`frontend/src/lib/communications/org-sender-config.ts` (PURE):

- **Precedence**: active org sender (deterministic: newest `created_at`,
  `sender_ref` asc tiebreak) → platform default number
  (`TWILIO_FROM_NUMBER`) → explicit fail-closed "unresolved" reason.
  Nothing is guessed; an org with no sender and no platform number cannot
  send, by construction.
- Malformed rows and cross-tenant rows are **excluded AND counted**
  (`excludedMalformed`, `excludedCrossTenant`) — fail closed with evidence,
  never silently repaired.
- Every candidate row is validated through `validateOrgCommunicationSender`
  before it can influence resolution.

### Server store + adapter composition

`frontend/src/lib/communications/org-sender-store.server.ts` (SERVER):

- Injected `SupabaseClient` (no module-scope client), every row read back is
  Zod-validated (same discipline as `mission-lease-db.server.ts`).
- `upsertOrgSender` validates the candidate FIRST (an invalid candidate never
  touches the table), demotes the prior ACTIVE row, then inserts.
- `twilioConfigForOrg` composes platform Twilio credentials
  (`twilioSmsConfigFromEnv`) with the resolved sender into the exact
  `TwilioSmsConfig` the existing adapter
  (`twilio-sms.server.ts`) consumes — **the adapter itself is unchanged**,
  which is precisely the config-only law the operator asked for.

### Architecture impact

- Owner: V1 communication platform plane (phase-10 surface, SMS channel).
- Consumers: the Twilio SMS send path; future per-org channel senders
  (email) would extend `channel` — new enum values are additive.
- Blast radius: new table + new modules only. The existing
  `TWILIO_FROM_NUMBER` platform fallback keeps working unchanged.

## Capability 2 — CoreGrid API keys (Supabase-style key classes)

### Key classes

`frontend/src/lib/apikeys/apikey-contract.ts` (PURE):

| Class | Prefix | Meaning | Inherent scope ceiling |
| --- | --- | --- | --- |
| publishable | `cg_publishable_` | client-safe identifier, safe in browser bundles | `org:identify` only |
| secret | `cg_secret_` | server-side privileged key, never bundled | all scopes |

Scope vocabulary (V1): `org:identify`, `org:read`, `org:write`,
`missions:read`, `missions:write`, `communications:send`, `webhooks:verify`.
Unknown scopes fail validation — no invented authority.

### Storage law (§30)

The platform **never stores a plaintext key**. `cg_api_key`
(`20261007000051_coregrid_api_key_substrate.sql`) stores:

- `key_hash` — sha256 hex of the full key (the ONLY lookup form; UNIQUE),
- `key_preview` — prefix + first 4 material chars (safe display),
- `fingerprint` — first 12 hex of the hash (stable public id),
- plus class, tenant, scopes, status, expiry, and **revocation provenance**
  (`revoked_at`/`revoked_by`/`revoke_reason`) guarded by a CHECK constraint
  that makes an incoherent state un-storable at the database layer.

Zero-policy posture, battery-verified: key authority data is service-role
only; publishable-key clients must never enumerate or mutate key rows.

### Fail-closed verification chain

`verifyCoreGridApiKey` (pure) — typed decision, never a throw:

```
malformed_key → unknown_key → revoked_key → expired_key
            → scope_outside_class_ceiling / scope_not_granted → ALLOW
```

- **Revocation is terminal** (`active → revoked` only; rotation is
  re-issuance, never an un-revoke — §28 audit integrity).
- **Time and revocation always win**: a revoked or expired key denies even
  when its scopes would match (§16 risk controls).
- **Class ceiling survives corruption**: even a corrupted row claiming
  `org:write` on a publishable key denies — the ceiling is re-checked
  against the presented key's class, not the row's claim.

### Service module

`frontend/src/lib/apikeys/apikey-service.server.ts` (SERVER):

- `issueCoreGridApiKey` — scopes/expiry validated BEFORE any key material
  exists; rejected issuance produces no key; plaintext returned EXACTLY
  ONCE, never logged (§29).
- `verifyCoreGridApiKeyForTenant` — hash lookup is tenant-scoped
  (`.eq("tenant_id", …)`): a foreign tenant's key is indistinguishable from
  an unknown key; then the pure verify chain runs.
- `revokeCoreGridApiKey` — the update predicate includes
  `.eq("status","active")` so a racing revocation cannot overwrite
  provenance; the transition is confirmed by read-back.
- `listOrgApiKeyMetadata` — metadata only (preview/fingerprint/scopes/
  status/dates); the hash is never exposed.

## Security validation

- Unit: `tests/unit/org-sender-config.test.ts` (10 tests),
  `tests/unit/apikey-contract.test.ts` (9 tests) — include the mandatory
  battery rows: cross-tenant denial is structural (tenant-scoped lookup +
  zero policies), revoked/expired access fails, agents cannot exceed
  permissions (untrusted client roles hold no grants).
- Database: both migrations zero-policy; full RLS isolation battery run
  post-apply (see wave-5 report for the run record).
- Secrets: no plaintext key or secret value appears anywhere in the repo;
  secret-scan gate (`npm run verify:secrets`) must stay green.

## Known limits (honest)

- The Twilio sender number itself does NOT exist yet (operator hold until
  CAC clears) — the substrate is built and battery-verified but cannot send
  until the operator grabs the number and sets `TWILIO_FROM_NUMBER` and/or
  inserts org sender rows. This is recorded as the deliberate remaining
  work, not a code gap.
- `cg_org_communication_sender.org_ref` is opaque text in V1 — the org-model
  migration `20261001000000` is authored-not-applied, so no FK to
  `cg_org_unit` yet; the FK becomes a follow-up migration when the org model
  lands (same posture as `cg_mission_lease`).
- Generated Supabase types do not include the new tables; consumers use the
  injected untyped client + Zod validation (established pattern).