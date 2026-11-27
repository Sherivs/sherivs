# ADR-120: Production migration pre-check matches the ledger by version or by name

|| Field | Value |
||---|---|
|| Status | PROPOSED (workflow change only; production dispatch stays a separate operator action) |
|| Date | 2026-11-24 |
|| Author | Cursor Cloud Agent (prod-migrate ledger pre-check) |
|| Mission | Production migration apply path (ops; coding agent) |
|| Version target | V1 organizational capability envelope |
|| Capabilities | V1 production schema apply control |
|| Supersedes-in-part | None |
|| Cites | AGENTS.md §12, §28, §38, §42, §45; .github/workflows/prod-migrate-one.yml; scripts/prod-migrate-ledger-precheck.mjs; scripts/verify-provenance-metadata.mjs (creator dimension); progress/missions/WF-01.md (production apply route: `apply_migration` records an apply-time version, so the version-only pre-check could not run) |
|| Minimal ownership artifact | `scripts/prod-migrate-ledger-precheck.mjs` |

## Context

`.github/workflows/prod-migrate-one.yml` is the guarded path for applying one repository migration to production project `nwrflbpbhyiqdptmlccm`. Its ledger pre-check used to require every earlier migration file's 14-digit version to appear in `supabase_migrations.schema_migrations.version`.

Migrations applied through the Supabase `apply_migration` path are recorded under the apply timestamp, with `name` set to the file stem or to that stem without its `<version>_` prefix. A file such as `20261117000700_sherivs_wf05_event_sources_v1` can be stored as version `20261117203609`. A file such as `20261104032000_sherivs_comms01_at_number_binding` can be stored as version `20261110095926` with name `sherivs_comms01_at_number_binding`. Those rows mean the SQL was applied. A version-only comparison reports them as missing and refuses the next target before any new SQL runs.

`progress/missions/WF-01.md` records that this pre-check is why later production applies did not use the workflow.

## Options

### Option 1 — Keep comparing versions only (rejected)

Leave the `comm` of file-version prefixes against ledger versions as it is.

- **Consequences:** no new matching risk, and the workflow stays unable to apply a migration that follows a timestamp-recorded row. The next targets (`20261124000000`, then `20261124170000`) fail closed for a reason that does not mean they are unsafe to apply.

### Option 2 — Insert the file versions into the production ledger (rejected)

Write one `schema_migrations` row per already-applied file, using the file version.

- **Consequences:** the old pre-check would pass, but the repair is a production write to the migration ledger. This change does not have approval to write to production, and a second row for one applied file makes the ledger harder to audit.

### Option 3 — Match version or exact migration name, and refuse a target that is already named (ruled)

An earlier repository file counts as applied when a ledger row has the same version, or a `name` equal to the file stem, or a `name` equal to the stem without its version prefix. The selected target is refused when any row matches it by that same rule. Every other workflow guard stays: 14-digit version, `APPLY-<version>` confirmation, the Production environment, `record_only` limited to `20261025100260`, the pinned project ref, and the single-file apply.

- **Consequences:** timestamp-recorded applies stop blocking the next file, and a second apply of a file already stored under either name is refused. The cost is that an exact name collision with a different applied change would hide a missing file or block a new one. Names in `database/supabase/migrations` are unique today, and an ambiguous name fails the pre-check instead of matching both files. The match does not checksum SQL bytes.

## Recommendation (decision)

**Adopt Option 3.** `scripts/prod-migrate-ledger-precheck.mjs` decides the pre-check from a ledger TSV and the migration directory. The workflow query selects `version` and `name` and does not embed the dispatch input in SQL. `MIGRATION` remains an environment variable. This ADR does not apply a migration and does not connect to production.

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual risk:** a ledger `name` is trusted as evidence that the matching repository file was applied. The check does not compare the applied SQL to the file bytes.
- **The sharpest instance:** a row whose `name` equals one file's unprefixed stem, while a different file with that stem was never applied, would let the pre-check continue.
- **The accepted rationale:** the previous guard trusted the ledger version the same way, without a checksum. Exact equality, unique file names, and a fail-closed ambiguous-name check bound the new match to the two name forms actually written by `apply_migration` and by this workflow.
- **Owner of the residual risk:** the operator who approves the Production environment run of `prod-migrate-one`. A mismatch between ledger name and file contents is an incident for that operator, not a silent rewrite of the ledger.

## Consequences (summary)

- **Positive:** a target can be dispatched when every earlier file is present by version or by exact name, including the timestamp-recorded applies since 2026-11-01. The target itself cannot be applied again when its version or either name is already stored.
- **Negative / obligations:** operators still dispatch one version at a time, in version order, with `confirm` set to `APPLY-<version>` and `record_only` left false. The workflow still writes the new row as the file version plus the unprefixed name. `scripts/verify-provenance-metadata.mjs` recognizes `Cursor Cloud Agent` as a creator identity so this ADR's Author line satisfies AGENTS.md §12 without naming a person.
- **For the wave/program specifically:** PUSH-01 (`20261124000000`) and PUSH-01b (`20261124170000`) can use this workflow after the change is on the dispatched ref. PUSH-01b stays blocked until PUSH-01 is recorded, because PUSH-01 is an earlier file.

## Golden Questions

- **WHO?** Operators of the Production environment run `prod-migrate-one`. This ADR owns the pre-check rule. It does not authorize a person or agent to apply SQL by itself.
- **WHAT?** An earlier migration is applied when the ledger version or the ledger name matches the file; the target is refused when either identity is already present.
- **WHERE?** The rule lives in `scripts/prod-migrate-ledger-precheck.mjs`, called from `.github/workflows/prod-migrate-one.yml`, and is checked by `tests/unit/prod-migrate-ledger-precheck.test.ts`.
- **WHY?** Version-only comparison treats applied, timestamp-recorded migrations as missing and blocks the next production apply.
- **UNDER WHICH POLICY?** AGENTS.md §28 (the ledger remains the record; this change does not invent a second ledger), §38 (the guard change is recorded here before reuse), §42 (the match does not claim a byte-level checksum), and §45 (V1 schema apply only; no V2 or V3 migration work).

## UNKNOWNs

- This change does not re-query production. The operator still confirms, on the Production run, that the ledger dump matches the applied history before the apply step.
- A ledger name that includes `.sql`, or a name that uses the apply timestamp as a prefix, does not match. Those shapes were not how the timestamp-recorded rows were written. A future shape needs a new ADR rather than a looser comparison.
- Dispatch of `20261124000000` and `20261124170000` is not part of this change. Each run still requires the typed confirmation and the Production environment approval.
