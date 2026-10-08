# Sherivs Experience Architecture

Status: Target architecture; implementation is not implied  
Version target: **ACTIVE-V1**, except rows explicitly marked frozen  
Authority: `AGENTS.md`, `DECISIONS.md`, `BOUNDARIES.md`, and `architecture/COREGRID_V53_DIRECTIVE_RECONCILIATION.json`

## 1. Purpose

Sherivs is the customer-facing platform brand. CoreGrid remains a compatibility name for existing
technical packages, database objects, migrations, historical evidence, and architecture records
until each dependency is deliberately migrated. Sherivs Scholar is the education runtime. Jarvis is
an executive intelligence experience, not an authorization authority.

The Experience System projects governed platform state; it never becomes canonical truth or an
authorization boundary.

## 2. Experience planes

| Plane | Audience | Shell | Boundary | V1 state |
| --- | --- | --- | --- | --- |
| Sherivs public | unauthenticated visitors | public shell | public, claim-verified content only | target |
| Organization public | organization visitors | organization shell | tenant + publication policy | existing Scholar-specific partial |
| Universal application | authenticated users | application shell | identity + tenant + capabilities | existing partial |
| Organization workspace | members | workspace shell | tenant + role + policy + resource | existing Scholar-specific partial |
| Sherivs internal | Sherivs workforce | internal shell | separate platform-workforce authorization | existing `/platform/org` partial |
| Domain runtime | runtime users | runtime contribution | runtime registry + capability contract | Scholar active |
| Mobile/PWA | authorized mobile users | mobile shell | same server authorization as web | existing partial |
| Embedded/contextual | authorized host contexts | contextual surface | signed context + origin + scope | target |
| AI/conversational | authorized users | intelligence surface | AI gateway + minimization + approval | existing partial |
| Developer/API | authorized developers | developer shell | scoped credentials + rate limits + audit | existing partial |
| Operational | platform operators | operational shell | control-plane boundary | existing partial |

V2 device/IoT, V3 Reality Intelligence, and FUTURE-UNASSIGNED implementation are frozen. Their
navigation may be catalogued but must not be enabled or represented as operational.

## 3. Shell composition

### Public shell

Skip link → brand/navigation → narrative main content → verified CTA → enterprise footer. Public
pages load only when supported by real content and capability evidence. No tenant-private API is
called.

### Organization shell

Resolved organization identity → approved navigation → published content → authorized public forms
→ contact/legal footer. Scholar-only sections are runtime contributions and appear only when
`runtime:scholar` is active.

### Application shell

Global header (brand, organization/workspace context, search/command, Jarvis, notifications, help,
status, profile) + capability-derived sidebar + page frame + optional contextual panel + mobile
navigation. Visibility is informative only; server authorization remains mandatory.

### Workspace shell

Navigation is computed from installed runtime contributions × granted capabilities × current
tenant context. A workspace switch invalidates tenant-scoped query state before new data renders.
Pinned/recent/favorite items are scoped by identity and tenant.

### Internal shell

Sherivs internal routes use a distinct platform-workforce grant and do not appear in customer
registries, search, recents, deep links, or notification actions.

### Mobile shell

Top context bar + task-specific content + at most five primary bottom destinations + command/search
entry + sheets for secondary controls. Desktop sidebar collapse is not the mobile architecture.

## 4. Experience configuration contract

```ts
type ExperienceConfiguration = {
  schemaVersion: string;
  tenant: { id: string; organizationId: string };
  actor: { identityId: string; sessionId: string };
  runtimeRefs: readonly string[];
  capabilityRefs: readonly string[];
  navigation: readonly GovernedNavigationNode[];
  theme: ControlledBrandTokens;
  locale: { language: string; timezone: string; dateFormat: string };
  content: readonly AuthorizedContentRef[];
  policyDecision: { decisionId: string; evaluatedAt: string };
};
```

The server resolves tenant, actor, capabilities, policy, and permitted content. The client validates
the versioned response with Zod and treats unknown fields and unknown actions as denied. Arbitrary
database rows never become components.

## 5. Core services

- **Identity/account:** authenticate, resolve memberships, verify sensitive changes, manage sessions.
- **Context:** tenant, organization, workspace, runtime, locale, time, purpose, risk.
- **Navigation/search/command:** return only authorized discoverable destinations and actions.
- **Notifications:** tenant-scoped inbox; action links are re-authorized on execution.
- **AI/Jarvis:** gateway-mediated context; label observation, inference, recommendation, action,
  evidence, and verification distinctly.
- **Calendar/time:** store instants in UTC plus source timezone; render in user or organization zone.
- **Missions/evidence:** ACTIVE-V1 bounded mission contracts only; future autonomous claims remain
  frozen.
- **Content:** draft → review → approved → scheduled/published → archived, with provenance.

## 6. Authentication and onboarding

Authentication lands in context resolution, never directly in Scholar. Resolution order:

1. Validate session and security posture.
2. Resolve active memberships and platform-workforce grants.
3. If one valid context exists, restore the last authorized workspace.
4. If several exist, show organization/workspace selection.
5. If none exists, show a truthful pending-link state.
6. Re-authorize the selected runtime and route.

Account, organization, and workspace onboarding are separate resumable flows. Each step is
progressively disclosed, schema validated, tenant scoped, auditable, and safe to retry.

## 7. State and failure model

- Server state: TanStack Query; keys always include tenant/workspace where applicable.
- URL state: shareable filters, sorting, pagination, tabs, and view modes.
- Local state: ephemeral presentation only.
- Durable preferences: server-owned, identity-scoped, versioned.
- Sensitive mutations: idempotency key, fresh authorization, audit, and explicit result.
- Loading: preserve known layout; use semantic skeletons; announce long operations.
- Empty: distinguish no data, no results, no permission, and not configured.
- Error: preserve user input, provide correlation ID where available, never expose secrets.
- Offline: show freshness, queue only explicitly offline-safe commands, re-authorize on replay.
- Stale: expose last-updated time and refresh path.

## 8. Responsive, theme, and localization

Layouts are specified for 360, 390, 430, 768, 1024, 1280, 1440, 1600, 1920, and 2560+ widths.
Touch targets are at least 44×44 CSS pixels. Themes are light, dark, system, and optional
high-contrast. Organization brand tokens may affect approved accent, logo, and editorial type
roles, never semantic colors, focus, contrast, spacing, or control anatomy.

All dates, numbers, currency, and relative time require locale-aware formatters. No business logic
uses display strings. User and organization timezones are explicit.

## 9. Accessibility

Target WCAG 2.2 AA. Every shell supplies semantic landmarks, skip navigation, persistent visible
focus, logical focus order, keyboard operation, dialog focus trapping/restoration, live-region
announcements for errors and asynchronous outcomes, reduced motion, text zoom support, and
non-color state cues.

## 10. Security boundaries

- Public, customer, and internal planes never share an implicit grant.
- Tenant and role values supplied by clients are untrusted.
- Route guards improve UX; APIs and RLS enforce access.
- Search, notifications, AI context, caches, files, and offline queues preserve tenant scope.
- Jarvis and command actions call the same governed command contracts as direct UI actions.
- Sensitive account/settings actions require step-up verification.
- Logs exclude secrets, raw credentials, and unnecessary personal data.

## 11. API relationship

The frontend consumes domain-neutral application contracts. Domain runtimes contribute typed
adapters. Provider SDKs remain behind infrastructure adapters. Queries return permitted
projections; commands authenticate, resolve tenant, authorize, validate, execute, audit, and return
only permitted output.

## 12. Conformance

An experience is releasable only after information, interaction, visual, responsive, accessibility,
performance, security, implementation, automated-test, human-quality, and architecture gates have
recorded evidence. Documentation or a route stub does not satisfy implementation.
