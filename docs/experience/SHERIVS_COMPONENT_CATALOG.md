# Sherivs Component Catalog

Version target: **V1**.

Status key: **live** means a component exists and is used. **contract** means the rule exists in code or an existing primitive and the Sherivs-specific composition is not a separate component. **absent** means it was requested and not built, because there is no truthful content or no backing behavior.

| Family | Piece | Status | Where |
| --- | --- | --- | --- |
| Brand | Wordmark and mark | live | `SherivsFrame` inline SVG |
| Brand | Favicon | live | existing `/icons` and `favicon.ico` |
| Brand | Animated logo, partner lockup | absent | No partner list exists |
| Navigation | Public primary, footer | live | `SherivsFrame` |
| Navigation | App sidebar, mobile bottom nav | live | `portal-sidebar`, `mobile-bottom-nav` |
| Navigation | Mega menu | absent | Primary nav is five links. A mega menu would be decoration |
| Hero | Narrative introduction | live | `SherivsPublicHome` chapter 01 |
| Hero | Video / particle hero | absent | Prohibited without a real film |
| Content | Editorial page, definitions, process | live | `EditorialPage` |
| Content | Article, blog, case study | absent | No platform publishing body |
| Product | Capability, runtime, mission, security sections | live | Homepage and `/platform/*` |
| Interaction | Button, link, dialog, drawer, tabs, command | live | `components/ui/*` and command palette |
| Data | Table, list, chart primitives | live | Existing UI kit. Public site does not chart fake metrics |
| Forms | Auth, admissions, settings | live | Existing routes. Public contact form intentionally absent |
| System | Loading, 404, error, offline, unlinked account | live | Root, shell, offline banner |
| Evidence | Mission stages | live | Homepage reads `EXECUTION_PATH_STAGES` |
| AI | Distinction of observation vs action | live as copy | `/platform/intelligence`. Visual AI chrome in product remains the existing assistants |

## Usage rules

- A public component may not embed a number that is not in a catalog or a contract.
- Links go to routes that resolve. The account call to action is `/auth`.
- Security and pricing pages render the existing guarantee and tier catalogs rather than a second copy of the prices.
