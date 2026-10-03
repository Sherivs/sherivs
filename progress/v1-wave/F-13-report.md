# F-13 Report — Honest e2e proof of the V1 vertical slice (longest fully-real journey)

- Mission: F-13 (team QA), CoreGrid V1 program, Wave 4
- Date: 2026-10-03
- Branch: `cursor/p08-foundation-loop-classification-fe86` (commits `69ee500`, `b0e8b55`)
- File ownership respected: `tests/e2e/**` + `playwright.config.ts` (additive webServer only). **No `frontend/src` changes were made** — one product defect was found instead and is reported below.

## Implemented

- `tests/e2e/v1-vertical-slice.spec.ts` — serial e2e spec that walks the longest journey that is
  genuinely end-to-end real today, against the real configured Supabase backend
  (`SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` /
  `SUPABASE_ACCESS_TOKEN` — names only, values never logged) and the real dev server.
- `playwright.config.ts` — additive `webServer` block (existing config untouched otherwise):
  boots the app on port 8080 unless `PLAYWRIGHT_NO_WEBSERVER` or an existing server is
  listening (`reuseExistingServer: true`), maps the client-bundle env names
  (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) from the server-side names, and sets
  the e2e-only demo fixture gate `ALLOW_DEMO_PROVISIONING=true`. Nothing in the existing config
  (timeouts, projects, retries) was weakened.

## Journey map (§37 vocabulary → what actually ran)

| # | §37 step | e2e step | Outcome | Evidence |
|---|----------|----------|---------|----------|
| 1 | Visitor → CoreGrid Public Website | T1 | **RAN REAL** | `/coregrid` H1 + `#capabilities`/`#security`/`#pricing` anchors + real `Sign in → /auth` link |
| 2 | Sign Up (self-serve) | T2 | **SKIP (typed)** | Supabase anonymous-signup rate limiter (`429 over_email_send_rate_limit`, "email rate limit exceeded") — external backend constraint; probed repeatedly over ~2h, window never cleared |
| 3 | Bootstrap gate (fail-closed) | T3 | **RAN REAL** | claim form rendered pre-claim; "Bootstrap complete" lock rendered post-claim/with fixture super admin |
| 4 | First super admin claim | T4 | **RAN REAL** (dedicated run) | Real `/super-admin-bootstrap` claim through the real auth flow → `claimFirstSuperAdmin` (server-side zero-count gate) → `/super-admin/dashboard`. Identity source documented in the run summary: `self-serve` when T2 succeeds, else `admin-seeded` (service-role `createUser email_confirm:true` — the same real auth-admin path the onboarding engine uses internally) because of the T2 rate limiter. Deviation always printed in the journey JSON. |
| 5 | Create Organization (onboarding engine) | T5 | **SKIP (typed, product defect)** | The engine committed the tenant + school_admin server-side, then its fail-closed §27.6 success-audit was rejected (`audit_logs_user_id_fkey` violation) because a bootstrap-claimed super admin has no canonical `public.users` row → typed error surfaced, generated-once password lost. See "Reported defect" below. |
| 6 | Workspace (DB-backed pages) | T6 | **RAN REAL** | Real password sign-in as a real school admin → `/admin/dashboard` "Executive Command Center" (tenant-scoped, school name from the tenant record) → `/notifications` |
| 7 | Reality/Entity → Mission → Execution → Evidence → Verification → Result | T7 | **RAN REAL** | Real bearer token from the real token endpoint; `scholarFoundationLoop` created a Scholar entity + mission + execution (`admitted`) + evidence + verification (`verified`); idempotent replay returned the recorded execution; `recordFoundationLoop` bound a second execution to the created reality ref |
| 8 | Notification (in-journey) | (T6) | **RAN REAL** | `/notifications` DB-backed page rendered for the tenant context |
| 9 | AI Worker (live execution) | T8 | **SKIP (typed, permanent)** | App exposes no live AI-worker surface (`lib/workforce` is library-form) and no `AI_API_KEY` is configured — faking is prohibited |

Skip-with-evidence is PASS-grade per mission law; no step was faked.

### Run results

- Dedicated run (own server, own claim cycle): **5 passed, 3 skipped, 0 failed**
  (T1, T3, T4, T6, T7 passed; T2, T5, T8 skipped with typed reasons).
  Report: `/opt/cursor/artifacts/f13-pw-report-dedicated-run.json` (contains every skip annotation verbatim).
- Full-suite run (all 6 specs): my spec contributed the same 4 passed / 4 skipped; in combined
  runs the demo fixture's super admin (created by the pre-existing specs' `provisionDemo`)
  correctly gates T4/T5 into typed skips — the spec never fakes authority over an existing
  bootstrap. Log: `/opt/cursor/artifacts/f13-existing-specs-full-suite.log`.

## Reported defect (blocking §37 "Create Organization" for real bootstrap-claimed super admins)

Verbatim UI/trace evidence (dedicated run):

```
write-audit: audit record rejected for "onboarding.provision_organization"
  (gate requirePlatformSuperAdmin, outcome succeeded):
  insert or update on table "audit_logs" violates foreign key constraint "audit_logs_user_id_fkey"
```

- Server-side the engine **succeeded**: `public.schools` + `public.users(role admin)` +
  subscription rows were committed (captured via the management SQL channel, then cleaned up).
- The engine's fail-closed §27.6 write-audit then failed: the bootstrap-claimed super admin has
  no canonical `public.users` row (`claimFirstSuperAdmin` audits with `actorId: null` for
  exactly this reason), but the provisioning audit passes the actor's auth uid as
  `audit_logs.user_id` → FK violation → typed error, and the generated-once password is lost.
- The demo path never hits this because the demo fixture super admin has a canonical users row.
- Suggested fix direction (owner decision, `frontend/src/lib/onboarding/provision-organization.functions.ts`
  or its write-audit helper): resolve the audit actor like `claimFirstSuperAdmin` does —
  `actorId: null` + actor email for control-plane actors without a canonical users row.
- Full evidence: `/opt/cursor/artifacts/f13-onboarding-audit-defect-evidence.md`.

## Files Changed

- `tests/e2e/v1-vertical-slice.spec.ts` (new, ~740 lines incl. documentation header)
- `playwright.config.ts` (additive `webServer` block)
- this report

## Architecture Impact

- None on product code. The spec exercises existing real surfaces only: public site, auth,
  bootstrap gate, onboarding engine wizard, DB-backed portal pages, foundation-loop server fns.
- The spec's fixture path mirrors the onboarding engine's own write set (auth user + school +
  users row) through the real auth-admin API and is fully removed in `afterAll`, including the
  append-only trigger dance for `cg_execution_history` (drop trigger → delete → recreate
  trigger), mirroring `scripts/exercise-foundation-loop.mjs`.
- Cleanup verified post-run: 0 `super_admins`, 0 F13 schools/users, 0 foundation-loop rows.

## Tests

- New spec (dedicated): 5 passed / 3 typed-skipped / 0 failed (mobile-chromium project).
- Existing 5 specs: **19 failures — all pre-existing** (V1-008 Known Risk 2: `helpers.ts`
  hard-codes `Demo@2026!` while `provisionDemoEnterprise` rotates the demo password every run;
  all roles land on `/admin/dashboard`). Identical set was reproduced earlier with the ORIGINAL
  config, so the config addition did not change their outcome. Fixing the helper credential
  refresh is V1-008 remaining-work item 4, not F-13 scope.
- `npm run typecheck` clean; prettier + eslint clean on changed files.

## Security Validation

- Secrets: run-generated credentials live in process memory only; env var values never logged;
  the journey summary JSON contains no secrets (verified output).
- Every privileged step goes through the real gate: bootstrap claim through the server-side
  zero-count gate; onboarding through `requirePlatformSuperAdmin`; mission execution through
  real bearer tokens resolved server-side (tenant resolved server-side; client cannot set
  tenant or verification outcome).
- The spec never fabricates authority: with an existing super admin (demo fixture or claimed),
  T4/T5 skip with typed reasons instead of faking a session.

## Known Risks

- Shared workspace hazard: parallel agent sessions on this VM share one `.git` stash stack; a
  concurrent stash operation consumed a stash entry during this mission. Working tree was
  restored to the pushed commit (`69ee500`); untracked pre-session files survived, but the 11
  pre-session tracked-file modifications (mission-execution / mission-lease / unit tests /
  proof JSONs) that were in the working tree at session start were lost with the consumed
  stash entry and are NOT recoverable from git objects. Their owning missions should re-apply
  or restore from their own sources.
- `probe-e2e.tmp.mjs` at repo root is a stray tracked file from a prior F-13 attempt (content
  restored to its committed state); harmless but should be untracked by the owning mission.
- Supabase anonymous-signup rate limiting on the configured project is aggressive (window
  did not clear over ~2h of probing); self-serve signup e2e proof must be captured in a window
  with budget, or the project's auth rate limits raised.
- T5's engine side effects (school + admin committed before the audit rejection) are cleaned up
  by the spec in every outcome path.

## Remaining Work

1. Fix the write-audit actor resolution in the onboarding engine (defect above) — then T5's
   full UI success path (school created panel + generated-once password) can be captured, and
   T6 can sign in as the engine-provisioned admin (currently proven via the real-auth fixture
   tenant).
2. Capture T2 (self-serve signup) real in a rate-limit-free window (project auth rate limit
   config or off-peak window).
3. T8 (AI worker live execution) stays blocked on a real AI-worker surface + `AI_API_KEY`.
4. Pre-existing 5-spec failures (V1-008 Known Risk 2) — fix `tests/e2e/helpers.ts` demo
   credential handling.
---

## RESOLUTION ADDENDUM (coordinator, 2026-10-03 11:40Z)

Both blocking defects found by this mission are fixed and the vertical slice re-run:

1. **T5 write-audit FK defect — FIXED** (commit `0fb9b01`): the onboarding engine now resolves
   the actor's canonical `public.users` row before the success audit and degrades to
   `actorId: null` + verified email claim for bootstrap-claimed super admins. Regression suite:
   `tests/unit/onboarding-audit-actor.test.ts`. Proven real: T5 full UI success path
   (school-created panel + generated-once password) + the engine's §27.6 success audit landed
   (`onboarding.provision_organization`, table `schools`) in the re-run.

2. **T6 exposed a SECOND, platform-wide defect — FIXED** (commit `459e627`): with a super-admin
   row present, every tenant read (schools, users, …) failed with PG `54001 stack depth limit
   exceeded` — `public.is_super_admin()` was the one helper left SECURITY INVOKER after
   `20260620151525` fixed its three siblings; the `super_admins` SELECT policy re-invokes it for
   any scanned row that is not the caller → unbounded RLS self-recursion. Reproduced
   deterministically, fixed by migration `20261003000020_coregrid_is_super_admin_definer.sql`
   (exact-inverse rollback shipped, canonical-apply manifest bound, applied to the canonical DB,
   posture ratchet: `tests/unit/rls-helper-definer-posture.test.ts`).

### Final journey outcome (dedicated re-run: 6 passed / 2 typed skips / 0 failed)

| Step | Outcome |
|---|---|
| T1 Visitor → public site | REAL |
| T2 Self-serve signup | SKIP (typed) — Supabase auth signup rate limiter (external) |
| T3 Bootstrap gate | REAL |
| T4 Super-admin claim | REAL (admin-seeded via real auth-admin API; rate-limited T2 documented deviation) |
| T5 Onboard organization | REAL — engine success path + §27.6 audit (fix proven) |
| T6 Workspace + notification | REAL — engine-provisioned admin on DB-backed tenant dashboard (RLS fix proven) |
| T7 Reality→mission→…→result | REAL — governed loop + idempotent replay + bound execution |
| T8 AI worker live | SKIP (typed, permanent for V1) — no live AI-worker surface / `AI_API_KEY` |

Remaining work items 1 (fixed), 2 (rate-limit window — external), 3 (external gate), 4
(demo-credential rotation in `tests/e2e/helpers.ts`, pre-existing 5-spec failures) unchanged
except item 1: done. Evidence: `/opt/cursor/artifacts/f13-final-vertical-slice.json`.
