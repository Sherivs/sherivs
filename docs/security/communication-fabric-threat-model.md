# Communication fabric threat model

## Scope and trust boundaries

This design is limited to the V1 organizational communication fabric. The V1 organization ID is the existing `schools.id`; the optional organization-owned WhatsApp number/embedded signup remains disabled. The fabric covers the existing `comms_templates`, `comms_optins`, `comms_sender_numbers`, `inbound_messages`, and `outbound_messages` tables, plus approval and conversation-context records that support those same flows.

Trust boundaries:

- Browser and AI-generated audience/template values are untrusted.
- Authenticated user identity, active organization context, role permissions, verified contact claims, and organization membership are established server-side.
- Provider webhook content is untrusted until its HMAC signature is verified.
- Provider credentials remain server-only; provider calls use the existing server adapter.
- The database is the enforcement boundary for recipient membership, tenant scoping, approval, consent, rate metering, and audit.

## Assets and security goals

- Organization-scoped message bodies, delivery status, audience definitions, recipient IDs, and opt-in state.
- The exact relationship between an organization and each recipient.
- Verified phone/email claims, which must not be exposed to AI proposal callers or unrelated users.
- WhatsApp conversation context and the 24-hour session-window timestamp.
- Proposal, approval, outbound-send, and inbound-routing evidence in `audit_chain`.

The primary safety property is that every newly created outbound message has one verified, active organization member as recipient, with an `org_id` equal to its `school_id`. A client cannot supply an arbitrary destination or write a delivery row directly.

## Threats and mitigations

| Threat | Mitigation |
|---|---|
| An AI or client names a phone number belonging to another user | Proposal RPC accepts an audience specification and template, resolves recipient IDs and confirmed contacts inside the requested organization, and never accepts a destination address. |
| An organization ID is changed to read another organization's messages | Communications tables use forced RLS; reads are constrained to the active organization and either the authenticated user's own recipient/sender ID or the organization broadcast permission. |
| A direct SQL/service path forges an outbound row | Direct table writes are revoked from client roles. A database trigger requires an active membership and checks that the stored address matches the member's contact. The send RPC additionally requires a released proposal. |
| AI approves its own bulk/external proposal | All proposals remain pending until an authenticated organization approver with `comms.broadcast` releases them; the proposer cannot approve or reject their own proposal. |
| Contact data leaks into broad AI context or audit records | The proposal response returns only proposal ID/count. Audit payloads omit body, phone, and email; recipient user ID is the minimum linkage retained for delivery/RLS. |
| Provider webhook spoofs sender, gateway, or organization | Webhook HMAC is checked over the raw body; the database validates the shared gateway and resolves sender membership/contact itself. Organization selection is required for a sender with multiple active organizations. |
| STOP/START state is applied to a different organization | Opt-in state is keyed by organization, sender phone, and channel; inbound routing keeps organization context per gateway/sender conversation. |
| WhatsApp free-form reply is sent outside the 24-hour window | Context stores `last_inbound_at` and `session_expires_at`; the routing prompt is sent only in direct response to a signed inbound message, opening that window. Template sends remain governed by approved templates and opt-in. |
| Retried webhook events create duplicate inbound rows | Existing provider-reference uniqueness and inbound idempotency are retained; the conversation context is upserted by gateway and normalized sender. |
| Cross-organization spend or runaway sends | Existing per-organization `meter_usage`, `flag_on`, and WhatsApp opt-in checks remain in the send path; organization bulk/external sends require human approval. |

## Audit and evidence

Proposal creation, approval/rejection, and outbound/inbound message rows are audited through the existing `audit_logs` bridge into append-only `audit_chain`. The audit records contain action/state and identifiers, not message content or contact addresses. Forced-RLS policy and recipient triggers provide database enforcement independent of the UI.

Validation uses the isolated Simulation Lab and synthetic `*.sim.invalid` identities. Required negative cases include: an organization-A audience cannot resolve organization-B members; an organization-A user cannot read organization-B messages; an unapproved proposal cannot send; and a forged outbound recipient fails the database guard.

Visual evidence uses synthetic local preview data:

- Desktop personal inbox (1440px): `docs/screenshots/communication-inbox-desktop-1440.png`
- Desktop organization log (1440px): `docs/screenshots/communication-admin-log-desktop-1440.png`
- Mobile personal inbox (390px): `docs/screenshots/communication-inbox-mobile-390.png`

## Residual limitations

- Provider delivery remains gated by existing feature flags and server credentials; this change does not enable a live provider or introduce a background delivery worker.
- Historical inbound rows with no prior `school_id` cannot be assigned a real organization without evidence. The migration preserves those legacy rows but rejects unscoped new routing through the database RPC.
- The data model follows the repository's current V1 school/organization identity mapping. A future canonical organization-ID migration requires separate authorization and migration planning.
