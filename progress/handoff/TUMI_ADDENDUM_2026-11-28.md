# Addendum for Tumi (read after the master prompt, 27 Nov 2026 and updated 27 Nov 21:00 Lagos)

Tumi's credits renew Monday 30 Nov 2026, 2:28pm Lagos. The founder sends this with `TUMI_MASTER_PROMPT_2026-11-27.md`. Nothing below was applied to a hosted database.

## 1. What happened while you were out
- **One combined merge.** PR #524 merged all open PRs into master as one validated change (merge commit `1cf981ef`). Conflicts were resolved by union, ADRs renumbered (master owns 112-114, 117-120; PR ADRs are 144-151; CS-01 is 152), provenance fixed. Audit: `progress/handoff/PR_AUDIT_2026-11-27.md`. 20 contained PRs and the stale rehearsal #464 were closed.
- **Five fixes the combination needed** (please review): WF-12 privilege list now includes `wf_fee_reminder_scan`; `wf_sensitive_step_up` now forces row security (new migration `20261117001010`); sim scenarios set `total_score` with score edits because M06 made it a stored column; AIN-02 e2e grants the A3 step-up before each promotion; formatting.
- **Still open, not in master:** #508-#511 (CD-01 to CD-05, two commits each) and #495 (UPD-01, Expo OTA). Review them and tell the founder whether they merge.
- **CS-01 (#523, draft):** class-scope approval defect. One resource-level check, `scholar_can_on`, for course approval, malpractice decision and scope-set add/remove. The assignment guard is unchanged. Sim-lab 300/300, baseline emptied. Review it, ADR-152, and the 5-hit neutrality baseline extension (needs the founder's approval). Known limit: department and faculty scope cannot be evaluated (no class-to-unit mapping); it fails closed. Design a mapping.
- **Ledger order flag:** master's `20261124*` migrations sort after the chain's `20261117*` ones. Decide how the hosted ledger handles that before any apply.
- **Vercel preview deploy fails on every PR** ("Hobby BLOCKED: commit author is not the team owner"). That is an account setting, not code. Tell the founder the fix.

## 2. Messaging stays held until you are back (reminders set earlier)
1. Ask the founder which BulkSMS company was contracted; set `SMS_PROVIDER`.
2. Delete the Twilio adapter after (1).
3. WhatsApp template submission to Meta (you own it; see master prompt Part 4).
4. Mapping CSV, SUP-01 and GRP-01 specs, SEC-01 inventory, gap register, PR-train review, backup and restore proof (master prompt Parts 2 and 3).

## 3. New instructions from the founder (27 Nov)
- **Whole ecosystem, all groups, not a pilot.** Do not wait for compliance or the DPO.
- **Multi-model, no vendor lock-in.** The founder chooses several AI models, each with a role. Review a provider-agnostic router port: one interface, per-role model assignment, fallback and cost cap per role, no model name hard-coded in business logic, every call logged. The port is built without real model calls; you review it and the founder picks the models.
- **Browser-agent testing before launch**, against the real app on a preview deployment, never at a real school. Needs the Vercel preview fixed (section 1).
- **Build order** (the builder works one mission at a time): A3 server code, A4, SUP-01, GRP-01 and the six group workflow events, AIN-06a/b/c, AIN-07, Track B (B7 to B23), Track C, institution packs, M9 part B and the M2b resolver, multi-model router, closure-register items.

## 4. Rules that do not change
Never apply to a hosted database without the founder's approval and a backup. Do not merge your own work. No claim without evidence.
