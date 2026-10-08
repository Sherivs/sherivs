# SHERIVS Information Architecture

Version: V1 foundation (2026-10-08) · Classification: **V1**

## 1. Public Sherivs IA

```
sherivs.com/
├── / (narrative: category → reality → intelligence → workforce →
│    missions → adaptive UX → runtimes → governance → kernel → direction → CTA)
├── /platform (kernel: capabilities #capabilities, runtimes #runtimes, contracts)
├── /solutions/education (installed education runtime)
├── /security (isolation, authorization, audit, governed AI, sessions)
├── /enterprise (delegation, evidence, rollout)
├── /pricing (tiers mirror commercial catalog)
├── /resources (published surfaces only: blog, kernel, security, education, status)
├── /about · /contact · /request-demo
├── /legal/{privacy,terms,cookies,accessibility}
└── /status (live /health.json)
```

Depth ≤ 2. Every leaf links upward (footer) and sideways (contextual CTAs).

## 2. Organization public IA (tenant engine, generic)

Identity → hero → about → programs/services → locations → people/leadership
→ events → announcements → resources/documents → forms → contact → policies.
Scholar-specific sections (admissions, programs, staff…) render only when
the Scholar runtime is active — the engine itself assumes no sector.

## 3. Authenticated IA (capability-projected)

```
Shell (org / workspace context, search, command, Jarvis, notifications, profile)
├── Overview (role home)
├── Reality · People · Teams
├── Work · Missions · Tasks · Calendar
├── Knowledge · Memory · Files · Data · Reports
├── Communications
├── AI Workforce (governed workers)
├── Automation · Integrations
├── Analytics · Governance · Audit
└── Settings (personal → organization → platform)
```

Entries appear only for granted capabilities; order is stable per role.
Mobile: bottom nav for top destinations + sheets/drawers, never a squeezed
sidebar. Internal Sherivs workspace is a separate tree behind a staff
boundary — never merged into customer nav.

## 4. Account & settings IA

Personal (profile, preferences, appearance, accessibility, notifications,
security/MFA, sessions/devices, privacy/export) → Organization (general,
identity/brand, members/teams/roles, policies, security, integrations, AI,
billing/usage, data/retention, audit, API/webhooks, runtime, public site,
localization) → Platform/internal (staff only).

## 5. Onboarding IA (progressive disclosure)

Account (welcome → identity → verification → preferences) → Organization
(identity → type → structure → members → policies → branding → activation) →
Workspace (navigation → capabilities → role guidance → first mission → first
AI interaction). Each step skippable except identity/verification/policy.

## 6. Search, command, notification IA

Search scopes: people, orgs, workspaces, missions, documents, knowledge,
events, tasks, communications, workers, settings, help. Command exposes
authorized actions only. Notifications: inbox → category (org/mission/
system/security/AI/mention/approval) → preferences per channel.
