# Sherivs Information Architecture

Status: `PROPOSED`  
Version target: `ACTIVE-V1`

## Principles

- Organize by actor intent and governed capability, not database tables or implementation phases.
- Keep platform operations, organization work, and runtime work distinct.
- Reveal capability by policy and installed runtime; never show a universal fixed menu.
- Preserve place: organization, workspace, object, and task are visible in the shell.

## Public Sherivs hierarchy

```text
Sherivs
├─ Platform
│  ├─ Organizational foundation
│  ├─ Context and practical memory
│  ├─ Governed missions and workers
│  ├─ Evidence and verification
│  ├─ Governance and security
│  └─ Integrations
├─ Solutions
│  ├─ Organizations
│  ├─ Enterprise
│  ├─ Education / Scholar
│  └─ Operations
├─ Security
├─ Enterprise
├─ Resources
│  ├─ Documentation
│  ├─ Guides
│  ├─ Blog
│  └─ Changelog
├─ Company
└─ Legal and status
```

Items without real capability or content remain absent. Reality Intelligence and autonomous-workforce claims are not public V1 claims unless narrowed to verified V1 contracts.

## Organization public hierarchy

Identity → overview → services/programs → people/leadership → locations → events/news → resources/policies/forms → contact/careers. Scholar-only admissions and academic sections load only from the active Scholar runtime.

## Authenticated hierarchy

### Global

Organization, workspace, search, commands, notifications, help, account, security, accessibility, language, timezone.

### Organization workspace

Overview, people, teams, work, missions, knowledge, communications, calendar, tasks, files, reports, automation, integrations, governance, settings. Each node requires an admitted capability and authorization decision.

### Runtime projection

Scholar maps education roles and tasks onto organization capabilities. Runtime navigation is subordinate to the workspace and cannot add platform-internal routes.

### Sherivs internal

Customers, organizations, product, engineering, architecture, infrastructure, security, operations, support, finance, research, analytics, releases, incidents, governance, and documentation. Only verified modules appear, and all require platform identities.

## Object hierarchy

```text
Organization
└─ Workspace
   ├─ People and teams
   ├─ Work and missions
   ├─ Knowledge and files
   ├─ Communication and calendar
   ├─ Integrations and data
   └─ Governance and settings
```

Missions contain plan, authority, dependencies, assignment, execution, evidence, verification, outcome, history, cost, and risk. Workers contain definition, capability, authority, tools, workload, mission history, evidence, reliability, policy, and audit.

## Navigation behavior

- Desktop: global header + capability sidebar + contextual page header; secondary panel only when persistent context is useful.
- Mobile: four or five highest-frequency authorized destinations, command access, and contextual sheets.
- Breadcrumbs represent hierarchy, not browser history.
- Favorites and recents are actor-scoped and tenant-safe.
- Switching organization invalidates tenant-bound caches, search results, notifications, and open object state.

## Findability

Search finds authorized objects. Commands find authorized actions. Help finds documentation. AI interprets context but does not replace deterministic navigation or policy.

## Settings hierarchy

Personal: profile, preferences, appearance, accessibility, notifications, security, sessions, privacy.  
Organization: general, identity, members, teams, roles, policies, security, domains, brand, integrations, communication, billing, data, audit, runtime, public experience.  
Platform: architecture, runtime governance, infrastructure, security, observability, providers, feature flags, and governance.
