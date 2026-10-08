# Sherivs Experience Architecture

Version target: **V1** (organizational capability envelope; AGENTS.md §45). Nothing in this document implements or claims progress on V2 (device/IoT), V3 (Reality Intelligence) or FUTURE-UNASSIGNED scope.

Evidence base: `architecture/experience/SHERIVS_EXPERIENCE_INVENTORY.json`, generated deterministically by `scripts/experience/inventory-experience.mjs` (`--check` fails when stale).

## 1. Positioning

| Concept | Name |
| --- | --- |
| Company / brand | Sherivs (`sherivs.com`) |
| Category | Institutional Intelligence Infrastructure |
| Education runtime | Sherivs Scholar (one runtime installed on the kernel; the platform is not "a school product") |
| Executive intelligence | Jarvis (contract only; no live surface) |
| AI workforce | Sherivs AI Workforce (governed workers, not characters) |
| Legacy / technical name | CoreGrid (retained in package names, DB, migrations, env vars, kernel types) |

## 2. The experience model

Every surface is organized around four planes, the same model the platform runs on:

```
Reality  ->  Intelligence  ->  Action  ->  Evidence
```

* **Reality** — canonical, verified records.
* **Intelligence** — derived understanding (inference, recommendation). Never overwrites reality (AGENTS.md §9).
* **Action** — work performed under granted authority.
* **Evidence** — what supports a claim and whether it was independently verified.

The planes are encoded as design tokens (`--sv-plane-*`), as the `Stratum` logo (four offset bars), and as the statement taxonomy used wherever AI output is shown (`evidence-model.ts`).

## 3. Surfaces and security boundaries

`EXPERIENCE_SURFACES` in `frontend/src/lib/experience-system/experience-contract.ts`:

| Surface | Boundary | Tenant context | Status |
| --- | --- | --- | --- |
| `public` | Anonymous | none | LIVE |
| `organization-public` | Anonymous, tenant branded | resolved from host / `?school=` | LIVE (pre-existing site, now behind the Sherivs root) |
| `workspace` | Authenticated tenant member | required | EXISTING (pre-Sherivs portals); not restyled |
| `internal` | Sherivs operators only (`super_admin` + `platformOperator`) | none (control plane, not a tenant) | GATED; moved off the public tree |
| `mobile`, `pwa` | Authenticated | required | PWA icons/manifest rebranded; screens not redesigned |
| `embedded`, `conversational`, `developer` | Authenticated | required | CONTRACT_ONLY |
| `system` | n/a | n/a | state components LIVE |

The internal workspace is a separate boundary. Routes formerly at `/platform` and `/platform/org` now live at `/super-admin/architecture` and `/super-admin/organization`, are `super_admin`-gated, disallowed in `robots.txt`, and are never produced by the customer navigation builder. `/platform/*` is now the public marketing tree.

## 4. Layering

```
frontend/src/design/              tokens (JSON source) -> generated CSS -> sherivs.css (components/motion)
frontend/src/lib/experience-system/   pure, framework-free domain logic (contract, registry, content, SEO, org brand, evidence)
frontend/src/components/sherivs/  presentation (brand, primitives, states, evidence, public shell, diagrams)
frontend/src/routes/(site)/       public routes (pathless group sharing PublicShell)
```

`lib/experience-system` has no React or vendor imports so it is unit-testable in node and obeys the Domain -> Application -> Policy -> Infrastructure rule (AGENTS.md §24).

## 5. Experience Contract (server-driven, conservative)

`resolveExperienceConfiguration(input, catalog)` takes tenant context, the viewer's capabilities, enabled modules and the requested surface, and returns the navigation, commands and decision. Properties (all covered by `sherivs-experience-contract.test.ts`):

* It can only **remove** options; the UI never adds authority (AGENTS.md §34).
* Tenant surfaces without tenant context resolve to `DENY`.
* The `internal` surface requires `platformOperator`.
* High-risk commands resolve to `REQUIRE_APPROVAL`, never silent `ALLOW`.
* Destinations marked `planned` are never rendered, so the shell cannot link to a page that does not exist.
* Decisions use the constitution vocabulary: `ALLOW | DENY | REDACT | ESCALATE | REQUIRE_APPROVAL`.

The contract is **not yet wired into the authenticated shell**. It is the verified target; wiring is listed in `SHERIVS_EXPERIENCE_STATUS.md`.

## 6. Public site

* Registry `PUBLIC_ROUTES` (LIVE / DEFERRED) drives header, footer, sitemap and conformance tests. DEFERRED entries record a reason and never render.
* Root `/`: Sherivs home for non-tenant visitors; tenant hosts and `?school=` still render the organization site.
* `/coregrid` -> 301 to `/`.
* Resources registry is empty by design; the section shows honest empty states, is excluded from the sitemap and is `noindex` until real content is published.

## 7. Known architectural limitations

1. Tenant resolution at `/` is client-side. SSR output for the root is a loading state until hydration. Fix: server-side host -> tenant resolution (not done).
2. The authenticated workspace, mobile screens and the existing organization public site still use the legacy token layer; Sherivs tokens are scoped to the new surfaces.
3. Command palette, global search, calendar, notifications center and the Jarvis conversational surface are contract-only or pre-existing; none was rebuilt.

See `SHERIVS_EXPERIENCE_STATUS.md` for the authoritative state.
