import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { writeAuditRecord } from "@/lib/server/write-audit";
import type { Json } from "@/integrations/supabase/types";
import {
  DSR_REQUEST_TYPES,
  DSR_SUBJECT_TYPES,
  canTransition,
  computeDueAt,
  planErasure,
  planExport,
  type DsrRequestType,
  type DsrStatus,
  type DsrSubjectType,
  type SubjectRef,
} from "./dsr";
import { isSchoolAdminOf, loadActor, throwIfError, type ComplianceDb } from "./db";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/**
 * DSR server paths (NDPA access + erasure). Every function authenticates,
 * resolves tenant from the actor row, authorizes, validates the status
 * workflow, executes within the request's school, then writes an append-only
 * request event and an audit record.
 */

export type DsrRequestRow = {
  id: string;
  school_id: string;
  subject_type: DsrSubjectType;
  subject_student_id: string | null;
  subject_user_id: string | null;
  requester_user_id: string;
  request_type: DsrRequestType;
  status: DsrStatus;
};

async function appendEvent(
  db: ComplianceDb,
  req: Pick<DsrRequestRow, "id" | "school_id">,
  from: string | null,
  to: string,
  actorId: string,
  note?: string,
) {
  const res = await db.from("data_subject_request_events").insert({
    request_id: req.id,
    school_id: req.school_id,
    from_status: from,
    to_status: to,
    actor_id: actorId,
    note: note ?? null,
    at: timeAuthority.now().at,
  });
  throwIfError(res, "Failed to append request event");
}

/* ───────────────────────── submit (requester) ───────────────────────── */

export type SubmitInput = {
  subjectType: DsrSubjectType;
  studentId?: string;
  requestType: DsrRequestType;
};

export async function performSubmit(deps: {
  adminClient: ComplianceDb;
  actorId: string;
  input: SubmitInput;
}) {
  const { adminClient: db, actorId, input } = deps;
  const actor = await loadActor(db, actorId);
  if (!actor?.school_id || actor.is_active === false)
    throw new Error("Forbidden: no active school identity");
  const schoolId = actor.school_id;

  if (input.subjectType === "student") {
    if (!input.studentId) throw new Error("studentId required");
    const link = await db
      .from("parent_student_map")
      .select("id")
      .eq("parent_id", actorId)
      .eq("student_id", input.studentId)
      .eq("school_id", schoolId)
      .maybeSingle();
    throwIfError(link, "Failed to verify guardian link");
    if (!link?.data) throw new Error("Forbidden: not a guardian of this student");
  }

  const nowIso = timeAuthority.now().at;
  const ins = await db
    .from("data_subject_requests")
    .insert({
      school_id: schoolId,
      subject_type: input.subjectType,
      subject_student_id: input.subjectType === "student" ? input.studentId : null,
      subject_user_id: input.subjectType === "user" ? actorId : null,
      requester_user_id: actorId,
      request_type: input.requestType,
      status: "received",
      received_at: nowIso,
      due_at: computeDueAt(nowIso),
    })
    .select("id")
    .single();
  throwIfError(ins, "Failed to record request");
  const request = ins.data as { id?: unknown } | null;
  if (typeof request?.id !== "string") {
    throw new Error("Failed to record request: missing request identifier");
  }
  const id = request.id;

  await appendEvent(db, { id, school_id: schoolId }, null, "received", actorId);
  await writeAuditRecord(db, {
    action: "dsr.submit",
    gate: "authenticatedRequester",
    tenantId: schoolId,
    actorId,
    table: "data_subject_requests",
    recordId: id,
    outcome: "succeeded",
    details: { request_type: input.requestType, subject_type: input.subjectType },
  });
  return { id, dueAt: computeDueAt(nowIso) };
}

/* ───────────────────────── admin plumbing ───────────────────────── */

type AdminDeps = { adminClient: ComplianceDb; actorId: string; actorSchoolId: string };

async function loadScopedRequest(deps: AdminDeps, requestId: string): Promise<DsrRequestRow> {
  const { adminClient: db, actorId, actorSchoolId } = deps;
  const actor = await loadActor(db, actorId);
  if (!isSchoolAdminOf(actor, actorSchoolId)) throw new Error("Forbidden: school admin required");
  const res = await db.from("data_subject_requests").select("*").eq("id", requestId).maybeSingle();
  throwIfError(res, "Failed to load request");
  const req = res?.data as DsrRequestRow | null;
  // Same message for missing and foreign-school rows: no cross-tenant existence oracle.
  if (!req || req.school_id !== actorSchoolId) throw new Error("Request not found");
  return req;
}

export async function performTransition(
  deps: AdminDeps & { input: { requestId: string; to: DsrStatus; note?: string } },
) {
  const { adminClient: db, actorId, actorSchoolId, input } = deps;
  const req = await loadScopedRequest(deps, input.requestId);
  if (!canTransition(req.status, input.to)) {
    throw new Error(`Illegal transition ${req.status} -> ${input.to}`);
  }
  // Completion happens only via executeExport/executeErasure so the work is actually done.
  if (input.to === "completed")
    throw new Error("Use executeExport/executeErasure to complete a request");
  if (input.to === "rejected" && !input.note?.trim())
    throw new Error("A rejection reason is required");

  const now = timeAuthority.now().at;
  const patch: Record<string, unknown> =
    input.to === "verified"
      ? { status: "verified", verified_by: actorId, verified_at: now }
      : { status: "rejected", rejection_reason: input.note, completed_at: now };
  const upd = await db
    .from("data_subject_requests")
    .update(patch)
    .eq("id", req.id)
    .eq("school_id", actorSchoolId);
  throwIfError(upd, "Failed to update request");
  await appendEvent(db, req, req.status, input.to, actorId, input.note);
  await writeAuditRecord(db, {
    action: `dsr.${input.to}`,
    gate: "requireSchoolAdminScope",
    tenantId: actorSchoolId,
    actorId,
    table: "data_subject_requests",
    recordId: req.id,
    outcome: "succeeded",
    details: { from: req.status, to: input.to },
  });
  return { ok: true as const, status: input.to };
}

/** Resolve the subject ids, verifying every row belongs to the request's school. */
async function resolveSubject(db: ComplianceDb, req: DsrRequestRow): Promise<SubjectRef> {
  if (req.subject_type === "user") {
    const u = await db
      .from("users")
      .select("id, school_id")
      .eq("id", req.subject_user_id)
      .eq("school_id", req.school_id)
      .maybeSingle();
    throwIfError(u, "Failed to load subject user");
    if (!u?.data) throw new Error("Subject user not found in school");
    return { userId: req.subject_user_id };
  }
  const s = await db
    .from("students")
    .select("id, school_id, user_id")
    .eq("id", req.subject_student_id)
    .eq("school_id", req.school_id)
    .maybeSingle();
  throwIfError(s, "Failed to load subject student");
  if (!s?.data) throw new Error("Subject student not found in school");
  let userId: string | null = null;
  const linked = (s.data as { user_id: string | null }).user_id;
  if (linked) {
    const u = await db
      .from("users")
      .select("id, role")
      .eq("id", linked)
      .eq("school_id", req.school_id)
      .maybeSingle();
    throwIfError(u, "Failed to load linked student user");
    if ((u?.data as { role?: string } | null)?.role === "student") userId = linked;
  }
  return { studentId: req.subject_student_id, userId };
}

async function requireVerified(deps: AdminDeps, requestId: string, type: DsrRequestType) {
  const req = await loadScopedRequest(deps, requestId);
  if (req.request_type !== type) throw new Error(`Request is not an ${type} request`);
  if (req.status !== "verified") throw new Error("Request must be verified before execution");
  return req;
}

async function complete(
  deps: AdminDeps,
  req: DsrRequestRow,
  result: Record<string, unknown>,
  action: string,
) {
  const { adminClient: db, actorId, actorSchoolId } = deps;
  const upd = await db
    .from("data_subject_requests")
    .update({ status: "completed", completed_at: timeAuthority.now().at, result })
    .eq("id", req.id)
    .eq("school_id", actorSchoolId);
  throwIfError(upd, "Failed to complete request");
  await appendEvent(db, req, "verified", "completed", actorId, action);
  await writeAuditRecord(db, {
    action,
    gate: "requireSchoolAdminScope",
    tenantId: actorSchoolId,
    actorId,
    table: "data_subject_requests",
    recordId: req.id,
    outcome: "succeeded",
    details: { subject_type: req.subject_type, summary: result },
  });
}

/* ───────────────────────── export ───────────────────────── */

export async function performExport(deps: AdminDeps & { input: { requestId: string } }) {
  const { adminClient: db, actorSchoolId } = deps;
  const req = await requireVerified(deps, deps.input.requestId, "access_export");
  const ref = await resolveSubject(db, req);

  const data: Record<string, { [column: string]: Json }[]> = {};
  for (const src of planExport(ref)) {
    if (src.arrayMember) {
      const res = await db
        .from(src.table)
        .select(`id, bus_number, route_name, ${src.column}`)
        .eq("school_id", actorSchoolId);
      throwIfError(res, `Export read failed for ${src.table}`);
      const bucket = (data[src.table] ??= []);
      for (const row of (res?.data ?? []) as { [column: string]: Json }[]) {
        const ids = Array.isArray(row[src.column]) ? (row[src.column] as unknown[]) : [];
        // Never expose co-passengers: only the bus/route the subject rides.
        if (ids.includes(src.subjectId)) {
          bucket.push({ id: row.id, bus_number: row.bus_number, route_name: row.route_name });
        }
      }
      continue;
    }
    const res = await db
      .from(src.table)
      .select("*")
      .eq(src.column, src.subjectId)
      .eq("school_id", actorSchoolId);
    throwIfError(res, `Export read failed for ${src.table}`);
    const bucket = (data[src.table] ??= []);
    const seen = new Set(bucket.map((r) => r.id));
    for (const row of (res?.data ?? []) as { [column: string]: Json }[]) {
      if (!seen.has(row.id)) bucket.push(row);
    }
  }

  const counts = Object.fromEntries(Object.entries(data).map(([t, rows]) => [t, rows.length]));
  // Only counts are persisted; the personal data itself is returned once, not duplicated.
  await complete(deps, req, { kind: "access_export", row_counts: counts }, "dsr.export");
  return {
    request_id: req.id,
    school_id: actorSchoolId,
    exported_at: timeAuthority.now().at,
    subject: ref,
    data,
  };
}

/* ───────────────────────── erasure ───────────────────────── */

export async function performErasure(deps: AdminDeps & { input: { requestId: string } }) {
  const { adminClient: db, actorSchoolId } = deps;
  const req = await requireVerified(deps, deps.input.requestId, "erasure");
  const ref = await resolveSubject(db, req);

  const applied: { table: string; column: string; action: string; affected: number }[] = [];
  for (const step of planErasure(ref)) {
    if (step.arrayMember) {
      const rows = await db
        .from(step.table)
        .select(`id, ${step.column}`)
        .eq("school_id", actorSchoolId);
      throwIfError(rows, `Erasure read failed for ${step.table}.${step.column}`);
      let affected = 0;
      for (const row of (rows?.data ?? []) as Record<string, unknown>[]) {
        const ids = Array.isArray(row[step.column]) ? (row[step.column] as unknown[]) : [];
        if (!ids.includes(step.subjectId)) continue;
        const upd = await db
          .from(step.table)
          .update({ [step.column]: ids.filter((x) => x !== step.subjectId) })
          .eq("id", row.id)
          .eq("school_id", actorSchoolId)
          .select("id");
        throwIfError(upd, `Erasure failed for ${step.table}.${step.column}`);
        affected += 1;
      }
      applied.push({ table: step.table, column: step.column, action: step.action, affected });
      continue;
    }
    const base =
      step.action === "delete"
        ? db.from(step.table).delete()
        : db.from(step.table).update(step.patch ?? {});
    const res = await base
      .eq(step.column, step.subjectId)
      .eq("school_id", actorSchoolId)
      .select("id");
    throwIfError(res, `Erasure failed for ${step.table}.${step.column}`);
    applied.push({
      table: step.table,
      column: step.column,
      action: step.action,
      affected: ((res?.data ?? []) as unknown[]).length,
    });
  }

  await complete(deps, req, { kind: "erasure", applied }, "dsr.erasure");
  return { ok: true as const, applied };
}

/* ───────────────────────── server fn wrappers ───────────────────────── */

type Ctx = { userId: string; claims?: { exp?: number } | null; supabase: unknown };

function sessionValid(ctx: Ctx): boolean {
  return typeof ctx.claims?.exp === "number" && tokenMsRemaining(ctx.claims.exp) > 0;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as ComplianceDb;
}

async function adminDeps(ctx: Ctx): Promise<AdminDeps> {
  const schoolId = await requireSchoolAdminScope(ctx.supabase as never, {
    lifecycle: null,
    sessionValid: sessionValid(ctx),
  });
  return { adminClient: await admin(), actorId: ctx.userId, actorSchoolId: schoolId };
}

const submitSchema = z.object({
  subjectType: z.enum(DSR_SUBJECT_TYPES),
  studentId: z.string().uuid().optional(),
  requestType: z.enum(DSR_REQUEST_TYPES),
});
const requestSchema = z.object({ requestId: z.string().uuid() });
const transitionSchema = requestSchema.extend({
  to: z.enum(["verified", "rejected"]),
  note: z.string().trim().max(1000).optional(),
});

export const submitDataSubjectRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => submitSchema.parse(i))
  .handler(async ({ data, context }) => {
    if (!sessionValid(context as Ctx)) throw new Error("Session expired");
    return performSubmit({ adminClient: await admin(), actorId: context.userId, input: data });
  });

export const transitionDataSubjectRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => transitionSchema.parse(i))
  .handler(async ({ data, context }) =>
    performTransition({ ...(await adminDeps(context as Ctx)), input: data }),
  );

export const executeExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => requestSchema.parse(i))
  .handler(async ({ data, context }) =>
    performExport({ ...(await adminDeps(context as Ctx)), input: data }),
  );

export const executeErasure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => requestSchema.parse(i))
  .handler(async ({ data, context }) =>
    performErasure({ ...(await adminDeps(context as Ctx)), input: data }),
  );
