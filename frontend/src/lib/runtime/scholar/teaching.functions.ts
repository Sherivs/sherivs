/**
 * M7 academic core (ADR-149) server functions. Every read of a class goes through a database
 * function that enforces "a teacher sees only their own classes" (m7_* in
 * 20261117003200_sherivs_m7_academic_core.sql); attendance marks are read under the existing M05
 * policy. Writes use existing functions: M05 sync (attendance.functions.ts), M06 scores
 * (results.functions.ts), SHERIVS-024 lesson_note_submit / lesson_note_review, plus the new
 * audited m7_correct_attendance. The organization always comes from the caller's session.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SavedMark, RosterEntry } from "@/lib/scholar/teaching/attendance-sheet";
import {
  parseWeightProfile,
  type GradebookRow,
  type WeightProfile,
} from "@/lib/scholar/teaching/gradebook";
import type { LessonNote, PendingReview } from "@/lib/scholar/teaching/lesson-notes";
import type { ClassOption, Period } from "@/lib/scholar/teaching/today";

type DbError = { message: string } | null;
type Rows = { data: unknown; error: DbError };
type Filter = PromiseLike<Rows> & {
  eq(column: string, value: unknown): Filter;
  in(column: string, values: unknown[]): Filter;
  order(column: string, options?: { ascending: boolean }): Filter;
  limit(count: number): Filter;
  maybeSingle(): PromiseLike<Rows>;
  single(): PromiseLike<Rows>;
  select(columns: string): Filter;
};
export type TeachingDb = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<Rows>;
  from(table: string): {
    select(columns: string): Filter;
    insert(row: Record<string, unknown>): Filter;
    update(row: Record<string, unknown>): Filter;
  };
};

const db = (client: unknown) => client as TeachingDb;

async function unwrap<T>(query: PromiseLike<Rows>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as T;
}

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const scope = z.object({
  subject: z.string().trim().min(1).max(120),
  term: z.string().trim().min(1).max(48),
  academic_year: z.string().trim().min(4).max(32),
});

/* ------------------------------- handlers (exported for tests) ------------------------------ */

export const handlers = {
  myClasses: (client: unknown) => unwrap<ClassOption[]>(db(client).rpc("m7_my_classes")),

  myPeriods: (client: unknown, day: string) =>
    unwrap<Period[]>(db(client).rpc("m7_my_periods", { p_day: day })),

  classRoster: (client: unknown, classId: string) =>
    unwrap<RosterEntry[]>(db(client).rpc("m7_class_roster", { p_class: classId })),

  classAttendance: (client: unknown, classId: string, date: string) =>
    unwrap<SavedMark[]>(
      db(client)
        .from("class_attendance_marks")
        .select("id, student_id, status, attendance_date")
        .eq("class_id", classId)
        .eq("attendance_date", date)
        .eq("period_key", "daily"),
    ),

  correctAttendance: (
    client: unknown,
    input: { mark_id: string; status: string; reason: string; client_key: string },
  ) =>
    unwrap<{ replay: boolean; correction_id: string; status: string }>(
      db(client).rpc("m7_correct_attendance", {
        p_mark: input.mark_id,
        p_status: input.status,
        p_reason: input.reason,
        p_client_key: input.client_key,
      }),
    ),

  async gradebook(
    client: unknown,
    input: { class_id: string; subject: string; term: string; academic_year: string },
  ): Promise<{ rows: GradebookRow[]; profile: WeightProfile | null }> {
    const [rows, profile] = await Promise.all([
      unwrap<GradebookRow[]>(
        db(client).rpc("m7_class_gradebook", {
          p_class: input.class_id,
          p_subject: input.subject,
          p_term: input.term,
          p_academic_year: input.academic_year,
        }),
      ),
      unwrap<Record<string, unknown> | null>(
        db(client)
          .from("m06_result_weight_profiles")
          .select(
            "subject, term, academic_year, ca_weight, terminal_weight, terminal_max_score, ca_components",
          )
          .eq("subject", input.subject)
          .eq("term", input.term)
          .eq("academic_year", input.academic_year)
          .maybeSingle(),
      ),
    ]);
    return { rows: rows ?? [], profile: parseWeightProfile(profile) };
  },

  myLessonNotes: (client: unknown, userId: string) =>
    unwrap<LessonNote[]>(
      db(client)
        .from("lesson_plans")
        .select(
          "id, title, subject, class_id, topic, description, status, review_notes, teacher_id",
        )
        .eq("teacher_id", userId)
        .order("updated_at", { ascending: false })
        .limit(100),
    ),

  async saveLessonNote(
    client: unknown,
    userId: string,
    input: {
      id?: string;
      title: string;
      subject?: string | null;
      class_id?: string | null;
      topic?: string | null;
      description?: string | null;
    },
  ) {
    const fields = {
      title: input.title,
      subject: input.subject ?? null,
      class_id: input.class_id ?? null,
      topic: input.topic ?? null,
      description: input.description ?? null,
    };
    if (input.id) {
      const rows = await unwrap<{ id: string }[]>(
        db(client)
          .from("lesson_plans")
          .update(fields)
          .eq("id", input.id)
          .eq("teacher_id", userId)
          .select("id"),
      );
      if (!rows?.length) throw new Error("not allowed: you can only edit your own draft");
      return { id: rows[0]!.id };
    }
    const school = await unwrap<string | null>(db(client).rpc("get_my_school_id"));
    if (!school) throw new Error("not allowed");
    const row = await unwrap<{ id: string }>(
      db(client)
        .from("lesson_plans")
        .insert({ ...fields, school_id: school, teacher_id: userId, status: "draft" })
        .select("id")
        .single(),
    );
    return { id: row.id };
  },

  submitLessonNote: (client: unknown, planId: string) =>
    unwrap<string>(db(client).rpc("lesson_note_submit", { p_plan: planId })),

  async pendingReviews(client: unknown): Promise<PendingReview[]> {
    const reviews = await unwrap<
      { id: string; lesson_plan_id: string; submitted_by: string; submitted_at: string }[]
    >(
      db(client)
        .from("lesson_note_reviews")
        .select("id, lesson_plan_id, submitted_by, submitted_at")
        .eq("status", "submitted")
        .order("submitted_at", { ascending: true })
        .limit(100),
    );
    if (!reviews?.length) return [];
    const plans = await unwrap<
      { id: string; title: string; subject: string | null; description: string | null }[]
    >(
      db(client)
        .from("lesson_plans")
        .select("id, title, subject, description")
        .in(
          "id",
          reviews.map((r) => r.lesson_plan_id),
        ),
    );
    const byId = new Map((plans ?? []).map((p) => [p.id, p]));
    return reviews.map((r) => ({
      review_id: r.id,
      lesson_plan_id: r.lesson_plan_id,
      submitted_by: r.submitted_by,
      submitted_at: r.submitted_at,
      title: byId.get(r.lesson_plan_id)?.title ?? "Untitled",
      subject: byId.get(r.lesson_plan_id)?.subject ?? null,
      description: byId.get(r.lesson_plan_id)?.description ?? null,
    }));
  },

  async reviewLessonNote(
    client: unknown,
    input: { review_id: string; approve: boolean; comment?: string | null },
  ) {
    if (!input.approve && (input.comment ?? "").trim().length < 5) {
      throw new Error("say what to fix when returning a note");
    }
    await unwrap(
      db(client).rpc("lesson_note_review", {
        p_review: input.review_id,
        p_approve: input.approve,
        p_comment: input.comment ?? null,
      }),
    );
    return { ok: true };
  },
};

/* ------------------------------------ server functions ------------------------------------- */

export const getMyClasses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => handlers.myClasses(context.supabase));

export const getMyPeriods = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        day: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => handlers.myPeriods(context.supabase, data.day));

export const getClassRoster = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ class_id: uuid }).parse(input))
  .handler(async ({ data, context }) => handlers.classRoster(context.supabase, data.class_id));

export const getClassAttendance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ class_id: uuid, date: isoDate }).parse(input))
  .handler(async ({ data, context }) =>
    handlers.classAttendance(context.supabase, data.class_id, data.date),
  );

export const correctAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        mark_id: uuid,
        status: z.enum(["present", "absent", "late", "excused"]),
        reason: z.string().trim().min(8).max(1000),
        client_key: z.string().trim().min(8).max(160),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => handlers.correctAttendance(context.supabase, data));

export const getGradebook = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => scope.extend({ class_id: uuid }).parse(input))
  .handler(async ({ data, context }) => handlers.gradebook(context.supabase, data));

export const getMyLessonNotes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => handlers.myLessonNotes(context.supabase, context.userId));

export const saveLessonNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        id: uuid.optional(),
        title: z.string().trim().min(1).max(200),
        subject: z.string().trim().max(120).nullable().optional(),
        class_id: uuid.nullable().optional(),
        topic: z.string().trim().max(200).nullable().optional(),
        description: z.string().max(20000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) =>
    handlers.saveLessonNote(context.supabase, context.userId, data),
  );

export const submitLessonNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ plan_id: uuid }).parse(input))
  .handler(async ({ data, context }) => ({
    review_id: await handlers.submitLessonNote(context.supabase, data.plan_id),
  }));

export const getPendingLessonNoteReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => handlers.pendingReviews(context.supabase));

export const reviewLessonNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        review_id: uuid,
        approve: z.boolean(),
        comment: z.string().trim().max(2000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => handlers.reviewLessonNote(context.supabase, data));
