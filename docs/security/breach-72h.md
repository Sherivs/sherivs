# 72-hour personal-data breach runbook

**Legal review required.** This operational checklist follows the existing NDPA response policy: assess whether a breach is likely to risk data subjects, notify the NDPC within 72 hours when required, and notify affected people without undue delay when the risk is high. Confirm the current legal threshold, reporting channel, and templates with the DPO/legal counsel; this runbook is not legal advice. See [the compliance procedure](../compliance/breach-response.md).

## Start the clock and create the incident record

- [ ] Record the time the organization became aware of the suspected breach as `detected_at`; this is the awareness time used by the response process.
- [ ] Create or update one `public.security_incidents` record through the approved server/operator path. Capture the incident ID, tenant (or `NULL` for a platform-wide incident), reporter, severity, category, whether personal data is involved, and a defensible estimate of affected people if known.
- [ ] Confirm `ndpc_notification_due_at` is set to `detected_at + 72 hours`; write the due time and incident ID into the incident channel/task tracker. Do not put credentials, tokens, student/staff names, or unnecessary personal data in the incident description.
- [ ] Name an incident commander and DPO, start a timestamped decision log, and follow [incident lockdown](../runbooks/incident-lockdown.md) for containment.

## Timeline checklist

### 0–4 hours — contain and establish facts

- [ ] Restrict access to affected systems or datasets, preserve relevant evidence, and involve security/engineering. Do not destroy logs or alter the incident record to hide uncertainty.
- [ ] Determine the systems, tenant boundary, data categories, exposure window, and whether access or exfiltration is confirmed, suspected, or not yet known.
- [ ] Ask the DPO to assess likely risk to people; record the rationale and remaining unknowns in the incident decision log.
- [ ] Identify a safe contact path for the NDPC and affected people, without sending unverified claims.

### By 24 hours — decide and prepare

- [ ] The DPO and incident commander confirm whether NDPC notification is required and whether the risk to people is high. Record the decision, evidence, and owner in the incident record.
- [ ] Prepare the NDPC notice with the nature of the breach, data/people categories and estimates, likely consequences, containment/mitigation, and contact point. Mark estimates and facts that are still uncertain.
- [ ] If high risk is established, prepare a clear, accessible notice to affected people and an approved support channel.
- [ ] Recheck `ndpc_notification_due_at`; escalate immediately if the planned actions risk missing it.

### By 48 hours — review readiness

- [ ] DPO/legal counsel review the notice, audience, channel, and any phased-notification plan.
- [ ] Confirm containment is holding, impact estimates are evidence-based, and the incident record reflects material new facts and decisions.
- [ ] Escalate unresolved blockers to the incident commander and platform owner; set named owners and short deadlines.

### By 72 hours — notify or escalate

- [ ] If notification is required, submit to the NDPC no later than `ndpc_notification_due_at`; record `ndpc_notified_at`, channel/reference, and the submitted version in the incident record.
- [ ] If facts are incomplete, make a legally reviewed phased notification where permitted and document what remains outstanding and when it will follow.
- [ ] If high risk applies, notify affected people without undue delay through the approved channel; record `guardians_notified_at` when applicable.
- [ ] If notification is not required, record the DPO's reasoned decision and supporting evidence before the deadline.
- [ ] If the 72-hour deadline has passed, notify the DPO/incident commander immediately, document the reason for delay, and follow counsel's direction; do not backdate the incident or notice.

### After notification — recover and close

- [ ] Continue remediation and monitor for recurrence; preserve the evidence and decision trail.
- [ ] Update the incident status and notification timestamps through the approved server/operator path.
- [ ] Complete a post-incident review with corrective actions, owners, and dates. Close the record only after remediation and review are complete.

## Roles and controls

- **Incident commander:** coordinates containment, assignments, escalation, and the timeline.
- **DPO:** owns the risk assessment and notification decision; coordinates legal review and regulator contact.
- **Engineering/security:** contains the issue, preserves evidence, and reports verified technical facts.
- **School/institution lead:** coordinates affected-person communication when appropriate.
- **Platform owner:** resolves cross-tenant/platform escalation and operational blockers.

`security_incidents` is the canonical incident record; its NDPC due time is established by the database trigger. Writes are restricted to the approved service/operator path, and access remains subject to tenant policy. Never use a spreadsheet or chat thread as the only incident record.
