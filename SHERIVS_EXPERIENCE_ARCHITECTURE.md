# Sherivs Experience Architecture

Status: `PROPOSED — EXPERIENCE BOUNDARY LOCK`  
Version target: `ACTIVE-V1` architecture; frozen expansion is documented, not implemented.  
Evidence date: 2026-10-08

## 1. Purpose and authority

This document defines the target experience boundary for Sherivs without treating a visual redesign as architecture. It is subordinate to `AGENTS.md`, the V1 scope lock, security policy, database/RLS truth, and runtime contracts.

Canonical customer-facing brand:

- Company/platform: **Sherivs**
- Category: **Institutional Intelligence Infrastructure**
- Education runtime: **Sherivs Scholar**
- Executive interface: **Jarvis** only where a verified, authorized implementation exists
- Technical compatibility identifiers: existing `coregrid*`, `cg_*`, `runtime:scholar`, package names, migration names, storage keys, and bundle IDs remain until separately migrated

## 2. Observed baseline

The repository currently contains:

- TanStack Start web application with 156 unique URL paths and approximately 162 route modules.
- Expo mobile application with authentication, organization selection, missions, workers, evidence, and settings.
- One authenticated web shell serving Scholar role portals.
- One tenant public-site composer with Scholar assumptions.
- 48 shadcn/Radix primitives, a large `portal-shell.tsx` pattern library, and a single global stylesheet.
- Parallel experience systems in `experience-*.ts`, `experience/experience-platform.ts`, and `scholar/experience/*`.
- Supabase authentication, tenant RLS, server-function gates, and service-role kernel operations.

This is not yet a unified Sherivs Experience System. Presence in code is not proof of production readiness.

## 3. Experience planes

| Plane                       | Audience                                  | Boundary                                              | V1 disposition                                                 |
| --------------------------- | ----------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------- |
| Sherivs Public              | Anonymous prospects, partners, applicants | Public content only; no tenant data                   | Active where claims are evidenced                              |
| Organization Public         | Anonymous organization visitors           | Published, organization-authorized content            | Active; generic engine required                                |
| Universal Application Shell | Authenticated actors                      | Session + selected organization + capabilities        | Active architecture; registry gate required before replacement |
| Organization Workspace      | Organization members                      | Tenant, membership, role, relationship, policy, RLS   | Active                                                         |
| Sherivs Internal Workspace  | Sherivs operators                         | Separate platform identity and authorization boundary | Active only for verified control-plane capabilities            |
| Scholar Runtime             | Authorized education actors               | Runtime capability mapping over universal contracts   | Active runtime; must not define platform ontology              |
| Mobile/PWA                  | Authenticated and public contexts         | Same policy decisions as web; offline data minimized  | Active foundation                                              |
| Embedded/Contextual         | Authorized host surfaces                  | Signed context and explicit embedding policy          | Contract only until host exists                                |
| AI/Conversational           | Authorized actors                         | AI gateway, minimization, evidence, approval          | V1 practical subset only                                       |
| Developer/API               | Authorized developers                     | Keys/scopes/rate limits/audit                         | Only capabilities that exist                                   |
| System/Operational          | Operators/support                         | Platform boundary; never tenant navigation            | Verified operational surfaces only                             |

## 4. Shell hierarchy

```text
Document shell
├─ Public shell
│  ├─ Sherivs public
│  └─ Organization public
├─ Authentication shell
└─ Authenticated shell
   ├─ Organization workspace shell
   │  └─ Runtime projection (for example Scholar)
   └─ Sherivs internal shell (separate authorization boundary)
```

The application shell is not an organization. It resolves organization and workspace context; it never manufactures either.

## 5. Governed experience contract

```text
Verified organization
+ installed runtime
+ server-resolved capabilities
+ authenticated actor
+ memberships and relationships
+ policy decision
+ request context
+ controlled theme
+ authorized content
= validated experience configuration
```

Required contract fields:

```ts
type ExperienceConfiguration = {
  schemaVersion: string;
  organization: { id: string; displayName: string };
  workspace: { id: string; kind: string };
  runtime: { id: string; capabilities: string[] } | null;
  actor: { id: string; displayName: string };
  authorization: {
    decisionId: string;
    allowedNavigation: string[];
    allowedActions: string[];
  };
  locale: { language: string; timeZone: string };
  theme: { mode: "light" | "dark" | "system"; brandTokens: Record<string, string> };
  features: Record<string, boolean>;
};
```

The server must authenticate, resolve tenant, authorize, validate, audit, and return only permitted fields. Client role names, tenant IDs, hidden navigation, and command-palette filtering are not authorization.

## 6. Navigation model

Navigation has four layers:

1. Global: organization/workspace switcher, search, commands, notifications, help, profile.
2. Workspace: capability-driven sections returned by governed contracts.
3. Runtime: contributions admitted through the runtime registry.
4. Contextual: page actions scoped to the current resource and policy decision.

Navigation items require `id`, `label`, `route`, `capability`, `policyAction`, `runtime`, `mobilePriority`, and `status`. Unknown or unauthorized items are omitted. Disabled navigation is used only when disclosure is itself authorized and useful.

## 7. Core flows

### Authentication

Resolve identity, session risk, memberships, organization, workspace, runtime, and authorized home. Never default every actor to Scholar. Sensitive changes require recent verification. Expired, suspicious, revoked, and recovery states are first-class.

### Onboarding

Use progressive stages: account → organization → membership/policy → workspace → first meaningful action. Organization type selects runtime capabilities but never changes universal identity or authorization semantics.

### Account and settings

Personal settings are actor-scoped. Organization settings require organization policy. Platform settings require platform identity. These areas must not share a permissive route guard.

### Search and commands

Search returns policy-filtered results with type, organization, provenance, and recency. Commands discover authorized actions; executing a command repeats server-side authorization.

### AI

AI surfaces distinguish observation, inference, recommendation, proposed action, evidence, and verification. They use the AI gateway and never imply processing or execution absent backend state.

## 8. State and data ownership

- Server/cache state: TanStack Query and server functions; keys include tenant/workspace context.
- Session/context: authenticated actor plus server-resolved organization.
- URL state: shareable filters, pagination, tabs, and search parameters.
- Form state: schema validated at client and server.
- Local state: ephemeral disclosure only.
- Offline state: encrypted/minimized cache where supported; writes queue only with idempotency and reauthorization.

Canonical truth remains in the database. UI projections and AI output never overwrite it without validated commands.

## 9. Responsive architecture

- 360–430: mobile task hierarchy, bottom navigation for highest-frequency authorized actions, sheets for secondary controls.
- 768: tablet split views only where content supports them.
- 1024–1600: contextual sidebar and optional secondary panel.
- 1920–2560+: bounded reading measures, multi-pane work areas, no uncontrolled stretching.

Tables become prioritized records, not horizontal desktop replicas. Touch targets are at least 44×44 CSS pixels.

## 10. Accessibility, localization, and themes

Target WCAG 2.2 AA. Semantic structure, keyboard order, focus restoration, live-region announcements, contrast, text zoom, and reduced motion are release gates. Localization includes language, date/number formats, currency, direction, and IANA timezone. Organization branding is restricted to validated brand tokens and cannot override semantic colors, focus, contrast, or typography.

## 11. Loading, empty, error, and offline behavior

Every async surface defines:

- initial loading with shape-preserving skeletons;
- refresh without content loss;
- empty with cause and permitted next action;
- partial/stale with timestamp;
- recoverable and terminal errors;
- unauthorized vs forbidden vs not found without data leakage;
- offline read state and blocked/queued write state.

`PlannedCapabilityState` is the canonical honest state for unavailable capabilities; fake metrics and simulated live activity are prohibited.

## 12. Security boundaries

1. Public content is explicitly published.
2. Authentication establishes identity, not permission.
3. Organization/workspace selection is server verified.
4. Every query and mutation is tenant scoped and policy checked.
5. RLS protects tenant-sensitive tables.
6. Internal Sherivs routes require platform identities and are not linked from tenant navigation.
7. AI context is classified, minimized, redacted, and audited.
8. Offline caches, notifications, search indexes, analytics, and realtime subscriptions preserve the same boundary.

## 13. API relationships

Web and mobile consume shared typed contracts. Server functions remain APIs and follow authenticate → resolve → authorize → validate → execute → audit → minimize. Organization public content uses a publication projection, never direct unrestricted tenant-table reads.

## 14. Frozen and unresolved boundaries

- Device/IoT, biometrics, geofence, fleet telemetry, and physical digital twins are frozen.
- Deep Reality Intelligence, causal/scientific simulation, and civilization-scale systems are frozen or deferred corpus.
- “Jarvis” and AI workforce may describe V1 governed worker/mission capabilities only when backed by runtime evidence.
- The global-shell registry gap must be resolved before replacing the current shell.

## 15. Conformance gates

Information architecture, interaction, visual system, responsive behavior, accessibility, performance, security, implementation, automated tests, human visual review, and architecture conformance each require evidence. A route or component is not complete merely because it renders.
