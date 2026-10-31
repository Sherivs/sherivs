/**
 * Notification fan-out helpers.
 *
 * These are admin/principal-callable server fns that create rows in
 * `notifications` for a set of users derived from a domain event. They are
 * intentionally idempotent at the row level (no dedup, the UI just shows
 * the newest entry) and are called after the originating action has
 * succeeded on the client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { SystemClock, TimeAuthority } from "../../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/**
 * Best-effort web-push ping after in-app notification rows are created.
 * Loaded lazily so the server-only push module never enters a client bundle,
 * and never allowed to fail the notification fan-out itself.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase client param; server-side helper boundary (pre-existing shape).
async function pushAfterInsert(supabase: any, userIds: string[]) {
  try {
    const { deliverPushToUsers } = await import("@/lib/push.server");
    await deliverPushToUsers(supabase, userIds);
  } catch {
    /* push is a side-channel — in-app notifications already succeeded */
  }
}

/**
 * Filter target user_ids based on per-user notification_preferences.
 * - Drops users with `inapp_<category>` = false.
 * - Drops users currently inside their quiet_hours window (suppresses both
 *   the in-app row and any email side-channel that would key off it).
 * Users with no preferences row are kept (defaults treated as opt-in).
 */
type PrefCategory = "messages" | "announcements" | "grades" | "attendance" | "fees";
async function filterByPrefs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase client param; server-side helper boundary (pre-existing shape).
  supabase: any,
  userIds: string[],
  category: PrefCategory,
): Promise<string[]> {
  if (!userIds.length) return [];
  const { data } = await supabase
    .from("notification_preferences")
    .select(`user_id, inapp_${category}, quiet_hours_start, quiet_hours_end`)
    .in("user_id", userIds);
  const rows = (data ?? []) as Array<{
    user_id: string;
    quiet_hours_start: string | null;
    quiet_hours_end: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic preference column projection (pre-existing shape).
    [k: string]: any;
  }>;
  const prefMap = new Map(rows.map((r) => [r.user_id, r]));

  const now = new Date(timeAuthority.now().atMs);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const inQuiet = (s: string | null, e: string | null) => {
    if (!s || !e) return false;
    const [sh, sm] = s.split(":").map(Number);
    const [eh, em] = e.split(":").map(Number);
    const sMin = sh * 60 + sm;
    const eMin = eh * 60 + em;
    if (sMin === eMin) return false;
    return sMin < eMin ? nowMin >= sMin && nowMin < eMin : nowMin >= sMin || nowMin < eMin; // wraps midnight
  };

  return userIds.filter((uid) => {
    const p = prefMap.get(uid);
    if (!p) return true;
    if (p[`inapp_${category}`] === false) return false;
    if (inQuiet(p.quiet_hours_start, p.quiet_hours_end)) return false;
    return true;
  });
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
    const { supabase, claims } = context;
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

    const { data: students } = await supabase
      .from("students")
      .select("id, user_id")
      .eq("school_id", schoolId)
      .eq("class_id", data.class_id)
      .eq("is_active", true);
    const sList = (students ?? []) as { id: string; user_id: string | null }[];
    const studentUids = sList.map((s) => s.user_id).filter((u): u is string => !!u);
    const sids = sList.map((s) => s.id);

    let parentUids: string[] = [];
    if (sids.length) {
      const { data: pm } = await supabase
        .from("parent_student_map")
        .select("parent_id")
        .in("student_id", sids);
      parentUids = Array.from(new Set((pm ?? []).map((r) => r.parent_id as string)));
    }

    const rawTargets = Array.from(new Set([...studentUids, ...parentUids]));
    const targets = await filterByPrefs(supabase, rawTargets, "grades");
    if (!targets.length) return { notified: 0 };

    const title = `Report card published — ${data.term} term ${data.academic_year}`;
    const rows = targets.map((uid) => ({
      school_id: schoolId,
      user_id: uid,
      title,
      message: "Your latest grades are now available to view.",
      type: "grades_published",
      action_url: "/report-card",
      is_read: false,
    }));
    const { error } = await supabase.from("notifications").insert(rows);
    if (error) throw new Error(error.message);
    await pushAfterInsert(supabase, targets);
    return { notified: rows.length };
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
    const { supabase, claims } = context;
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
      .select("student_id, due_date, status, amount")
      .eq("school_id", schoolId)
      .neq("status", "paid")
      .lte("due_date", cutoff);
    const { data: fees } = await q;
    let due = (fees ?? []) as { student_id: string }[];

    if (data.class_id) {
      const { data: students } = await supabase
        .from("students")
        .select("id")
        .eq("school_id", schoolId)
        .eq("class_id", data.class_id);
      const allow = new Set((students ?? []).map((s) => s.id as string));
      due = due.filter((f) => allow.has(f.student_id));
    }

    const sids = Array.from(new Set(due.map((f) => f.student_id)));
    if (!sids.length) return { notified: 0 };

    const { data: pm } = await supabase
      .from("parent_student_map")
      .select("parent_id")
      .in("student_id", sids);
    const rawParents = Array.from(new Set((pm ?? []).map((r) => r.parent_id as string)));
    const parents = await filterByPrefs(supabase, rawParents, "fees");
    if (!parents.length) return { notified: 0 };

    const rows = parents.map((uid) => ({
      school_id: schoolId,
      user_id: uid,
      title: "Outstanding school fees",
      message: `You have unpaid invoices due within ${data.days_until_due} day(s). Please review.`,
      type: "fees_due",
      action_url: "/parent/fees",
      is_read: false,
    }));
    const { error } = await supabase.from("notifications").insert(rows);
    if (error) throw new Error(error.message);
    await pushAfterInsert(supabase, parents);
    return { notified: rows.length };
  });

// ---------------- Generic announcement push ----------------

const PushInput = z.object({
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(2000),
  audience: z.enum(["all", "parents", "teachers", "students"]),
  action_url: z.string().max(200).optional(),
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
    const { data: users } = await q;
    const rawIds = (users ?? []).map((u) => u.id as string).filter((id) => id !== userId);
    const ids = await filterByPrefs(supabase, rawIds, "announcements");
    if (!ids.length) return { notified: 0 };

    const rows = ids.map((uid) => ({
      school_id: schoolId,
      user_id: uid,
      title: data.title,
      message: data.message,
      type: "announcement",
      action_url: data.action_url ?? "/home/notifications",
      is_read: false,
    }));
    const { error } = await supabase.from("notifications").insert(rows);
    if (error) throw new Error(error.message);
    await pushAfterInsert(supabase, ids);
    return { notified: rows.length };
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

    const { data: users } = await q;
    const raw = (users ?? []).map((u: { id: string }) => u.id).filter((id) => id !== userId);
    const targets = await filterByPrefs(supabase, raw, "announcements");
    if (!targets.length) return { notified: 0 };

    const typeLabel = data.event_type ? data.event_type.replace(/_/g, " ") : "event";
    const rows = targets.map((uid) => ({
      school_id: schoolId,
      user_id: uid,
      title: `New ${typeLabel}: ${data.title}`,
      message: `Scheduled for ${data.start_date}. Open the calendar for details.`,
      type: "calendar_event",
      action_url: "/home/notifications",
      is_read: false,
    }));
    const { error } = await supabase.from("notifications").insert(rows);
    if (error) throw new Error(error.message);
    await pushAfterInsert(supabase, targets);
    return { notified: rows.length };
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
