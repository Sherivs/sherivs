# Personal data breach response

**LEGAL REVIEW REQUIRED** for every deadline, threshold and template below. Under the NDPA 2023 a controller must notify the NDPC **within 72 hours** of becoming aware of a breach likely to result in risk to data subjects, and notify affected data subjects without undue delay when the risk is high.

Register: `public.security_incidents` (migration `20261020000060`). `ndpc_notification_due_at` is set automatically to `detected_at + 72h`. Writes are service-role only (server function / operator); school admins and super admins can read. `school_id` NULL = platform-wide incident (super admin only).

The in-memory incident contract (`frontend/src/lib/command-incidents.ts`) is a command-centre model with no table behind it; the table above is the legal record.

## Severity matrix

| Severity | Examples | Target actions |
|---|---|---|
| critical | Cross-tenant data exposure, credential leak with data access, mass export of pupil records | Lockdown now ([incident-lockdown runbook](../runbooks/incident-lockdown.md)); NDPC notice ≤ 72h; guardians notified |
| high | Single-tenant unauthorised access to pupil/staff data, lost unencrypted device with data | Contain same day; NDPC notice ≤ 72h unless risk assessed as unlikely |
| medium | Misdirected message with limited personal data, short exposure caught early | Assess; record decision either way |
| low | No personal data involved / contained with no access | Record only |

## RACI

| Step | DPO | Incident commander | Engineering | School admin | Platform owner |
|---|---|---|---|---|---|
| Detect & log in `security_incidents` | I | A | R | C | I |
| Contain (lockdown, rotate credentials) | C | A | R | I | I |
| Assess risk to data subjects | A | R | C | C | I |
| Notify NDPC (≤ 72h) | A/R | C | C | C | I |
| Notify guardians / data subjects | C | C | I | A/R | I |
| Post-incident review, update controls | A | R | R | C | I |

(R responsible, A accountable, C consulted, I informed.)

## Procedure

1. **Detect** — record the incident (severity, category, `personal_data_involved`, `affected_subjects_estimate`). The 72h clock starts at `detected_at`.
2. **Contain** — follow [incident-lockdown.md](../runbooks/incident-lockdown.md). Automated escalation signals follow `frontend/src/lib/jarvis/escalation.ts` (notify_only → request_human_approval → page_operator); critical incidents page the operator.
3. **Assess** — DPO decides whether the breach is likely to risk data subjects' rights; document the reasoning in the incident.
4. **Notify NDPC** — send before `ndpc_notification_due_at`; set `ndpc_notified_at`, status `notified`. If full facts are unavailable, notify in phases.
5. **Notify guardians** — if risk is high; set `guardians_notified_at`.
6. **Close** — status `closed` after remediation and review; keep the record.

Never put secrets, tokens or unnecessary personal data in the description (AGENTS §29).

## Template — NDPC notification (LEGAL REVIEW REQUIRED)

> To: Nigeria Data Protection Commission — `<submission channel>`
> From: `<controller / school name>`; DPO: `<controller's designated DPO>`; contact routing supplied at runtime
> Date/time of awareness: `<detected_at>`; date of notice: `<now>`
> 1. Nature of the breach (what, how, when, ongoing?)
> 2. Categories and approximate number of data subjects and records: `<affected_subjects_estimate>`
> 3. Likely consequences for data subjects
> 4. Measures taken or proposed to contain and mitigate
> 5. Contact point for further information
> 6. Reason for any delay beyond 72 hours (if applicable)

## Template — guardian notification (LEGAL REVIEW REQUIRED)

> Subject: Important notice about your child's information at `<school>`
>
> Dear `<guardian>`, on `<date>` we discovered that `<plain description>` affected information about `<child / category of data>`. We have `<containment steps>`. You may wish to `<recommended precautions>`. We have informed the Nigeria Data Protection Commission. For questions, use the controller's DPO contact channel supplied at runtime. We apologise for the concern this causes.

## Related

[ndpa-overview.md](./ndpa-overview.md) · [retention-schedule.md](./retention-schedule.md) · [erasure-policy.md](./erasure-policy.md)
