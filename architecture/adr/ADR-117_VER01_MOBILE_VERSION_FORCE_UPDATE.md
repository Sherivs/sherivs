# ADR-117: VER-01 Mobile Version Force-Update and Soft-Update Gate

|| Field | Value |
||---|---|
|| Status | PROPOSED (operator approval gate remains open) |
|| Date | 2026-11-24 |
|| Author | copilot-swe-agent[bot] (VER-01) |
|| Mission | VER-01 (mobile/web; coding agent) |
|| Capabilities | V1 organizational mobile distribution safety controls |
|| Supersedes-in-part | None |
|| Cites | AGENTS.md:923-924; frontend/src/routes/api/public/webauthn.ts:1-33; mobile/app/_layout.tsx:1-24; .env.example:194-210 |
|| Minimal ownership artifact | This ADR only — a decision artifact |

## Context

Mobile releases need a governed way to communicate minimum supported versions and latest available versions without authentication, so client builds can block only when explicitly below a configured minimum and otherwise show a soft update prompt. The contract must fail open when configuration is missing, malformed, or unreachable so operational mistakes do not lock out users.

## Options

### Option 1 — Hard-fail endpoint and strict client blocking (rejected)

Return server errors when env values are missing or malformed and let clients treat errors as blocking.

- **Consequences:** maximizes strictness, but creates lockout risk from transient network/server configuration failures; violates fail-open availability intent for public version checks.

### Option 2 — Public safe payload with fail-open client logic (ruled)

Expose an unauthenticated public payload that always returns 200 with shape-stable JSON and sanitize env values to strict semver-or-null. Clients block only when both app version and configured minimum are valid and current version is below minimum.

- **Consequences:** prevents accidental lockouts and keeps behavior deterministic; tradeoff is weaker enforcement when configuration is invalid, which is explicitly accepted to preserve availability.

## Recommendation (decision)

**Adopt Option 2.** The public endpoint returns shape-stable JSON from env with strict semver normalization and no 500 lockout path. Mobile checks run on launch/resume and fail open on transport, parsing, or config errors. Blocking applies only for valid `current < min`; soft update applies only for valid `min <= current < latest`; otherwise no prompt.

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual risk:** malformed or missing env values disable enforcement until corrected.
- **The sharpest instance:** an outdated build may continue running if version config is invalid.
- **The accepted rationale:** availability and anti-lockout take priority for this public health-style endpoint.
- **Owner of the residual risk:** VER-01 implementation owner and release operations configuring environment values.

## Consequences (summary)

- **Positive:** deterministic public contract; safe default behavior under failure.
- **Negative / obligations:** operations must maintain valid semver env values and optional https store URLs.
- **For the wave/program specifically:** mobile and web teams consume one contract for update gating without changing auth boundaries.

## Golden Questions

- **WHO?** VER-01 mission implementation; operators manage env configuration quality.
- **WHAT?** Fail-open public version payload and mobile force/soft update gating.
- **WHERE?** Endpoint at `/api/public/mobile-version`; mobile gate in root layout wrapper.
- **WHY?** Prevent lockout while still enabling minimum-version enforcement.
- **UNDER WHICH POLICY?** AGENTS governance, V1 execution boundary, and mission constraints for public route + mobile gate wiring.

## UNKNOWNs

- Final production values for minimum/latest versions and store URLs remain operational configuration (out of code scope).
- Localization extraction of user-facing copy is deferred to i18n follow-up work.
