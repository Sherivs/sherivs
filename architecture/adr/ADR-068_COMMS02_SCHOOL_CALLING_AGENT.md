# ADR-068: Each Paid Organization Gets One Calling Agent

|| Field | Value |
||---|---|
|| Status | PROPOSED (operator review before any production migration or live-calling flag) |
|| Date | 2026-11-10 |
|| Author | Automated coding agent for issue #329. Extends the voice fabric authored by `copilot-swe-agent[bot]` (issues #216 and #221). |
|| Mission | COMMS-02 — dedicated calling agent for Professional and Enterprise organizations |
|| Capabilities | V1 organizational communications; one calling agent scoped to the organization that owns the bound number |
|| Supersedes-in-part | None. ADR-067 still binds Africa's Talking numbers. This ADR adds the plan gate, the organization line, and the observed legacy-vocabulary groups for migration `20261104033000`. |
|| Cites | AGENTS.md §§13, 16, 17, 19, 21, 26–31, 45; issue #329; ADR-067; `database/supabase/migrations/20261104033000_sherivs_comms02_calling_agent.sql`; `frontend/src/lib/communications/school-calling-agent.ts`; `frontend/src/lib/payments/tier-entitlements.ts` |
|| Minimal ownership artifact | `database/supabase/migrations/20261104033000_sherivs_comms02_calling_agent.sql` and its matching rollback |

## Context

Issue #329 reserves migration timestamps `20261104033000`–`20261104033999` and ADR-068. COMMS-01 (ADR-067, migration `20261104032000`) already stores each organization's Africa's Talking number in `comms_sender_numbers` and resolves outbound recipients from a member id. The inbound path could still follow an older sender row, and no plan check kept Trial, Starter, or Growth from enabling the add-on. The spoken answerer used public help text and refused organization records.

The live organization id is still `schools.id` through `school_tenant_map.school_id`. A plan check and a member-scoped fact read have to name that column. ADR-004 allows a neutrality-baseline extension only when an ADR records it.

`voice_live` stays off. This decision does not place a live call and does not store `AT_API_KEY`, `AT_VOICE_WEBHOOK_TOKEN`, `VOICE_STT_API_KEY`, or `AI_API_KEY`.

## Options

### Option 1 — Add a second agent directory and a second number table (rejected)

Create a new table of calling agents and route school calls outside `comms_sender_numbers`.

- **Consequences:** It would split tenant enforcement from the fabric COMMS-01 just bound and ignore the instruction to extend the existing voice agent.

### Option 2 — Let the model read any row it names and speak the result (rejected)

Pass the caller's words to the model with a service-role query tool.

- **Consequences:** The model could name another organization's member or a raw phone number. That breaks tenant isolation and the rule that AI may only propose.

### Option 3 — Gate the existing agent on the paid plans and speak only server-built facts (ruled)

Professional and Enterprise are the commercial entitlement in `payments/tier-entitlements.ts`. The same feature gate used by `getMyFeatureAccess` must also allow the actor. Trial, Starter, and Growth fail closed in both places and in SQL. Enabling the add-on, binding an organization number, requesting a call, and approving a call all require that plan. Inbound audio for an organization binding reaches that binding's tenant only, and only when the line is open. A verified member hears fee, result, admission, and timetable facts for that member. Anything else escalates to the already-bound platform support line. The model may phrase those facts. A proposal that adds a phone number or an amount is discarded. `voice_live` stays off. Forced RLS stays on. New functions set `search_path` and are not granted to `anon`.

- **Consequences:** The migration names `school_id` because that is the live organization key, and it names `fees` and `timetable` because those are the existing record tables the agent reads. Those three observed groups are quarantined under this ADR. Operators apply the file before organization lines answer. Live calling stays a separate flag.

## Recommendation (decision)

**Use Option 3.** COMMS-02 extends the COMMS-01 voice agent. It does not add a second telephony stack, does not accept a raw number from the client or the model, and does not apply the migration to production from this change. Caller ID only identifies a candidate member. Fees, results, admission numbers, and timetable are released only after that member's voice PIN is confirmed on the keypad. The PIN is stored with `pgcrypto` `crypt` using `bf`, and it is never written to `audit_chain` or the call log. The spoken organization answer is the server-built sentence, not a free model phrasing.

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual risk:** A caller who is not a verified member is escalated and hears no organization records. A verified member hears only the rows linked to that member. The model does not choose the member id or the phone number.
- **The sharpest instance:** If two confirmed members share one number, the line treats the caller as unverified and escalates.
- **The accepted rationale:** Guessing which person shares a handset would disclose the wrong record. Escalation is the safe result.
- **Owner of the residual risk:** The communications owner, when `voice_live` is later enabled for a tenant.

## Consequences (summary)

- **Positive:** Lower plans cannot bind a number, enable the agent, or open an inbound school line. A Professional school cannot receive another school's facts. Missing provider keys fail closed.
- **Negative / obligations:** Applying `20261104033000` is an operator step. The neutrality baseline grows by the observed groups for this file only. Rollback drops the new functions and the `line_role` column and keeps `audit_chain` rows.
- **For the wave/program specifically:** V1 communications only. No V2 device or V3 reality work.

## Golden Questions

- **WHO?** An organization admin on Professional or Enterprise enables the agent and requests a call for a member. A different admin approves. Africa's Talking webhooks are authenticated with `AT_VOICE_WEBHOOK_TOKEN`. The model proposes wording only.
- **WHAT?** One calling agent per entitled organization, bound to that organization's Africa's Talking number, answering only that caller's verified records.
- **WHERE?** Migration `20261104033000_sherivs_comms02_calling_agent.sql`, the existing voice modules, and this ADR.
- **WHY?** Issue #329 requires the school calling agent on the latest paid tiers without a second fabric and without client-supplied numbers.
- **UNDER WHICH POLICY?** AGENTS.md §§13, 16, 17, 19, 21, 26–31, and 45; forced RLS; `voice_live` remains default-off; ADR-004 baseline growth is limited to the observed groups.

## Pre-apply query and apply order

Run these read-only queries before applying `20261104033000_sherivs_comms02_calling_agent.sql`. They do not write.

Rows here are organizations that already have the voice add-on or an organization number and are not on Professional or Enterprise. The migration does not delete those rows. After apply, enabling, binding, requesting, approving, and inbound school lines fail closed for them.

```sql
SELECT s.id, lower(btrim(coalesce(s.subscription_tier, 'trial'))) AS tier
FROM public.schools s
JOIN public.cg_org_voice_agent a
  ON a.tenant_ref = s.id::text
  OR a.tenant_ref IN (
    SELECT m.tenant_id::text FROM public.school_tenant_map m WHERE m.school_id = s.id
  )
WHERE a.enabled
  AND lower(btrim(coalesce(s.subscription_tier, 'trial'))) NOT IN ('professional', 'enterprise');

SELECT n.org_id, n.binding_role, n.number_status
FROM public.comms_sender_numbers n
JOIN public.schools s ON s.id = n.org_id
WHERE n.channel = 'voice'
  AND n.binding_role = 'organization'
  AND n.number_status = 'active'
  AND lower(btrim(coalesce(s.subscription_tier, 'trial'))) NOT IN ('professional', 'enterprise');
```

Apply order:

1. COMMS-01 `20261104032000` is already earlier in the migration sequence and is applied before this file.
2. Run both queries above.
3. Apply `20261104033000`. Do not apply it to production from this pull request.
4. Re-applying the file does not enable `voice_live` and does not insert a phone number.
5. The inbound callback answers "not available" for an organization binding until this file is applied. It does not return HTTP 500 solely because the new function is missing.
6. Set the provider environment variables before any non-test call. Turning on `voice_live` is a separate operator action and is not authorized here.

## UNKNOWNs

- The operator must apply the migration and set `AT_USERNAME`, `AT_API_KEY`, `AT_VOICE_WEBHOOK_TOKEN`, `AT_VOICE_CALLBACK_URL`, `VOICE_STT_API_KEY`, `VOICE_LLM_PROVIDER`, and `AI_API_KEY` before any non-test school call. This change does not do that.
- Turning on `voice_live` is a separate operator action and is not authorized here.
- A shared handset with two confirmed members is escalated rather than guessed.
