# PSA-01b: Sherivs operator screen for platform share collections

Status: draft PR on top of #547 (PSA-01, ADR-162). Not applied anywhere; this change has no migration.

Why: PSA-01 gave the database the reports; nobody could read them without SQL. This is the Sherivs operator's view: per school and term, what accrued, how it was collected (online, wallet cash, wallet automatic, waived), what is overdue, which students paid at the school without the share being taken, and how far the school's wallet is from covering what is overdue.

Built: `frontend/src/lib/platform-share/operator-view.ts` (pure parsing, totals, attention ordering, naira formatting, error wording; no I/O), `frontend/src/components/app-shell/platform-share-screen.tsx` (reads `platform_share_collections` and `platform_share_student_list` through the existing client), card-registry key `platform-share` (a shell section, opened at /home/s/platform-share), unit tests `tests/unit/platform-share-operator-view.test.ts` (12) and the dispatch test entry.

Safety choices: read-only; no accrue, settle or waive buttons (money-moving actions stay as operator-run database functions or a schedule until the cron cadence is decided). The database refuses everyone who is not a platform operator, and the screen shows only a plain refusal for that case and a generic message for any other error, never the database text. Student rows show ids only, no names. Rows the screen cannot read are counted and reported, never guessed.

Evidence: vitest (view core 12, card-registry dispatch 8, card-registry coverage 9) pass; `tsc` shows only the one pre-existing unrelated error; neutrality and provenance guards pass.

Not built: a rendered-screen test (the dispatch test mocks the screen module, as for the other screens); school names (the report returns school ids; a name lookup needs a decision on what an operator may read about a school); an action to settle or waive from the screen; a link from any menu (the section is reached by URL).
