# Sherivs Information Architecture

## Public narrative

The homepage is a numbered argument, in this order:

1. Brand
2. Category
3. Organizational reality
4. Intelligence as a derived layer
5. AI workforce
6. Mission sequence
7. Adaptive experiences
8. Domain runtimes
9. Governance
10. Enterprise architecture
11. Category boundary, including what is not in this release
12. Account as the call to action

A sticky section index sits beside the argument from 1024px up. Below that, the index is a list above the sections.

## Public wayfinding

Primary: Platform, Solutions, Security, Enterprise, Pricing, Resources.

Footer adds company, legal, and status. Proof-page anchors point at `/coregrid` for the capability, runtime, security, and pricing sections that the existing public contract requires.

There is no social column.

## Application

Global header: Sherivs, organization, workspace switcher, search, notifications, profile.

Sidebar: the installed runtime's contributions, filtered by the actor's capabilities. The target organization vocabulary (overview, reality, people, teams, work, missions, knowledge, memory, communications, calendar, tasks, files, data, reports, automation, AI workforce, integrations, analytics, governance, settings) is a capability contract in `ORGANIZATION_WORKSPACE_NAV`. It is not wired as a second menu, because those items do not yet have domain-neutral routes.

Mobile: the existing bottom navigation remains for parent and student portals. The public site uses a disclosure menu below 768px.

## Internal

Departments are generated, not drawn. They are visible to operators at `/platform/org` and are excluded from the public header. Provisioning is a super-admin route.

## Search and command

Documentation search filters the three published documents. Universal search across people, missions, and files is the existing command palette, still role-scoped. It was not rebuilt.

## Settings hierarchy

Personal account: profile, password, privacy, appearance. MFA, passkeys, sessions, export, and deletion are named and marked not offered.

Organization settings remain the existing admin settings surface. A domain-neutral settings information architecture is specified in the experience architecture and is not a new route tree.
