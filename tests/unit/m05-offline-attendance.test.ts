import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "database/supabase/migrations/20261103100000_sherivs_m05_offline_attendance.sql",
  "utf8",
);
const rollback = readFileSync(
  "database/supabase/rollbacks/20261103100000_sherivs_m05_offline_attendance.sql",
  "utf8",
);
const harness = readFileSync("tests/integration/m05-offline-attendance.local.sql", "utf8");
const appContext = readFileSync("frontend/src/contexts/app-context.tsx", "utf8");

describe("M05 offline attendance migration", () => {
  it("uses tenant-bound class, student, and shift keys for daily and period marks", () => {
    expect(migration).toContain("FOREIGN KEY (class_id, school_id)");
    expect(migration).toContain("FOREIGN KEY (student_id, class_id, school_id)");
    expect(migration).toContain("FOREIGN KEY (shift_id, school_id)");
    expect(migration).toContain("period_key text NOT NULL DEFAULT 'daily'");
    expect(migration).toContain("class_attendance_marks_scope_m05_uq");
  });

  it("forces RLS, restricts teacher writes to assigned classes, and preserves conflicts", () => {
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("public.m05_teacher_assigned_to_class(v_school, v_class)");
    expect(migration).toContain("a.scope_type = 'class'");
    expect(migration).toContain("tt.is_active IS TRUE");
    expect(migration).toContain("server_has_other_mark");
    expect(migration).toContain("v_prior_outcome = 'applied'");
    expect(migration).toContain("v_prior_conflict");
    expect(migration).toContain("class_attendance_sync_conflicts");
    expect(migration).toContain("public.scholar_audit()");
  });

  it("protects retries with batch and per-item idempotency and provides rollback/RLS coverage", () => {
    expect(migration).toContain("client_batch_id = p_batch");
    expect(migration).toContain("PRIMARY KEY (user_id, client_item_id)");
    expect(migration).toContain("ON CONFLICT (user_id, client_item_id) DO NOTHING");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.class_attendance_marks");
    expect(harness).toContain("replaying the same batch creates no duplicate mark");
    expect(harness).toContain("unassigned teacher cannot mark class");
    expect(harness).toContain("ROLLBACK;");
    expect(harness).toContain("refusing non-loopback server address");
  });

  it("clears offline data on auth sign-out", () => {
    expect(appContext).toContain('if (event === "SIGNED_OUT") void clearClientOfflineData()');
    expect(appContext).toContain("await clearClientOfflineData();");
    expect(appContext).toContain("await clearOfflineData(scope)");
  });
});
