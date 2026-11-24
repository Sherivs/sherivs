# ADR-113: LINK-01 Universal/App Links Host Scoping

|| Field | Value |
||---|---|
|| Status | PROPOSED (draft PR only; deploy/device DAL verification remains operator-gated) |
|| Date | 2026-11-24 |
|| Author | `copilot-swe-agent[bot]` (GitHub Copilot Coding Agent) |
|| Mission | LINK-01 (mobile/web link routing hardening) |
|| Version target | V1 organizational capability envelope |
|| Supersedes-in-part | None |
|| Cites | AGENTS.md §45; frontend/src/lib/auth/webauthn-associated-domains.ts; frontend/src/routes/[.]well-known/assetlinks[.]json.ts; frontend/src/routes/[.]well-known/apple-app-site-association.ts; mobile/app.json; mobile/src/lib/links/app-link-routes.ts |
|| Minimal ownership artifact | `mobile/src/lib/links/app-link-routes.ts` |

## Context

MOB-00 established passkey association files for `sherivs.com`, but LINK-01 requires universal/app links to be scoped to `app.sherivs.com` so marketing pages on apex/www are not captured by native app intents. The Android DAL and iOS AASA responses were previously host-agnostic, so every host received the same passkey-only claims.

## Options

### Option 1 — Keep host-agnostic association documents (rejected)

- **Consequences:** keeps implementation simple but cannot express host-specific `handle_all_urls` / `applinks`; risks broad capture on non-app hosts and violates LINK-01 scope requirements.

### Option 2 — Host-aware association docs + allow-listed app-link paths (ruled)

- **Consequences:** adds host resolution and path-map maintenance work, but keeps apex/webcredentials behavior intact while limiting native link capture to `app.sherivs.com` and known Scholar paths.

## Recommendation (decision)

**Adopt host-aware `.well-known` generation and mobile intent allow-lists: only `app.sherivs.com` emits Android `delegate_permission/common.handle_all_urls` and iOS `applinks` path components; apex/www retain passkey-focused behavior. Mobile routing must map only explicit Scholar web prefixes to existing in-app routes and leave unknown paths unclaimed.**

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual risk:** live store/device association validation is still environment-dependent and cannot be fully proven in CI.
- **The sharpest instance:** Google DAL verification and `adb shell pm get-app-links` may still fail after deploy if external platform metadata is misconfigured.
- **The accepted rationale:** this mission is code/config scope only; runtime verification is tracked as post-deploy evidence.
- **Owner of the residual risk:** platform operators (post-deploy validation checklist), reported as UNVERIFIED until executed.

## Consequences (summary)

- **Positive:** passkey association remains stable; app-link capture narrows to app host + allow-list; unknown paths remain browser-owned.
- **Negative / obligations:** host-aware docs must preserve `Vary: Host`; future new deep-link paths require explicit allow-list updates in both mobile config and route map tests.
- **For the wave/program specifically:** LINK-01 unblocks PUSH-03 reuse of the pure path mapper for notification routes without broadening host capture.

## Golden Questions

- **WHO?** LINK-01 owns host-aware documents and mobile allow-list mapping; operators own post-deploy DAL/device checks.
- **WHAT?** Universal/app links are constrained to `app.sherivs.com` and explicit Scholar path prefixes.
- **WHERE?** In `.well-known` route handlers/helpers, `mobile/app.json`, and `mobile/src/lib/links/app-link-routes.ts`.
- **WHY?** To prevent apex/www marketing pages from being claimed while preserving MOB-00 passkey associations.
- **UNDER WHICH POLICY?** AGENTS §22/§23 workflow verification and AGENTS §45 V1 execution boundary.

## UNKNOWNs

- Production DAL/device verification evidence is pending deployment and physical/device-level checks.
- Future `/home/notifications` dedicated route does not yet exist; LINK-01 routes this prefix to school home until a dedicated screen is implemented.
