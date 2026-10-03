# R3 — MOBILE-CONTRACTS: single-source shared contract package (`packages/contracts`)

- Team: R3 (MOBILE-CONTRACTS), V1 remediation wave
- Follow-up executed: V1-010 follow-up 2 ("shared contract package for mobile drift-pinning")
- Version-target classification: **V1** (organizational capability envelope; §45 — no V2/V3 scope touched)
- Date: 2026-10-03
- Report format: AGENTS §42
- Branch: `cursor/p08-foundation-loop-classification-fe86` (unchanged; no commits/pushes per mission LAW)

## Implemented

1. **`packages/contracts` (`@coregrid/contracts`)** — new TypeScript package,
   zero runtime dependencies, consumed as **source** by both surfaces. It is
   now the single physical home of every contract that V1-010 had pinned on
   two sides:
   - `src/vocabulary.ts` — the six closed vocabularies (`EXECUTION_STATUSES`,
     `EXTERNAL_EFFECTS`, `EVIDENCE_LIFECYCLES`, `VERIFICATION_DECISIONS`,
     `IDENTITY_KINDS`, `IDENTITY_STATES`) + derived union types. Previously
     declared in `frontend/src/lib/control-plane/foundation-mission.ts` and
     `frontend/src/lib/identity-registry.ts` and *re-declared* as literal
     tuples in `mobile/src/api/contracts/vocabulary.ts` under two-directional
     `satisfies`/`Exclude` parity assertions.
   - `src/foundation-rows.ts` — `FoundationExecutionRow` /
     `FoundationVerificationRow` / `FoundationEvidenceRow` (moved from
     `frontend/src/lib/control-plane/foundation-loop.ts`; previously only
     *comment-mirrored* in mobile's Zod schemas — an undetected drift class).
   - `src/identity.ts` — `IdentitySummary` / `ListIdentitiesResult` (moved
     from `frontend/src/lib/identity-registry.functions.ts`).
   - `src/database.ts` — the generated Supabase `Database`/`Json` row types,
     moved **verbatim** (4522 lines) from
     `frontend/src/integrations/supabase/types.ts` so regeneration diffs stay
     clean; `CoreGridDatabase` alias exported from `src/index.ts`.
2. **Resolution mechanism (documented choice)** — npm `file:` dependencies
   consumed as TypeScript source, no bundler plugins/config:
   root `package.json`: `"@coregrid/contracts": "file:packages/contracts"`;
   `mobile/package.json`: `"@coregrid/contracts": "file:../packages/contracts"`.
   npm symlinks both into each project's `node_modules` (verified:
   `@coregrid/contracts@0.1.0 -> ./packages/contracts`), so Vite/TanStack
   Start, root Vitest, and root `tsc` resolve it through normal node_modules
   resolution, and Expo/Metro resolves it because symlink support is default
   since React Native 0.73 and Metro's default `sourceExts` already includes
   `.ts` (package `main` → `./src/index.ts`). tsconfig `paths` mapping was
   rejected because Metro honors it only via
   `experiments.tsconfigPaths` (a metro-config/bundler change); a compiled
   `dist/` was rejected because it would reintroduce a second truth. Full
   rationale in `packages/contracts/README.md`.
3. **Web re-pointed (types + re-exports only — runtime behavior identical)**:
   `foundation-mission.ts`, `foundation-loop.ts`, `identity-registry.ts`,
   `identity-registry.functions.ts`, and `integrations/supabase/types.ts` now
   re-export from `@coregrid/contracts` under their existing names/paths, so
   no non-contract frontend file changed.
4. **Mobile re-pointed**: `mission-contracts.ts` and `identity-contracts.ts`
   import the shared vocabularies from `@coregrid/contracts` and pin their
   Zod-inferred row types to the shared row contracts with compile-time
   mutual-assignability assertions (schema ↔ shared type parity);
   `client.ts` takes `CoreGridDatabase` from the package. The two
   two-directional drift shims were **deleted**
   (`mobile/src/api/contracts/vocabulary.ts`, `contracts/database.ts`).
5. **Drift tests replaced**: the two-directional mirror machinery is gone
   (drift is impossible by construction — one declaration); replaced by ONE
   structural test, `tests/unit/contracts-single-source.test.ts`, which
   proves (a) each canonical vocabulary is declared exactly once repo-wide,
   (b) all five web contract modules and all three mobile consumers actually
   import the package, (c) no cross-tree relative imports remain, (d) the
   former drift shims are retired, (e) the package's runtime values are the
   closed ordered sets. Mobile's runtime Zod contract tests
   (`mobile-*.test.ts`, 31 tests) are unchanged in purpose and all pass.

## Files Changed

Created:
```
packages/contracts/package.json, README.md, tsconfig.json,
packages/contracts/src/{index,vocabulary,foundation-rows,identity,database}.ts
tests/unit/contracts-single-source.test.ts
```
Modified:
```
frontend/src/lib/control-plane/foundation-mission.ts      (vocab: re-export from package)
frontend/src/lib/control-plane/foundation-loop.ts         (row types: re-export from package)
frontend/src/lib/identity-registry.ts                     (identity vocab: re-export from package)
frontend/src/lib/identity-registry.functions.ts           (read contracts: re-export from package)
frontend/src/integrations/supabase/types.ts               (generated types moved to package; thin re-export)
mobile/src/api/contracts/mission-contracts.ts             (package imports + row-parity pins)
mobile/src/api/contracts/identity-contracts.ts            (package imports + summary-parity pin)
mobile/src/api/client.ts                                  (CoreGridDatabase from package)
mobile/package.json, mobile/package-lock.json             (file: dep)
package.json, package-lock.json                           (file: dep)
progress/v1-wave/R3-report.md                             (this file)
```
Deleted: `mobile/src/api/contracts/vocabulary.ts`, `mobile/src/api/contracts/database.ts`.

Ownership respected: no writes to `lib/workforce`, `lib/hermes`,
`lib/communications`, `lib/missions`, `lib/onboarding`, `tests/e2e`,
`scripts/`, `database/`, or Supabase. (Their uncommitted files appear in the
shared working tree from concurrent teams; untouched by R3.)

## Architecture Impact

- §23 satisfied in the strong sense: web and mobile consume ONE physical
  declaration; the former "detect drift after it happens" pattern (mirrors +
  two-directional assertions, and silent comment-mirrors) is replaced by
  "drift impossible by construction". Foundation-loop row shapes — previously
  the weakest pin (comment-only) — are now typed-shared and pinned into
  mobile's Zod schemas by compile-time parity checks.
- Phase 22 boundary preserved: the package carries no runtime logic, no I/O,
  no authorization semantics — only closed value sets and row shapes.
  Authorization remains server-side (unchanged).
- Vite (web), Vitest (root), tsc (root), and Expo/Metro + tsc (mobile) all
  resolve the package without any bundler plugin or config change.
- The supabase type generator (in `scripts/`, another team) still writes to
  `frontend/src/integrations/supabase/types.ts`; that file is now a one-line
  re-export, so a regeneration would overwrite the re-export — caught by
  `contracts-single-source.test.ts` (the web module would no longer import
  the package). Generator output path repoint is the remaining work item.

## Tests

Real command output (full log: `/opt/cursor/artifacts/r3-validation.log`):

```
npx vitest run tests/unit/contracts-single-source.test.ts tests/unit/mobile-*.test.ts
 ✓ tests/unit/mobile-serverfn-client.test.ts (8 tests) 25ms
 ✓ tests/unit/contracts-single-source.test.ts (6 tests) 115ms
 ✓ tests/unit/mobile-connectivity.test.ts (6 tests) 4ms
 ✓ tests/unit/mobile-env-contract.test.ts (6 tests) 5ms
 ✓ tests/unit/mobile-mission-contracts.test.ts (11 tests) 9ms
 Test Files  5 passed (5) — Tests  37 passed (37)

cd mobile && npx tsc --noEmit        → exit 0 (clean)

npm ls @coregrid/contracts (root)    → @coregrid/contracts@0.1.0 -> ./packages/contracts
npm ls @coregrid/contracts (mobile)  → @coregrid/contracts@0.1.0 -> ./../packages/contracts

npx vitest run  (FULL unit suite, end of validation)
 Test Files  417 passed | 1 skipped (418)
      Tests  8750 passed | 5 skipped (8755)   (skips = DB-required live tests, by design)
```

Repo typecheck (`npx tsc --noEmit` at root) — honest status: the shared
working tree currently fails ONLY inside other teams' uncommitted, in-flight
files (`tests/unit/worker-launch.functions.test.ts` had parse errors; later
`frontend/src/lib/hermes/hermes-observation-db.server.ts` had 2 semantic
errors — an untracked file from the hermes team; the workforce errors
disappeared as that team kept editing during validation). Evidence that R3's
changes contribute zero errors: with only those foreign untracked/in-flight
files excluded via a temporary probe tsconfig (created and deleted, not
committed), tsc completes with **no diagnostics in any file R3 touched**;
the full-suite vitest run over the same tree is 100% green.

Security validation:

- No new runtime surface: the package is types + literal tuples, zero
  dependencies, no I/O; the web's re-exports are behavior-identical.
- Mobile security posture unchanged and re-proven by the passing mobile
  suites: cross-tenant identity rows still rejected, unknown
  kinds/states/statuses still fail closed, environment contract still
  rejects non-publishable keys (37/37 tests above include those cases).
- No secrets touched or introduced (§30); no client-supplied tenant ids
  introduced (§26).

## Known Risks

1. Concurrent remediation wave: other teams' uncommitted files currently
   break the root `tsc --noEmit` (hermes test/lib files at validation time).
   Not caused by R3; will clear when those teams land their files.
2. Supabase type regeneration still targets `frontend/src/integrations/
   supabase/types.ts` (thin re-export). If regenerated without repointing,
   the structural test fails loudly rather than drifting silently.
3. Metro resolution of the symlinked source package is verified by typecheck
   + node_modules symlink inspection here; a first `expo start` bundling run
   on a dev device is the residual check (no runtime behavior changed, so
   risk is confined to tooling).

## Remaining Work

1. Repoint the supabase type generator (in `scripts/`, other team's scope) to
   emit `packages/contracts/src/database.ts` directly.
2. Optionally extend the package with the remaining mirrored contracts
   (profile-contracts row shapes) once the web exposes typed sources for
   them — today they are mobile-only projections, so no drift class exists.
3. V1-010's other follow-ups (missions-list server function, EAS server-fn
   ids, store credentials) are unchanged and still open with their owners.
