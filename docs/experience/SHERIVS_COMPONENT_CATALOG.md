# SHERIVS Component Catalog

Version: V1 foundation (2026-10-08) · Classification: **V1**
Sources: `frontend/src/components/sherivs/*`, existing `components/ui/*`.

## 1. Shipped (V1 foundation)

| Family | Component | Purpose | States |
|---|---|---|---|
| Brand | `sherivs-logo.tsx` (Mark/Wordmark/Lockup) | Canonical identity, no image assets | static, currentColor |
| Brand | `sherivs-brand.ts` (lib) | Customer-facing constants + V1 classifier | tested |
| Navigation | `public-shell.tsx` | Public header, mobile menu, enterprise footer | menu open/closed, focus |
| Navigation | `public-registry.ts` | Verified-destination nav/footer registries | tested (no dead links) |
| Content | `sherivs-home.tsx` | 12-movement public narrative | responsive |
| Content | `doc-page.tsx` (DocPage/DocSection) | Content-page hero + prose + review date | static |
| Shell | `sherivs-shell.tsx` | Universal app shell + slots + collapsible sidebar | drawer/collapsed/focus |
| Trust | `evidence.tsx` | Intelligence badges, provenance, confidence, verification | 6 kinds + meter |
| System | `system-states.tsx` | Loading/empty/error/offline/forbidden/not-found/reasoning | announced via aria-live |
| Icons | `sherivs-icons.ts` | Single auditable icon source | — |

Existing `components/ui/*` (shadcn/Radix: dialog, dropdown, tabs, table,
command, form…) remain the interaction primitives; Sherivs composes them.

## 2. Families and ownership

BRAND · NAVIGATION · HERO · CONTENT · PRODUCT · INTERACTION · DATA · FORMS ·
SYSTEM — full taxonomy with required members is specified in the program;
families marked below are P1 missions reusing `ui/*` + Sherivs tokens:
product cards (capability/mission/worker/integration), data table/list/grid
wrappers, form system (validation/consent/multi-step), charts with Sherivs
styling, calendar/time primitives, command palette + AI panels wired to
policy-checked actions.

## 3. Usage rules

- Import icons from `sherivs-icons.ts`, never lucide directly in surfaces.
- Public links come from `public-registry.ts`; never hardcode a public href
  twice — and never add a destination that does not exist.
- AI kind badges are mandatory on AI-generated content regions.
- Every list/table/counter ships empty + loading + error siblings.
- Anti-patterns: glass everywhere, card-grid defaultism, fake numbers,
  narration of frozen scope as shipped.

## 4. Test status

Unit: `tests/unit/sherivs-brand.test.ts` (constants, classification,
registry integrity). Component render tests are a P1 mission alongside
E2E journeys (public IA walk, shell keyboard walk, offline walk).
