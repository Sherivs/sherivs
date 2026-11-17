# ADR-081: Tool Broker, connector vault references and the append-only call ledger

| Field | Value |
|---|---|
| Status | PROPOSED (operator ratification required before deployment) |
| Date | 2026-11-14 |
| Author | Claude Code agent (ENGINE-03 implementation) |
| Creator | Claude Code agent, mission E-001 (issue #n/a) |
| Mission | ENGINE-03 (one governed seam between twins, agents and JARVIS and every outside tool) |
| Capabilities | Governed tool use by twins, agents and JARVIS (platform and tenant); no connector is activated by this change |
| Supersedes-in-part | None |
| Cites | ADR-077, ADR-078, ADR-079, ADR-080, JARVIS risk policy (ADR-035), `docs/engineering/ENTITY_ENGINE_EPIC.md` |
| Minimal ownership artifact | `frontend/src/lib/tool-broker/*` (contract, vault, broker, service, redaction, catalog) with migration `20261110000300` (cg_tool_registry, cg_connector_binding, cg_tool_call_ledger) |

## Context

The owner wants twins, agents and JARVIS to use the full stack of internal and external tools, including social media, messaging and payments, and to run them by earned autonomy. An audit showed the repository has AI draft call sites and a JARVIS risk policy but no single place where a tool call is authorised, no place that records one, and no rule that keeps a credential out of the database. Without that seam, each connector would invent its own checks.

### Options considered

- **Option 1, per-connector checks.** Fast to start, impossible to audit, and every connector can drift. Rejected.
- **Option 2, give agents the connector credentials directly.** Maximum reach, no control point, and a leaked prompt becomes a leaked credential. Rejected.
- **Option 3, one broker that decides, a vault that stores only references, and an append-only ledger.** Chosen.

## Decision

**Adopt Option 3.**

- **Tools are named and tiered.** A tool declares its connector, direction and effect. The tier is floored by effect: internal state T1, customer-visible T2, and public posts, money, production config, access grants and legal T3. T4 is not registrable. Money, public posts and access grants are platform-only and T3 writes must be idempotent. The DB enforces the same rules with check constraints and an immutability trigger.
- **One pure decision function.** `decideToolCall` takes server-resolved authority only (never the call payload) and returns execute, shadow, propose, queue_approval, sheriff_passkey or deny. The first broken invariant denies: kill switch, invalid or disabled tool, T4, inactive context, platform-only from a tenant, no pack capability, missing role permission, tool tier above capability tier, no active binding, binding of another tenant or scope, hourly budget, missing idempotency key for a write. T3 always returns sheriff_passkey, whatever the earned autonomy. Below T3, the verdict follows the ladder from ADR-078.
- **The vault stores references, never secrets.** A binding holds `vault://<family>/<name>#v<n>`. Check constraints and a TypeScript validator reject anything shaped like a credential (private keys, bearer and JWT strings, provider token prefixes, long hex). The reference is immutable; rotation adds a new binding; a revoked binding cannot be reactivated. Secret values live in the secret manager the owner operates.
- **An append-only ledger.** Each call writes a `decision` row (digest of the exact arguments plus a bounded, redacted summary; secret-named keys are refused at any depth) and later `outcome` rows. The database refuses: update, delete and truncate; a logged tier that differs from the registry; a tenant that differs from the context; an execute, queue or passkey verdict from an inactive context; a T3 decision that is not sheriff_passkey or deny; a success from a shadow, propose or deny decision; a T3 success without a sheriff approval reference; a queued success without any approval reference; a second success for one decision; an outcome that does not repeat its decision's context, tool, tier and digest.
- **The service fails closed.** `brokerToolCall` records the decision before it answers. If the ledger cannot be written the call is refused and the error is not echoed. The same idempotency key with the same arguments replays the earlier decision; with different arguments it is refused.
- **Forbidden actions** (merge or deploy to production unattended, change its own authority, alter the audit log, bypass the kill switch) are listed, never registered and never decided.

## Consequences

- Positive: one place to audit every outside action; a connector can be added without touching policy; secrets cannot reach the database or a log through this seam; the same rules hold in TypeScript and in Postgres.
- **Limit, no connector is live.** The catalog names tools and tiers only. A tool with no active binding is denied. Nothing here claims a vendor API; each connector adapter is later work.
- **Limit, outcomes are recorded by the caller.** The DB makes an unauthorised success unrecordable, but it cannot make a caller report a side effect it performed. The adapter that executes must write the outcome in the same unit of work; this is an acceptance criterion for each adapter.
- **Limit, secret-shape detection is heuristic.** It blocks known shapes and secret-named keys, not every possible secret. The control that matters is that the platform never receives secrets in a field that is stored.
- **Owner actions:** apply the migration (staging first); configure the secret manager and create bindings; decide hourly budgets per tool; ratify the tier floors.

## Verification

- Unit: `tests/unit/tool-broker.test.ts` (17, including a 3000-run seeded property test: a kill switch always denies; an execute implies tier at most T2, an active context, a tenant-correct binding and a platform context for platform-only tools; T3 never returns anything but sheriff_passkey or deny) and `tests/unit/tool-broker-service.test.ts` (6: redaction, replay, key reuse, unknown context, fail-closed, denials recorded).
- Mutation: 10 source mutants (kill switch, T3 rule, tenant binding, platform-only, tier ceiling, permission, rate limit, secret-key filter, secret-value filter, T4 registration) were each caught by the unit tests.
- Real Postgres: `tests/integration/engine03-tool-broker.local.sql` on a PG16 replay of all 172 migrations; 14 schema mutants (guard triggers, floor, platform-only, secret-shape, secret-key check, idempotency index, one-active index, deny-code check, update grant, client read grant, unforced RLS) were each caught.
- Static: `tsc` 0 errors.
- Not verified here: CI on PG17, any live connector, and the production apply.
