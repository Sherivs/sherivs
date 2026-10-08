# Sherivs Experience Status

**Version-target:** V1  
**Wave:** 1 — architecture lock, brand, design tokens, public plane, shell/account foundations  

This is not a claim that every surface in the original 58-section program is complete. Premium means coherence of what shipped, not a gradient.

**Gates (Wave 1):**
- `npm run verify:neutrality` — STATUS=PASS, 0 new hits (`platform.ts` no longer names the education runtime)
- `npx tsc --noEmit` — pass
- `tests/unit/sherivs-experience.test.ts` — 10/10
- `tests/unit/mh-15-launch-criteria.test.ts` — 13/13, live tree 18 criteria, 0 unproven, exit 0
- Runtime product lockup lives in `frontend/src/lib/runtime/installed-runtimes.ts` (`INSTALLED_RUNTIME_PRODUCT`)

## Implementation inventory (Wave 1)

| Surface | Route | Components | Mission | Status | Tests | A11y | Perf | Security |
|---|---|---|---|---|---|---|---|---|
| Experience constitution | `architecture/experience/*` | docs | M-EX-01 | done | n/a | n/a | n/a | n/a |
| Brand identity | `lib/platform.ts` | constants | M-EX-02 | done | unit | n/a | n/a | no secret change |
| Public homepage | `/`, `/coregrid` | PublicHome, PublicShell | M-EX-03 | done | unit + e2e T1 updated | landmarks | static | no tenant leak |
| Public catalog pages | `/platform/*` `/solutions/*` `/legal/*` `/resources/*` | public-pages | M-EX-04 | done | unit | article+crumbs | static | honest empty |
| Status | `/status` | health.json | M-EX-05 | done | health unit existing | live region pending | 30s poll | leak-free payload |
| Provision | `/provision` | CommandCentre | M-EX-06 | moved | existing CC tests | inherited | n/a | still unsigned wizard |
| Org public engine | tenant `/` | resolveOrgPublicExperience | M-EX-07 | partial | unit | inherited school site | n/a | public flags only |
| App shell identity | `_authenticated` | SherivsMark | M-EX-08 | done | structural | skip+focus | n/a | RoleGuard unchanged |
| Account preferences | `/settings` | appearance/a11y | M-EX-09 | done | unit prefs via module | motion/contrast | local | no extra grants |
| PWA/mobile brand | SW, manifest, Expo name | — | M-EX-10 | done | pwa unit | n/a | cache bump | bundle id preserved |
| Command/search | ⌘K | existing palette | M-EX-11 | inherited | existing | keyboard | n/a | policy still backend |
| AI/mission UX | assistants, worker-missions | existing | M-EX-12 | inherited | existing | kind badges added as primitives | n/a | untrusted output law |
| Calendar/time | existing portals | — | M-EX-13 | not redesigned | existing | — | — | — |
| Developer portal | — | — | M-EX-14 | not built | — | — | — | — |

## Remaining work

- Human visual review at all listed viewports  
- Command palette neutralization (Scholar student search is runtime-specific)  
- Workspace switcher multi-org wiring (contract exists, web feed is single school)  
- MFA/passkey/SSO UI when backends exist  
- Platform editorial publishing  
- Dedicated Jarvis visual interface beyond contracts  
- Full org public engine (non-Scholar organizations still use the Scholar site composer when the tenant row is a school)

## Mission portfolio (staffed)

M-EX-01 Experience architecture  
M-EX-02 Brand migration (customer-facing only)  
M-EX-03 Public narrative home  
M-EX-04 Public route catalog  
M-EX-05 Status  
M-EX-06 Provision relocation  
M-EX-07 Org public gating  
M-EX-08 Application shell identity  
M-EX-09 Account experience  
M-EX-10 PWA/mobile brand  

No artificial teams. Further workers spawn when those remaining work items are authorized.
