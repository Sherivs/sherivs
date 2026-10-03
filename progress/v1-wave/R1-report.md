# R1 Report — Legacy e2e suite made honest and green (team QA-CREDS)

- Mission: team R1 (QA-CREDS), CoreGrid V1 remediation wave
- Date: 2026-10-03
- Branch: `cursor/p08-foundation-loop-classification-fe86` (no branch switch; coordinator commits)
- File ownership respected: only `tests/e2e/helpers.ts` + the 5 legacy spec files were modified
  (`tests/e2e/v1-vertical-slice.spec.ts` untouched; no `frontend/src`, `mobile/`, `scripts/`,
  `database/`, `.env.example`, or playwright.config changes). No git commit/push performed.
- Version-target classification (AGENTS §45): **V1** — test-infrastructure remediation over the
  existing V1 organizational surface; no V2/V3 capability implemented.

## Implemented

1. **Credential law rebuilt in `tests/e2e/helpers.ts`** — the hard-coded demo password
   (`Demo@2026!`) and the demo-button provisioning path are gone. Credentials now come from
   exactly two places, never a source constant:
   - **(a) Per-run fixture tenant** through the REAL auth-admin API (service-role
     `createUser` with `email_confirm: true` — the same pattern as
     `tests/e2e/v1-vertical-slice.spec.ts` beforeAll) plus the same `schools`/`users` rows the
     onboarding engine writes: one run-unique tenant (`slug: r1legacy-fixture-<runId>`,
     `subscription_tier: "enterprise"`) with eight tenant users (`admin`, `principal`,
     `teacher`, `parent`, `student`, `bursar`, `hq`, `driver` — all values allowed by
     `users_role_check`). Run-generated emails/passwords live in process memory only and are
     never printed. Memoized per worker; `cleanupLegacyFixture` removes every artifact
     (storage objects under the tenant's `school-media/` prefix, `school_gallery` rows,
     `audit_logs` rows, `schools` row cascading `users`, every created auth user) and prints a
     leftover-verification JSON.
   - **(b) Env-var identity pair** `E2E_<PREFIX>_EMAIL` / `E2E_<PREFIX>_PASSWORD` via
     `envCredentials(prefix)` — used for identities e2e must never fabricate (the
     `super_admin` case reads `E2E_SUPER_ADMIN_EMAIL`/`E2E_SUPER_ADMIN_PASSWORD`) and
     available for any future spec that genuinely needs the pinned pre-existing demo tenant
     (`E2E_DEMO_ADMIN_EMAIL`/`E2E_DEMO_ADMIN_PASSWORD`). Absent env vars ⇒ typed SKIP naming
     the missing external dependency. Never hard-coded.
   - The legacy `provisionDemo()` (click "sign in as enterprise demo") was **removed**: every
     invocation rotates the demo tenant's account credentials and rewrites the demo school row
     (`frontend/src/lib/runtime/scholar/demo-provision.functions.ts` — `updateUserById` with a
     fresh generated password; `ensureSchool` UPDATE), which mutates the demo tenant. Tests
   never touch the demo tenant now.
2. **Five legacy specs re-pointed at the fixture** (`preview-public-site-card`,
   `enterprise-checklist`, `mobile-swipe-open`, `gallery-upload`, `mobile-sidebar-active`):
   `beforeAll` provisions, each test SKIPs typed when the fixture is unavailable
   (`FIXTURE_SKIP_NO_BACKEND`), `afterAll` cleans up. `signIn()` now takes explicit
   `{email, password}` and tolerates the dev-server hydration navigation race; the demo
   tenant's school slug no longer appears anywhere (`gallery-upload` uses the fixture slug).
3. **Two honest product/environment findings driven the spec updates** (reported, not faked):
   - **`transport_buses` zero-policy posture** (migration `20261002000014`, stated consumer
     impact: every client-role read denies): the driver dashboard renders the preview card
     only in its assigned-bus state, and `getMyDriverBus` returns zero rows for every driver
     session on any tenant. `preview-public-site-card`'s driver case SKIPs on the observed
     `"No bus assigned"` state with a typed reason naming the posture, and runs real
     automatically if access is ever re-provisioned.
   - **`school-media` storage bucket is not provisioned** on the configured backend
     (`POST /storage/v1/object/school-media/...` → `400 {"statusCode":"404","error":"Bucket
     not found"}`). e2e must not create infrastructure, so `gallery-upload` probes
     `storage.listBuckets()` and SKIPs typed when the bucket is absent.
4. **`mobile-sidebar-active` rewritten to the invariant, not a stale label matrix** — the old
   per-role route→`aria-label` matrix drifted out of sync with the live nav catalog
   (`scholar-nav-catalog.ts`, e.g. `/admin/dashboard` is now "Executive Dashboard" inside
   collapsible sections). The spec now (i) signs in, (ii) asserts role→portal routing,
   (iii) discovers the routes the sidebar itself exposes at runtime, and (iv) asserts each
   exposed route's sidebar item carries `data-active="true"` while active (expanding collapsed
   sections first). Redirects away from a sidebar route are annotated and logged, never silent.
5. **`mobile-swipe-open` gesture fix** — `edgeSwipeOpen` dispatched synthetic TouchEvents on
   `window`, but the app's hook listens on `document` (`use-swipe-sidebar.ts:49-50`), so the
   events never reached it. Dispatch target corrected to `document`; freshly-navigated pages
   retry the same gesture until the app can receive it (hydration timing), with the real
   sheet-open assertion unchanged.

## Files Changed

- `tests/e2e/helpers.ts` (rewritten credential law + fixture + cleanup + `envCredentials` +
  `schoolMediaBucketExists` + fixed `edgeSwipeOpen`)
- `tests/e2e/preview-public-site-card.spec.ts`
- `tests/e2e/enterprise-checklist.spec.ts`
- `tests/e2e/mobile-swipe-open.spec.ts`
- `tests/e2e/gallery-upload.spec.ts`
- `tests/e2e/mobile-sidebar-active.spec.ts`
- this report

Not touched (verified via `git status --porcelain`): `tests/e2e/v1-vertical-slice.spec.ts`
(modified by its owning team R2, not by R1), all `frontend/src`, `mobile/`, `scripts/`,
`database/`, `.env.example`, `playwright.config.ts`.

## Architecture Impact

- None on product code. The specs exercise the existing real surfaces: `/auth` password
  sign-in, role dashboards, CMS, storage upload path, public site, mobile sidebar.
- The fixture mirrors the onboarding engine's write set (auth user + school + users rows)
  through the real auth-admin API and is fully removed afterwards — same discipline as the
  v1-vertical-slice fixture, applied to the legacy suite.
- The e2e suite no longer depends on (nor mutates) the demo tenant, closing V1-008
  Known Risk 2 / F-13 remaining-work item 4 at the test layer.

## Tests

All runs against the existing dev server on http://localhost:8080 (tmux `coregrid-dev-server`,
reused, never killed; `PLAYWRIGHT_NO_WEBSERVER=1`).

**Final consolidated run — full legacy suite (5 specs):**

```
  3 skipped
  16 passed (3.1m)
```
Log: `/opt/cursor/artifacts/r1-legacy-suite-full.log`. **0 failures.**

Per-spec results (each also run individually with `npx playwright test <spec> --reporter=line`):

| Spec | Result | Skip reasons |
|---|---|---|
| `preview-public-site-card` | 6 passed, 1 skipped | driver case: `transport_buses` ZERO-POLICY posture (typed) |
| `enterprise-checklist` | 1 passed | — |
| `mobile-swipe-open` | 1 passed | — |
| `gallery-upload` | 1 skipped | `school-media` bucket not provisioned (typed) |
| `mobile-sidebar-active` | 8 passed, 1 skipped | super_admin: no `E2E_SUPER_ADMIN_*` env identity; creation prohibited (typed) |

Every run printed the cleanup verification, e.g.:

```
{"cleanup":"r1-legacy-fixture","schoolId":"5216ed06-2675-49ea-829d-81b9984576e5","schoolsLeftover":0,"usersLeftover":0,"statementFailures":0}
```

Typecheck: `npx tsc --noEmit` → **exit 0, zero output** (fully clean).

## Security Validation

- **No hard-coded secrets**: `rg "Demo@2026|demo\.school|universalschool" tests/e2e/`
  (excluding R2's `v1-vertical-slice.spec.ts`) → 0 matches. Passwords are run-generated
  (`randomBytes(18).toString("base64url") + "aA1!"`) and live in process memory only; env var
  values are never logged (names only in skip reasons).
- **Demo tenant untouched**: no spec calls the demo-provision button or writes to school
  `01ebe598-eb54-4343-a902-3627cb14cc5b`; the rotation-mutating `provisionDemo` path was
  deleted from the suite.
- **No super admin created**: the bootstrap gate was never claimed; the `super_admin` case
  requires operator-provided env credentials and otherwise typed-skips.
- **Least-privilege writes**: service-role writes are confined to the run's own fixture
  tenant; cleanup deletes every created row/auth user.
- **Cleanup proven across all runs** — read-only leftover audit over every namespace this
  mission created (`r1legacy-*`, `r1probe*` schools/slugs/emails):

```
{"probe":"r1-leftover-audit","schoolsLeftover":0,"schoolsSlugs":[],"usersRowsLeftover":0,"authUsersLeftover":0,"authUserEmails":[]}
```

## Known Risks

1. **Environment gaps surfaced (owned by other teams/infra, test-layer handled honestly):**
   - `school-media` storage bucket absent from the configured backend → gallery journey
     typed-skips until an operator provisions the bucket.
   - `transport_buses` zero-policy RLS (`20261002000014`) makes the driver's assigned-bus
     surface unreachable for every client session → driver preview-card case typed-skips until
     the owning mission re-provisions neutral tenant-scoped access.
   - No legitimate super-admin credentials in the environment (and creating them is
     prohibited) → super_admin sidebar case typed-skips until `E2E_SUPER_ADMIN_EMAIL` /
     `E2E_SUPER_ADMIN_PASSWORD` are provided.
2. **Shared-VM churn**: concurrent teams run against the same dev server; one early run hit a
   Vite error overlay / browser channel closure (environment-level, not app-level) and was
   re-run cleanly. Spec assertions were kept strict; only gesture-level hydration timing uses
   an in-test retry of the same user action.
3. **`signIn` hydration race tolerance**: the helper retries `goto /auth` once on a benign
   same-URL navigation interruption; a genuine auth outage still fails loudly (waitForURL
   30s).

## Remaining Work

1. Infrastructure owner: provision the `school-media` storage bucket on the canonical backend
   → `gallery-upload` runs real automatically (bucket probe already in place).
2. Owning mission for `transport_buses`: re-provision neutral tenant-scoped policies (per the
   migration's stated consumer impact) → the driver preview-card case runs real automatically.
3. Operators: provide `E2E_SUPER_ADMIN_EMAIL`/`E2E_SUPER_ADMIN_PASSWORD` via Cloud Secrets to
   exercise the super_admin sidebar case against a real super admin.
4. Coordinator: commit the six changed test files (R1 performed no git operations per mission
   law).