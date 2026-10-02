/**
 * Attendance server functions
 *
 * Correct school flow:
 *  - Teachers mark STUDENT attendance per class per day (UI-driven, no QR).
 *  - Admins display a QR at the gate/staff room for TEACHERS to scan
 *    to record sign-in / sign-out (attendance_logs).
 *  - Students never mint or scan attendance codes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope, requireStaffContext } from "@/lib/security-role-gate";
import { SystemClock, TimeAuthority } from "../../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const TOKEN_TTL_SECONDS = 30;
const ALLOWED_STATUSES = ["present", "absent", "late", "excused"] as const;

function randomToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 24);
}

// -------------------------------------------------------------------------
// Teacher sign-in QR (admin-issued)
// -------------------------------------------------------------------------

const genQrSchema = z.object({ mode: z.enum(["sign_in", "sign_out"]) });

export const generateTeacherCheckQr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => genQrSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    // Canonical Phase 08 school-admin gate (admin/principal). Replaces the
    // legacy inline users.role read + check.
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(supabase, {
      lifecycle: null,
      sessionValid: typeof claims?.exp === "number" && tokenMsRemaining(claims.exp) > 0,
    });

    const token = randomToken();
    const expiresAt = new Date(timeAuthority.now().atMs + TOKEN_TTL_SECONDS * 1000).toISOString();

    const { error } = await supabase.from("qr_tokens").insert({
      school_id: schoolId,
      token,
      type: data.mode, // CHECK constraint allows 'sign_in' | 'sign_out'
      expires_at: expiresAt,
      used: false,
      created_by: userId,
      payload: { mode: data.mode },
    });
    if (error) throw new Error(error.message);

    return { token, expires_at: expiresAt, ttl_seconds: TOKEN_TTL_SECONDS, mode: data.mode };
  });

const teacherCheckSchema = z.object({ token: z.string().trim().min(4).max(64) });

export const teacherCheckWithQr = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => teacherCheckSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    // Canonical Phase 08 school-teacher gate (role = teacher). Replaces the
    // legacy inline users.role read + check.
    // Lifecycle threading: see the school-admin gate above for the signal
    // semantics (unverified lifecycle flagged; session attested from exp).
    const staff = await requireStaffContext(supabase, "school_teacher", {
      lifecycle: null,
      sessionValid: typeof claims?.exp === "number" && tokenMsRemaining(claims.exp) > 0,
    });

    const { data: tok, error: tokErr } = await supabase
      .from("qr_tokens")
      .select("id, token, school_id, type, expires_at, used, payload")
      .eq("token", data.token)
      .maybeSingle();
    if (tokErr) throw new Error(tokErr.message);
    if (!tok) throw new Error("Invalid or unknown code");
    if (tok.type !== "sign_in" && tok.type !== "sign_out")
      throw new Error("This code is not a teacher check-in code");
    if (tok.used) throw new Error("This code has already been used");
    if (new Date(tok.expires_at).getTime() < timeAuthority.now().atMs) throw new Error("This code has expired");
    if (tok.school_id !== staff.schoolId) throw new Error("Wrong school");

    const { error: logErr } = await supabase.from("attendance_logs").insert({
      school_id: tok.school_id,
      teacher_id: userId,
      type: tok.type,
      qr_token: tok.token,
      verified: true,
    });
    if (logErr) throw new Error(logErr.message);

    await supabase.from("qr_tokens").update({ used: true }).eq("id", tok.id);

    return { ok: true, mode: tok.type as "sign_in" | "sign_out" };
  });

// -------------------------------------------------------------------------
// Teacher marks student attendance for a class on a date
// -------------------------------------------------------------------------

const markSchema = z.object({
  class_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  marks: z
    .array(
      z.object({
        student_id: z.string().uuid(),
        status: z.enum(ALLOWED_STATUSES),
        note: z.string().max(500).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const markClassAttendance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => markSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    // Canonical Phase 08 teaching-staff gate (admin/principal/teacher).
    // Replaces the legacy inline users.role read + check.
    // Lifecycle threading: see the school-admin gate above for the signal
    // semantics (unverified lifecycle flagged; session attested from exp).
    const staff = await requireStaffContext(supabase, "teaching_staff", {
      lifecycle: null,
      sessionValid: typeof claims?.exp === "number" && tokenMsRemaining(claims.exp) > 0,
    });

    // Confirm the class belongs to the same school
    const { data: cls, error: clsErr } = await supabase
      .from("classes")
      .select("id, school_id")
      .eq("id", data.class_id)
      .maybeSingle();
    if (clsErr) throw new Error(clsErr.message);
    if (!cls || cls.school_id !== staff.schoolId) throw new Error("Class not in your school");

    const rows = data.marks.map((m) => ({
      school_id: staff.schoolId,
      student_id: m.student_id,
      class_id: data.class_id,
      date: data.date,
      status: m.status,
      note: m.note ?? null,
      marked_by: userId,
    }));

    const { error: upErr } = await supabase
      .from("attendance")
      .upsert(rows, { onConflict: "student_id,date" });
    if (upErr) throw new Error(upErr.message);

    return { ok: true, saved: rows.length };
  });
