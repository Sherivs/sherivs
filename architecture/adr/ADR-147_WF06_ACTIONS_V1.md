# ADR-147: Workflow Actions V1 through the Tool Broker

| Field          | Value                                                            |
| -------------- | ---------------------------------------------------------------- |
| Status         | Proposed                                                         |
| Date           | 2026-11-17                                                       |
| Creator        | copilot-swe-agent[bot]                                           |
| Version target | V1 organizational workflows                                      |
| Scope          | WF-06 actions: email, in-app, WhatsApp, SMS, task, wait, webhook |
| Related        | ADR-111 (WF-05 event sources), ADR-115                           |

## Context

WF-05 can create tenant-scoped runs and steps, but effectful actions need a single policy and
execution boundary. A workflow step, event, or agent must not contact a provider directly or raise
its own autonomy. Delivery must be independently disabled by default and isolated by organization.

## Decision

- Keep action definitions versioned with the workflow and validate them against the closed V1
  action schema. Message content is referenced by approved templates and bounded parameters;
  recipient addresses are not accepted from workflow or event payloads.
- Resolve action type and broker tool from the service-managed catalogue. Route effectful action
  decisions through `brokerToolCall`, and require the execution gate for live connector execution.
  No workflow runtime provider imports or direct provider calls are permitted.
- Effective autonomy is the minimum of template, tenant, and agent ceilings, further limited by
  the category cap. Money movement, safeguarding, credential changes, public publishing, mass or
  confidential communication, and sharing data with an external authority are capped at `draft`.
  More than 25 recipients, any audience selector, or confidential/minor-sensitive data is mass
  communication.
- Require the same protected-category cap in SQL. Drafts preserve tenant/run/step scope,
  template parameters, recipient IDs, and audience selector; service role alone writes them.
  Sandbox outbox rows are service-only and cannot be dispatched to a provider.
- The executed (sandbox outbox) record is itself bounded in SQL: never a capped category, at most
  `WORKFLOW_MASS_RECIPIENT_THRESHOLD` = 25 recipients, no audience selector, a `public` or
  `internal` data class only, and a link to an `execute` broker decision of the same tenant, tool
  and idempotency key. Drafts that are mass or confidential must carry a capped category.
- Data classes are an explicit set (`public`, `internal`, `confidential`, `minor_sensitive`).
  Unknown values, and missing values on person-facing kinds, are treated as `confidential`.
- When an effect is replayed, the runtime looks up what the original dispatch produced (draft,
  sandbox outbox or succeeded live outcome) and keeps the step waiting unless it executed.
- `WORKFLOW_DELIVERY_MODE` defaults to `off`, including invalid values. `sandbox` records broker
  decisions and outbox rows only. `live` additionally requires the global workflow flag, a
  production app environment, the organization flag, valid broker authority, a tenant binding,
  and a resolved connector secret. Any missing prerequisite fails closed.
- The broker idempotency key is the workflow step key. Draft and sandbox writes are unique by
  organization and idempotency key. A retry must reuse the same key.

## Consequences

WF-06 adds a service-managed action catalogue, tenant-scoped drafts, sandbox outbox, and registered
webhook targets. The runtime has no alternate provider path. Categories and audiences that need
human review remain drafts; WF-07 owns the approval inbox. The runtime must continue to refuse
live delivery when a connector adapter, active binding, or secret resolver is unavailable.

## Validation boundary

Migration replay, SQL RLS/grant/cap checks, unit tests, and event-to-action simulation use only the
disposable local sim-lab and CI. This ADR does not authorize applying migrations to hosted
databases, enabling a production organization, or deploying live delivery.
