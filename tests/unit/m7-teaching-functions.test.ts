/**
 * M7 (ADR-149) server-function handlers: each calls the right database function with arguments
 * derived from validated input only (never an organization id from the client), and surfaces
 * database refusals instead of swallowing them.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => {
  const chain = () => {
    const c = {
      middleware: () => c,
      validator: () => c,
      handler: (fn: unknown) => fn,
    };
    return c;
  };
  return { createServerFn: chain };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const { handlers } = await import("@/lib/runtime/scholar/teaching.functions");

type Call = { kind: string; name: string; args?: unknown; filters: [string, string, unknown][] };

function fakeDb(results: Record<string, unknown> = {}, error: string | null = null) {
  const calls: Call[] = [];
  const query = (call: Call, key: string) => {
    const resolved = () =>
      Promise.resolve({ data: results[key] ?? null, error: error ? { message: error } : null });
    const q: Record<string, unknown> = {
      eq: (c: string, v: unknown) => (call.filters.push(["eq", c, v]), q),
      in: (c: string, v: unknown) => (call.filters.push(["in", c, v]), q),
      order: () => q,
      limit: () => q,
      select: (cols: string) => (call.filters.push(["select", cols, null]), q),
      maybeSingle: resolved,
      single: resolved,
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => resolved().then(ok, bad),
    };
    return q;
  };
  return {
    calls,
    client: {
      rpc(name: string, args?: unknown) {
        const call = { kind: "rpc", name, args, filters: [] };
        calls.push(call);
        return query(call, `rpc:${name}`);
      },
      from(table: string) {
        const make = (kind: string) => (args?: unknown) => {
          const call = { kind, name: table, args, filters: [] };
          calls.push(call);
          return query(call, `${kind}:${table}`);
        };
        return {
          select: (cols: string) => make("select")(cols),
          insert: make("insert"),
          update: make("update"),
        };
      },
    },
  };
}

describe("teaching server-function handlers", () => {
  it("reads classes, periods and the roster through the own-class database functions", async () => {
    const db = fakeDb({ "rpc:m7_my_classes": [{ class_id: "c1" }], "rpc:m7_class_roster": [] });
    expect(await handlers.myClasses(db.client)).toEqual([{ class_id: "c1" }]);
    await handlers.myPeriods(db.client, "monday");
    await handlers.classRoster(db.client, "c1");
    expect(db.calls.map((c) => [c.name, c.args])).toEqual([
      ["m7_my_classes", undefined],
      ["m7_my_periods", { p_day: "monday" }],
      ["m7_class_roster", { p_class: "c1" }],
    ]);
  });

  it("reads the day's daily marks for one class only (RLS does the own-class check)", async () => {
    const db = fakeDb({ "select:class_attendance_marks": [] });
    await handlers.classAttendance(db.client, "c1", "2026-11-18");
    expect(db.calls[0]!.filters).toContainEqual(["eq", "class_id", "c1"]);
    expect(db.calls[0]!.filters).toContainEqual(["eq", "attendance_date", "2026-11-18"]);
    expect(db.calls[0]!.filters).toContainEqual(["eq", "period_key", "daily"]);
  });

  it("sends a correction with its reason and client key", async () => {
    const db = fakeDb({
      "rpc:m7_correct_attendance": { replay: false, correction_id: "x", status: "absent" },
    });
    await handlers.correctAttendance(db.client, {
      mark_id: "m1",
      status: "absent",
      reason: "Marked present by mistake",
      client_key: "att-fix-1",
    });
    expect(db.calls[0]!.args).toEqual({
      p_mark: "m1",
      p_status: "absent",
      p_reason: "Marked present by mistake",
      p_client_key: "att-fix-1",
    });
  });

  it("surfaces a database refusal as an error", async () => {
    const db = fakeDb({}, "not allowed");
    await expect(handlers.classRoster(db.client, "c-other")).rejects.toThrow("not allowed");
  });

  it("loads the gradebook and parses the M06 weights", async () => {
    const db = fakeDb({
      "rpc:m7_class_gradebook": [{ student_id: "s1" }],
      "select:m06_result_weight_profiles": {
        subject: "Maths",
        term: "First",
        academic_year: "2026/2027",
        ca_weight: 40,
        terminal_weight: 60,
        terminal_max_score: 60,
        ca_components: [{ code: "t1", weight: 100, max_score: 10 }],
      },
    });
    const sheet = await handlers.gradebook(db.client, {
      class_id: "c1",
      subject: "Maths",
      term: "First",
      academic_year: "2026/2027",
    });
    expect(sheet.rows).toEqual([{ student_id: "s1" }]);
    expect(sheet.profile?.ca_components).toEqual([{ code: "t1", weight: 100, max_score: 10 }]);
    expect(db.calls[0]!.args).toEqual({
      p_class: "c1",
      p_subject: "Maths",
      p_term: "First",
      p_academic_year: "2026/2027",
    });
  });

  it("creates a lesson note as a draft of the caller, in the caller's organization", async () => {
    const db = fakeDb({ "rpc:get_my_school_id": "org-1", "insert:lesson_plans": { id: "lp1" } });
    expect(await handlers.saveLessonNote(db.client, "u1", { title: "Fractions" })).toEqual({
      id: "lp1",
    });
    const insert = db.calls.find((c) => c.kind === "insert")!;
    expect(insert.args).toMatchObject({
      school_id: "org-1",
      teacher_id: "u1",
      status: "draft",
      title: "Fractions",
    });
  });

  it("edits only the caller's own note", async () => {
    const db = fakeDb({ "update:lesson_plans": [] });
    await expect(
      handlers.saveLessonNote(db.client, "u1", { id: "lp-of-someone-else", title: "x" }),
    ).rejects.toThrow(/own draft/);
    expect(db.calls[0]!.filters).toContainEqual(["eq", "teacher_id", "u1"]);
  });

  it("submits and reviews through the SHERIVS-024 functions", async () => {
    const db = fakeDb({ "rpc:lesson_note_submit": "r1" });
    expect(await handlers.submitLessonNote(db.client, "lp1")).toBe("r1");
    await handlers.reviewLessonNote(db.client, { review_id: "r1", approve: true });
    expect(db.calls.map((c) => [c.name, c.args])).toEqual([
      ["lesson_note_submit", { p_plan: "lp1" }],
      ["lesson_note_review", { p_review: "r1", p_approve: true, p_comment: null }],
    ]);
  });

  it("refuses to return a note without a comment before calling the database", async () => {
    const db = fakeDb();
    await expect(
      handlers.reviewLessonNote(db.client, { review_id: "r1", approve: false, comment: "no" }),
    ).rejects.toThrow(/what to fix/);
    expect(db.calls).toHaveLength(0);
  });

  it("joins pending reviews to their notes", async () => {
    const db = fakeDb({
      "select:lesson_note_reviews": [
        {
          id: "r1",
          lesson_plan_id: "lp1",
          submitted_by: "u2",
          submitted_at: "2026-11-18T08:00:00Z",
        },
      ],
      "select:lesson_plans": [
        { id: "lp1", title: "Fractions", subject: "Maths", description: null },
      ],
    });
    expect(await handlers.pendingReviews(db.client)).toEqual([
      {
        review_id: "r1",
        lesson_plan_id: "lp1",
        submitted_by: "u2",
        submitted_at: "2026-11-18T08:00:00Z",
        title: "Fractions",
        subject: "Maths",
        description: null,
      },
    ]);
  });
});
