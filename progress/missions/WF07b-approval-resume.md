# WF-07b approved approval-step resume

Status: draft PR, not applied anywhere.
Built: migration 20261128000200 (wf_claim_approved_steps, wf_approver_holds_role) and rollback, runtime resume path (resumeApprovedStep, tick phase, in-memory and Supabase ports), harness tests/integration/wf07-approval-resume.local.sql (WF07R ALL PASS: 18 checks), CI step, WF-12 default-privileges allowlist, 3 new unit tests, ADR-158.
Evidence: unit tests 14/14; harness passes; rollback removes both functions and re-apply passes again; WF-01, WF-03, WF-07, WF-08 and WF-12 privilege harnesses still pass on the combined chain.
Not built: the scheduler that calls the tick; draft-linked approvals (draft executor); a screen.
Tumi to check: hosted runs with an approved approval step already waiting (they resume on the first tick).
