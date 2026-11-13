# Sherivs Mobile

The Sherivs mobile client (V1-010, Wave 3 — mission team MOBILE). An Expo /
React Native application sharing the web platform's identity service, API
contracts, and governed mission substrate. Phase 22 ownership applies
(`architecture/phase-22-mobile-platform.md`): **Sherivs services own truth;
this client owns interaction.**

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

The Expo project is owned by the **sherivs** Expo account (signed up
through GitHub as Sharfaddeen100). Do not use the old `vibeoraai-bit`
Expo account. After this account move, `extra.eas.projectId` is
intentionally absent until the owner creates the new project. Do not
invent or paste a project ID by hand.

One-time steps (owner, on a machine signed in to the sherivs Expo account):

```bash
cd mobile
npx eas-cli login    # sign in as sherivs
npx eas init         # creates the project under sherivs and writes the new projectId into app.json
```

Then rebuild with the profiles below. If any push-notification credentials
existed on the old Expo project, re-set them on the new one (this repo has
no `expo-notifications` dependency, no `google-services.json`, and no
`GoogleService-Info.plist`). GitHub Actions does not currently run EAS; if
a future workflow does (`eas build` / `eas update` / `eas submit`), add an
`EXPO_TOKEN` issued from the **sherivs** Expo account as a repository
Actions secret.

```bash
npm install -g eas-cli   # once
eas login                # as sherivs
eas build:configure      # uses the checked-in eas.json
eas build --profile development --platform all   # dev client / simulator
eas build --profile preview --platform android   # internal APK
eas build --profile production --platform all    # store artifacts
```

Profiles (`mobile/eas.json`): `development` (dev client, iOS simulator),
`preview` (internal distribution, Android APK), `production` (app-bundle,
auto-incremented versions). Each profile pins its `EXPO_PUBLIC_APP_ENV`
channel so production configuration can never leak into development builds
(Phase 22 §CD).

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
npm run generate-assets   # regenerates the placeholder icon/splash PNGs
```

## Pending work

1. Apple/Google developer accounts + signing credentials → EAS submit
   (external gate).
2. Shared contract package extraction (§23 follow-up above).
3. Server-function ids emitted per environment into EAS env config.
4. Push notifications, deep links, biometric unlock, i18n — Phase 22 scope
   beyond this mission's V1 foundation.
5. Replace generated placeholder icon/splash artwork with final brand
   assets (design authority pending).
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
- Production `EXPO_PUBLIC_*` values (Supabase URL + publishable key, web base URL) in EAS environment variables.
- Push notifications (optional next step): `expo-notifications` + an FCM server key / APNs key.
