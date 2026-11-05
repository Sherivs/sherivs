# ADR-023: M009-A2 Preserves the Workspace Below the Initial Bundle Budget

| Field                      | Value                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator review)                                                                                                                                                                                                                                                                                                                                      |
| Date                       | 2026-11-03                                                                                                                                                                                                                                                                                                                                                      |
| Author                     | copilot-swe-agent[bot] (M009-A2 follow-up)                                                                                                                                                                                                                                                                                                                      |
| Mission                    | M009-A2 follow-up (Scholar runtime; V1 organizational capability)                                                                                                                                                                                                                                                                                               |
| Capabilities               | Consumes V1CAP-01 (multi-tenant workspaces) and V1CAP-03 (role/permission model); no capability ownership expansion                                                                                                                                                                                                                                             |
| Supersedes-in-part         | None                                                                                                                                                                                                                                                                                                                                                            |
| Cites                      | Issue #175; `AGENTS.md:923-924`; `architecture/campaigns/V1-PROGRAM/V1-CAPABILITY-MATRIX.md:11-13`; `vite.config.ts:24-27`; `frontend/src/routes/home/route.tsx:1-24`; `frontend/src/routes/home/index.tsx:1-23`; `tests/unit/workspace-shell.test.ts:55-92`; `package.json:15-17`; `.github/workflows/verify.yml:86-97`; `scripts/verify-home-bundle.mjs:1-67` |
| Minimal ownership artifact | This ADR only — a decision artifact                                                                                                                                                                                                                                                                                                                             |

## Context

M009 Stage A requires a role-based workspace with exactly three primary navigation sections, a widget catalog, recent activity, and notifications; access remains tied to assigned roles and permissions (issue #175). The A2 follow-up requires all 56 V1 role templates to have exactly three primary sections and at least three widgets, while bringing the `/home` initial JavaScript graph to no more than 250 KiB gzip without removing features.

The original measured static graph was 340.51 KiB gzip. After making optional website-head and Sentry code load only when needed it measured 263.81 KiB, still above the budget. The selected route-level split measures 236.80 KiB. These figures use Vite's production manifest, the default TanStack Start client entry plus the `/home` route and index component entries, recursive static `imports` only, and the sum of each unique emitted JavaScript file compressed independently with gzip level 9. KiB is 1024 bytes. The two workspace modules remain explicit dynamic imports and are not counted as first-load files. The regular production build does not emit a manifest; the verification-only build emits `.output/public/.vite/manifest.json`, which the size-check script removes after reading it.

## Options

### Option 1 — Keep all workspace modules in the static route graph (rejected)

Retain eager imports for the application shell and home screen.

- **Consequences:** Avoids a post-hydration chunk request and preserves the existing eager rendering path, but leaves the measured graph above the issue's 250 KiB limit.

### Option 2 — Remove workspace features or widgets (rejected)

Reduce the bundle by removing parts of the shell, widget catalog, or workspace content.

- **Consequences:** Could lower the measured size, but would violate the M009 workspace requirements and the issue's no-feature-removal constraint.

### Option 3 — Defer the existing shell and home screen until after hydration (ruled)

Keep the route entry lightweight and load the existing shell and home screen through dynamic imports after the route hydrates.

- **Consequences:** Keeps all workspace features and server authorization behavior, and places the static first-load graph below budget. It adds a brief accessible loading state and a later chunk request; slow connections can delay the workspace becoming interactive.

## Recommendation (decision)

**Use Option 3 for the V1 organizational `/home` route.** Keep app-shell and home-screen functionality intact behind explicit dynamic imports, preserve the current server-resolved authentication and workspace authorization paths, and require the all-role assertions plus the manifest-based 250 KiB gzip guard to pass. The size guard measures only the static first-load graph; it must also verify that the two workspace modules remain dynamic imports so the budget cannot be met by dropping features. The verification-only build removes its temporary manifest before succeeding; ordinary production builds do not emit it.

### Explicit residual risk

- **The residual risk:** Users may wait for a separate workspace chunk after the first page paint.
- **The sharpest instance:** A slow or interrupted connection can extend the brief loading state or prevent the workspace screen from becoming interactive until the chunk is available.
- **The accepted rationale:** Deferring the existing code retains the requested workspace behavior and authorization, while the initial static graph meets the specified budget.
- **Owner of the residual risk:** M009's Scholar runtime owner; report any persistent loading or failed-chunk behavior through the existing Verify and user-facing regression process.

## Consequences (summary)

- **Positive:** The initial `/home` static graph is machine-checked at 236.80 KiB gzip against the 250 KiB limit, while all role templates retain three primary sections and at least three authorized widgets.
- **Negative / obligations:** Keep deferred imports explicit, retain the accessible fallback, and update the bundle measurement and role coverage checks if route entry points change. The 236.80 KiB result is reproducible with `npm run verify:home-bundle:build`; the temporary manifest is deleted by the checker, and ordinary production builds emit no manifest.
- **For the wave/program specifically:** This is a bounded M009-A2 V1 organizational workspace follow-up. It makes no database or migration change and authorizes no V2 or V3 work.

## Golden Questions

- **WHO?** M009 owns the V1 role-based workspace; the operator reviews this decision and the runtime owner monitors deferred-load behavior.
- **WHAT?** Preserve all workspace features while deferring shell and home-screen code from the static first-load graph.
- **WHERE?** This ADR records the decision; `scripts/verify-home-bundle.mjs` measures and removes the verification-only client manifest; the route components declare the deferred imports; unit and E2E tests verify workspace behavior.
- **WHY?** Issue #175 requires the Stage A workspace, and the A2 follow-up sets a 250 KiB initial bundle ceiling without feature removal.
- **UNDER WHICH POLICY?** Issue #175; AGENTS.md §45's V1 execution boundary; existing role, tenant, authorization, and RLS invariants.

## UNKNOWNs

- **Operator review:** The operator must ratify or reject this ADR; until then it remains proposed.
- **Real-device latency:** CI verifies the budget and responsive workspace fixtures, but production latency for the deferred chunk remains an operational observation owned by the Scholar runtime.
