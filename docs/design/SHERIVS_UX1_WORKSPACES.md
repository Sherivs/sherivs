# SHERIVS-UX1: design system and dynamic workspaces

## Principles
1. **Computed, not configured.** A workspace is computed on every load from the user's catalog roles (multi-role), the
   permissions the school toggled for those roles, scope sets, the school's plan and modules, then the user's own layout.
   Two people with the same role title can see different homes, and that is correct.
2. **Hidden is not secure.** The UI hides what you cannot do; the server still enforces it (RLS, `scholar_can`,
   `authz_check`). `workspace_item_allowed()` exposes the same rule to data RPCs. Personalisation can only reference allowed items.
3. **Today first.** Home answers "what needs me today": quick actions, inbox streams, then cards ordered by role family.
4. **Built for a ₦60k Android phone on 3G.** System fonts, no web fonts, 48 px touch targets, bottom navigation, horizontally
   scrolling actions, one column under 600 px, offline banner, last manifest cached in localStorage and shown instantly.
5. **Nigerian context.** Naira formatting, terms/sessions, JSS/SS/ND/HND/100L levels, WAEC/NECO/BECE, Paystack, PTA,
   exeat, sick bay, NERDC scheme of work. English, Hausa, Yorùbá, Igbo and Nigerian Pidgin.
6. **WCAG 2.2 AA.** All token pairs ≥ 4.5:1 in light and dark (unit-tested), visible focus rings, skip link, landmarks,
   labelled controls, `aria-current`, reduced motion respected.

## Tokens (`frontend/src/components/sds/sds.css`)
Scoped under `.sds` so screens migrate one at a time. Colour: green primary `#0b6b3a` (dark `#3fb873`), amber accent,
neutral greys; type scale 12/14/16/20/24/32; spacing 4/8/12/16/24/32; radius 8/12/16; density `comfortable|compact`.

## Engine
- Catalog: `tools/workspace/catalog_src.py` (single source) generates `frontend/src/lib/sherivs-ws/catalog.data.ts` and the
  SQL seed inside `20261024000500_sherivs_ux1_workspace_manifest.sql`. 101 items: 28 nav, 44 widgets, 24 quick actions, 5 inbox streams.
  Each item has any-of / all-of permissions, an optional plan feature or school module, and size.
- 18 role families map the 56 role templates (and so all 572 catalog roles) to a default layout and priority.
  Multi-role users get the union, ordered by family priority (for example form teacher before subject teacher).
- Server: `workspace_manifest(org)`, `workspace_prefs_save(org, prefs)` (sanitised to the allowed set),
  `workspace_feature_set(org, module, on)` (needs `settings.manage`), `workspace_item_allowed(org, key)`.
- Client: `computeWorkspace()` mirrors the SQL for previews/tests; `/workspace` renders the server manifest;
  `/ux-lab` (dev or `VITE_UX_LAB=1` only) renders synthetic personas.

## Verification
- `tests/sherivs-ws.test.ts`: catalog integrity vs the permission catalog, seed parity, every hidden-when-missing rule,
  family defaults, the two-teacher example, personalisation limits, five-language labels, WCAG contrast.
- `tools/sim-lab/sim/workspace-scenarios.mjs`: 22 checks on the sim DB; `tools/sim-lab/load/workspace.js`: k6 burst.
- `tools/workspace/screenshots.mjs`: Playwright captures of the UX lab.
