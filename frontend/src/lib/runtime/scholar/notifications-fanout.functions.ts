/**
 * Notification fan-out helpers.
 *
 * These are admin/principal-callable server fns that create rows in
 * `notifications` for a set of users derived from a domain event. They are
 * use a database uniqueness key so retries do not duplicate in-app rows.
 * External delivery remains disabled for this V1 path.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { writeAuditRecord } from "@/lib/server/write-audit";
import type { Database } from "@/integrations/supabase/types";
import {
  shouldDeliverInAppNotification,
  type NotificationPreferenceCategory,
  type NotificationPreferences,
} from "@/lib/notifications/delivery-policy";
import { SystemClock, TimeAuthority } from "../../kernel/time-authority";

type NotificationInsert = Database["public"]["Tables"]["notifications"]["Insert"];

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/**
 * Filter target user_ids based on per-user notification_preferences.
 * Preference reads use the service client only after the caller has resolved
 * and authorized the school scope. Missing rows retain the existing opt-in default.
 */
async function filterByPrefs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase client param; server-side helper boundary (pre-existing shape).
  supabase: any,
  schoolId: string,
  userIds: string[],
  category: NotificationPreferenceCategory,
  notificationType: string,
): Promise<string[]> {
  const candidates = Array.from(new Set(userIds.filter(Boolean)));
  if (!candidates.length) return [];

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: recipients, error: recipientError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("school_id", schoolId)
    .eq("is_active", true)
    .in("id", candidates);
  if (recipientError) throw new Error(recipientError.message);
  const scopedIds = new Set((recipients ?? []).map((row) => row.id as string));
  const targetIds = candidates.filter((id) => scopedIds.has(id));
  if (!targetIds.length) return [];

  const { data, error } = await supabaseAdmin
    .from("notification_preferences")
    .select(`user_id, inapp_${category}, quiet_hours_start, quiet_hours_end`)
    .eq("school_id", schoolId)
    .in("user_id", targetIds);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<NotificationPreferences & { user_id: string }>;
  const prefMap = new Map(rows.map((r) => [r.user_id, r]));

  const now = new Date(timeAuthority.now().atMs);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  return targetIds.filter((uid) =>
    shouldDeliverInAppNotification(notificationType, category, prefMap.get(uid), nowMin),
  );
}

async function createNotificationIdempotencyKey(kind: string, sourceKey: string): Promise<string> {
  const { createNotificationIdempotencyKey: createKey } =
    await import("@/lib/notifications/delivery-key.server");
  return createKey(kind, sourceKey);
}

async function insertNotificationRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder boundary.
  supabase: any,
  schoolId: string,
  actorId: string,
  action: string,
  rows: NotificationInsert[],
): Promise<number> {
  let inserted = 0;
  if (rows.length) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("notifications")
      .upsert(rows, {
        onConflict: "school_id,user_id,idempotency_key",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) throw new Error(error.message);
    inserted = (data ?? []).length;
  }

  await writeAuditRecord(supabase, {
    action,
    gate: "requireSchoolAdminScope",
    tenantId: schoolId,
    actorId,
    table: "notifications",
    outcome: "succeeded",
    details: { attempted: rows.length, inserted },
  });
  return inserted;
}

// ---------------- Grades published ----------------

const GradesInput = z.object({
  class_id: z.string().uuid(),
  term: z.string().min(1).max(40),
  academic_year: z.string().min(1).max(20),
});

export const notifyGradesPublished = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => GradesInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    // Canonical Phase 08 school-admin gate (fail closed). Replaces the legacy
    // inline users.role admin/principal read + check.
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(supabase, {
      lifecycle: null,
      sessionValid: typeof claims?.exp === "number" && tokenMsRemaining(claims.exp) > 0,
    });

    const { data: students, error: studentsError } = await supabase
      .from("students")
      .select("id, user_id")
      .eq("school_id", schoolId)
      .eq("class_id", data.class_id)
      .eq("is_active", true);
    if (studentsError) throw new Error(studentsError.message);
    const sList = (students ?? []) as { id: string; user_id: string | null }[];
    const studentUids = sList.map((s) => s.user_id).filter((u): u is string => !!u);
    const sids = sList.map((s) => s.id);

    let parentUids: string[] = [];
    if (sids.length) {
      const { data: pm, error: parentMapError } = await supabase
        .from("parent_student_map")
        .select("student_id, parent_id")
        .in("student_id", sids);
      if (parentMapError) throw new Error(parentMapError.message);
      parentUids = Array.from(new Set((pm ?? []).map((r) => r.parent_id as string)));
    }

    const rawTargets = Array.from(new Set([...studentUids, ...parentUids]));
    const targets = await filterByPrefs(
      supabase,
      schoolId,
      rawTargets,
      "grades",
      "grades_published",
    );

    const title = `Report card published — ${data.term} term ${data.academic_year}`;
    const idempotencyKey = await createNotificationIdempotencyKey(
      "grades_published",
      `${data.class_id}\u0000${data.term}\u0000${data.academic_year}`,
    );
    const rows = targets.map((uid) => ({
      school_id: schoolId,
      user_id: uid,
      idempotency_key: idempotencyKey,
      title,
      message: "Your latest grades are now available to view.",
      type: "grades_published",
      action_url: "/report-card",
      is_read: false,
    }));
    const notified = await insertNotificationRows(
      supabase,
      schoolId,
      userId,
      "notifications.grades_published.fanout",
      rows,
    );
    return { notified };
  });

// ---------------- Fees due reminder ----------------

const FeesInput = z.object({
  class_id: z.string().uuid().optional(),
  days_until_due: z.number().int().min(0).max(60).default(7),
});

export const notifyFeesDue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => FeesInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    // Canonical Phase 08 school-admin gate (fail closed). Replaces the legacy
    // inline users.role admin/principal read + check.
    // Lifecycle threading: see notifyGradesPublished for the signal semantics.
    const schoolId = await requireSchoolAdminScope(supabase, {
      lifecycle: null,
      sessionValid: typeof claims?.exp === "number" && tokenMsRemaining(claims.exp) > 0,
    });

    const cutoff = new Date(timeAuthority.now().atMs + data.days_until_due * 86400_000)
      .toISOString()
      .slice(0, 10);

    const q = supabase
      .from("fees")
      .select("id, student_id, due_date, status, amount")
      .eq("school_id", schoolId)
      .neq("status", "paid")
      .lte("due_date", cutoff);
    const { data: fees, error: feesError } = await q;
    if (feesError) throw new Error(feesError.message);
    let due = (fees ?? []) as { id: string; student_id: string }[];

    if (data.class_id) {
      const { data: students, error: studentsError } = await supabase
        .from("students")
        .select("id")
        .eq("school_id", schoolId)
        .eq("class_id", data.class_id);
      if (studentsError) throw new Error(studentsError.message);
      const allow = new Set((students ?? []).map((s) => s.id as string));
      due = due.filter((f) => allow.has(f.student_id));
    }

    const sids = Array.from(new Set(due.map((f) => f.student_id)));
    if (!sids.length) return { notified: 0 };

    const { data: pm, error: parentMapError } = await supabase
      .from("parent_student_map")
      .select("student_id, parent_id")
      .in("student_id", sids);
    if (parentMapError) throw new Error(parentMapError.message);
    const rawParents = Array.from(new Set((pm ?? []).map((r) => r.parent_id as string)));
    const parents = await filterByPrefs(supabase, schoolId, rawParents, "fees", "fees_due");

    const feeIdsByStudent = new Map<string, string[]>();
    for (const fee of due) {
      const ids = feeIdsByStudent.get(fee.student_id) ?? [];
      ids.push(fee.id);
      feeIdsByStudent.set(fee.student_id, ids);
    }
    const feeIdsByParent = new Map<string, string[]>();
    for (const row of pm ?? []) {
      const ids = feeIdsByParent.get(row.parent_id as string) ?? [];
      ids.push(...(feeIdsByStudent.get(row.student_id as string) ?? []));
      feeIdsByParent.set(row.parent_id as string, ids);
    }
    const rows = await Promise.all(
      parents.map(async (uid) => ({
        school_id: schoolId,
        user_id: uid,
        idempotency_key: await createNotificationIdempotencyKey(
          "fees_due",
          `${cutoff}\u0000${data.class_id ?? "all"}\u0000${(feeIdsByParent.get(uid) ?? []).sort().join(",")}`,
        ),
        title: "Outstanding school fees",
        message: `You have unpaid invoices due within ${data.days_until_due} day(s). Please review.`,
        type: "fees_due",
        action_url: "/parent/fees",
        is_read: false,
      })),
    );
    const notified = await insertNotificationRows(
      supabase,
      schoolId,
      userId,
      "notifications.fees_due.fanout",
      rows,
    );
    return { notified };
  });

// ---------------- Generic announcement push ----------------

const PushInput = z.object({
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(2000),
  audience: z.enum(["all", "parents", "teachers", "students"]),
  action_url: z.string().max(200).optional(),
  event_id: z.string().uuid().optional(),
});

export const pushNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => PushInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    // Canonical Phase 08 school-admin gate (fail closed). Replaces the legacy
    // inline users.role admin/principal read + check.
    // Lifecycle threading: see notifyGradesPublished for the signal semantics.
    const schoolId = await requireSchoolAdminScope(supabase, {
      lifecycle: null,
      sessionValid: typeof claims?.exp === "number" && tokenMsRemaining(claims.exp) > 0,
    });

    let q = supabase.from("users").select("id").eq("school_id", schoolId).eq("is_active", true);
    if (data.audience === "parents") q = q.eq("role", "parent");
    else if (data.audience === "teachers") q = q.eq("role", "teacher");
    else if (data.audience === "students") q = q.eq("role", "student");
    const { data: users, error: usersError } = await q;
    if (usersError) throw new Error(usersError.message);
    const rawIds = (users ?? []).map((u) => u.id as string).filter((id) => id !== userId);
    const ids = await filterByPrefs(supabase, schoolId, rawIds, "announcements", "announcement");

    const idempotencyKey = await createNotificationIdempotencyKey(
      "announcement",
      data.event_id ??
        JSON.stringify([data.title, data.message, data.audience, data.action_url ?? null]),
    );
    const rows = ids.map((uid) => ({
      school_id: schoolId,
      user_id: uid,
      idempotency_key: idempotencyKey,
      title: data.title,
      message: data.message,
      type: "announcement",
      action_url: data.action_url ?? "/home/notifications",
      is_read: false,
    }));
    const notified = await insertNotificationRows(
      supabase,
      schoolId,
      userId,
      "notifications.announcement.fanout",
      rows,
    );
    return { notified };
  });

// ---------------- Calendar event published ----------------

const CalendarInput = z.object({
  event_id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  start_date: z.string().min(8),
  event_type: z.string().nullable().optional(),
  target_audience: z.enum(["all", "parents", "teachers", "students"]).default("all"),
});

export const notifyCalendarEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => CalendarInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    // Canonical Phase 08 school-admin gate (fail closed). Replaces the legacy
    // inline users.role admin/principal read + check.
    // Lifecycle threading: see notifyGradesPublished for the signal semantics.
    const schoolId = await requireSchoolAdminScope(supabase, {
      lifecycle: null,
      sessionValid: typeof claims?.exp === "number" && tokenMsRemaining(claims.exp) > 0,
    });

    let q = supabase
      .from("users")
      .select("id, role")
      .eq("school_id", schoolId)
      .eq("is_active", true);
    if (data.target_audience === "parents") q = q.eq("role", "parent");
    else if (data.target_audience === "teachers") q = q.eq("role", "teacher");
    else if (data.target_audience === "students") q = q.eq("role", "student");
    else q = q.in("role", ["parent", "teacher", "student"]);

    const { data: users, error: usersError } = await q;
    if (usersError) throw new Error(usersError.message);
    const raw = (users ?? []).map((u: { id: string }) => u.id).filter((id) => id !== userId);
    const targets = await filterByPrefs(supabase, schoolId, raw, "announcements", "calendar_event");

    const idempotencyKey = await createNotificationIdempotencyKey("calendar_event", data.event_id);
    const typeLabel = data.event_type ? data.event_type.replace(/_/g, " ") : "event";
    const rows = targets.map((uid) => ({
      school_id: schoolId,
      user_id: uid,
      idempotency_key: idempotencyKey,
      title: `New ${typeLabel}: ${data.title}`,
      message: `Scheduled for ${data.start_date}. Open the calendar for details.`,
      type: "calendar_event",
      action_url: "/home/notifications",
      is_read: false,
    }));
    const notified = await insertNotificationRows(
      supabase,
      schoolId,
      userId,
      "notifications.calendar_event.fanout",
      rows,
    );
    return { notified };
  });

// ---------------- Face lockout admin unlock ----------------

const UnlockInput = z.object({ userId: z.string().uuid() });

export const unlockFaceAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => UnlockInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, claims } = context;
    // Canonical Phase 08 school-admin gate (fail closed). Replaces the legacy
    // inline users.role admin/principal read + check.
    // Lifecycle threading: see notifyGradesPublished for the signal semantics.
    const schoolId = await requireSchoolAdminScope(supabase, {
      lifecycle: null,
      sessionValid: typeof claims?.exp === "number" && tokenMsRemaining(claims.exp) > 0,
    });

    const { data: target, error: tErr } = await supabase
      .from("users")
      .select("id, school_id")
      .eq("id", data.userId)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    if (!target || target.school_id !== schoolId) throw new Error("Not found");

    const { error } = await supabase
      .from("users")
      .update({
        is_face_locked: false,
        face_attempt_count: 0,
        face_locked_at: null,
      })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
