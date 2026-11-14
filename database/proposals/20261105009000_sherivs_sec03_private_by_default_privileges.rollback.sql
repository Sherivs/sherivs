-- Rollback for the SEC-03 proposal. It restores the audited production default privileges.
-- Running it makes every NEW object in schema public readable and writable by anon and
-- authenticated again unless a migration revokes it. Existing objects are unaffected either way.
-- MAINTAIN exists from PostgreSQL 17 (production); older servers omit it.
DO $sec03_rb$
BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER%s ON TABLES TO anon, authenticated',
    CASE WHEN current_setting('server_version_num')::int >= 170000 THEN ', MAINTAIN' ELSE '' END);
END
$sec03_rb$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO anon, authenticated;
