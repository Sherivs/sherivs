# A3: Passkey step-up for sensitive decisions (decision D-09)

| Field     | Value                                                                                   |
| --------- | --------------------------------------------------------------------------------------- |
| Status    | Draft PR (separate branch from `claude/wf-15a3-reminder-runtime`); NOT APPLIED          |
| Decision  | [ADR-138](../../architecture/adr/ADR-138_A3_PASSKEY_STEP_UP_FOR_SENSITIVE_DECISIONS.md) |
| Migration | `database/supabase/migrations/20261117001000_sherivs_a3_sensitive_step_up.sql`          |
| Rollback  | `database/supabase/rollbacks/20261117001000_sherivs_a3_sensitive_step_up.sql`           |

## Built

- Evidence table, digest and spend functions, the promotion gate (SQL); the digest in TypeScript with a shared vector.
- Harness `a3-sensitive-step-up.local.sql`; AIN-02 and AIN-05 harness helpers record a step-up before successful promotions.

## Evidence (26 Nov 2026; local PostgreSQL 16, CI-faithful chain of 205 migrations)

- `A3 ALL PASS: 37 checks`; `AIN02 ALL PASS: 205`; `AIN05 ALL PASS: 62`; WF01-08, WF12, WF15a, WF15a2, AIN01, AIN03, AIN04 pass unchanged.
- The digest vector was computed independently by node and by the SQL function and matched.
- Unit: 3 tests pass; eslint and prettier clean.

## Already in place (not changed)

- Money movement, safeguarding, credential change, public publishing, mass messaging and sharing with an authority are capped classes: WF-07 requires high risk and a step-up on each approving vote (table constraint `wf_approval_decision_step_up_required`).

## UNVERIFIED

- The server code that verifies the WebAuthn assertion and writes the evidence row does not exist; nothing calls the new table yet. Promotion through the existing server path (`autonomy-scale.ts`) will now fail until it does.
- "Production change approval": no database function changes an organisation's enablement or autonomy ceiling, so there is nothing to gate. The kind is reserved.
- The privilege-under-default-privileges CI steps (AIN-02, wf12 function list) were not run here; the new functions are revoked from every API role, which those lists expect.
- Not run in CI.
