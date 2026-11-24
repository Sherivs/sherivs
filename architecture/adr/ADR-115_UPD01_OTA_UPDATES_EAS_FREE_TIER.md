# ADR-115: UPD-01 OTA Updates via EAS Update (Free Tier)

| Field                      | Value                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (manual publish only; production rollout remains operator-gated until free-tier limits are verified)                 |
| Date                       | 2026-11-24                                                                                                                    |
| Author                     | `copilot-swe-agent[bot]` (GitHub Copilot Coding Agent)                                                                        |
| Mission                    | UPD-01 (mobile release; OTA update channel wiring)                                                                            |
| Version target             | V1 organizational mobile capability envelope                                                                                  |
| Cites                      | AGENTS.md §22, §23, §30, §45; `mobile/app.json`; `mobile/eas.json`; `.github/workflows/eas-update.yml`; `mobile/package.json` |
| Minimal ownership artifact | This ADR only — a decision artifact                                                                                           |

## Context

The mobile app had no explicit OTA update runtime policy, no EAS Update URL, and no manual-only
GitHub workflow for publishing updates. UPD-01 requires free-tier-safe OTA wiring for the existing
EAS project `2e19ca55-cc79-4634-ae8a-bf8b551a6a20` (owner `sherivs`): preview and production channels
in `mobile/eas.json`, update behavior and `updates.url` in `mobile/app.json`, and publishing
restricted to `workflow_dispatch` with `secrets.EXPO_TOKEN`.

ADR-112 is the PUSH-01 device-registry decision. This mission records its own decision as ADR-115
and does not reuse that number. Brand, link, push, and version-gate config already on `master`
(splash color, associated domains, intent filters, remote version source, `expo-application`)
stays in place; this decision only adds the OTA keys.

Free-tier monthly active user and update-volume limits are UNVERIFIED. Production publishing stays
manually triggered until those limits are confirmed. No paid Expo plan is assumed. `EXPO_TOKEN` is
not created or stored by this change.

## Options

### Option 1 — Publish on push or pull_request (rejected)

Automatically publish updates on each commit.

- **Consequences:** fast propagation, but spends the free-tier allowance on every merge and widens the chance of an accidental production update.

### Option 2 — Manual-dispatch-only update workflow with channel gating (ruled)

Publish updates only when an operator runs `workflow_dispatch` and chooses the channel, platform, and message. The workflow checks out the selected branch, installs the locked mobile dependencies, and runs `eas update` for that channel. The channel name is also the EAS environment (`preview` or `production`), matching `mobile/eas.json`. Dispatch inputs are passed through the step `env` and read by the shell; they are not interpolated into the `run` script. `actions/checkout` and `actions/setup-node` are pinned to full commit SHAs.

- **Consequences:** an operator must publish on purpose. That is slower than automation and matches the free-tier quota bound. The development profile has no channel: development-client builds are not the OTA consumer for this mission, and an extra channel is another way to spend the allowance.

## Recommendation (decision)

**Adopt manual-only EAS Update publishing and declarative runtime configuration now:**
`runtimeVersion.policy = "fingerprint"`, `updates.url = "https://u.expo.dev/2e19ca55-cc79-4634-ae8a-bf8b551a6a20"`,
`updates.checkAutomatically = "ON_LOAD"`, `updates.fallbackToCacheTimeout = 0`, the `expo-updates`
dependency and config plugin, and `preview` / `production` build profiles mapped to the same-named
channels. No automatic publish triggers are allowed.

The update URL is the EAS Update endpoint for the project id already stored at
`expo.extra.eas.projectId`. Native projects are not committed, so Continuous Native Generation
applies this config on the next EAS build. A build compiled before this URL exists cannot receive
these updates until it is rebuilt.

## Consequences (summary)

- **Positive:** preview and production builds compiled with this config can receive JS-only updates on their channel. Production remains an explicit operator action.
- **Negative / obligations:** someone must run the manual workflow; `EXPO_TOKEN` must be provisioned outside source control; free-tier MAU and update limits are still unverified, so production publishing stays gated.
- **For the program:** unblocks UPD-01 while keeping free-tier risk bounded and auditable.

## Golden Questions

- **WHO?** Release operators trigger update publishes. Mobile config owns runtime and update behavior.
- **WHAT?** Manual, channel-targeted OTA wiring for Expo EAS Update on the free tier.
- **WHERE?** `mobile/app.json`, `mobile/eas.json`, `.github/workflows/eas-update.yml`, `mobile/package.json`, this ADR.
- **WHY?** To enable JS-only updates without a publish on every push and without a paid-plan assumption.
- **UNDER WHICH POLICY?** AGENTS.md §22 and §23 inspect-and-verify workflow, §30 secrets hygiene, §45 V1 execution boundary.

## UNKNOWNs

- Free-tier MAU and update-volume limits are UNVERIFIED. The operator confirms them before a production publish. This ADR does not authorize a paid Expo plan.
- Live `eas channel:list` and a preview build actually applying a JS-only update are UNVERIFIED. This change does not create `EXPO_TOKEN` and does not publish an update.
- A native rebuild is required before installed binaries can see `updates.url` or the new channels. That rebuild is outside this mission (CI-01 owns EAS build workflows).

## Verification

- Tests: `tests/unit/mobile-updates-config.test.ts` and `tests/unit/mobile-store-config.test.ts`.
- Workflow control: `.github/workflows/eas-update.yml` uses `workflow_dispatch` only, pins third-party actions to commit SHAs, passes inputs through `env`, and references `secrets.EXPO_TOKEN`.
- Security posture: no token material stored in repository content.
