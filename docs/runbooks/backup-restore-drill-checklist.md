# CHECKLIST — Restore the newest nightly backup into a scratch database and compare counts

Authority: SHERIVS MASTER EXECUTION PROMPT v1.0 §12.1 M23 ("restore drill evidence recorded"); AGENTS.md §§28, 29, 30, 42; `docs/runbooks/backup-off-github.md` step 7.
Origin: Claude Code agent, mission E-013 (M23 production hardening tooling)
Creator: Claude Code agent
Created: 2026-11-17

Status: AUTHORED, NOT EXECUTED. No drill has been run from this checklist. Every evidence slot is empty. The operator is a person with the backup passphrase. An agent must not handle the passphrase or the production connection string.

## What this proves

That the newest encrypted nightly dump (`nightly-db-backup.yml`, Cloudflare R2 `sherivs-db-backups`, key `prod/YYYY/MM/DD/sherivs-prod-<stamp>.dump.gpg`) decrypts, restores into an EMPTY scratch Postgres, and holds the same tables with row counts matching production at dump time (within the writes made since the dump).

## Rules

- Restore only into a scratch database on your own machine or a disposable container. NEVER into production or staging.
- Never paste the passphrase or a connection string into a file, ticket, chat or this document.
- Delete the plaintext dump and the scratch database at the end (step 9).

## Steps (copy-ready, bash)

1. **Tools.** Postgres 17 client and server, gpg, AWS CLI v2.
   ```bash
   pg_restore --version && gpg --version | head -1 && aws --version
   ```
2. **Work folder.**
   ```bash
   umask 077; WORK="$(mktemp -d)"; cd "$WORK"
   ```
3. **Find and download the newest object** (read-only R2 credentials in the environment, typed by you, not saved):
   ```bash
   export AWS_DEFAULT_REGION=auto AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED AWS_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED
   ENDPOINT="https://${R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com"
   KEY="$(aws s3api list-objects-v2 --bucket sherivs-db-backups --prefix prod/ --endpoint-url "$ENDPOINT" \
     --query 'reverse(sort_by(Contents || `[]`, &LastModified))[0].Key' --output text)"
   echo "$KEY"
   aws s3 cp "s3://sherivs-db-backups/$KEY" backup.dump.gpg --endpoint-url "$ENDPOINT" --only-show-errors
   sha256sum backup.dump.gpg
   ```
   If R2 is not reachable, use the newest `sherivs-prod-db-*` artifact of the latest green `nightly-db-backup` run (7-day retention).
4. **Decrypt** (gpg prompts for the passphrase, so nothing is echoed or stored):
   ```bash
   gpg --decrypt --output backup.dump backup.dump.gpg
   pg_restore --list backup.dump | awk '$4=="TABLE" && $5!="DATA"' | wc -l
   ```
5. **Scratch database** (a disposable local container):
   ```bash
   docker run -d --name sherivs-restore-drill -e POSTGRES_PASSWORD=drill -p 55432:5432 postgres:17
   sleep 5
   export PGHOST=127.0.0.1 PGPORT=55432 PGUSER=postgres PGPASSWORD=drill
   createdb restore_drill
   # Supabase roles the dump may reference; created empty, no login.
   for r in anon authenticated service_role supabase_admin authenticator; do
     psql -d restore_drill -qc "DO \$\$BEGIN CREATE ROLE $r NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END\$\$;"
   done
   ```
6. **Restore** (the dump was taken with `--no-owner --no-privileges`; schemas public, auth, storage):
   ```bash
   pg_restore --dbname=restore_drill --no-owner --no-privileges --exit-on-error=false backup.dump 2> restore-errors.txt
   wc -l restore-errors.txt
   ```
   Errors about extensions or Supabase-only objects are expected. Record the count and every distinct error kind in the evidence.
7. **Counts in the scratch database:**
   ```bash
   psql -d restore_drill -At -F $'\t' > restored-counts.tsv <<'SQL'
   SELECT format('%I.%I', table_schema, table_name),
          (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint
     FROM information_schema.tables
    WHERE table_schema IN ('public','auth','storage') AND table_type = 'BASE TABLE'
    ORDER BY 1;
   SQL
   wc -l restored-counts.tsv
   ```
8. **The same counts on production, read-only**, run by the founder or the orchestrator (an agent may only run read-only `SELECT`). Use the SQL from step 7 in a session started with `SET default_transaction_read_only = on`, save it as `production-counts.tsv`, then:
   ```bash
   join -t $'\t' -a1 -a2 -e MISSING -o 0,1.2,2.2 restored-counts.tsv production-counts.tsv \
     | awk -F'\t' '$2!=$3 {print}' > count-differences.tsv
   wc -l count-differences.tsv
   ```
   A table that is MISSING on either side fails the drill. A count difference is acceptable only for tables written since the dump's stamp. List each one with its reason.
9. **Clean up:**
   ```bash
   docker rm -f sherivs-restore-drill
   shred -u backup.dump 2>/dev/null || rm -f backup.dump
   rm -f backup.dump.gpg; cd /; rm -rf "$WORK"
   ```

## Evidence template (copy into the mission or drill record; no secrets)

| Field                                        | Value |
| -------------------------------------------- | ----- |
| Operator                                     |       |
| Date and time (Africa/Lagos)                 |       |
| R2 object key                                |       |
| Ciphertext SHA-256                           |       |
| Dump stamp (from the key)                    |       |
| Tables listed by `pg_restore --list`         |       |
| Restore error lines / distinct kinds         |       |
| Tables in scratch database                   |       |
| Tables in production                         |       |
| Tables MISSING on either side                |       |
| Tables with count differences (and reasons)  |       |
| Plaintext and scratch database deleted (y/n) |       |
| Time from download to verified counts (RTO)  |       |
| Verdict (PASS / FAIL)                        |       |

PASS needs: decrypt OK, every production table present after restore, every count difference explained, and cleanup done.
