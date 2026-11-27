# WF-07 follow-up: in-app approver notification

Status: built (database), draft PR, NOT APPLIED.

- Migration `20261127000700_sherivs_wf07_approver_notification.sql`: `wf_approval_notify_scan(limit)` (service role only). For each pending, unexpired approval not yet notified, it writes one in-app notification per eligible approver (from `wf_approver_candidates`), keyed `wf-approval:<approval>:<user>`, so a repeat scan sends nothing. The message is fixed text ("A workflow step is waiting for your decision", high-risk variant) with a link to the inbox; no student, guardian, amount or step name.
- Harness: five checks added to `wf07-approval-inbox.local.sql` (103 pass); allowlist entry in `wf12-default-privileges.local.sql` (50 functions pass).
- Not built: the cron entry that calls the scan (needs Tumi); SMS and WhatsApp (held until the messaging reset); resuming a plain approval-kind step after its approval (only drafts continue today); reminders for approvals still pending after a day.
- Needs: founder approval and a backup before apply; Tumi's review.
