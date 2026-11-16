# Backups off GitHub: versioned, encrypted copies in S3

Authority: AGENTS.md §§28, 29, 31; SHERIVS MASTER EXECUTION PROMPT v1.0 §12.1 M0.
Origin: Claude Code agent, mission E-003 (M0 stabilise and secure)
Creator: Claude Code agent
Created: 2026-11-16

Status: PLAN. Not executed. No bucket, key, schedule or dump was created by this document. Executing it needs the founder's AWS access and the database connection string, which an agent must not handle.

## Why

The only backup job is a GitHub Actions workflow (`nightly-db-backup.yml`). Actions has not run since 12 Nov 2026, so the last good backup is 11 Nov 08:43 WAT, and its copies live only as GitHub artifacts for 90 days. The database plan has no point-in-time recovery. A bad change today cannot be undone from a backup.

## Target

| Part            | Choice                                                                                                                                      | Cost note                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Storage         | One private S3 bucket, versioning on, all public access blocked, default encryption, lifecycle: 35 daily copies, then monthly for 12 months | Small dumps; expected to stay within or near the free tier. Check the bill after the first month |
| Encryption      | The dump is encrypted before upload with the existing backup key (the workflow already uses gpg). Only ciphertext leaves the machine        | none                                                                                             |
| Write access    | One IAM identity that may only `PutObject` to this bucket. It cannot read, list or delete                                                   | none                                                                                             |
| Read access     | A separate identity for restore drills, used by a person                                                                                    | none                                                                                             |
| Freshness alert | An alarm when no new object has arrived for 26 hours                                                                                        | CloudWatch free tier                                                                             |

## Steps (owner or orchestrator, in order)

1. **Take one manual backup now**, before anything else: from a trusted computer run the same `pg_dump` command the workflow uses (`--serializable-deferrable --format=custom --no-owner --no-privileges`), encrypt it with gpg, and keep two copies in different places. Record the time and the file's SHA-256.
2. Create the bucket in the same region family as the database (eu-west-1) with versioning, block-public-access and default encryption on.
3. Create the write-only identity and the restore identity. Store the write identity's credentials as repository secrets, never in code.
4. Add an upload step to `nightly-db-backup.yml` after the existing encryption step, keeping the artifact upload as a second copy. Pin the action by commit SHA as the workflow already does.
5. Until Actions billing is fixed, run step 1 by hand each day there is a production change.
6. Add the freshness alarm and send it to the owner-alert email.
7. **Restore drill**: restore the newest copy into the staging project following `docs/runbooks/restore-recovery.md`, compare table and row counts with production, and record the evidence. A backup that has never been restored is not yet a backup.

## Evidence to record

Bucket settings (versioning, public access block, encryption), the IAM policy text, one object listing with a timestamp, the alarm firing in a test, and the restore drill's counts.

## What stays true if this is not done

No migration is reversible beyond its own rollback file, and rollback files do not bring back data.
