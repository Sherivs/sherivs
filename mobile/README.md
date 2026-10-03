# CoreGrid Mobile

The CoreGrid mobile client (V1-010, Wave 3 — mission team MOBILE). An Expo /
React Native application sharing the web platform's identity service, API
contracts, and governed mission substrate. Phase 22 ownership applies
(`architecture/phase-22-mobile-platform.md`): **CoreGrid services own truth;
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
| Server functions | TanStack Start `/_serverFn/<id>` URL contract via `EXPO_PUBLIC_COREGRID_WEB_BASE_URL` |
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
- `EXPO_PUBLIC_COREGRID_WEB_BASE_URL` — deployed web app that hosts the
  TanStack Start server functions
- `EXPO_PUBLIC_SERVER_FN_RECORD_FOUNDATION_LOOP`,
  `EXPO_PUBLIC_SERVER_FN_LIST_IDENTITIES` — server-function ids emitted by
  the deployed web build (build-generated content hashes). Unset ids make
  the affected screen fail closed with an explicit "not configured" state.

## Build (EAS)

```bash
npm install -g eas-cli   # once
eas login
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

`mobile/src/api/contracts/` mirrors the web's authoritative contracts:

- **Database row types** — type-only import of the generated
  `frontend/src/integrations/supabase/types.ts` (erased at build time; a
  web schema change fails mobile's typecheck).
- **Execution/identity vocabulary** — literal mirrors pinned to the
  canonical types from `foundation-mission.ts` / `identity-registry.ts`
  with two-directional exhaustiveness assertions; vocabulary drift breaks
  the build.
- **Server-function request/response contracts** — mirrored from
  `foundation-loop.functions.ts` and `identity-registry.functions.ts`,
  responses re-validated with Zod before rendering.

**Reported follow-up (not done here — `frontend/src/**` was read-only for
this mission):** extract the generated Database types and the pure contract
vocabulary modules into a shared workspace package so web and mobile import
one physical source. The `cg_*` kernel tables are also absent from the
generated web schema; a tenant-scoped "missions list" server function
would let mobile drop its direct RLS-scoped substrate reads.

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