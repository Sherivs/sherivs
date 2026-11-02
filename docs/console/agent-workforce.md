# Internal Console agent workforce design

**Version target:** V1 organizational capability envelope.  
**Status:** Design proposal only. No workspace agents, escalation queue, autonomous tools, or production integrations are implemented by this document.

The Control Plane V1 gap matrix marks an AI workforce control plane deferred.
This document records the Phase F design requested by issue #203; execution
requires explicit scope authorization. Agents are untrusted identities and do
not own the system.

## One bounded subagent per workspace

The proposal has one primary subagent for each of the six V1 workspace
experiences. Personal workspaces are per-user: an agent must not be shared
across owners or reveal one user's content to another.

| Workspace               | Proposed purpose                                                                 | Default tools and data boundary                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Platform Operations     | Summarize authorized organization lifecycle and health signals.                  | Read-only aggregate organization summaries, verified health states, and authorized metrics; no school records or personal content. |
| Platform Administration | Explain staff invitations, approved role capabilities, and workspace membership. | Read-only staff/admin metadata; no super-admin grants or role mutation.                                                            |
| Operations              | Summarize onboarding cases, ownership, and supported lifecycle state.            | Read-only assigned/authorized organization cases; lifecycle mutations require human approval.                                      |
| Engineering             | Summarize verified health and provisioning diagnostics.                          | Health and allow-listed diagnostics only; never secrets, session tokens, environment variables, or deploy actions.                 |
| Support                 | Explain assigned organization onboarding, invitation, and access issues.         | Assigned organizations and permitted metadata only; no student, financial, or biometric data.                                      |
| Personal Workspace      | Provide private identity/role context and shortcuts for its owner.               | Only that owner's authorized metadata and resources; no external mutation tools or cross-user memory.                              |

These are workspace experiences, not new roles. The existing
`platform_roles`, `platform_staff_roles`, `super_admins`, and
`has_platform_capability()` remain the authorization authority. A workspace
membership, agent identity, model output, or possession of a Twin does not
grant a capability or tenant access.

## Governed execution model

If separately authorized for implementation, each agent identity must declare
an owner, purpose, model, capabilities, tools, tenant scope, memory scope, data
scope, audit trail, and lifecycle state. Tools are server-side adapters on an
approved allowlist. Every call re-authenticates the agent, resolves tenant
context server-side, checks the existing capability and applicable policy,
minimizes data, and audits the result. Provider credentials remain in approved
secret stores; agents never receive raw keys.

Read-only aggregate queries are the default. Agents may analyze, summarize,
and recommend; they may not independently change roles, memberships,
organization lifecycle, subscription state, platform configuration, tenant
data, or production deployments. No agent may make a direct model-provider
call or use workspace membership to bypass server authorization.

## Human escalation proposal

The future escalation queue is a design proposal, not an implemented queue.
Each item should contain:

- agent and owner identity, requested action, target, resolved tenant, policy
  decision, purpose, and correlation ID;
- a minimal, redacted **before** snapshot and proposed **after** state;
- evidence and source freshness, risk, and the reason human review is required;
- explicit `pending`, `approved`, `denied`, `expired`, or `cancelled` state.

Sensitive actions always require a human decision. Approval is bound to the
exact proposal and target; edits invalidate approval. The human reviewer
revalidates authorization and context at execution time. Agents cannot approve
their own proposals, expand permissions, or execute a changed proposal. Denial
and expiry are terminal decisions and are audited.

## Shared audit and failure behavior

When implementation is authorized, agent proposals and decisions use the same
append-only `public.audit_logs` stream and `writeAuditRecord()` contract as
human actions. Agent attribution uses `actor_kind = agent` and an `actor_ref`;
the record includes correlation ID, action, target, outcome, and allow-listed
before/after proposal data. Human approval and any resulting mutation are
separate audit events. Audit failure blocks the related action.

Missing tenant, identity, capability, policy, evidence, or correlation context
fails closed and escalates or denies. Unknown health never becomes Healthy.
Agents do not receive unrestricted memory or another tenant's context.

## Scope boundary

V1 implementation remains limited to the organizational capability envelope.
The workforce control plane, agents, queue, and autonomous execution remain
deferred. This document does not authorize them, create database objects, or
claim that any agent or human-review workflow is implemented, tested, deployed,
or production-verified.
