# Counsel review pack: safeguarding, legal and compliance wording

Authority: AGENTS.md §§12, 17, 26, 31; ADR-082, ADR-087, ADR-091.
Origin: Owner instruction of 2026-11-16 ("build counsel review of the safeguarding, legal and compliance wording")
Creator: Claude Code agent
Created: 2026-11-16
Status: PREPARED FOR COUNSEL. NOT REVIEWED. NOT APPROVED.

**This is not legal advice and it is not a legal opinion.** It was written by an AI agent to make a lawyer's review fast and complete. Nothing in it has been reviewed or approved by counsel, and nothing here may be treated as approved wording until the sign-off block at the end is completed by a qualified Nigerian lawyer. The agent cannot give that sign-off and no code, test or automation substitutes for it.

## 1. What counsel is being asked to do

Review the wording and rules that three Sherivs agents, and the JARVIS owner-alert channel, will put in front of people, and say for each item: approve, approve with changes, or reject. The three agents start in shadow mode (they draft and propose; they do not act on their own), so no wording below has reached a real person yet. The review has to finish before any of them is promoted out of shadow.

| Agent                                | Codename | Autonomy today                                               | Highest tier it can reach               |
| ------------------------------------ | -------- | ------------------------------------------------------------ | --------------------------------------- |
| Safeguarding agent                   | Warden   | Shadow; screens and routes, notifying a lead needs approval  | T2 (`notify.designated.lead`, WhatsApp) |
| Legal and contracts agent            | Brief    | Shadow; drafts and tracks, sending a notice needs approval   | T2 (`send.legal.notice`, email)         |
| Compliance and data-protection agent | Themis   | Shadow; assesses and drafts, sending a notice needs approval | T2 (`send.data.notice`, email)          |

## 2. Wording inventory

Exact text is quoted from the repository so counsel reviews what is really there. Source files are named so a change can be made in one place.

### 2.1 Mission statements (shown to staff in the console)

| Agent  | Text                                                                                                                                                     | Source                                              |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Warden | "Make sure every safeguarding concern reaches the right human fast, with the case prepared, and never handles a child's case alone."                     | `workforce-charter/charters/completion-charters.ts` |
| Brief  | "Keep contracts and obligations in order by drafting from approved templates and flagging risk, with counsel and the sheriff deciding anything binding." | same                                                |
| Themis | "Keep the platform inside its data-protection duties by assessing requests, watching retention and preparing notices for human and counsel review."      | `workforce-charter/charters/expansion-charters.ts`  |

### 2.2 Hard boundaries (what each agent is told it must never do)

Warden

1. "Never investigates, decides or concludes a case: it screens, routes and prepares for a human."
2. "Never contacts a child, a parent or a family."
3. "Never shares case details outside the case or with any other agent except by an approved handoff."
4. "Never lowers an urgency set by a human."

Brief

1. "Never signs, agrees or accepts terms for Sherivs."
2. "Never gives legal advice: it drafts, flags and refers to counsel."
3. "Never sends a notice without approval and counsel review where the template requires it."
4. "Never changes an executed contract or template."
5. "Never reads an organization's content or records beyond the contract in front of it."

Themis

1. "Never decides a legal question: it prepares and refers to counsel."
2. "Never reads an organization's records without an active grant for that organization."
3. "Never deletes, exports or changes personal data itself."
4. "Never sends a notice without approval and, where required, counsel review."

Source: `workforce-charter/workspaces/workforce-workspaces.ts`.

### 2.3 Capabilities that produce outward-facing text

| Capability                                | Agent  | Tier | Who approves      | Channel  |
| ----------------------------------------- | ------ | ---- | ----------------- | -------- |
| Notify the designated safeguarding lead   | Warden | T2   | platform staff    | WhatsApp |
| Send a legal notice to an organization    | Brief  | T2   | platform staff    | Email    |
| Send a data-protection notice to a tenant | Themis | T2   | platform staff    | Email    |
| Draft a personal-data incident assessment | Themis | T0   | none (draft only) | none     |

The notice templates themselves are not yet written. Counsel is asked to supply or approve them before the three T2 capabilities are enabled (see question Q4).

### 2.4 JARVIS owner-alert messages (new in this change)

JARVIS alerts the owner about incidents and pending approvals. These are the exact messages.

| Channel                    | Text                                                                                                                                                                    | Source                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| SMS, email, WhatsApp       | `[S1] <title> Review in console: https://console.sherivs.com/console/alerts?ref=<key>` (titles are limited to 140 characters, with links and hidden characters removed) | `jarvis-executive/owner-alert.ts`                     |
| Voice call                 | "This is a Sherivs priority alert. Severity one. Please open your Sherivs console to review it. This call cannot approve anything."                                     | `jarvis-bridge/owner-alert-sender.server.ts`          |
| Email subject              | "[S1] Sherivs owner alert"                                                                                                                                              | same                                                  |
| Console banner (test mode) | "alerts reach this console only; phone, WhatsApp, SMS and email go to test sinks."                                                                                      | `components/internal-console/owner-alerts-screen.tsx` |

Titles are built from controlled templates such as "Security incident (critical, breach)" and "Approval waiting (T3): deploy production". They contain no names, no student or guardian data and no free text from a customer. Counsel is asked to confirm that this is enough to keep personal data out of SMS, WhatsApp and email (question Q6).

## 3. What the code already guarantees (so counsel need not rule on it)

These are enforced by code and tests, not by wording. They are listed so counsel can rely on them or ask for them to change.

- An alert never carries an approval link, a code or a secret. Phone, WhatsApp, SMS and email can only notify or deny; approving needs the console and, for T3, a passkey assertion bound to that approval (`tests/unit/jarvis-step-up.test.ts`, `tests/unit/jarvis-approval-store.test.ts`).
- Real messages are sent only when the gateway is in live mode, an unexpired authorization names the channel and an approver, the owner's contact is configured, and the provider's credentials exist (`tests/unit/alert-delivery.test.ts`, `tests/unit/owner-alert-sender.test.ts`, `tests/unit/jarvis-live-evaluation.test.ts`).
- The agents cannot decide an approval, read secrets or move money (`tests/unit/jarvis-service-identity.test.ts`).
- Each of the three agents is in shadow mode and the platform's evaluation harness passes all graded deterministic cases with zero critical failures. 569 model-behaviour cases are ungraded because no model-backed grader exists; they are not counted as passes.

## 4. Questions for counsel

Each question names the wording or rule it affects. "Repo says" quotes what the repository currently states; that statement is itself unreviewed (`docs/compliance/breach-response.md` is marked LEGAL REVIEW REQUIRED).

| #   | Question                                                                                                                                                                                                                                                                                                                                                               | Affects                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Q1  | Is the safeguarding boundary set (screen, route, never decide, never contact a child or family) adequate for a platform serving organizations that look after children? Are there mandatory-reporting duties on Sherivs, as opposed to the organization, that change what "route to the designated lead" must do or record?                                            | Warden mission and boundaries                  |
| Q2  | Safeguarding reports are the most sensitive records on the platform. Is it acceptable for an AI model to read them ("sees customer content: yes", context ceiling "restricted") to screen urgency, under what lawful basis, and with what consent or notice to the organization? Should the answer be no for some report types?                                        | Warden model policy                            |
| Q3  | Does an automated urgency screen need to be disclosed to the people it concerns, and must a human review every screening outcome? Warden's target is 95 percent agreement with the designated lead; is that an acceptable standard?                                                                                                                                    | Warden SLOs                                    |
| Q4  | Please supply or approve the templates for the three outward notices: safeguarding lead notification, legal notice, data-protection notice. Until approved, those capabilities stay disabled.                                                                                                                                                                          | T2 capabilities in 2.3                         |
| Q5  | Repo says a controller must notify the NDPC within 72 hours of becoming aware of a breach likely to risk data subjects, counted from `detected_at`. Confirm the rule, the trigger for "becoming aware", whether Sherivs is controller or processor for each tenant, and whether the 72-hour clock should start at detection by an agent or only at human confirmation. | Themis breach assessment, `security_incidents` |
| Q6  | Owner alerts go over SMS, WhatsApp and email, which are less secure than the console. Confirm that titles limited to a severity and a category (no names or case details) keep personal data out of these channels, and whether any further wording or retention rule is needed for alert history.                                                                     | 2.4                                            |
| Q7  | The voice call and message say they cannot approve anything. Is that sufficient to prevent a spoofed message from being mistaken for authority, or should alerts carry additional wording against social-engineering?                                                                                                                                                  | 2.4                                            |
| Q8  | Themis may read an organization's records only under a time-boxed grant. Is a grant of up to 120 minutes (maximum 240 in the database) and a record of the human who approved it adequate for the purpose of assessing a data-subject request?                                                                                                                         | Themis boundary 2                              |
| Q9  | Brief "drafts, flags and refers" and "never gives legal advice". Is that wording enough, or must drafts carry a visible notice that they are not legal advice and are unreviewed?                                                                                                                                                                                      | Brief mission and boundary 2                   |
| Q10 | Retention: how long may alert history, approval events and delivery records be kept, and when must they be erased (`docs/compliance/retention-schedule.md` does not yet cover them)?                                                                                                                                                                                   | alert tables                                   |
| Q11 | Cross-border processing: BulkSMS (SMS), Africa's Talking (voice), WhatsApp Cloud and Resend (email) process the owner's number and the alert text outside Nigeria. Is a notice, contract term or transfer mechanism required?                                                                                                                                          | all alert channels                             |

## 5. How to review

1. Read sections 2.1 to 2.4 against the source file named in each row.
2. Answer Q1 to Q11, marking each: agreed, agreed with changes, or not agreed.
3. For wording that must change, give replacement text. The change is then made in the single source file; tests fail loudly if a wording change breaks a guarantee in section 3.
4. Complete the sign-off block.

## 6. Sign-off

Nothing above is approved until this block is completed by counsel. An agent must not fill it in.

| Field                                   | Entry                                           |
| --------------------------------------- | ----------------------------------------------- |
| Reviewing counsel (name and bar number) |                                                 |
| Firm                                    |                                                 |
| Date of review                          |                                                 |
| Scope reviewed                          | Sections 2.1 to 2.4 and questions Q1 to Q11     |
| Outcome                                 | Approved / Approved with changes / Not approved |
| Conditions                              |                                                 |
| Signature                               |                                                 |
