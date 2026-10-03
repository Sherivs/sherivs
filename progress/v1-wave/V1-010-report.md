# V1-010 — Mobile Foundation (Expo/React Native, shared contracts with web)

- Mission: V1-010
- Team: MOBILE
- Wave: V1 Wave 3
- Version-target classification: **V1** (organizational capability envelope; §45 V1 EXECUTION BOUNDARY — no V2/V3 scope touched)
- Date: 2026-10-03
- Report format: AGENTS §42

## Implemented

1. **Expo application** — production-structured Expo SDK 57 app in `mobile/`
   (React Native 0.86, React 19.2, expo-router, TypeScript strict with
   `noUncheckedIndexedAccess`). No fake/mock/seed data anywhere; every screen
   renders live backend state with honest loading/empty/error states.
2. **Typed shared-contract API layer** (`mobile/src/api/`) —
   - `contracts/database.ts`: type-only consumption of the web's generated
     Database row types (single typed source; erased at build time);
   - `contracts/vocabulary.ts`: execution/identity vocabulary mirrors pinned
     to the canonical web types with two-directional exhaustiveness
     assertions (compile-time drift detection, V1CAP-052 pattern);
   - `contracts/mission-contracts.ts`, `identity-contracts.ts`,
     `profile-contracts.ts`: Zod row/response contracts mirroring
     `foundation-loop.ts`, `identity-registry.functions.ts`, and the web's
     auth bootstrap; every response validated before rendering;
   - `contracts/env.ts`: fail-closed `EXPO_PUBLIC_*` environment contract
     (dev/preview/production separation, publishable-key shape check);
   - `client.ts` + `auth.client.ts`: Supabase client factories mirroring the
     web's `client.ts` conventions (publishable key only, opaque-key fetch
     wrapper, persisted auto-refreshing session) on expo-secure-store;
   - `serverFn.client.ts`: the TanStack Start `/_serverFn/<id>` URL contract
     client (POST `{"data": …}`, `x-tsr-serverFn: true`, Bearer JWT;
     cross-JSON result unwrapping; closed error taxonomy), matching the
     repository's live HTTP evidence in `scripts/exercise-foundation-loop.mjs`;
   - `missions.client.ts`, `identity.client.ts`, `evidence.client.ts` reads
     over the SAME endpoints/substrate the web uses.
3. **Screens** (`mobile/app/`) — sign-in (real Supabase auth);
   organization/workspace selection (real `users`→`schools` query; super
   admins list active organizations); missions list, mission detail, and
   mission status (real `cg_execution_record`/`cg_verification_result`
   RLS-scoped reads, verification shown independently of worker completion);
   worker/agent status read-only view (real `listIdentities` server function
   with tenant-boundary re-check); evidence view (real
   `cg_foundation_evidence` with provenance/integrity); settings + sign-out
   (secure-store token cleanup); app-shell offline banner + reconnection
   controller (Supabase health probe, exponential backoff, manual retry).
   Offline/failed states never fabricate cached content.
4. **App config** — `app.json` with production bundle identifier
   `com.coregrid.app` (iOS) and applicationId `com.coregrid.app` (Android);
   spec-generated icon/adaptive-icon/splash/favicon placeholders
   (`scripts/generate-assets.mjs`); `eas.json` with development/preview/
   production profiles pinning `EXPO_PUBLIC_APP_ENV` per channel; names-only
   `.env.example` — no secrets committed (§30).
5. **README** (`mobile/README.md`) — run/build instructions, real-API vs
   pending table, contract-discipline notes, external-gate statement.
6. **Tests** — 31 unit tests (4 files) covering the environment contract,
   the server-fn URL contract client, all mission/identity/evidence row
   contracts (including cross-tenant and vocabulary rejections), and the
   offline state machine (backoff, cap, recovery, retry, subscription,
   cancellation).

## Files Changed

Created only (no existing file modified; `frontend/src/**` untouched —
read-only constraint respected; no git commands run per mission LAW):

```
mobile/
  package.json, tsconfig.json, app.json, eas.json, .env.example, .gitignore,
  README.md, scripts/generate-assets.mjs,
  assets/{icon.png, adaptive-icon.png, splash-icon.png, favicon.png},
  app/_layout.tsx, app/index.tsx, app/sign-in.tsx,
  app/(app)/_layout.tsx, app/(app)/index.tsx, app/(app)/organization.tsx,
  app/(app)/missions/index.tsx, app/(app)/missions/[id].tsx,
  app/(app)/agents.tsx, app/(app)/evidence.tsx, app/(app)/settings.tsx,
  src/api/client.ts, src/api/auth.client.ts, src/api/missions.client.ts,
  src/api/identity.client.ts, src/api/serverFn.client.ts, src/api/errors.ts,
  src/api/contracts/{database,env,vocabulary,mission-contracts,
                      identity-contracts,profile-contracts}.ts,
  src/lib/offline/connectivity.ts, src/lib/app-runtime.ts, src/lib/use-query.ts,
  src/providers/{session-provider,connectivity-provider}.tsx,
  src/ui/{theme.ts, components.tsx}
tests/unit/
  mobile-env-contract.test.ts, mobile-serverfn-client.test.ts,
  mobile-mission-contracts.test.ts, mobile-connectivity.test.ts
progress/v1-wave/
  V1-010-report.md (this file)
```

## Architecture Impact

- Phase 22 (Mobile Platform) substrate now exists: the client is an
  interaction layer only — all authorization remains server-side (RLS +
  server-function gates), satisfying Phase 22 DC ("CoreGrid services own
  truth; Phase 22 owns interaction") and DF invariants 1/2/7.
- Shared-contract discipline (§23): authentication semantics, row shapes,
  and vocabulary are consumed from the web's typed sources via type-only
  imports + compile-time exhaustiveness assertions — zero runtime coupling,
  zero re-invention. `frontend/src/**` was NOT restructured.
- Data minimization (§19): mobile selects only presentation columns; the
  `schools` payment-credential columns present in the web schema are never
  requested.
- No new UI framework; React Native core primitives + token module
  (`src/ui/theme.ts`).

## Tests

Runner choice (stated per mission): repo-root vitest, repo convention
(`tests/unit/`), because the tested layers (`contracts/`,
`serverFn.client.ts`, `lib/offline/`) are pure TypeScript without Expo/RN
imports and therefore run directly in node under the existing root project;
Expo-dependent code is covered by `mobile/ npm run typecheck`.

```
npx vitest run tests/unit/mobile-*.test.ts
 ✓ tests/unit/mobile-connectivity.test.ts (6 tests)
 ✓ tests/unit/mobile-env-contract.test.ts (6 tests)
 ✓ tests/unit/mobile-mission-contracts.test.ts (11 tests)
 ✓ tests/unit/mobile-serverfn-client.test.ts (8 tests)
 Test Files  4 passed (4) — Tests  31 passed (31)
cd mobile && npx tsc --noEmit   → exit 0
```

Security validation performed:

- Environment contract rejects secret-shaped keys (`sb_secret_…`) and any
  non-publishable credential (tested).
- Tenant boundary: identity list responses are rejected when any row's
  tenant crosses the response's declared tenant scope (schema refinement,
  tested) and re-checked against the actor's resolved organization
  (`identity.client.ts`).
- Responses are untrusted: every row passes a Zod contract or the screen
  reports a contract error (tested: unknown statuses, foreign tenants,
  tampered ids all fail closed).
- No service-role or server-only secret exists anywhere in `mobile/`;
  `.env.example` names only. Session tokens persist exclusively through
  expo-secure-store (Keychain/Keystore).
- Client never supplies tenant ids; tenant context is always resolved from
  the authenticated row or a server-function gate (§26).

## Known Risks

1. **Server-function ids are build artifacts.** TanStack Start emits
   content-hash ids per web build; mobile receives them via
   `EXPO_PUBLIC_SERVER_FN_*`. Until EAS environment variables carry the
   deployed web build's ids, the workers/agents screen fails closed with an
   explicit "not configured" state. Mitigated: never guesses URLs.
2. **GET server-function serialization** (`?input=` JSON) is the one
   contract shape not covered by the repository's live POST evidence; the
   first live GET contract must be verified against the deployed build.
   Documented in `serverFn.client.ts` and README.
3. **Missions list uses RLS-scoped direct reads.** The web exposes no
   tenant-scoped missions-list server function; if RLS on `cg_*` tables is
   deny-by-default for mobile-facing roles, the screen honestly reports
   "not visible" until a server-function read path is added (see follow-up).
4. Placeholder brand assets are spec-valid PNGs generated to the CoreGrid
   tokens; final artwork pending design authority.
5. Root `npm run verify` was NOT run (per mission LAW); only targeted
   mobile tests + mobile typecheck. Repo-wide drift/registry checks were
   not exercised against the new files.

## Remaining Work (reported follow-ups)

1. **EXTERNAL GATE — store submission:** Apple App Store / Google Play
   release requires Apple Developer + Google Play Console accounts and
   signing credentials (keystore, certificates). These are ABSENT; the
   mission ships release-readiness artifacts only. **No store presence is
   claimed.** PENDING external credentials.
2. **Shared contract package (§23):** extract the generated Database types
   and pure vocabulary modules from `frontend/src/` into a shared workspace
   package so web and mobile import one physical source. Requires frontend
   restructuring authority (out of scope here).
3. Add a tenant-scoped missions-list server function in the web and consume
   it from mobile (replaces direct `cg_*` reads with the web's gate
   semantics).
4. Emit the deployed web build's server-function ids into EAS environment
   configuration per channel.
5. Phase 22 scope beyond V1: push notifications, deep links, biometric
   unlock, i18n, telemetry/crash reporting, full design system.
6. Replace placeholder icon/splash assets with final brand artwork.