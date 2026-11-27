# ADR-143: Super-Admin Support Access (Item 9) and the Group-Level Organisation

- Status: ACCEPTED by the founder in chat, 27 Nov 2026 (to be added to the signed record at the next pack). The access mechanism is a design only; nothing is built or applied until Tumi reviews SUP-01.
- Date: 2026-11-27

## Decision A: Super-admin access inside a school (item 9)

1. **A super admin may read and write inside a school, but only on the school's request.** Access is grounded in a request that originates from the school (a support ticket, a written request from the school head, or a legal or safety obligation), never on the super admin's own initiative. No standing access exists.
2. **Every grant is a record, not a role.** A `support_access_grant` names the school, the requesting person, the reason, the scope (the tables or modules, read or write), the requested duration and the super admin who holds it. Write scope is requested separately from read scope.
3. **Four-eyes on write.** A read grant needs the school head's confirmation. A write grant needs the school head's confirmation and a second platform approver (Tumi or the named alternate), plus passkey step-up (ADR-138). The grantee cannot approve their own grant (SoD).
4. **Time-boxed and revocable.** A grant expires on its own (default 4 hours for read, 1 hour for write; hard maximum 24 hours) and the school head can revoke it at any time. An expired or revoked grant stops working immediately.
5. **Everything is audited with full detail.** Each read and write inside the grant writes an append-only audit row: who, which school, which grant and request, what (table, row, before and after for writes, query class for reads), when, from where (IP, device), and the outcome. The school head sees the same log in their own inbox. The log cannot be edited or deleted by anyone, including the super admin (hash-chained like the existing audit trail).
6. **JARVIS and agents never hold a grant.** Agent access to tenant content stays governed by D-07 and the autonomy ladder. JARVIS continues to read aggregates only (ADR-142).
7. **Break-glass.** For a safety or security emergency a super admin may open a grant without the school head's confirmation. It is read-only unless a second approver adds write, lasts at most one hour, is flagged high-severity, notifies the school head immediately, and is reviewed by Tumi the next working day.
8. **The tenant boundary is unchanged.** Support access is a narrow, audited exception through a dedicated function. It does not weaken RLS, SoD, audit or autonomy caps for anyone else.

## Decision B: The group-level organisation

1. A school group is its own organisation of type `grp` (the **group organisation**). Each campus remains its own isolated organisation (D-07).
2. The group organisation holds **no campus records**. It reads campuses only through a **group aggregate layer**: security-definer functions that return counts and amounts per campus, never rows about a person.
3. **Small-number rule:** any count of 1 to 4 is suppressed (shown as "fewer than 5"); zero and 5 or more are shown. The threshold is a constant, not a tenant setting.
4. A **campus link** (group organisation, campus organisation) is created only when the campus head accepts the link, and either side can end it. Ending a link stops aggregate sharing from that moment.
5. The group director sees aggregates and approves group workflows. A campus's own head still approves anything that changes the campus (fee policy, student and staff transfers need both heads, SoD preserved).
6. Group fee policy is a **proposal** to each campus; the group never edits a campus fee schedule.

## Consequences

- New missions: **SUP-01** (support access grants, audit log, expiry, school-head visibility) and **GRP-01** (group organisation, campus links, aggregate layer, small-number rule, schedule events for the six group workflows). Both need migration, rollback, harness and Tumi's review; neither is applied anywhere.
- The six group templates in Group Pack v1 stay `needs_event_source` until GRP-01 lands.
- The domain-neutrality guard: group and campus vocabulary lives in the scholar runtime namespace; universal migrations use neutral names (organisation link, aggregate).

## Open (for Tumi's review)

- Who is the named second platform approver when Tumi is unavailable.
- Whether the school head's confirmation can be given in WhatsApp (with a signed link) or only in the app.
- Retention period for support-access audit rows (proposal: 7 years).

## Addendum: baseline extension approved (27 Nov 2026)

The founder approved in chat the domain-neutrality baseline extension for the WF-15a2 migration (5 groups, 28 hits), recorded in `NEUTRALITY_GUARD_BASELINE.json` `meta.lastExtension`. It stays a quarantined exception; Tumi's independent review is still requested.
