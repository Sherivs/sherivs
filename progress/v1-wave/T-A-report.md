# T-A REPORT — CODEGEN-REPOINT (post-R-wave follow-up wave)

Team: T-A · Branch: `cursor/p08-foundation-loop-classification-fe86` · Date: 2026-10-03
Mission: make the Supabase DB-type generator path official — regeneration must write
`packages/contracts/src/database.ts` (the R3 single source), never the legacy re-export path.

## Implemented

1. **Official generator script** — `scripts/generate-database-types.mjs`:
   - Runs `npx supabase gen types typescript --project-id <ref> --schema public` (read-only
     schema introspection; no database writes), then formats the raw output with the repo
     prettier config (`.prettierrc`: `printWidth 100`, `semi: true`) so regenerated files
     diff cleanly against the committed capture.
   - Writes **only** `packages/contracts/src/database.ts` (`OUTPUT_TARGET` constant +
     `targetAbs` guard). The legacy path appears only in the write-guard constant
     `LEGACY_OUTPUT_PATH` and doc comments — never as a write target.
   - Fail-closed on missing `SUPABASE_ACCESS_TOKEN`; refuses output that does not look like
     Supabase `Database` types.
   - Project ref resolved `SUPABASE_PROJECT_ID` → host of `SUPABASE_URL` → canonical
     `nwrflbpbhyiqdptmlccm` (public project identifier, not a secret).
   - Observability: logs byte/table counts; on drift prints a loud SCHEMA DRIFT summary
     (tables added/removed) and a NOTICE that committing regenerated types is a coordinator
     decision.
   - `--check` mode: probe → compare → report drift → exit 2, writes NOTHING.
2. **Script entry** — root `package.json`: `"types:generate": "node scripts/generate-database-types.mjs"` (one line, nothing else touched).
3. **Documentation** — `packages/contracts/README.md`: the "generator should be repointed here
   (tracked follow-up)" caveat is replaced by a *Regenerating `src/database.ts`* section
   documenting the command, `--check` mode, auth requirements, project-ref resolution, the
   write-only-this-file law, and the drift policy (coordinator review; never a silent commit).
4. **Structural ratchet extended** — `tests/unit/contracts-single-source.test.ts`: new describe
   block (4 tests, existing 6 untouched) pinning: the `types:generate` script entry; the
   generator's sole write target; the legacy path as a strictly one-line re-export; README
   documentation of the official path.

## Files Changed

- `scripts/generate-database-types.mjs` (new, scripts/ ownership)
- `package.json` (script entry only)
- `packages/contracts/README.md` (documentation)
- `tests/unit/contracts-single-source.test.ts` (extended only)
- `progress/v1-wave/T-A-report.md` (this report)

No commit/push performed (per instructions). Other teams' working-tree changes untouched.

## Architecture Impact

- Completes the R-wave recorded remaining work (R3 follow-up): the generator path is now
  official, so the canonical DB types (`@coregrid/contracts`) can be refreshed without any
  path ambiguity. A stray regeneration aimed at the old location now fails the structural
  ratchet loudly (`contracts-single-source.test.ts`), exactly as the R-wave report required.
- No runtime, schema, RLS, or authorization change. Frontend and mobile continue consuming
  `@coregrid/contracts` unchanged; `frontend/src/integrations/supabase/types.ts` remains the
  one-line re-export (`export type { Database, Json } from "@coregrid/contracts";`).
- Version-target classification: V1 (contracts/tooling for the V1 organizational envelope;
  no frozen-scope capability touched).

## Tests

Command: `npx vitest run tests/unit/contracts-single-source.test.ts` —
**Test Files 1 passed (1), Tests 10 passed (10)** (6 pre-existing + 4 new; two early
iterations of the new assertions failed honestly and were refined before the pass —
see run history in the shell transcript).

Typechecks:
- `npx tsc --noEmit` (root) → **EXIT=0**
- `cd mobile && npx tsc --noEmit` → **EXIT=0**

## Security Validation

- No database writes: generation is pure introspection (`supabase gen types`); the report
  statement is backed by the command itself and by the script doc-comment contract.
- No secrets committed or logged: the script requires `SUPABASE_ACCESS_TOKEN` but never
  prints it; the project ref `nwrflbpbhyiqdptmlccm` is a public URL identifier (already
  named in `progress/v1-wave/R-WAVE-REPORT.md`). Diff contains no credentials
  (repo secret-scan scope `verify:secrets` not re-run here — no secret-bearing files touched).
- Authorization surface unchanged: no policy, RLS, or API code modified.

## Schema-drift finding (action REQUIRED by coordinator — per requirement 3)

The Supabase CLI **is** available in this VM (`npx supabase` → supabase 2.119.0), so the
generation probe was really executed (twice: manual probe + official script `--check`).
The regenerated output **differs** from the committed capture. Per instructions the
committed file was left **UNCHANGED**; no drift was committed.

Real probe output (`npm run types:generate -- --check`, exit 2):

```
types:generate: generating public-schema types for project nwrflbpbhyiqdptmlccm (read-only introspection)
types:generate: generated 245017 bytes, 136 tables/functions
types:generate: SCHEMA DRIFT DETECTED — 68 -> 136 tables/functions (+68 new: cg_conformance_assessment, cg_delivery_evidence, cg_domain_runtime, cg_entity, cg_event, cg_event_route_cursor, cg_event_route_outcome, cg_event_route_queue, …)
types:generate: --check mode — file left UNCHANGED. Review the diff, then re-run without --check to update the package.
EXIT=2
```

Exact diff summary (formatted output vs `packages/contracts/src/database.ts` @ `594c2cb`):

- Committed file: 4,522 lines, 68 tables, **no functions**. Generated: 245,017 bytes,
  136 tables/functions (55 tables + 13 functions new).
- **Pure insertion** after prettier normalization: diff is `685a686,3735` — 3,050 added
  lines, **zero modified or deleted lines** in the existing 68 table blocks. The committed
  subset is strictly preserved; the drift is exactly the `cg_*` substrate tables created by
  migrations 000001–000031 (role substrate, workforce, memory/knowledge, event fabric,
  hermes observation, delivery evidence, idempotency, tenant/org/workspace — including the
  R-wave migrations 30/31 tables `cg_hermes_observation` + `cg_delivery_evidence`) plus
  13 new Postgres functions (`assign_role`, `holds_tenant_role`, `get_my_primary_workforce_position`,
  `grant_role_capability`, `end_role_assignment`, `list_role_assignments`, `list_role_grants`,
  `assign_workforce_position`, `end_workforce_position`, `list_workforce_positions`,
  `get_org_profile`, `upsert_org_profile`, `cg_prune_expired_idempotency_records`).
- Raw CLI output formatting (no semicolons) differs from the committed file because the
  committed file is prettier-formatted; the script applies prettier so future regeneration
  diffs isolate schema changes only (proven above: formatting-normalized diff is pure addition).
- Full probe artifacts preserved at `/tmp/database-probe.ts` (raw) and
  `/tmp/dbtypes.pretty.diff` (formatted diff) for coordinator review.

Recommendation: regenerating and committing the expanded types would surface the new
substrate tables to all consumers; that is a schema-drift adoption decision for the
coordinator after review of the 55 new tables' RLS postures (RLS battery currently covers
44 tables — many of the new `cg_*` tables would need posture entries first).

## Known Risks

- The drift is now one `npm run types:generate` away from materializing in the package; the
  `--check` mode + loud NOTICE + ratchet keep it honest, but the package stays one capture
  behind the canonical project until the coordinator adopts it.
- The script resolves the CLI via `npx` (first run downloads `supabase@2.119.0` into the npx
  cache); a fully pinned CLI version would make generation bit-reproducible across machines.
- `mobile` node_modules must be linked (`npm install` at mobile/) for the mobile typecheck;
  verified green in this VM.

## Remaining Work

- Coordinator decision: review `/tmp/dbtypes.pretty.diff` and either adopt the regenerated
  types (after extending the RLS posture registry for new `cg_*` tables) or re-capture at a
  defined milestone.
- Optional hardening: pin the `supabase` CLI version (devDependency or fixed npx spec) and
  add a CI-friendly `types:generate -- --check` gate.