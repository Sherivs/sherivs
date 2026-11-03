import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "database/supabase/migrations/20261103000000_sv1_student_mobility_followup.sql",
  ),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "database/supabase/rollbacks/20261103000000_sv1_student_mobility_followup.sql",
  ),
  "utf8",
);

describe("SV1 mobility follow-up migration", () => {
  it("allocates term fees by placement service time without changing invoices", () => {
    expect(MIGRATION).toContain(
      "CREATE TABLE IF NOT EXISTS public.student_mobility_fee_allocations",
    );
    expect(MIGRATION).toContain("period_seconds bigint NOT NULL CHECK (period_seconds > 0)");
    expect(MIGRATION).toContain("academic_periods period");
    expect(MIGRATION).toContain("placement.effective_from < v_period_end");
    expect(MIGRATION).toContain("round(v_total_fee * v_service_seconds / v_period_seconds, 2)");
    expect(MIGRATION).toContain("student_mobility_fee_proration");
    expect(MIGRATION).not.toMatch(/UPDATE\s+public\.fees|INSERT\s+INTO\s+public\.fees/i);
  });

  it("keeps allocations tenant-scoped, forced-RLS, read-only, and fee-authorized", () => {
    expect(MIGRATION).toContain(
      "ALTER TABLE public.student_mobility_fee_allocations FORCE ROW LEVEL SECURITY",
    );
    expect(MIGRATION).toContain("REVOKE ALL ON public.student_mobility_fee_allocations");
    expect(MIGRATION).toContain("public.scholar_can(school_id, 'fees.view')");
    expect(MIGRATION).toContain("student_mobility_fee_allocations_append_only");
  });

  it("notifies only the same-tenant requester and configured approver roles", () => {
    expect(MIGRATION).toContain("public.student_mobility_notify_approvers");
    expect(MIGRATION).toContain("user_record.school_id = p_school");
    expect(MIGRATION).toContain("requester.school_id = NEW.school_id");
    expect(MIGRATION).toContain("NEW.effective_at IS DISTINCT FROM OLD.effective_at");
    expect(MIGRATION).toContain("Movement request rejected");
    expect(MIGRATION).toContain("Movement approval recorded");
    expect(MIGRATION).toContain("student_mobility_request_notification");
    expect(MIGRATION).toContain("student_mobility_approval_notification");
    expect(MIGRATION).toContain("only the requester may change the effective date");
    expect(MIGRATION).toContain("only a future, unapproved pending request may be rescheduled");
    expect(MIGRATION).toContain("student_mobility_reschedule");
  });

  it("does not grant client execution of internal trigger functions", () => {
    expect(MIGRATION).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(MIGRATION).toContain(
      "GRANT EXECUTE ON FUNCTION public.student_mobility_reschedule(uuid, timestamptz)",
    );
    expect(MIGRATION).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.(?:student_mobility_fee_proration|student_mobility_notify_approvers|student_mobility_request_notification|student_mobility_approval_notification)\(/,
    );
  });

  it("ships a same-version rollback for every introduced table, trigger, and function", () => {
    expect(MIGRATION).toMatch(/^BEGIN;/m);
    expect(MIGRATION).toMatch(/^COMMIT;/m);
    expect(ROLLBACK).toMatch(/^BEGIN;/m);
    expect(ROLLBACK).toMatch(/^COMMIT;/m);
    expect(ROLLBACK).toContain("-- Rollback for 20261103000000_sv1_student_mobility_followup.sql.");
    expect(MIGRATION).toContain(
      "CREATE TABLE IF NOT EXISTS public.student_mobility_fee_allocations",
    );
    expect(ROLLBACK).toContain("DROP TABLE IF EXISTS public.student_mobility_fee_allocations");

    for (const trigger of [
      "student_mobility_fee_allocations_append_only",
      "student_mobility_fee_proration",
      "student_mobility_request_notification",
      "student_mobility_approval_notification",
      "trg_student_mobility_fee_allocations_audit",
    ]) {
      expect(MIGRATION).toContain(`CREATE TRIGGER ${trigger}`);
      expect(ROLLBACK).toContain(`DROP TRIGGER IF EXISTS ${trigger}`);
    }

    for (const [fn, signature] of [
      ["student_mobility_append_only", ""],
      ["student_mobility_fee_proration", ""],
      ["student_mobility_notify_approvers", "uuid, uuid, text, text"],
      ["student_mobility_request_notification", ""],
      ["student_mobility_approval_notification", ""],
      ["student_mobility_reschedule", "uuid, timestamptz"],
    ]) {
      expect(MIGRATION).toContain(`FUNCTION public.${fn}(`);
      expect(ROLLBACK).toContain(`DROP FUNCTION IF EXISTS public.${fn}(${signature})`);
    }
  });
});
