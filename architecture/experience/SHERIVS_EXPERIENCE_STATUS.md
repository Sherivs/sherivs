# Sherivs Experience Status

**Version-target:** ACTIVE-V1  
**Date:** 2026-10-08  
**Honesty rule:** Implemented means code + tests or a live route. Designed means architecture only.

| Surface | Route | Components | Owner | Mission | Status | Tests | A11y | Perf | Security |
|---|---|---|---|---|---|---|---|---|---|
| Brand SSOT | — | `lib/platform.ts` | Experience | EXP-001 | Implemented | unit | n/a | n/a | n/a |
| Design tokens | — | `styles.css`, `sherivs-tokens.ts` | Design Systems | EXP-002 | Implemented | unit | reduced-motion | not measured | n/a |
| Public IA | — | `sherivs-public-ia.ts` | IA | EXP-003 | Implemented | unit | n/a | n/a | n/a |
| Public homepage | `/` | `sherivs-public/home.tsx` | Public Web | EXP-004 | Implemented | unit + e2e T1 | landmarks | not measured | no fake forms |
| Public interior | `/(site)/*` | `interior.tsx` | Public Web | EXP-005 | Implemented | unit IA | headings | not measured | disclosures only |
| `/coregrid` alias | `/coregrid` | redirect | Brand | EXP-006 | Implemented | unit | n/a | n/a | n/a |
| Org public engine | tenant `/` | `organization-public.ts` | Org Public | EXP-007 | Implemented | unit | inherited | n/a | tenant-scoped |
| App shell Jarvis | auth chrome | `shell-header-actions.tsx` | Shell | EXP-008 | Implemented | not dedicated | button label | n/a | href only if authorized role |
| Account appearance | `/settings` | ThemeToggle | Account | EXP-009 | Implemented | existing theme | toggle | n/a | local preference |
| Status | `/status` | health fetch | Ops | EXP-010 | Implemented | health lib | alert on error | live fetch | leak-free endpoint |
| Command palette | global | existing | Navigation | — | Existing | existing | keyboard | n/a | role-filtered |
| MFA / passkeys / SSO | — | — | Auth | — | Not built | — | — | — | no fake UI |
| Careers / social / case studies | deferred/empty | empty states | Content | — | Honest empty | unit IA | empty copy | n/a | n/a |
| Multi-org switcher data | header | `workspace-switcher.tsx` | Identity | — | Contract only | existing | n/a | n/a | no extra grant |
| V2/V3 experiences | — | — | Frozen | — | Frozen | — | — | — | not implemented |

## Remaining work (real)

- Visual QA across the listed viewports (human gate 10)
- Bundle / LCP measurement on the new public routes
- Wiring organization settings IA that does not yet have backend contracts
- Replacing remaining customer-facing “CoreGrid” strings in long-tail admin/super-admin titles
- Regenerating `routeTree.gen.ts` in CI/dev so new file routes typecheck
- Dedicated accessibility audit of legacy Scholar portals (out of this program’s claim)

## Not claimed

Production deploy. Premium merely because of gradients. Completion of every listed specialist team.
