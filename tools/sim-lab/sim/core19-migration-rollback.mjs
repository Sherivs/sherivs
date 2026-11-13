import pg from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PGPORT || 54329);
const database = `core19_roundtrip_${process.pid}`;
const admin = new pg.Client({ host: "127.0.0.1", port, user: "postgres", database: "postgres" });
const migrationUrl = new URL(
  "../../../database/supabase/migrations/20261103143000_core19_notification_delivery.sql",
  import.meta.url,
);
const rollbackUrl = new URL(
  "../../../database/supabase/rollbacks/20261103143000_core19_notification_delivery.sql",
  import.meta.url,
);

await admin.connect();
try {
  const { rows } = await admin.query(
    "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')",
  );
  const roles = new Set(rows.map((row) => row.rolname));
  if (!roles.has("anon") || !roles.has("authenticated")) {
    throw new Error("Supabase bootstrap roles anon/authenticated are required for this simulation");
  }
  await admin.query(`CREATE DATABASE "${database}"`);
} finally {
  await admin.end();
}

const db = new pg.Client({ host: "127.0.0.1", port, user: "postgres", database });
try {
  await db.connect();
  await db.query(`
    CREATE TABLE public.notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL,
      user_id uuid NOT NULL
    );
    CREATE TABLE public.notification_preferences (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL
    );
    CREATE TABLE public.organization_memberships (
      user_id uuid NOT NULL,
      school_id uuid NOT NULL,
      is_active boolean NOT NULL
    );
    INSERT INTO public.organization_memberships
      (user_id, school_id, is_active)
    VALUES
      ('00000000-0000-4000-8000-000000000001',
       '00000000-0000-4000-8000-000000000002', true);
  `);
  await db.query(await readFile(fileURLToPath(migrationUrl), "utf8"));
  const indexAfterMigration = await db.query(
    "SELECT to_regclass('public.notifications_school_user_idempotency_key_uq') AS index_name",
  );
  if (!indexAfterMigration.rows[0].index_name) {
    throw new Error("CORE-19 unique index was not created by the migration");
  }
  await db.query(`
    INSERT INTO public.notifications (school_id, user_id, idempotency_key)
    VALUES ('00000000-0000-4000-8000-000000000002',
            '00000000-0000-4000-8000-000000000001', 'synthetic-roundtrip-key');
  `);
  await db.query(await readFile(fileURLToPath(rollbackUrl), "utf8"));
  const afterRollback = await db.query(`
    SELECT
      to_regclass('public.notifications_school_user_idempotency_key_uq') AS index_name,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'notifications'
          AND column_name = 'idempotency_key'
      ) AS has_idempotency_key,
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'core19_notification_membership_guard'
          AND NOT tgisinternal
      ) AS has_membership_trigger
  `);
  const state = afterRollback.rows[0];
  if (state.index_name || state.has_idempotency_key || state.has_membership_trigger) {
    throw new Error(
      `CORE-19 rollback did not restore the pre-migration structure: ${JSON.stringify(state)}`,
    );
  }
  console.log("CORE-19 migration and rollback round-trip passed on disposable PostgreSQL");
} finally {
  await db.end().catch(() => {});
  const cleanup = new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
  });
  await cleanup.connect();
  try {
    await cleanup.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  } finally {
    await cleanup.end();
  }
}
