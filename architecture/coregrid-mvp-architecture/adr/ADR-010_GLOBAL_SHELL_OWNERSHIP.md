# ADR-010: Global Shell Ownership Resolution (J-047 / GAP-008)

| Field | Value |
|---|---|
| Status | PROPOSED (operator rules; resolves the COND-004 / GAP-008 ownership review this artifact concludes) |
| Date | 2026-10-02 |
| Author | FRONTEND PLATFORM ENGINEER (MISSION H2-12) |
| Mission | H2-12 (resolve J-047) |
| Capabilities | V1CAP-085 (global shell neutralization contract); J-047 (global shell ownership resolution) |
| Supersedes-in-part | ADR-003 (Global Application Shell Ownership) — ADR-003 recorded the PROPOSED direction; this ADR is the ruling resolution J-047 requires and names the minimal ownership artifact |
| Cites | STREAM J J-047 + GAP-008 unresolved entry; STREAM G G-068 contradiction; ADR-003; AGENTS §13, §14, §23, §24, §26, §27, §33, §34; observed shell sources (file evidence cited inline per claim) |
| Minimal ownership artifact | `frontend/src/lib/platform/global-shell.ts` (typed shell contract module; pure, domain-neutral, no vendor imports) + `tests/unit/mh-12-global-shell.test.ts` |

## Context

J-047 (major, Experience fabric) records that G-068 buckets the global shell V1 ("it is how one human reaches every loop surface") while GAP-008 holds it BLOCKED pending an ownership review; the capability cannot be scheduled by Step 5/6 while ownership is open. ADR-003 (PROPOSED, 2026-10-01) already argued for platform ownership but left the ruling open and left two UNKNOWNs: the exact neutral contract surface for search, and the typed shape of the shell/run-time boundary. This ADR closes both by ruling the ownership layer, fixing the contract with domain runtimes, and authoring the minimal typed contract artifact.

**Observed ownership evidence (every claim below is file-verified in the working tree, 2026-10-02):**

1. **The shell composition root is a platform route, not a runtime module.** `frontend/src/routes/_authenticated/route.tsx` is the authenticated layout route: it gates on server identity (`beforeLoad` calls Supabase `auth.getUser()` and redirects to `/auth` on failure) and composes the shell chrome — `PortalSidebar`, `ShellHeaderActions`, `WorkspaceSwitcher`, `CommandCenterMount` — around an `Outlet`.
2. **Navigation rendering is already data-driven platform chrome.** `frontend/src/components/portal-sidebar.tsx` states its own law — "This component contains NO hard-coded portals, role maps, or labels. It renders whatever the workspace resolution produced" — and consumes neutral types (`WorkspaceNavItem`/`WorkspaceNavSection` from `@/lib/workspace-engine/navigation`), with icons mapped from registry keys.
3. **Navigation vocabulary flows through a runtime registry.** `frontend/src/lib/shell-nav.ts` admits contribution sets only for runtimes declared by the installed-runtime manifest (`admitNavContributionSets`), rejects forged sets ("not published by its own runtime"), renders capability-gated nav with per-item provenance (`runtimeRef`), and fails safe to an honest empty nav. The registry itself is `frontend/src/lib/runtime/nav-registry.ts`: `INSTALLED_NAV_CONTRIBUTION_SETS` declares exactly one runtime today (`RUNTIME_SCHOLAR` from `./scholar-nav-catalog`), and installing another runtime is "a line here" — the shell is not edited.
4. **The org/workspace switcher is already platform chrome over a server-owned directory.** `frontend/src/components/shell/workspace-switcher.tsx` renders options typed by `frontend/src/lib/shell-org-switcher.ts`, whose contract is submit-resolve: the client submits a workspace choice only ("Deliberately carries no tenant context"); `resolveWorkspaceSwitchChoice` derives tenant context exclusively from the server-owned directory record and delegates cross-tenant policy to the verified engine `switchWorkspaceContext` in `frontend/src/lib/workspace-core.ts` (which tracks `isCrossTenantSwitch` — the J-012 context-switch-safety substrate).
5. **Global search is the one shell surface still domain-coupled.** `frontend/src/components/command-center/command-palette.tsx` (the ⌘K palette, triggered from `frontend/src/components/shell/shell-header-actions.tsx`) imports Scholar role vocabulary (`AppRole` from `@/lib/roles`) and queries Supabase directly for domain-scoped records. No neutral search-provider contract exists — exactly ADR-003's recorded UNKNOWN ("whether the shell needs a platform-level search index or fans out to per-runtime search providers").
6. **Notifications and profile already have neutral platform contracts.** `frontend/src/lib/shell-notifications.ts` (fail-closed viewer/tenant scoping, withheld counts) and `frontend/src/lib/shell-profile.ts` (fixed platform-owned destinations) are consumed by `components/shell/notification-bell.tsx` and `profile-menu.tsx`.
7. **The composition root still leaks domain imports.** `_authenticated/route.tsx` imports Scholar runtime helpers directly (`scholarCapabilitiesForPortal`, `scholarWorkspaceHome` from `@/lib/runtime/nav-registry`; `scholarWorkspaceLabelForMember` from `@/lib/runtime/scholar-workforce-nav`) and calls the Scholar server function `getMyPrimaryWorkforcePosition` (`@/lib/runtime/scholar/workforce-positions.functions`) — the I-027 contamination class living inside the shell itself.
8. **A platform namespace and a neutrality guard already exist.** `frontend/src/lib/platform/platform-targets.ts` establishes `lib/platform/` as the platform-level namespace (P22/23); `scripts/verify-domain-neutrality.mjs` scans lib-root sources with a shrink-only ratchet baseline (`NEUTRALITY_GUARD_BASELINE.json`), and `tests/unit/global-shell.test.ts` already asserts shell sources carry no domain vocabulary.

## Options

### Option 1 — Platform layer owns the shell; runtimes compose INTO it (ruled)

The shell is owned by the **platform layer** (phase 24 experience as platform infrastructure; platform namespace `frontend/src/lib/platform/` plus the `frontend/src/lib/shell-*.ts` contracts), not by any domain runtime and not by the kernel substrate. Runtimes compose into the shell exclusively through neutral contribution contracts — nav contribution sets (the existing `INSTALLED_NAV_CONTRIBUTION_SETS` mechanism), search providers, and switcher directory entries — resolved server-side. A runtime may never import the shell into itself as an owner, never inject chrome by direct import, and never have its vocabulary named in shell source.

- **Consequences:** one legible owner for the only universal surface every tenant and role touches on every request; contamination regressions stay mechanically detectable by the neutrality guard because every shell import is classifiable; the second domain runtime composes in by registering, not by editing the shell. Cost: the platform layer carries the contract obligation (this ADR's minimal artifact is its first installment), and shell evolution is gated on one owner.

### Option 2 — Runtime-owned shells (rejected)

Each domain runtime owns and injects its own shell regions; the platform provides a mount point. Rejected for the ADR-003 grounds, now confirmed by evidence: cross-runtime surfaces (one org switcher spanning runtimes, one search across domains, one notification inbox) become duplicated or impossible; and the first runtime to inject would define the chrome — recreating contamination class 7 above by design. The UI is not security (AGENTS §34); scattering shell ownership scatters the audit surface for access-presentation regressions.

### Option 3 — Hybrid frame/content split (rejected)

Platform owns the frame; runtimes own some content regions, with the boundary relitigated per feature. Rejected: the moving line is precisely the ambiguity GAP-008 exists to close, and it would force the neutrality guard to carry per-runtime shell exemptions or a mutable frame/content boundary, breaking the shrink-only ratchet the guard is built on.

## Recommendation

**Option 1. The global shell is owned by the platform layer.** Ruling specifics:

1. **Owner:** phase 24 (experience) as platform infrastructure, per the J-047 proposal. Shell chrome lives in platform namespaces (`frontend/src/lib/platform/`, `frontend/src/lib/shell-*.ts`, `frontend/src/components/shell/`, the `_authenticated` composition root). The Control Plane is not a tenant and gets its surfaces through the same neutral mechanism (AGENTS §14).
2. **Contract with domain runtimes — the three contribution surfaces:**
   - **Navigation:** runtime nav content is admitted only through registered contribution sets validated against the installed-runtime manifest (evidence 3); every rendered item carries its `runtimeRef` provenance.
   - **Org/tenant switcher:** runtimes never resolve tenant context. The switcher is submit-resolve over a server-owned directory; tenant context is derived exclusively from the directory record and the verified workspace engine (evidence 4) — never from client-asserted fields (AGENTS §26).
   - **Global search:** the shell fans out to registered, domain-neutral search providers scoped by resolved tenant context; it never queries a domain store directly. This closes the last domain-coupled surface (evidence 5) and ADR-003's search UNKNOWN: fan-out to per-runtime providers, not a platform index.
3. **The boundary — compose INTO, never OWN:** a domain runtime may contribute nav entries, search providers, and notification sources through the registry; it may not own shell chrome, import shell modules into its own ownership, name its vocabulary in shell source, or ship shell regions the registry does not admit. The shell composition root's direct Scholar imports (evidence 7) are pre-existing violations this ruling puts inside the guard's scope, to be relocated into the runtime layer — the baseline may only shrink.
4. **Shell is presentation, not policy:** shell visibility is never authorization (AGENTS §34); every shell-reachable surface is independently backend-enforced (server function rule, AGENTS §27), and identity/tenant context reaching the shell is server-resolved, failing closed.
5. **Minimal ownership artifact:** `frontend/src/lib/platform/global-shell.ts` declares the typed, pure, domain-neutral shell surface — ownership vocabulary, nav contribution admission/composition, the switcher (tenant-context resolution) contract, the search provider contract, and real-identity/tenant context resolution hooks — with no vendor imports and no domain vocabulary. `tests/unit/mh-12-global-shell.test.ts` proves the fail-closed behavior and self-scans the module against the neutrality guard's token vocabulary.

## Golden Questions

- **WHO?** The platform layer (phase 24 as infrastructure) owns the shell; domain runtimes contribute through the registry; the operator ratifies this ruling (COND-004/GAP-008 closure).
- **WHAT?** Navigation, org/tenant switcher, global search, notifications, profile — platform-owned chrome; runtime content admitted as data only.
- **WHERE?** Platform namespaces (`lib/platform/`, `lib/shell-*.ts`, `components/shell/`, the `_authenticated` composition root); runtime contributions in each runtime's own layer (`lib/runtime/…`); the guard scans and its baseline can only shrink.
- **WHY?** G-068 makes the shell structurally necessary for V1 (human entry to every loop node, Outcome -> Observation); J-047 blocks Step 5/6 scheduling while ownership is open; GAP-008 demands the review this ADR concludes.
- **UNDER WHICH POLICY?** AGENTS §13 (every request carries tenant context), §14 (Control Plane not a tenant), §24 (Domain -> Application -> Policy -> Infrastructure ordering — runtimes compose into the platform, never the reverse), §26/§27 (server-side validation and authorization), §33 (Tailwind/shadcn/Radix/Lucide only), §34 (UI is not security); J-047; ADR-003; RULING-1 (domain modules are runtime content, not platform).

## UNKNOWNs

- Operator ratification: this ADR resolves the ownership review J-047 requires; formal COND-004 closure remains the operator's act.
- Timeline for relocating the composition root's direct Scholar imports (evidence 7) — the ruling declares them guard-scope, but the relocation is runtime-layer work not owned here.
- The concrete search-provider registration mechanism in the live palette (the contract is ruled and typed here; wiring `command-palette.tsx` to `ShellSearchProvider` is shell-implementation work under V1CAP-085).
- Notification sources as a registered contribution surface (ADR-003 UNKNOWN carried): the notifications contract exists (evidence 6) but multi-runtime source registration is not yet evidenced.
- Interaction with COND-005 (phase-15 split): no shell surface depends on the split; the guard baseline assumed here stands either way.
