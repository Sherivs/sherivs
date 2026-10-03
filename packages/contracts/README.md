# @coregrid/contracts

Single source of truth for the contracts shared between the CoreGrid web
application (`frontend/`) and the Expo mobile application (`mobile/`)
(Constitution §23 — one typed source, drift impossible by construction).

## Contents

| Module | Contract | Former dual homes |
| --- | --- | --- |
| `src/vocabulary.ts` | Closed execution/identity vocabularies | `frontend/src/lib/control-plane/foundation-mission.ts`, `frontend/src/lib/identity-registry.ts`, mirrored in `mobile/src/api/contracts/vocabulary.ts` |
| `src/foundation-rows.ts` | `cg_execution_record` / `cg_verification_result` / `cg_foundation_evidence` row types | `frontend/src/lib/control-plane/foundation-loop.ts`, comment-mirrored in `mobile/src/api/contracts/mission-contracts.ts` |
| `src/identity.ts` | `IdentitySummary` / `ListIdentitiesResult` read contracts | `frontend/src/lib/identity-registry.functions.ts`, mirrored in `mobile/src/api/contracts/identity-contracts.ts` |
| `src/database.ts` | Generated Supabase `Database`/`Json` row types | `frontend/src/integrations/supabase/types.ts` |

## Resolution mechanism (documented choice)

The package is consumed as **TypeScript source** — no build step, no runtime
dependencies, no bundler plugins — through **plain node_modules resolution**
via npm `file:` dependencies:

- root `package.json` (`frontend`): `"@coregrid/contracts": "file:packages/contracts"`
- `mobile/package.json` (Expo): `"@coregrid/contracts": "file:../packages/contracts"`

npm installs both as symlinks under each project's `node_modules`, so:

- **Vite / TanStack Start (web)** resolves the specifier from the repo root
  `node_modules` and transpiles the `.ts` source with its built-in esbuild
  pipeline (linked packages are treated as source, not pre-bundled deps).
- **Vitest (repo root)** resolves through the same `node_modules` symlink.
- **Metro (Expo)** resolves the package from `mobile/node_modules` and follows
  the symlink natively (symlink support is default since React Native 0.73);
  its default `sourceExts` already includes `.ts`, and the package's `main`
  points at `./src/index.ts`. No `metro.config.js`, `watchFolders`, or
  tsconfig-paths experiment is needed.
- **tsc** (repo root and `mobile/`, both `moduleResolution: "bundler"`-class)
  resolves `types: "./src/index.ts"`.

This was chosen over tsconfig `paths` mapping because Metro does not honor
`paths` without the `experiments.tsconfigPaths` metro-config flag (a bundler
config/plugin change), and over publishing a build artifact because a compiled
`dist/` would reintroduce a second truth to keep in sync.

## Laws

- Zero runtime dependencies; no I/O; pure types and literal tuples.
- The web's public contract modules re-export from this package; they must not
  re-declare these values (pinned by `tests/unit/contracts-single-source.test.ts`).
- `src/database.ts` is generated output (`supabase gen types`) kept verbatim
  so future regenerations diff cleanly; the generator's output path should be
  repointed here (tracked follow-up — `scripts/` is another team's scope).
