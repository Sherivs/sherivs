# Sherivs Brand Migration

CoreGrid is audited and classified, never blindly replaced.

## Method

1. `scripts/experience/inventory-experience.mjs` counts every CoreGrid reference by class (stored in `SHERIVS_EXPERIENCE_INVENTORY.json`, `brand` section).
2. `scripts/experience/brand-classifier.mjs` classifies each line: `CUSTOMER_FACING`, `AI_PROMPT`, `TECHNICAL_IDENTIFIER`, `PERSISTED_VALUE`, `REGISTRY_BOUND`, `PACKAGE_METADATA`, `COMMENT`, `INFRASTRUCTURE_OR_DB`, `TOOLING`, `TEST`, `GOVERNANCE_DOC`.
3. `scripts/experience/migrate-brand.mjs` (dry run by default, `--apply` to write) rewrites **only** `CUSTOMER_FACING` lines in `frontend/src`, `mobile/src`, `mobile/app`, `public`.
4. `tests/unit/sherivs-brand-migration.test.ts` classifies representative cases and scans the customer zones to prove no `CUSTOMER_FACING` CoreGrid line remains (one deliberate allowance: `legacyName` in `sherivs-brand.ts`, which records the legacy name for compatibility).

## Result

* Commit `187374c`: 84 customer-facing lines in 50 files migrated (84 insertions / 84 deletions; nothing else touched in those zones).
* Current inventory `brand` counts: COMMENT 703, TECHNICAL_IDENTIFIER 189, PERSISTED_VALUE 28, REGISTRY_BOUND 10, PACKAGE_METADATA 2, AI_PROMPT 1, TOOLING 500, TEST 949, INFRASTRUCTURE_OR_DB 469, CUSTOMER_FACING 1 (the allow-listed `legacyName`).

## Deliberately preserved

| Item | Why |
| --- | --- |
| `package.json` name `coregrid-scholar`, `@coregrid/*` packages | Install/build compatibility; asserted by test |
| `CoreGrid*` types, `COREGRID_*` constants, env vars | Contract/compile compatibility |
| Storage bucket `coregrid-files`, `secret://coregrid/*` refs, enum/plan ids | Persisted data; changing would orphan records |
| `database/`, migrations, `infrastructure/` | Migration history is immutable |
| `lib/kernel/**`, `phase-catalog.ts` | Governed registries verified by drift checks |
| AI prompt in `worker-launch-runtime.server.ts` | Model input; a prompt change needs reviewed validation |
| `AGENTS.md` and `architecture/` governance documents | Governance rules must not be modified by an agent |
| Service-worker cache name `coregrid-app-shell-v1` | Cache key; renaming only drops clients' cache, left for a deliberate release |
| Comments | Not customer visible; deferred |

## Follow-ups (not done)

* Rename of technical identifiers is a separate, ADR-governed migration plan with rollback; not attempted here.
* Domain: canonical origin is `https://sherivs.com` in `SHERIVS_BRAND`, sitemap and robots. DNS/hosting configuration is outside the repository and is not verified.
* `/coregrid` returns a 301 to `/` to preserve inbound links.
