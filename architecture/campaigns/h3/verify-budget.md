# H3-090 — Verify-Chain Runtime Census and Budget Policy

Mission: Verify Budget Engineer (Squad H, Quality & CI hardening).
Authority: AGENTS.md §22/§23/§42; H3-WAVE-CAMPAIGN.md campaign law (H3-090 ownership row).
Machine source of truth: `scripts/verify-budget.mjs` (regenerates the census below; offline, read-only, zero test execution).
Provenance of every claim: `package.json` (read READ-ONLY), `vitest.config.ts`, and the filesystem census of `tests/`. No timing in this document was produced by executing a verify step; runtime figures are budget classes, not measurements.

## 1. The verify chain

Declared in `package.json` (`scripts.verify`), strictly sequential via `&&`:

```
npm run typecheck && npm run test:unit && npm run verify:registry && npm run verify:drift && npm run verify:neutrality && npm run verify:secrets && npm run build
```

| # | Step | Command | What it does | Cost class | Runtime budget |
|---|------|---------|--------------|------------|----------------|
| 1 | `typecheck` | `tsc --noEmit` | Whole-repo TypeScript check; no emit. Correctness gate for the entire chain. | **L** | <= 180s |
| 2 | `test:unit` | `vitest run` | Full vitest suite over `tests/**/*.test.{ts,tsx}` (unit + failure + credentials-gated integration). Internally parallel workers; largest CPU consumer. | **L** | <= 600s |
| 3 | `verify:registry` | `node scripts/verification/registry-validate.mjs` | Validates `architecture/registry.json` machine metadata: 51 phases, unique ids/names, allowed layer/status sets, capability/runtime integrity. | **S** | <= 10s |
| 4 | `verify:drift` | `node scripts/verify-registry-drift.mjs` | Compares declared registry state against the governed evolution baseline + recorded drift declaration; undeclared drift fails CI. | **S** | <= 10s |
| 5 | `verify:neutrality` | `node scripts/verify-domain-neutrality.mjs` | Domain-neutrality guard over lib-root files, `kernel/phase-contracts/`, and migrations; fails on new violations, warns on shrink-only baseline entries. | **S** | <= 10s |
| 6 | `verify:secrets` | `node scripts/verification/secret-scan.mjs` | Secret-shaped-material scanner over git-tracked files (shells out to `git ls-files` only); committed secret values fail. | **S** | <= 10s |
| 7 | `build` | `vite build` | Production frontend build; heaviest single step, CPU- and IO-bound. | **L** | <= 300s |

Cost classes: **S** = cheap static verifier (budget <= 10s); **L** = heavy step (typecheck / full unit suite / build).

## 2. Parallelization analysis

- As declared, the chain is strictly sequential — no step parallelizes with another.
- The four **S-class** verifiers (`verify:registry`, `verify:drift`, `verify:neutrality`, `verify:secrets`) are mutually independent: each reads different artifacts and none consumes another's output. They may run concurrently once the `typecheck` gate passes.
- The **L-class** steps (`typecheck`, `test:unit`, `build`) must stay sequential relative to each other: each saturates CPU, and co-running them degrades both participants. They parallelize only *internally* (vitest workers; bundler).
- **Serial wall-clock budget:** ~1540s (~25.7 min). **Parallelized policy:** ~1510s (~25.2 min) — the saving is small because heavy steps dominate; the policy value is bounded-latency cheap verifiers, not the 30s saving.

## 3. Test-count / runtime-budget census

Counts derive from filesystem enumeration (`tests/**/*.test.{ts,tsx}` per `vitest.config.ts`) and static call-site estimates (`it(`/`test(` occurrences incl. `.each` variants). They are upper-bound estimates, **not** collected test counts, and were not produced by running vitest.

| Suite | Test files | Test-call sites (est.) | In verify chain? | Runtime budget | Note |
|-------|-----------:|-----------------------:|------------------|----------------|------|
| `unit` | 376 | 7471 | yes | <= 600s total | the `test:unit` surface; per-test timeout 30s (`vitest.config.ts`) |
| `failure` | 3 | 66 | yes | <= 60s | adversarial/failure-path suite, same vitest run |
| `integration` | 1 | 5 | yes (skips offline) | 0s offline | `tests/integration/foundation-loop.live.test.ts` is credentials-gated (`describe.skipIf(!enabled)`); contributes zero runtime offline |
| e2e (playwright specs) | 5 | n/a | no | n/a | `tests/e2e/*.spec.ts`; run via `npm run test:e2e` only, never part of `npm run verify` |

Total vitest-surface files: 380.

## 4. Budget policy

1. **Budget breach = incident, not license.** A step exceeding its runtime budget is triaged (flaky test, accidental DB/network touch, pathological scan), never resolved by weakening tests.
2. **Unit-suite protection.** The `test:unit` budget (<= 600s) is enforced structurally by the 30s per-test timeout in `vitest.config.ts`; a single pathological test cannot silently consume the chain.
3. **Cheap-verifier discipline.** New static verifiers entering the verify chain must stay S-class (<= 10s). Anything heavier (e.g., a live drill) must be wired as a separate credential-gated script, never into the serial chain.
4. **Offline guarantee.** `npm run verify` must complete with no database and no network. The only credentials-gated test in the vitest include skips itself when credentials are absent (`describe.skipIf`). Live drills (`verify-ai-gateway-live.drill.mjs`, `verify-payments-live.drill.mjs`, `verify-communication-live.drill.mjs`, `verify-recovery-drill.mjs`) are deliberately outside the verify chain.
5. **Wave discipline.** Teams run only their own test files (`npx vitest run <files>`) during the wave; the full chain is the coordinator's post-wave gate.

## 5. Regenerating the census

```
node scripts/verify-budget.mjs
```

Exit 0 offline with the markdown census on stdout. The script reads `package.json` and walks `tests/` only: it spawns no processes, touches no database, and makes no network calls. Steps added to the verify chain later are classified by command shape and flagged `(not yet in the census map)` until this document is updated.