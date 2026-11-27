# A3 server code: passkey step-up for agent promotion

Status: built, draft PR, not applied anywhere. Decision: ADR-138.

- `frontend/src/lib/workflow/agent-promotion-step-up.ts`: the flow. `begin` builds a challenge bound to the signer, the promotion digest and a one-time nonce; `finish` verifies the passkey, records one evidence row (valid 4 minutes, within the table's 5-minute limit), then calls `wf_autonomy_promote`, which spends it.
- `frontend/src/lib/workflow/agent-promotion.functions.ts`: two server functions (`beginAgentPromotion`, `finishAgentPromotion`), founder (super admin) only, using the existing WebAuthn service.
- Tests: `tests/unit/a3-agent-promotion-step-up.test.ts` (8): binding, digest equals the database's, no evidence on a failed passkey, no promotion if evidence fails, malformed requests refused before the authenticator.
- UNVERIFIED: no end-to-end run with a real authenticator or a hosted database; the server functions are not type-checked against generated Supabase types (stubbed here). The screen that calls these is A4.
