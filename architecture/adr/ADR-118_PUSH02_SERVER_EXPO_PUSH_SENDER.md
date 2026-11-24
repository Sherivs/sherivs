# ADR-118: PUSH-02 Server Expo Push Sender and Receipt Polling

|| Field | Value |
||---|---|
|| Status | PROPOSED (draft PR; operator deployment/secret provisioning remains outside this change) |
|| Date | 2026-11-24 |
|| Author | `copilot-swe-agent[bot]` |
|| Mission | PUSH-02 (server push sender) |
|| Capabilities | V1 push notification delivery hardening |
|| Supersedes-in-part | [ADR-112_PUSH01_DEVICE_REGISTRY_AND_PUSH_PREFERENCES.md](./ADR-112_PUSH01_DEVICE_REGISTRY_AND_PUSH_PREFERENCES.md) — consumes its schema and preferences; no schema rewrite |
|| Cites | frontend/src/lib/push.server.ts; frontend/src/lib/push/expo-push.server.ts; frontend/src/lib/push/push-preferences.server.ts; frontend/src/lib/push/push-route-allowlist.server.ts; frontend/src/lib/org-workforce/notification-worker.server.ts; frontend/src/routes/api/public/cron/org-notifications.ts; frontend/src/routes/api/public/cron/push-expo-receipts.ts; infra/cloudflare/sherivs-cron/src/index.js; database/supabase/migrations/20261124000000_sherivs_push01_mobile_push_devices.sql |
|| Minimal ownership artifact | `frontend/src/lib/push/expo-push.server.ts` |

## Context

PUSH-01 added device registry and push preference columns, but server delivery still relied on legacy web push paths and ignored push-category preferences plus per-user timezone quiet hours. The org notification worker also treated push as unsupported, and no cron receipt polling path existed for Expo ticket follow-up.

## Options

### Option 1 — Keep web-only sender and fail push rows (rejected)

- **Consequences:** avoids new sender logic, but leaves `mobile_push_devices` unused and cannot satisfy Expo delivery, push-category preference enforcement, or device pruning on `DeviceNotRegistered`.

### Option 2 — Add Expo sender + receipt poller while preserving existing in-app flow (ruled)

- **Consequences:** adds bounded sender and cron polling complexity, but keeps in-app notification creation unchanged, adds payload minimization controls, and consumes existing PUSH-01 schema without migration changes.

## Recommendation (decision)

**Use a dual-channel server push sender: keep existing web push, add Expo batch send (`<=100`), optional bearer auth (`EXPO_ACCESS_TOKEN` only when set), transient retries, receipt polling, and stale device pruning against `mobile_push_devices`, all gated by `PUSH_EXPO_ENABLED` (off by default) and route allow-list sanitization for push data.**

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual risk:** live end-to-end delivery to physical devices remains unverified until PUSH-03 mobile client wiring and operator-provided credentials.
- **The sharpest instance:** staging/preview flows may report successful enqueue without user-visible notification if client token state is stale.
- **The accepted rationale:** this mission is server-side sender and worker wiring only; no device-side push client or secret provisioning is in scope.
- **Owner of the residual risk:** PUSH-03/PUSH-04 mobile delivery tracks; marked UNVERIFIED in mission evidence.

## Consequences (summary)

- **Positive:** server can send both web and Expo push, enforce push prefs + timezone quiet hours, and suppress unsafe deep-link routes.
- **Negative / obligations:** receipt polling route must remain disabled unless `PUSH_EXPO_ENABLED` is truthy; operators must provision optional Expo token separately.
- **For the wave/program specifically:** PUSH-02 now consumes ADR-112 schema and prepares server contracts needed by PUSH-03 client registration/validation.

## Golden Questions

- **WHO?** PUSH-02 owns server sender and cron receipt polling code; operators own deployment-time env/secret controls.
- **WHAT?** Add Expo server delivery beside existing web push, with guarded payload and preference/quiet-hour enforcement.
- **WHERE?** Push server modules, org notification worker wiring, cron routes, and Cloudflare cron route table.
- **WHY?** Existing sender path could not serve Expo devices or enforce PUSH-01 push preferences in user-local quiet hours.
- **UNDER WHICH POLICY?** AGENTS.md constitution rules on security, tenant isolation, no secret leakage, and V1 execution boundary.

## UNKNOWNs

- PUSH-03 device client registration and token lifecycle validation against real devices.
- Operator decision on whether to set `EXPO_ACCESS_TOKEN` in staging/production.
- Production roll-out timing for enabling `ROUTE_PUSH_EXPO_RECEIPTS` and `PUSH_EXPO_ENABLED`.
