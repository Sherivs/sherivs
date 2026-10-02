/**
 * Broadcast messaging — send the same message to many recipients in one call.
 *
 * Authorisation:
 *   - admin / principal: can target any audience in their school
 *   - teacher:           can target their own class students/parents only
 *
 * Side-effects:
 *   - one row per recipient in `messages` (shared thread_id)
 *   - one row per recipient in `notifications` (so unread badges light up)
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireStaffContext } from "@/lib/security-role-gate";
import { SystemClock, TimeAuthority } from "../../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const Audience = z.union([
  z.object({ kind: z.literal("class_students"), class_id: z.string().uuid() }),
  z.object({ kind: z.literal("class_parents"), class_id: z.string().uuid() }),
  z.object({ kind: z.literal("role"), role: z.enum(["teacher", "parent", "student", "admin"]) }),
  z.object({ kind: z.literal("all_school") }),
]);

const Input = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(8000),
  audience: Audience,
});

export type BroadcastResult = { sent: number; thread_id: string };

export const broadcastMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => Input.parse(i))
  .handler(async ({ data, context }): Promise<BroadcastResult> => {
    const { supabase, userId, claims } = context;
    // Canonical Phase 08 teaching-staff gate (admin/principal/teacher).
    // Replaces the legacy inline users.role read + check. Audience-specific
    // policy below (teacher → own class only; admin → any audience) branches
    // on the canonical role — never on a client-supplied claim.
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const staff = await requireStaffContext(supabase, "teaching_staff", {
      lifecycle: null,
      sessionValid: typeof claims?.exp === "number" && tokenMsRemaining(claims.exp) > 0,
    });
    const { role: actorRole, schoolId } = staff;
    const isAdmin = actorRole === "admin" || actorRole === "principal";
    const isTeacher = actorRole === "teacher";
    if (!isAdmin && !isTeacher) throw new Error("Not allowed to broadcast");

    // Resolve recipient ids
    let recipientIds: string[] = [];
    const aud = data.audience;

    async function studentUserIds(classId: string): Promise<string[]> {
      const { data: rows } = await supabase
        .from("students")
        .select("user_id")
        .eq("school_id", schoolId)
        .eq("class_id", classId)
        .eq("is_active", true);
      return (rows ?? []).map((r) => r.user_id as string | null).filter((u): u is string => !!u);
    }
    async function parentUserIds(classId: string): Promise<string[]> {
      const { data: srows } = await supabase
        .from("students")
        .select("id")
        .eq("school_id", schoolId)
        .eq("class_id", classId)
        .eq("is_active", true);
      const sids = (srows ?? []).map((r) => r.id as string);
      if (!sids.length) return [];
      const { data: prows } = await supabase
        .from("parent_student_map")
        .select("parent_id")
        .in("student_id", sids);
      return Array.from(new Set((prows ?? []).map((r) => r.parent_id as string)));
    }

    if (aud.kind === "class_students" || aud.kind === "class_parents") {
      // Teachers may only target classes they own
      if (isTeacher) {
        const { data: cls } = await supabase
          .from("classes")
          .select("id, teacher_id, school_id")
          .eq("id", aud.class_id)
          .maybeSingle();
        if (!cls || cls.school_id !== schoolId) throw new Error("Class not in your school");
        if (cls.teacher_id !== userId) throw new Error("Not your class");
      }
      recipientIds =
        aud.kind === "class_students"
          ? await studentUserIds(aud.class_id)
          : await parentUserIds(aud.class_id);
    } else if (aud.kind === "role") {
      if (!isAdmin) throw new Error("Only admins can broadcast to a role");
      const { data: rows } = await supabase
        .from("users")
        .select("id")
        .eq("school_id", schoolId)
        .eq("role", aud.role)
        .eq("is_active", true);
      recipientIds = (rows ?? []).map((r) => r.id as string);
    } else {
      if (!isAdmin) throw new Error("Only admins can broadcast to the whole school");
      const { data: rows } = await supabase
        .from("users")
        .select("id")
        .eq("school_id", schoolId)
        .eq("is_active", true);
      recipientIds = (rows ?? []).map((r) => r.id as string);
    }

    recipientIds = recipientIds.filter((id) => id !== userId);
    if (!recipientIds.length) return { sent: 0, thread_id: "" };

    const thread_id = crypto.randomUUID();
    const now = timeAuthority.now().at;

    const msgRows = recipientIds.map((rid) => ({
      school_id: schoolId,
      sender_id: userId,
      recipient_id: rid,
      subject: data.subject,
      body: data.body,
      thread_id,
      is_read: false,
      created_at: now,
    }));
    const { error: mErr } = await supabase.from("messages").insert(msgRows);
    if (mErr) throw new Error(mErr.message);

    const notifRows = recipientIds.map((rid) => ({
      school_id: schoolId,
      user_id: rid,
      title: data.subject,
      message: data.body.slice(0, 240),
      type: "message",
      action_url: "/messages",
      is_read: false,
    }));
    await supabase.from("notifications").insert(notifRows); // best-effort

    return { sent: recipientIds.length, thread_id };
  });
