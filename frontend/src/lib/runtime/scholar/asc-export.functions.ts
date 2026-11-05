/**
 * M08 ASC draft exports. Authenticated school-admin scope, tenant RLS reads,
 * and fail-closed export audit; no government submission path is exposed.
 */
import { Buffer } from "node:buffer";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { writeAuditRecord } from "@/lib/server/write-audit";
import { ASC_MANIFEST_2026_DRAFT } from "@/lib/scholar/asc-manifest.2026-draft";
import { ascValuesFromSources, serializeAscCsv, serializeAscXlsx } from "@/lib/scholar/asc-export";

const exportInput = z.object({ format: z.enum(["csv", "xlsx"]) });

interface AscReadResult {
  readonly data: Record<string, string | null> | null;
  readonly count: number | null;
  readonly error: { readonly message: string } | null;
}

interface AscReadBuilder extends PromiseLike<AscReadResult> {
  eq(column: string, value: string | boolean): AscReadBuilder;
  maybeSingle(): PromiseLike<AscReadResult>;
}

interface AscReadClient {
  from(table: string): {
    select(columns: string, options?: { count: "exact"; head: true }): AscReadBuilder;
  };
  rpc(
    functionName: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export const exportAscFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => exportInput.parse(input))
  .handler(async ({ data, context }) => {
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid:
        typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const db = context.supabase as unknown as AscReadClient;
    const permission = await db.rpc("scholar_can", {
      p_org: schoolId,
      p_perm: "reports.academic",
    });
    if (permission.error) throw new Error(permission.error.message);
    if (permission.data !== true)
      throw new Error("Forbidden: academic reporting permission required");

    const [school, location, students, teachers] = await Promise.all([
      db.from("schools").select("name,address,phone,email").eq("id", schoolId).maybeSingle(),
      db
        .from("school_locations")
        .select("state,lga,ownership")
        .eq("school_id", schoolId)
        .maybeSingle(),
      db
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("school_id", schoolId)
        .eq("is_active", true),
      db
        .from("users")
        .select("id", { count: "exact", head: true })
        .eq("school_id", schoolId)
        .eq("role", "teacher")
        .eq("is_active", true),
    ]);

    for (const result of [school, location, students, teachers]) {
      if (result.error) throw new Error(result.error.message);
    }

    const values = ascValuesFromSources(ASC_MANIFEST_2026_DRAFT, {
      tables: { schools: school.data, school_locations: location.data },
      derivations: {
        "active-student-count": students.count,
        "active-teacher-count": teachers.count,
      },
    });
    const fileName = `asc-${ASC_MANIFEST_2026_DRAFT.revision}-unverified.${data.format}`;
    const content =
      data.format === "csv"
        ? serializeAscCsv(ASC_MANIFEST_2026_DRAFT, values)
        : Buffer.from(serializeAscXlsx(ASC_MANIFEST_2026_DRAFT, values)).toString("base64");

    await writeAuditRecord(context.supabase, {
      action: "asc_export.download",
      gate: "requireSchoolAdminScope",
      tenantId: schoolId,
      actorId: context.userId,
      table: "asc_export",
      outcome: "succeeded",
      details: {
        scope: "authenticated school tenant snapshot",
        filters: { students: { is_active: true }, teachers: { role: "teacher", is_active: true } },
        manifest_revision: ASC_MANIFEST_2026_DRAFT.revision,
        manifest_status: ASC_MANIFEST_2026_DRAFT.status,
        format: data.format,
      },
    });

    return {
      fileName,
      format: data.format,
      content,
      manifestRevision: ASC_MANIFEST_2026_DRAFT.revision,
      manifestStatus: ASC_MANIFEST_2026_DRAFT.status,
    };
  });
