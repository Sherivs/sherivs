import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { writeAuditRecord } from "@/lib/server/write-audit";
import {
  CAPTURE_METHODS,
  CONSENT_PURPOSES,
  LAWFUL_BASES,
  decideConsent,
  type CaptureMethod,
  type LawfulBasis,
  type ConsentPurpose,
  type ConsentRecordLike,
} from "./consent";
import { isSchoolAdminOf, loadActor, throwIfError, type ComplianceDb } from "./db";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/**
 * Consent server paths. Reads and writes go through the service-role client:
 * consent_records has no client write grants (migration 20261020000060).
 */

/** Server-side consent lookup for a specific data subject, scoped to the school. */
export async function hasConsent(
  client: ComplianceDb,
  studentId: string,
  purpose: ConsentPurpose,
  schoolId: string,
): Promise<boolean> {
  const res = await client
    .from("consent_records")
    .select(
      "student_id, purpose, status, policy_version, lawful_basis, granted_by, granted_at, withdrawn_at, updated_at",
    )
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .eq("purpose", purpose);
  // Fail closed: an unreadable consent table must never read as consent to optional purposes.
  if (res?.error) return false;
  return decideConsent((res?.data ?? []) as ConsentRecordLike[], studentId, purpose);
}

/** Batch variant: the subset of studentIds that may be processed for the purpose. */
export async function filterConsentedStudents(
  client: ComplianceDb,
  studentIds: readonly string[],
  purpose: ConsentPurpose,
  schoolId: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (!studentIds.length) return out;
  const res = await client
    .from("consent_records")
    .select(
      "student_id, purpose, status, policy_version, lawful_basis, granted_by, granted_at, withdrawn_at, updated_at",
    )
    .eq("school_id", schoolId)
    .eq("purpose", purpose)
    .in("student_id", [...studentIds]);
  const rows = (res?.error ? null : (res?.data ?? [])) as ConsentRecordLike[] | null;
  for (const id of studentIds) {
    if (rows && decideConsent(rows, id, purpose)) out.add(id);
  }
  return out;
}

export type ConsentChangeInput = {
  studentId: string;
  purpose: ConsentPurpose;
  action: "grant" | "withdraw";
  captureMethod?: CaptureMethod;
  lawfulBasis?: LawfulBasis;
  grantedByUserId?: string;
  notes?: string;
};

export type PerformConsentDeps = {
  adminClient: ComplianceDb;
  actorId: string;
  input: ConsentChangeInput;
};

const ADMIN_CAPTURE: readonly CaptureMethod[] = [
  "admin_entered",
  "paper_signed",
  "verbal_recorded",
];

function isAdult(dateOfBirth: string | null, now: string): boolean {
  if (!dateOfBirth || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return false;
  const cutoff = new Date(now);
  if (Number.isNaN(cutoff.getTime())) return false;
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 18);
  return dateOfBirth <= cutoff.toISOString().slice(0, 10);
}

export async function performConsentChange(deps: PerformConsentDeps) {
  const { adminClient: db, actorId, input } = deps;
  const now = timeAuthority.now().at;
  const [actor, studentRes] = await Promise.all([
    loadActor(db, actorId),
    db
      .from("students")
      .select("id, school_id, user_id, date_of_birth")
      .eq("id", input.studentId)
      .maybeSingle(),
  ]);
  throwIfError(studentRes, "Failed to load student");
  const student = studentRes?.data as {
    id: string;
    school_id: string;
    user_id?: string | null;
    date_of_birth?: string | null;
  } | null;
  const schoolId = student?.school_id ?? null;

  let role: "guardian" | "self" | "admin" | null = null;
  if (student && actor && actor.school_id === schoolId && actor.is_active !== false) {
    if (student.user_id === actorId && isAdult(student.date_of_birth ?? null, now)) {
      role = "self";
    } else {
      const link = await db
        .from("student_guardian_relationships")
        .select("relationship_type, effective_from, effective_until")
        .eq("student_id", input.studentId)
        .eq("school_id", student.school_id)
        .eq("related_user_id", actorId);
      throwIfError(link, "Failed to load guardian link");
      const relationships = (link?.data ?? []) as {
        relationship_type?: string;
        effective_from?: string;
        effective_until?: string | null;
      }[];
      const activeConsentRelationship = relationships.some(
        (relationship) =>
          ["legal_guardian", "parent"].includes(relationship.relationship_type ?? "") &&
          !!relationship.effective_from &&
          relationship.effective_from <= now.slice(0, 10) &&
          (!relationship.effective_until || relationship.effective_until > now.slice(0, 10)),
      );
      if (activeConsentRelationship) role = "guardian";
      else if (isSchoolAdminOf(actor, student.school_id)) role = "admin";
    }
  }

  if (!role || !student) {
    try {
      await writeAuditRecord(db, {
        action: `consent.${input.action}`,
        gate: "performConsentChange",
        tenantId: actor?.school_id ?? null,
        actorId,
        table: "consent_records",
        recordId: null,
        outcome: "denied",
        details: { purpose: input.purpose, student_id: input.studentId },
      });
    } catch {
      // best-effort: the denial must still surface
    }
    throw new Error(
      "Forbidden: only the adult learner, an active parent/legal guardian, or a school admin may change consent",
    );
  }

  const captureMethod: CaptureMethod =
    role === "admin" ? (input.captureMethod ?? "admin_entered") : "web_form";
  if (role === "admin" && !ADMIN_CAPTURE.includes(captureMethod)) {
    throw new Error("Invalid capture method for admin-recorded consent");
  }
  if (input.action === "grant" && !input.lawfulBasis) {
    throw new Error("A lawful basis is required for every consent grant");
  }
  const grantedBy = role === "admin" ? input.grantedByUserId : actorId;
  if (!grantedBy) throw new Error("The person granting consent must be identified");
  if (input.lawfulBasis && !(LAWFUL_BASES as readonly string[]).includes(input.lawfulBasis)) {
    throw new Error("Invalid lawful basis");
  }
  if (!db.rpc) throw new Error("Consent service is unavailable");
  const result = await db.rpc("consent_set_for_actor", {
    p_actor_id: actorId,
    p_student_id: input.studentId,
    p_purpose: input.purpose,
    p_grant: input.action === "grant",
    p_granted_by: grantedBy,
    p_lawful_basis: input.lawfulBasis ?? null,
    p_method: captureMethod,
    p_note: input.notes ?? null,
  });
  throwIfError(result, "Failed to record consent");
  const recorded = result?.data as { consent_id?: string; status?: string } | null;
  if (
    !recorded?.consent_id ||
    recorded.status !== (input.action === "grant" ? "granted" : "withdrawn")
  ) {
    throw new Error("Consent service returned an invalid result");
  }
  return {
    ok: true as const,
    consentId: recorded.consent_id,
    status: input.action === "grant" ? ("granted" as const) : ("withdrawn" as const),
  };
}

const schema = z.object({
  studentId: z.string().uuid(),
  purpose: z.enum(CONSENT_PURPOSES),
  captureMethod: z.enum(CAPTURE_METHODS).optional(),
  lawfulBasis: z.enum(LAWFUL_BASES).optional(),
  grantedByUserId: z.string().uuid().optional(),
  notes: z.string().trim().max(500).optional(),
});

async function run(
  action: "grant" | "withdraw",
  data: z.infer<typeof schema>,
  context: { userId: string; claims?: { exp?: number } | null },
) {
  if (typeof context.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) <= 0) {
    throw new Error("Session expired");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return performConsentChange({
    adminClient: supabaseAdmin as unknown as ComplianceDb,
    actorId: context.userId,
    input: { ...data, action },
  });
}

export const grantConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => run("grant", data, context));

export const withdrawConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => schema.parse(input))
  .handler(async ({ data, context }) => run("withdraw", data, context));
