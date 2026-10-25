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
  SQL seed inside `20261025100210_sherivs_ux1_workspace_manifest.sql`. 101 items: 28 nav, 44 widgets, 24 quick actions, 5 inbox streams.
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

## Results (24 Oct 2026, local sim lab, SIM_SCALE=0.05, 8-core box shared by k6 + PostgREST + Postgres)
- Fresh DB, all 107 migrations: workspace scenarios 22/22; existing suite 215/216 (the one failure is the lifecycle
  check that expects 12,000 university students, which a 0.05-scale dataset does not have; it does not touch these tables).
- `workspace_manifest` p50 3.6 ms, p95 6.7 ms in SQL. k6 burst (all roles, 500 VUs through PostgREST/RLS): 0% errors,
  903 to 1,405 req/s, p95 395 to 712 ms across two runs. At 1,000 VUs: 0% errors, p95 2.1 s (box-bound).
- First version called `scholar_can()` once per permission for legacy users (55 ms per manifest; 18% errors at 500 VUs);
  replaced by a set-based mirror with a parity scenario.
- Rollback drops every object; migration re-applies twice cleanly.
- Screens: `docs/design/ux1-screens/` (captured by `tools/workspace/screenshots.mjs`).

## SHERIVS-UX2: scope- and policy-aware workspaces
Migration `20261025100220_sherivs_ux2_scope_policy_workspace.sql` (rollback included, not applied to prod) adds two inputs:

- **Assigned scopes.** Catalog items can declare `scope_dims` (campus, shift, section, level, class, subject, house, hostel). Five new cards (`w.campus_overview`, `w.shift_overview`, `w.section_overview`, `w.level_overview`, `w.house_overview`) show only for people the admin scoped on that dimension, right after their lead card. A whole-school principal does not get them; a campus head does. The manifest returns `scope_options` and the shell shows a **scope switcher** (e.g. "shift: Morning"). Picking one narrows the scope cards and adds `?scope=dim:ref` to card and action links. This is presentation only.
- **School policies.** `workspace_policy_catalog` (7 policies, generated from `catalog_src.py`) and `org_workspace_policies`. A policy can only hide items. `workspace.personalise=off` locks everyone's layout except users with `settings.manage`: saved prefs are ignored, and `workspace_prefs_save` keeps only language and density. Admins manage modules and policies at `/workspace/settings` (`workspace_policy_list`, `workspace_policy_set`, `workspace_feature_set`, all checking `settings.manage`).
- The TS engine mirrors the rules (`denialReason` adds `policy` and `scope`; `focusScope`, `scopeFocusOptions`). `server-adapter` maps manifest v2.

Verified locally (sim-lab Postgres, inside a rolled-back transaction):
- Two real `ng.mathematics_teacher` assignments gave different homes. The one scoped `level: JSS2, subject: Mathematics` got `w.level_overview` second. The unscoped one did not.
- Turning `staff.message_parents` off removed `a.message_parents` and made `workspace_item_allowed` false.
- Turning personalisation off made `can_personalise=false` and stripped saved prefs.
- `workspace_policy_set` was refused without `settings.manage`.
- Rollback followed by re-applying UX1 and UX2 succeeded.

## SHERIVS-UX3: live card data and `?scope=` on target pages
The migrations are renumbered so they sort after Track E (#120): UX1 is `…0930`, UX2 is `…0940`, UX3 is `…0950`. The six workspace tables are `FORCE ROW LEVEL SECURITY`, matching the Track E posture.

**Card data.** `workspace_widget_data(org, keys, scope)` is SECURITY INVOKER, so every number is computed under the caller's own RLS.
- It covers 29 card keys: lessons, registers, scores, lesson notes, CBT, form/level/campus/shift/section/school attendance, at-risk, fees and defaulters, children, results, timetable, expenses, leave, admissions, enrolment, sick bay, library, gate and announcements.
- Results are narrowed to the caller's assigned scope, or to one focused scope they actually hold.
- A key the caller may not see is skipped.
- If the caller can't read a card's table, the card comes back as `{unavailable:true}`.

**Scope resolution.** `workspace_scope_resolve(org, focus)` validates `?scope=dim:ref` and returns the classes it covers plus human labels (`workspace_scope_labels`).

**Pages that honour `?scope=`.** They do it through `useScopeFilter()` and `<ScopeBanner>`, which has a "Show all" button:
- `/teacher/attendance`
- `/teacher/gradebook`
- `/teacher/class-intelligence`
- `/admin/report-cards`
- `/admin/students` (new `CrudList.selectIn`)

The campus and section cards now link to `/admin/students`; the shift card links to `/teacher/attendance`; the level card links to `/teacher/gradebook`.

**Sim lab** (`tools/sim-lab/sim/workspace-ux3-scenarios.mjs`, results in `tools/sim-lab/results/workspace-ux3.json`): 18/18 pass.
- The fixture is two maths teachers at one school: one scoped to JSS 2 + Mathematics, one scoped to Ajah Annex + Afternoon. They get different homes.
- Each card's live counts equal the true counts for that scope.
- A student gets no finance cards. A parent sees only their own children.
- Anon and cross-school requests get nothing.
- p95 is 4.8 ms for a full home.

**Screens.** `docs/design/ux3-screens/` is rendered by `/ux-lab?replay=X|Y` from the real server output captured in that run (`tools/workspace/replay.mjs`, `tools/workspace/screenshots-ux3.mjs`).
