# R2 (QA-SIGNUP) Report — Rate-limit-aware self-serve signup harness for T2

- Team: R2 (QA-SIGNUP), CoreGrid V1 remediation wave
- Date: 2026-10-03
- Branch: `cursor/p08-foundation-loop-classification-fe86` (no commits/pushes made, per mission instruction 6)
- Parent mission: F-13 (`progress/v1-wave/F-13-report.md`) — its "Remaining Work" item 2 (capture T2 in a rate-limit window) motivated this harness.
- File ownership respected: only `tests/e2e/signup-resilience.ts` (new) and `tests/e2e/v1-vertical-slice.spec.ts` (edited), plus this report. No other file was created or modified (including `helpers.ts` and the other e2e specs, and including other teams' working-tree files).

## Implemented

1. `tests/e2e/signup-resilience.ts` (new) — a rate-limit-aware signup harness with three parts:
   - **Probe** (`probeRateLimitWindow`): before the first real attempt, a cheap availability probe is sent to the REAL auth surface (`POST /auth/v1/recover` with a run-unique address belonging to no account — GoTrue answers without sending email and without creating rows for unknown addresses, but the request still traverses the auth rate limiter). A 429 proves the email-send window is "closed" and may yield a `Retry-After` hint. The probe is typed HEURISTIC and advisory-only: the real attempt is always made; the probe only seeds the first backoff wait.
   - **Retry** (`attemptSignupWithRateLimitResilience`): bounded exponential backoff (5s → 10s → 20s → 30s, `Retry-After` honored when present, each wait clamped to [5s, 30s]), fresh run-unique credentials per attempt, `MAX_RETRIES=4`. Total ADDED waiting time is capped at 90s by default (`maxAddedWaitMs`); the Playwright test timeout is raised once, up front, to `maxAddedWaitMs + 4×25s attempt budget + 10s probe budget` via `test.setTimeout` — backoff can never manifest as a Playwright timeout.
   - **Classification**: every rendered outcome is classified `CREATED` / `RATE_LIMITED` / `EMAIL_COLLISION` / `OTHER` with the backend message captured verbatim (240-char bound) for the typed skip text. Only `RATE_LIMITED` is retried (transient backend pressure); `EMAIL_COLLISION` and `OTHER` return immediately so retrying cannot mask a real signal. If the outcome panel never renders at all, the caller's `outcomeText` rejects and the test FAILS — a UI regression is a failure signal, never a skip.
2. `tests/e2e/v1-vertical-slice.spec.ts` — T2 wired MINIMALLY to the helper: one import, T2's body now drives the attempt through the helper. Preserved exactly: both pre-skips (`backendConfigured`, `backendReachable`), the outcome locator + visibility contract inside `outcomeText`, the FULL real contract assertion on success (`/Account created\. A school admin must link your account to a school before you can access a portal\./i` via `toHaveText`), the typed-skip prefix/suffix wording for rate-limit and collision skips, and the `state.*` updates feeding T4/T6. The rate-limit skip text is enriched (not weakened): attempt count, bounded-backoff wait, probe signal, and the verbatim backend message. One additive cleanup line: on CREATED, if fixture-capable, the created self-serve auth identity is resolved by email and registered in `state.createdAuthUserIds` so afterAll removes it (previously unreachable code path — baseline runs always had T2 skip).
3. `afterAll` cleanup was NOT changed; it remains fully intact.

## Files Changed

- `tests/e2e/signup-resilience.ts` (new, ~215 lines incl. documentation header)
- `tests/e2e/v1-vertical-slice.spec.ts` (T2 body + 1 import; net diff ~+74/−2 at session check, most of it T2's helper wiring and typed-skip enrichment)
- `progress/v1-wave/R2-report.md` (this report)

## Architecture Impact

- None on product code. The harness only exercises the REAL Supabase auth surface (public recover endpoint + the real signup UI path); no AI, Digital Twin, RLS, or authorization surface is touched.
- The probe uses `POST /auth/v1/recover` because it traverses the real limiter with no side effects (no email sent, no rows created for an unknown address). Its result is advisory by design and typed as such — it can never suppress or fake a real attempt.
- Failure semantics preserved: rate-limit/collision/unexpected-outcome → typed skip with verbatim backend message (§31/§42 battery discipline, "skip with evidence is PASS-grade"); unrendered outcome → test failure.

## Tests

All runs against the real configured backend (env names only; values never logged) and the pre-existing dev server on http://localhost:8080 (tmux `coregrid-dev-server`, reused, never killed/restarted).

1. Final full-spec run (after formatting), `npx playwright test tests/e2e/v1-vertical-slice.spec.ts --reporter=line`:
   ```
   2 skipped
   6 passed (2.2m)
   ```
   Exit code 0 — identical-or-better vs. the baseline profile (6 passed / 2 typed skips): T1, T3, T4, T5, T6, T7 passed; T2 and T8 typed-skipped. Log: `/opt/cursor/artifacts/r2-final-run.log`.
2. **T2 exercised the harness for real** (solo run, `--reporter=json -g "T2"`); the typed skip annotation, verbatim:
   ```
   SKIP: Supabase auth anonymous-signup rate limit hit for this environment (external dependency: auth rate limiting; 5 real attempt(s) with bounded backoff (probe: open, waited 65s) still rate-limited; backend message: "email rate limit exceeded"); the signup path is proven by the recorded run evidence.
   ```
   This demonstrates every requirement end to end on a live rate-limited window: 5 real UI signup attempts, 65s of bounded backoff (5+10+20+30, inside the 90s cap), probe signal recorded (heuristic "open" did NOT suppress attempts — the authoritative classification came from the real attempts), backend message captured verbatim, and the honest typed skip preserved. The rate-limit window was still closed during this session (consistent with F-13's ~2h probe finding), so T2 did NOT pass for real; no pass is claimed.
3. Transient T7 failure, reported honestly: the first full run had T7 fail on the `/foundation-loop` heading; T7 passed in isolation (`1 passed (25.9s)`) and in both subsequent full runs. T7 is untouched by this mission (only T2 and the import were edited); the shared dev server has been live since 10:42 while other teams concurrently modify frontend files in the same working tree (mid-session, repo-wide `tsc` errors shifted from `frontend/src/lib/communications/*` to `frontend/src/lib/hermes/*` — none in R2 files). Attributed to dev-server/HMR churn from concurrent edits, not to this change.
4. Typecheck: repo-wide `npx tsc --noEmit` currently fails ONLY in other teams' in-flight working-tree files (`frontend/src/lib/hermes/hermes-event-source.ts`, `frontend/src/lib/hermes/hermes-observation-db.server.ts`; earlier `frontend/src/lib/communications/delivery-evidence.server.ts` — all untracked/modified by other teams, outside R2 file ownership). Zero errors in R2 files, proven with a scoped typecheck of exactly the two owned files:
   ```
   npx tsc --noEmit --strict --noFallthroughCasesInSwitch --target ES2022 --module ESNext \
     --moduleResolution Bundler --lib ES2022,DOM,DOM.Iterable --skipLibCheck \
     tests/e2e/signup-resilience.ts tests/e2e/v1-vertical-slice.spec.ts
   → R2_FILES_TYPECHECK_OK (exit 0)
   ```
5. Lint/format on owned files: `npx prettier --write` clean, `npx eslint` → `LINT_OK` (exit 0).
6. Cleanup verification (management SQL channel, post-run):
   ```
   {"leftoverF13AuthUsers":0,"leftoverF13Schools":0,"totalSuperAdmins":0}
   ```
   (An intermediate reading of 1 leftover school was a measurement race — the check ran in parallel with the final run and caught the probe tenant mid-journey; both post-run checks returned 0. No super admin was created/claimed by R2 beyond what the untouched spec's own flow handles, and `afterAll` cleanup is intact.)

## Security Validation

- Secrets: emails/passwords are run-generated, held in process memory, never printed; env var VALUES never logged (names only in skip texts). Journey summary JSON contains no secrets (verified output above).
- The probe sends only a synthetic unknown address to the real recover endpoint — no enumeration vector (unknown addresses answer uniformly), no email sent, no row created.
- No security boundary is weakened: all T2 pre-skips and assertions preserved; the helper cannot mark CREATED without the full real contract text matching; T4's claim-identity logic is untouched.
- Cleanup duty honored: every auth user row this run's journeys create is removed by the intact `afterAll` (verified 0 leftovers above); no super admin was fabricated.

## Known Risks

- The probe is heuristic: a "closed" signal is proven (real 429), but an "open"/"unknown" signal is weak and is never used to skip or fake anything — attempts always run. In this session the probe said "open" while the real limiter was closed, which is exactly the designed behavior.
- `EMAIL_COLLISION`/`OTHER` produce typed skips (not failures) per the classification contract; the skip texts mark them explicitly ("unexpected for a run-unique address", "classification OTHER") so they cannot be confused with the routine rate-limit skip.
- Shared-workspace hazards observed (reporting only, not owned): concurrent teams are actively editing `frontend/src`; repo-wide typecheck is currently red from those in-flight files; one transient T7 flake correlated with that churn. Also heed F-13's warning: this VM's parallel sessions share one `.git` stash stack — avoid `git stash` here.
- If the email-send window opens mid-run, T2 may pass for real and then T4 will consume the self-serve identity as the claim identity (existing spec behavior, unchanged).

## Remaining Work

1. Capture T2 for real in an open rate-limit window (external constraint on the canonical project's auth email limits — unchanged from F-13; the harness now makes any such window usable automatically, with retries inside the test timeout).
2. If T2 passes for real in a window where the platform is already bootstrapped (T4 skip path), confirm the new self-serve identity cleanup line keeps the shared backend free of orphans (logic is in place; not yet observed live).
3. Repo-wide typecheck red is owned by the teams currently editing `frontend/src/lib/hermes/*` and `frontend/src/lib/communications/*`; not R2 scope.
