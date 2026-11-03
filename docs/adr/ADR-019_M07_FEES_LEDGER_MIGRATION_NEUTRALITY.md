# ADR-019: M07 Fee Ledger Uses the Existing Tenant and Role Substrate

|| Field | Value |
||---|---|
|| Status | PROPOSED (operator ratification required) |
|| Date | 2026-11-03 |
|| Author | Copilot (M07 / #186) |
|| Mission | M07 (#186), V1 organizational fee ledger |
|| Capabilities | V1 fee schedules, invoices, payments, refunds, receipts, and ledger |
|| Supersedes-in-part | None |
|| Cites | Issue #186 scope note (ADR-019 reservation); ADR-004; `database/supabase/migrations/20261103130000_sv1_m07_fees_ledger_receipts.sql`; `architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json`; AGENTS.md §§16–17, 26–28 |
|| Minimal ownership artifact | `docs/adr/ADR-019_M07_FEES_LEDGER_MIGRATION_NEUTRALITY.md` and its five migration-only neutrality entries |

## Context

M07 extends the existing V1 Scholar tenant store and role engine. The migration must use the existing fee permission namespace, bursar role template, `get_my_school_id()` identity binding, and campus/school foreign-key shape to preserve the established tenant and authorization contract. The migration-only neutrality guard observes these terms, even though the migration adds no domain vocabulary to shared application code. ADR-004 permits a baseline exception only with an ADR; the issue reserves ADR-019 for M07.

The five observed groups are `fee` (12 hits), `fees` (6), `bursar` (10), `get_my_school_id` (3), and structural `school_id` (16). They are recorded as observed groups from the guard, not as permission to add further vocabulary or to weaken tenant controls.

## Options

### Option 1 — Rename the existing tenant and role contracts (rejected)

Replace the existing tenant helper, role-template, permission, and campus foreign-key contracts solely to avoid migration-only guard findings.

- **Consequences:** Avoids the five guard groups, but duplicates or changes shared security contracts outside M07 ownership and risks weakening compatibility or tenant isolation. This conflicts with AGENTS.md §§16–17 and ADR-004's relocation-first boundary.

### Option 2 — Quarantine observed migration-only groups with this ADR (retained)

Record only the five findings emitted for the M07 migration, preserving all pre-existing baseline entries and counters except for these observed additions.

- **Consequences:** Keeps the new domain vocabulary confined to the SQL migration and leaves application-code checks unchanged. The baseline emits warnings for these exact groups until a future tenant/role substrate conversion removes them.

## Recommendation (decision)

**Use the existing tenant and role contracts in the additive M07 migration, and quarantine only the five observed migration-only groups under ADR-019.** The migration adds no default role permission: it disables the bursar's optional cash-recording default. Data reads remain subject to forced RLS, and each SECURITY DEFINER operation validates the authenticated actor, tenant, permission, and applicable role scope. The exception authorizes no weakening of RLS, tenant isolation, SoD, or audit.

## Consequences (summary)

- **Positive:** M07 remains compatible with the applied M04/M009 tenant and role substrate; the neutrality guard can pass while continuing to detect unregistered groups.
- **Negative / obligations:** Keep the five entries limited to the exact observed migration file and tokens. Remove them when a verified neutral-tenant/role conversion makes the legacy terms unnecessary.
- **For the wave/program specifically:** M07 owns the migration and its tests; the neutral-tenant conversion owns eventual removal.

## Golden Questions

- **WHO?** M07 owns this migration-specific exception; an operator must ratify this proposed ADR.
- **WHAT?** Preserve existing tenant/role contracts and quarantine five observed SQL-only groups.
- **WHERE?** This ADR records the decision; the neutrality baseline records exact findings; the migration and local SQL harness enforce and test the behavior.
- **WHY?** The existing V1 tenant/role substrate is the required authorization and referential-integrity boundary for M07.
- **UNDER WHICH POLICY?** ADR-004, AGENTS.md §§16–17, 26–28, and issue #186's reserved ADR-019 scope apply.

## UNKNOWNs

- **Operator ratification:** The operator must approve or reject this proposed exception. Until then, the migration remains authored and unapplied.
- **Removal timing:** The owner of a future neutral-tenant conversion must remove the five groups once the underlying legacy contracts have been replaced and verified.
