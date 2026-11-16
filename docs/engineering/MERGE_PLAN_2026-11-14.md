# Merge plan for the open draft PRs (prepared 2026-11-13, for 2026-11-14)

Status: proposal. Nothing here has been merged, applied or deployed by the agent. Every merge is the owner's decision.

## 0. Before anything is merged

1. Fix the organization billing hold, then use "Re-run all checks" on every PR you intend to merge. Until then all evidence is local, and GitHub reports each PR as `unstable` because its checks cannot run. As of this writing GitHub reports every PR below as mergeable (no conflicts).
2. The migration job on PostgreSQL 17 is the authority for database changes. Local runs used PostgreSQL 16.
3. Stacked PRs: merge from the bottom up. After a base PR is merged, check that the next PR's base moved to `master` (or retarget it) and re-run its checks before merging it.

## 1. Already applied to production (at the owner's instruction on 2026-11-13)

| PR          | What                                     | Note                                                                                       |
| ----------- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| #349 FIN-01 | Wallet authorization and overdraft bound | Recorded in production as version `20261113082810`; the repo file is `20261104050000_...`. |
| #350 ENT-01 | Subscription authorization               | Recorded in production as version `20261113082843`; the repo file is `20261104051000_...`. |

These two need merging so the repository matches production. Check how the production migration history will line up with the repo file names (the versions differ) before anyone runs a migration tool against production. Do not re-apply them.

## 2. Suggested order

Independent of each other unless noted. Within a stack, bottom to top.

| Group                   | PRs (bottom to top)                                    | Migrations (version)                                           | Notes                                                                                           |
| ----------------------- | ------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Production-parity       | #349, #350                                             | 20261104050000, 20261104051000                                 | Already applied; merge first.                                                                   |
| Dependent on the above  | #351 COMMS-03                                          | 20261104052000                                                 | Not applied. SMS stays disabled. Needs FIN-01 and ENT-01 merged first.                          |
| Security and dependency | #355 SEC-02, #356 DEP-01                               | 20261104034500 (SEC-02)                                        | SEC-02 not applied; staging first. DEP-01 needs a preview check that error capture still works. |
| Retention               | #318 M12, then #352 M11                                | 20261104014000, 20261104014500                                 | M11 migration number is an open owner decision.                                                 |
| Results                 | #313 M06                                               | 20261104010000                                                 | #353 M14 (pilot metrics) was built on M06; confirm whether it needs #313 first.                 |
| Governance              | #315 M10                                               | 20261104012000                                                 | Neutrality baseline decision pending.                                                           |
| Other independent       | #308 CORE-19, #319, #324 scheduling, #353 M14, #354 UI | 20261103143000, 20261104015000, 20261104016000, 20261104017000 | #319 default-privilege policy is an open owner decision.                                        |
| Workspaces              | #310 B-1, #358 B-2, #359 B-3, #360 B-4, #361 B-5       | 20261103145000 (B-1), 20261103153000 (B-5)                     |                                                                                                 |
| JARVIS                  | #321, #362 to #366                                     | 20261103165000 (#362)                                          |                                                                                                 |
| TWIN                    | #320, #367 to #371                                     | 20261103154000 (#320)                                          |                                                                                                 |
| Reality                 | #336 R1, #372 R3, #373 R9                              | 20261105000100 (R3)                                            | R3 migration not applied; R9 has no migration.                                                  |
| Database clean-up       | #374 DB-12                                             | 20261105000200                                                 | Unapplied; independent of the other groups.                                                     |
| Reality (continued)     | #375 R20, #376 R23 (stacked on #373)                   | 20261105000300 (R20)                                           | R20 migration unapplied; R23 has no migration.                                                  |
| Proposal                | #377 SEC-03 default privileges                         | none (proposal file)                                           | Apply last, after all pending migrations; owner decision R-06.                                  |
| Docs                    | #357 audit register and this plan                      | none                                                           |                                                                                                 |

No two PRs use the same migration version. R3's version (20261105000100) is later than every other file in the repository.

## 3. Owner decisions that block or shape merges

1. Default-privileges policy (register R-06) before #319 and #355.
2. M11 migration number (013xxx range versus 014500).
3. Neutrality baseline additions (R-17); the agent's PRs were kept within the existing baseline.
4. Whether to apply the unapplied migrations (#351, #355, #315, #318, #352, #313, #324, #353, #372 and the stacks' migrations) and when; staging first.
5. Reality: reserved-prefix guard for the interview attestation (R-20) and catalog extension for the website sync (R-22).
6. Fate of #5 and #6 (Cursor drafts on an older base) and the Dependabot PRs (merge after CI works).

See `DECISIONS_2026-11-14.md` for the recommended option on each decision above, the M14 versus M06 check (no dependency; textual conflicts only) and the merge-day hazards.

## 4. After merging

- Delete merged branches only after confirming the next stacked PR has been retargeted.
- Update the audit register (#357) statuses.
- Re-run the production advisor snapshot read-only.

## 5. What this plan does not claim

- It does not claim any PR passes CI.
- It does not verify dependencies between independent PRs beyond mergeability against their bases; the order above is a suggestion.
- The production migration history was not queried for this plan.
