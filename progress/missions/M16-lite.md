# Mission M16 (SV1-LITE part): Safe and visible offline layer (web app)

Authority: SHERIVS MASTER EXECUTION PROMPT v1.0 (16 Nov 2026), §5.1 item 5, §12.1 M16, §13.1 "Nigeria-first performance"; docs/v1/V1-GAP-REPORT.md LITE-01 to LITE-05.
Origin: Claude Code agent, mission E-012 (M16 SV1-LITE offline layer)
Creator: Claude Code agent
Created: 2026-11-17

Status: IMPLEMENTED and unit-TESTED on branch `mission/M16-lite-offline`; not merged. No migration. Web app only (not `mobile/`).
Active persona: Frontend Platform Engineer, with the Security Engineer for the wipe rule.

## What each LITE item asks for, and what already existed

| Item    | Asks for (gap report)                                                    | Existed before this mission                                                                                                                                                            | This mission                                                                                                                                              |
| ------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LITE-01 | App-shell cache and offline reads for the four requested user data types | `public/sw.js` caches only the public root `/` (`sherivs-app-shell-v1`), authenticated routes network-only; scoped offline reads via `readThrough` (workspace manifest, notifications) | Shell cache name versioned by prefix, older versions deleted on activate, all versions deleted on sign-out. No new caching strategy; no new offline reads |
| LITE-02 | IndexedDB outbox with idempotent sync and conflict rules                 | Scoped store with attendance/score mutations, attendance queue with server batch idempotency                                                                                           | Generic outbox (`outbox.ts`) on the same store: idempotency keys, ordered drain, states, bounded retry with backoff, server-wins conflict rule            |
| LITE-03 | Route-level Data Saver controls and JS budget                            | Data Saver toggle (per scope, localStorage) that lazy-loads images and stops autoplay video                                                                                            | `data-saver.ts` + `useDataSaver` hook + `DataSaverGate` wrapper; applied to the two avatar images in the shell; toggle target 44 px                       |
| LITE-04 | Offline/online indicator and sync-queue UI                               | Online/Offline/Syncing label, pending and conflict counts, `role="status"` polite                                                                                                      | Adds outbox counts, last successful sync time (Africa/Lagos, time authority), failures with reason, Retry and Remove actions, 44 px targets               |
| LITE-05 | Tenant-local wipe on logout and role switch; Slow 3G verification        | Sign-out wiped all offline data silently (unsent work included); admin-forced role change wiped previous scope silently; the person-initiated switch in the shell wiped nothing        | Guard before sign-out and switch (send now or discard, count shown); previous scope wiped after a switch; forced wipes leave a count-only notice          |

## Files

- `frontend/src/lib/offline/outbox.ts` (new), `context-exit.ts` (new), `data-saver.ts` (new)
- `frontend/src/lib/offline/indexeddb-store.ts`: row union type, legacy filter, exported browser database, `readAllMutations`, `markSynced`, last-sync record id
- `frontend/src/lib/offline/attendance-queue.ts`: records last sync after a successful flush (one guarded call)
- `frontend/src/components/app-shell/connection-status.tsx` (indicator), `offline-controls.tsx` (new: hook, wrapper, exit guard)
- Minimal hooks: `app-shell.tsx` (sign-out button and `switchContext` go through the guard; previous scope wiped after a switch; two avatars under Data Saver), `app-context.tsx` (`clearClientOfflineData` lazily records the forced-wipe count and clears shell caches on full wipe), `app-shell.css` (44 px targets), `public/sw.js` (versioned cache cleanup)
- `tests/unit/sv1-lite-outbox.test.ts`, `architecture/adr/ADR-109_SV1_LITE_OUTBOX_CONTEXT_TAGGING_AND_WIPE.md`, INDEX row

## Report

See the pull request body for evidence. Not done: no producer migrated onto the generic outbox (attendance keeps its own path); no Playwright offline run, screenshots or axe scan; no Slow 3G measurement; no chart exists in the workspace shell, so the chart form of the wrapper is unit-tested only through the shared hook.
