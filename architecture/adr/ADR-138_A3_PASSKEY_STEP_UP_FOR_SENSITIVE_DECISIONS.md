# ADR-138: Passkey Step-Up for Agent Promotion (A3, decision D-09)

- Status: PROPOSED
- Date: 2026-11-26
- Builds on: ADR-103 and WF-07 (approval step-up), AIN-02 (promotion gate)

## Context
Decision D-09: ratify the engine as built, add a strict agent boundary, and require a passkey on sensitive decisions. WF-07 already requires a single-use, five-minute passkey step-up, bound to the approval content, before a high-risk approval can count; the capped classes (money movement, safeguarding, credential change, public publishing, mass messaging, sharing with an authority) must be raised at high risk. Agent promotion (AIN-02) had no step-up: the founder's identity alone sufficed.

## Decision
1. New append-only table `wf_sensitive_step_up`: person, kind (`agent_promotion`, `production_change`), a 64-hex digest, verified and expiry times (window at most five minutes), `used_at` and `revoked_at`. Row security on with no policy; only the service role may read, insert and update (never delete); evidence fields are immutable; a spent row cannot be un-spent.
2. `wf_step_up_digest(kind, parts[])` is SHA-256 over the kind and parts separated by U+001F. The server uses it as the WebAuthn challenge; `frontend/src/lib/workflow/step-up-digest.ts` computes the same value (a shared test vector pins both).
3. `wf_step_up_consume(person, kind, digest)` spends one fresh matching row or raises `a3:step_up_required` (42501). Not executable by any API role.
4. `wf_autonomy_promote` spends a step-up for (organisation, agent, target level, evidence) after every other check passed, in the same transaction: a refused promotion never burns a step-up, and one that fails after the spend gives it back. Demotion is the safe direction and needs none.

## Consequences
- A promotion needs a fresh passkey assertion for exactly that promotion by exactly that person.
- Existing AIN-02 and AIN-05 harnesses record a step-up as the server would before each successful promotion.
- `production_change` is reserved: no database path changes an organisation's enablement or ceiling today (service-role table writes), so there is nothing to gate yet. Gating it needs the function that performs it, which is a later mission.
- The server code that verifies the WebAuthn assertion and writes the row is not built here.

## Rollback
`database/supabase/rollbacks/20261117001000_sherivs_a3_sensitive_step_up.sql` restores the AIN-02 function and drops the table and functions.
