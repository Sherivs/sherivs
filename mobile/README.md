# Scholar

Scholar is the Sherivs education app (V1-010, Wave 3 — mission team MOBILE).
Sherivs Technologies Limited is the parent brand; this client is the store
app. Store display name: **Scholar**. iOS bundle identifier and Android
package: `com.sherivs.scholar`. URL scheme: `scholar`. Future products ship
as separate apps under `com.sherivs.*`.

An Expo / React Native application sharing the web platform's identity
service, API contracts, and governed mission substrate. Phase 22 ownership
applies (`architecture/phase-22-mobile-platform.md`): **Sherivs services own
truth; this client owns interaction.**

Status: **foundation implemented, store submission is an EXTERNAL GATE**
(pending Apple/Google developer accounts and signing credentials — never
claimed as available).

## Stack

| Concern | Choice |
| --- | --- |
| Runtime | Expo SDK 57 (React Native 0.86, React 19.2), TypeScript strict |
| Navigation | expo-router (file-based, `mobile/app/`) |
| Auth | Supabase JS — email/password sign-in against the SAME project as web |
| API | Typed clients in `mobile/src/api/` mirroring web contracts + RLS-governed reads |
| Server functions | TanStack Start `/_serverFn/<id>` URL contract via `EXPO_PUBLIC_SHERIVS_WEB_BASE_URL` |
| Session storage | expo-secure-store (iOS Keychain / Android Keystore) — never plain storage |
| Tests | Root-repo vitest (`tests/unit/mobile-*.test.ts`) + `npm run typecheck` here |

## Run

```bash
cd mobile
npm install
cp .env.example .env   # fill in the non-secret EXPO_PUBLIC_* values
npm run ios            # or: npm run android / npm run start
```

Environment contract (names in `.env.example`; never commit real values):

- `EXPO_PUBLIC_APP_ENV` — `development | preview | production`
- `EXPO_PUBLIC_SUPABASE_URL` — same Supabase project as the web app
- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — publishable/anon key only
  (public by design; authorization is enforced server-side by RLS)
- `EXPO_PUBLIC_SHERIVS_WEB_BASE_URL` — deployed web app that hosts the
  TanStack Start server functions
- `EXPO_PUBLIC_SERVER_FN_RECORD_FOUNDATION_LOOP`,
  `EXPO_PUBLIC_SERVER_FN_LIST_IDENTITIES` — server-function ids emitted by
  the deployed web build (build-generated content hashes). Unset ids make
  the affected screen fail closed with an explicit "not configured" state.

## Build (EAS)

The Expo project is owned by the **sherivs** Expo account. Do not use the
old `vibeoraai-bit` Expo account. The linked project is already in
`app.json`: owner `sherivs`, slug `coregrid-mobile`, `extra.eas.projectId`
`2e19ca55-cc79-4634-ae8a-bf8b551a6a20`. Do not run `eas init` again and do
not replace that project id.

Passkey association uses the WebAuthn RP host `sherivs.com`:

- iOS `associatedDomains`: `webcredentials:sherivs.com` (apple-app-site-association
  defaults to bundle id `com.sherivs.scholar`)
- Android `package`: `com.sherivs.scholar`, plus an `https` intent filter on
  host `sherivs.com` (the same host). Expo also emits the `scholar://` scheme
  filter from `scheme`. `assetlinks.json` defaults to package
  `com.sherivs.scholar` and only the passkey relation
  `delegate_permission/common.get_login_creds` — it does not grant
  `handle_all_urls`.

The EAS project defines three **public** environment variables in each of
the `production`, `preview`, and `development` environments. Names only;
values live in EAS, never in this repo:

| Name | Source |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | EAS environment (same Supabase project as the web app) |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | EAS environment (publishable/anon key only) |
| `EXPO_PUBLIC_SHERIVS_WEB_BASE_URL` | EAS environment (deployed web app origin) |

Each build profile sets `environment` to the matching EAS environment so
those variables load at build time. `EXPO_PUBLIC_APP_ENV` is pinned in the
profile (`development`, `preview`, or `production`) and is not one of the
EAS-hosted variables. No server secrets belong in the mobile app.

GitHub Actions does not currently run EAS. If a future workflow does
(`eas build` / `eas update` / `eas submit`), add an `EXPO_TOKEN` issued
from the **sherivs** Expo account as a repository Actions secret. The
`submit.production` profile is an empty object: it does not name an Apple
ID, an App Store Connect app, or a Play service account.

```bash
npm install -g eas-cli   # once
eas login                # as sherivs
eas build:configure      # uses the checked-in eas.json
eas build --profile development --platform all   # dev client / simulator
eas build --profile preview --platform android   # internal APK
eas build --profile production --platform all    # store artifacts
```

Profiles (`mobile/eas.json`): `development` (dev client, iOS simulator,
EAS environment `development`), `preview` (internal distribution, Android
APK, EAS environment `preview`), `production` (app-bundle,
auto-incremented versions, EAS environment `production`). Each profile
pins `EXPO_PUBLIC_APP_ENV` to that same channel so production
configuration can never leak into development builds (Phase 22 §CD).

**Store submission — EXTERNAL GATE:** releasing to the Apple App Store /
Google Play requires Apple Developer and Google Play Console accounts plus
signing credentials (keystore, certificates). These are ABSENT from this
environment; the mission therefore ships release-readiness artifacts only.
No store presence is claimed.

## What is wired to real APIs

Everything renders live backend state; there is no mock or seed data
anywhere in `mobile/`. Loading, empty, and error states are honest — when a
fetch fails or connectivity drops, screens say so and never substitute
cached or fabricated content.

| Screen | Real source | Notes |
| --- | --- | --- |
| Sign-in | Supabase `signInWithPassword` | Same project/semantics as `frontend/src/routes/auth.tsx` |
| Organization/workspace selection | `users` → `schools` queries (RLS) | Super admins list active `schools`; staff get their gate-resolved org |
| Missions list / detail / status | `cg_execution_record`, `cg_verification_result` (RLS-scoped reads, Zod-validated rows) | Verification shown independently of worker completion |
| Workers & agents (read-only) | `listIdentities` server function via `/_serverFn/<id>` URL contract | Same endpoint the web uses; tenant boundary re-checked client-side |
| Evidence | `cg_foundation_evidence` (RLS-scoped reads) | Provenance + integrity shown verbatim |
| Settings + sign-out | Supabase session; secure-store token cleanup | Shows environment + configured server-fn ids |
| Offline state | Supabase `auth/v1/health` probe with exponential backoff | Banner in the app shell; no offline content fabrication |

## Shared-contract discipline (AGENTS §23)

The shared contracts are declared ONCE in `packages/contracts`
(specifier `@sherivs/contracts`, an npm `file:` dependency consumed as
TypeScript source by both Vite and Metro — no bundler plugins). This app
imports them directly; there is no mobile-side mirror to drift:

- **Database row types** — `@sherivs/contracts` (`src/database.ts`, generated
  types; type-erased at build time; a schema change fails both surfaces'
  typechecks at once).
- **Execution/identity vocabulary** — `@sherivs/contracts`
  (`src/vocabulary.ts`); the web's contract modules re-export the same
  declarations, so vocabulary drift between web and mobile is impossible by
  construction (pinned by `tests/unit/contracts-single-source.test.ts`).
- **Server-function request/response contracts** — row shapes come from
  `@sherivs/contracts` (`src/foundation-rows.ts`, `src/identity.ts`);
  responses re-validated with Zod before rendering, and each Zod schema is
  compile-time-pinned to the shared row type.

**Reported follow-up:** the `cg_*` kernel tables are absent from the
generated web schema; a tenant-scoped "missions list" server function would
let mobile drop its direct RLS-scoped substrate reads. The Supabase type
generator's output path should also be repointed to
`packages/contracts/src/database.ts` (the generator script belongs to
another team's scope).

## Tests

Root-repo convention (stated choice per mission): unit tests live in
`tests/unit/mobile-*.test.ts` and run with the repo's vitest project
(`npm run test:unit` from the repo root). The tested layers (`contracts/`,
`serverFn.client.ts`, `lib/offline/`) are pure TypeScript with no Expo or
React Native imports, so they run in node directly. Expo-dependent code
(screens, providers, secure storage) is covered by `npm run typecheck`
inside `mobile/`.

```bash
# from repo root
npx vitest run tests/unit/mobile-env-contract.test.ts \
                tests/unit/mobile-serverfn-client.test.ts \
                tests/unit/mobile-mission-contracts.test.ts \
                tests/unit/mobile-connectivity.test.ts

# inside mobile/
npm run typecheck
```

Brand artwork lives in `mobile/assets/` (`icon.png` 1024×1024,
`adaptive-icon.png` 1024×1024, `splash-icon.png` 1024×1024, `favicon.png`
48×48). `npm run generate-assets` still overwrites those files with the old
placeholder marks — do not run it for a store build.

## Pending work

1. Apple/Google developer accounts + signing credentials → EAS submit
   (external gate).
2. Shared contract package extraction (§23 follow-up above).
3. Server-function ids emitted per environment into EAS env config.
4. Push notifications, deep links, biometric unlock, i18n — Phase 22 scope
   beyond this mission's V1 foundation.
5. Brand icon, adaptive icon, splash, and favicon are the Scholar marks in
   `mobile/assets/`. Do not regenerate them with `scripts/generate-assets.mjs`.

## School workspace (Track E)

Signed-in users now land in `app/(school)/`, a tab bar built from the **workspace manifest**
(`src/workspace/manifest.ts`): one account, and the tabs follow the role on the `users` row.

| Role | Tabs |
| --- | --- |
| student | Home, Results, CBT, Attendance, Fees, Messages |
| parent | Home, Results, Attendance, Fees, Messages |
| teacher | Home, Attendance, Results, CBT, Messages |
| bursar | Home, Fees, Messages |
| admin / principal / hq | Home, Results, Attendance, Fees, Messages (+ Platform console link to the original `(app)` screens) |
| alumni / driver / unknown | Home, Messages |

- Data: `src/api/school.client.ts`. Plain RLS-scoped reads plus the `cbt_start` / `cbt_sync` / `cbt_submit` RPCs, using the same
  Supabase project and auth session as the web app. Every query passes an explicit `student_id`/`class_id` filter, so it uses an index.
- Offline: `src/lib/offline-cache.ts` keeps the last good copy of results, attendance, fees, messages and the CBT list per user
  in AsyncStorage and **labels it with the time it was fetched**. It is never shown as live and is cleared on sign-out.
  CBT answers autosave every 15 s to the server and to the phone; the server's monotonic `client_seq` rejects stale replays.
- Fee payment opens the web checkout (Paystack); settlement stays webhook-driven on the server.

Verified locally: `npm run typecheck` passes, `npx expo start` serves Metro, and `npx expo export --platform android` bundles the app.

### Needed to ship (not available in this environment)
- **Expo account `sherivs` + `EXPO_TOKEN`** issued from that account (for `eas build` / `eas update`; set as a CI secret if a workflow starts using EAS).
- **Apple Developer Program** membership ($99/yr) + App Store Connect app record. EAS can manage the certificates and profiles.
- **Google Play Console** account ($25 one-time) + an upload keystore (EAS can generate it) + a service-account JSON for `eas submit`.
- The three public EAS variables above are set on the project for `production`, `preview`, and `development`. Server-function ids are still unset and fail closed until supplied.
- Push notifications (optional next step): `expo-notifications` + an FCM server key / APNs key.
