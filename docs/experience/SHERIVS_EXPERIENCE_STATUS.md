# Sherivs Experience Status

Version target: **V1 organizational envelope**.

This is the actual state after the experience program, not a completion claim.

## What shipped

- Customer-facing brand constants and a classified migration of visible strings
- Experience configuration contract with tenant, actor, and runtime rules
- Public narrative at `/` for platform hosts
- Public route group for platform essays, solutions, security, enterprise, pricing, resources, about, contact, access, status, and legal notices
- Three documentation articles and empty shelves where publishing has not started
- Shared public shell, type, and paper/ink materials
- Education public sections gated on `runtime:scholar`
- Operator provisioning removed from `/` and placed at `/command-centre/provision`
- Account map that names unavailable security controls
- Sitemap, robots, and canonical origin pointed at `https://sherivs.com`
- Reduced-motion rule
- Unit tests for the brand boundary, narrative shape, page honesty, experience contract, and section gate

## What did not ship

| Area | State |
| --- | --- |
| Universal organization workspace routes | Target capability list only. Live nav is still the education runtime catalog |
| Internal company workspace as a secured app | Generated projection remains at `/platform/org` and is still publicly reachable, with `noindex` |
| MFA, passkeys, SSO, sessions, export, deletion | Named as not offered |
| Magic link | Not offered |
| Blog, guides, case studies, changelog entries | Empty shelves |
| Careers | Empty |
| Counsel-authored privacy policy and terms | Explicitly not written |
| Jarvis interface | Contracts only. No public or in-app chat was added |
| Customer mission studio | Model and admin launch exist. A full mission workspace was not built |
| Command palette rewrite | Existing palette kept |
| High-contrast theme | Not built |
| Measured LCP, INP, CLS | Not measured in this environment |
| Signed-in visual pass of every education screen | Not done. The app requires a configured identity provider, which this environment does not have |
| V2 devices, V3 reality intelligence | Frozen. The narrative says they are not in this release |

## Surface inventory

| Surface | Route | Owner | Status | Tests | Accessibility | Security |
| --- | --- | --- | --- | --- | --- | --- |
| Public narrative | `/` | Experience | Shipped | Unit | Landmarks, focus, reduced motion | No tenant data |
| Capability proof | `/coregrid` | Experience | Shipped, prior contract kept | Unit + existing e2e contract | Prior landmarks kept | Static |
| Kernel registry | `/platform` | Platform | Rebranded, same data | Existing kernel test | Table remains | Public registry only |
| Platform essays | `/platform/*` | Experience | Shipped | Unit | Editorial headings | No secrets |
| Internal projection | `/platform/org` | Platform org | Existing, `noindex` | Existing surface tests | Unchanged | Still unauthenticated. Remaining risk |
| Provisioning | `/command-centre/provision` | Operations | Moved behind super admin | Route assertion | Existing console | Role guard on the parent layout |
| Solutions, security, enterprise, pricing | public paths | Experience | Shipped | Unit | Editorial | Pricing does not grant access |
| Docs | `/resources/docs/$slug` | Content | Three articles | Unit | Search label, 404 on unknown slug | Static |
| Empty shelves | blog, guides, cases, changelog, careers | Content | Honest empty | Unit | Status text | None |
| Legal notices | `/legal/*` | Legal | Notices only | Unit | Headings | Not a contract |
| Status | `/status` | Operations | Live status word | Manual structure | Alert on failure | Shows only the status field |
| Account | `/settings` | Identity | Map plus existing forms | Unit on the map | Existing forms | Password change stays on the session |
| Organization public | `/` with tenant | Runtime | Existing, education sections gated | Unit on the filter | Existing site | Tenant record as before |
| Application shell | `/_authenticated` | Shell | Wordmark added | Existing nav tests | Existing | Auth gate unchanged |
| Mobile display | Expo app | Mobile | Display strings | Not run here | Not re-audited | Identifiers preserved |

## Tests run

`tests/unit/sherivs-experience.test.ts`, `tests/unit/site-marketing.test.ts`, and `tests/unit/platform-neutrality.test.ts` passed. `tsc --noEmit` passed. Domain-neutrality verification passed with no new violations.

## Visual review

A static render of the homepage CSS and narrative was reviewed at 1440px and 390px in light, and at 1440px in dark. It is a render of the public materials, not a browser session against a running identity provider.

## Remaining work

1. Authenticate `/platform/org` without breaking the projection audit.
2. Resolve the public homepage on the server from the request host, so the narrative is in the first HTML byte on platform hosts and tenant sites do not depend on a client session check.
3. Build domain-neutral workspace routes only when a second runtime exists to consume them.
4. Publish legal text only after counsel writes it.
5. Measure LCP, INP, and CLS on a deployed host.
