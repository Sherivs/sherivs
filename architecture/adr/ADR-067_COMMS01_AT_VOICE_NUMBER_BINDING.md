# ADR-067: Africa's Talking Numbers Stay Bound to the Tenant

|| Field | Value |
||---|---|
|| Status | PROPOSED (operator review before any production migration or live-calling flag) |
|| Date | 2026-11-10 |
|| Author | Automated coding agent for issue #328. Extends the voice fabric authored by `copilot-swe-agent[bot]` (issues #216 and #221). |
|| Mission | COMMS-01 — bind Africa's Talking as the phone-number and voice provider |
|| Capabilities | V1 organizational communications; existing voice support line and organization voice add-on |
|| Supersedes-in-part | None. ADR-012 still records the earlier communications scope-lock vocabulary. This ADR adds only the COMMS-01 migration's observed legacy-vocabulary groups. |
|| Cites | AGENTS.md §§13, 16, 17, 19, 26, 27, 28, 30, 31, 45; issue #328; `database/supabase/migrations/20261104032000_sherivs_comms01_at_number_binding.sql`; `frontend/src/lib/communications/africas-talking-voice.server.ts`; `frontend/src/lib/communications/voice-agent.functions.ts` |
|| Minimal ownership artifact | `database/supabase/migrations/20261104032000_sherivs_comms01_at_number_binding.sql` and its matching rollback |

## Context

Issue #328 reserves migration timestamps `20261104032000`–`20261104032999` and ADR-067. Africa's Talking is already the voice provider behind `africas-talking-voice.server.ts`, `africas-talking-outbound.server.ts`, `telephony-adapter-contract.ts`, `voice-agent.functions.ts`, and `comms_sender_numbers`. The organization voice screen and `voice_agent_configure` / `voice_agent_request_call` still accepted a raw sender number and a raw recipient number from the authenticated client.

The live V1 identity store still keys organization membership through `school_id`. Extending `comms_sender_numbers` and the voice-agent RPCs has to name that column. The domain-neutrality guard flags those references. ADR-004 allows a baseline extension only when an ADR records it. ADR-067 is the number issue #328 assigned, ahead of the still-unused ADR-043 and ADR-044.

`voice_live` already defaults to off. This decision does not turn it on and does not place a live call.

## Options

### Option 1 — Add a parallel voice-number table (rejected)

Create a new provider directory of phone numbers and route calls through it.

- **Consequences:** It would duplicate `comms_sender_numbers` and `cg_org_communication_sender`, split tenant enforcement, and ignore the instruction to extend the existing fabric.

### Option 2 — Keep accepting numbers from the client and only check opt-in (rejected)

Leave the current configure and request payloads in place.

- **Consequences:** An AI or browser caller could name any E.164 destination. Opt-in lookup would still depend on that untrusted number, which issue #328 forbids.

### Option 3 — Bind numbers in the existing sender table and resolve recipients from membership (ruled)

Store the platform support line and each entitled organization's Africa's Talking number in `comms_sender_numbers`. Only `service_role` may bind or attach a number. Authenticated callers enable the add-on and choose a member id. The database resolves the confirmed phone, checks voice opt-in, and rejects another organization's member. Speech defaults remain Africa's Talking `<Say>` and the existing OpenAI transcriber. Human escalation dials only `+2349015056201` when that platform row is active. Every voice-number change appends to `audit_chain`. Forced RLS stays on.

- **Consequences:** The migration must mention `school_id` and `school_tenant_map` so the binding matches the live organization id. Those hits are quarantined under this ADR. Operators must apply the migration before the new RPCs are called. Live calling stays off until a separate flag change.

## Recommendation (decision)

**Use Option 3.** COMMS-01 extends `comms_sender_numbers` and the existing voice-agent functions. It does not create a second telephony stack, does not store `AT_API_KEY` or `AT_VOICE_WEBHOOK_TOKEN`, does not enable `voice_live`, and does not apply the migration to production from this change.

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual risk:** Inbound routing still accepts an already-provisioned neutral sender row without a second lookup of `comms_sender_numbers`, because that path is the existing organization voice contract. New numbers cannot be written by the client.
- **The sharpest instance:** A sender row created before this binding, if one exists, can still anchor an inbound session while `voice_live` is on.
- **The accepted rationale:** Removing that path would change a merged contract and the tests that lock it. Outbound dispatch now refuses a from-number that is not the organization binding.
- **Owner of the residual risk:** The communications owner, when `voice_live` is later enabled for a tenant.

## Consequences (summary)

- **Positive:** Platform and organization numbers have one server-side binding. Recipients are member ids. Missing provider keys and bad webhook tokens fail closed. The RLS check learns the new bind RPCs without failing databases that have not applied the migration.
- **Negative / obligations:** Applying the migration is an operator step. The neutrality baseline grows by the observed `school_id` group for this file only. Rollback restores the previous voice-agent signatures and keeps `audit_chain` rows.
- **For the wave/program specifically:** V1 communications only. No V2 device or V3 reality work.

## Golden Questions

- **WHO?** Service role binds numbers. An organization admin enables the add-on and requests a call for a member. A different admin approves. Africa's Talking webhooks are authenticated with `AT_VOICE_WEBHOOK_TOKEN`.
- **WHAT?** Bind the platform support line and each entitled organization's Africa's Talking number to a tenant, and resolve call recipients on the server.
- **WHERE?** Migration `20261104032000_sherivs_comms01_at_number_binding.sql`, the existing voice modules, and this ADR.
- **WHY?** Issue #328 requires Africa's Talking as the provider without a second fabric and without client-supplied numbers.
- **UNDER WHICH POLICY?** AGENTS.md §§13, 16, 17, 19, 26–31, and 45; forced RLS; `voice_live` remains default-off; ADR-004 baseline growth is limited to the observed group.

## Pre-apply query and apply order

Run these read-only queries before applying `20261104032000_sherivs_comms01_at_number_binding.sql`. They do not write.

The voice-row query must return zero rows. A voice row whose provider is not Africa's Talking, or an existing voice row for `+2349015056201`, has to be resolved by an operator before apply.

The root-tenant query must return exactly one organization. That organization is the only one `comms_attach_platform_voice_org` will accept, and inbound platform calls route through it.

```sql
SELECT channel, provider, provider_number
FROM public.comms_sender_numbers
WHERE channel = 'voice'
  AND (
    provider IS DISTINCT FROM 'africas_talking'
    OR provider_number = '+2349015056201'
  );

SELECT m.school_id, m.tenant_id
FROM public.school_tenant_map m
WHERE m.tenant_id = '3c0d0f9a-56bb-4a3e-8e02-b1a426f1c201';
```

Apply order:

1. The voice add-on `20261101000050` and the sender channel check `20261103000200` are already earlier in the migration sequence.
2. Run both queries above.
3. Apply `20261104032000`. Do not apply it to production from this pull request.
4. The inbound callback may be deployed before step 3. If `binding_role` is missing it answers "not available" and does not return HTTP 500. Apply the migration before operators call `voice_agent_configure` or `voice_agent_request_call`.
5. Re-applying the file does not rewrite an unchanged platform row, so it does not append another audit entry for that row.
6. `comms_attach_platform_voice_org` accepts only the organization mapped to tenant `3c0d0f9a-56bb-4a3e-8e02-b1a426f1c201` and refuses to move a line that is already attached. Inbound platform calls follow that same tenant map, not an arbitrary `org_id` on the row.

## UNKNOWNs

- The operator must apply the migration and set `AT_USERNAME`, `AT_API_KEY`, `AT_VOICE_WEBHOOK_TOKEN`, and `AT_VOICE_CALLBACK_URL` before any non-test call. This change does not do that.
- Turning on `voice_live` is a separate operator action and is not authorized here.
- Inbound platform audio still needs a `school_tenant_map` row for `3c0d0f9a-56bb-4a3e-8e02-b1a426f1c201`. Until that map exists the number is stored and inbound routing fails closed.
