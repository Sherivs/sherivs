/**
 * CoreGrid Scholar — feature access + generated-experience server functions.
 *
 * APIs are APIs (Constitution §27): authenticate, resolve the tenant, authorize
 * through the canonical gates, validate input against platform vocabulary,
 * execute, and return only permitted data. These functions are READ-ONLY: they
 * decide, preview and explain — none of them writes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asKernelAdmin } from "@/lib/kernel-admin-client";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import {
  SCHOLAR_SCHOOL_TEMPLATES,
  SCHOLAR_TEMPLATE_FEATURE_SET,
} from "@/lib/runtime/scholar-school-templates";
import { featureCodesForReality } from "@/lib/scholar/capability-codes";
import { featureGateSnapshot, type FeatureGateDecision } from "@/lib/scholar/feature-gate";
import { EDUCATION_LEVELS, type EducationLevel } from "@/lib/scholar/roles/role-definition";
import { roleIdsForWorkforceKind } from "@/lib/scholar/roles/role-registry";
import type { InstitutionReality } from "@/lib/scholar/roles/role-template-engine";
import {
  generateExperience,
  type GeneratedExperience,
} from "@/lib/scholar/experience/experience-engine";
import { governExperience } from "@/lib/scholar/experience/experience-governance";

/**
 * Legacy membership kind → workforce kind. MIGRATION BRIDGE ONLY: new
 * authorization is P02 identity + P08 gate + installed workforce positions
 * (`cg_workforce_position`). Remove once every actor carries a position.
 */
const MEMBERSHIP_TO_WORKFORCE_KIND: Readonly<Record<string, string>> = {
  admin: "head_of_school",
  principal: "head_of_school",
  teacher: "subject_teacher",
  bursar: "bursar",
  driver: "driver",
  hq: "education_ministry_liaison",
  super_admin: "head_of_school",
};

const TEMPLATE_IDS: ReadonlySet<string> = new Set(SCHOLAR_SCHOOL_TEMPLATES.map((t) => t.id));
const JURISDICTION_RE = /^(\*|[A-Z]{2})$/;

const realitySchema = z.object({
  featureKeys: z.array(z.string()).max(40),
  templateRefs: z.array(z.string()).max(20).optional(),
  educationLevels: z.array(z.string()).max(10).optional(),
  jurisdictions: z.array(z.string()).max(20).optional(),
  curriculumFlavour: z.enum(["christian", "islamic", "secular", "alternative"]).optional(),
});

/** Keep only platform vocabulary — a client can never extend the ontology. */
function normaliseReality(input: z.infer<typeof realitySchema>): InstitutionReality {
  return {
    featureKeys: input.featureKeys.filter((key) => SCHOLAR_TEMPLATE_FEATURE_SET.has(key)),
    templateRefs: (input.templateRefs ?? []).filter((id) => TEMPLATE_IDS.has(id)),
    educationLevels: (input.educationLevels ?? []).filter((level): level is EducationLevel =>
      (EDUCATION_LEVELS as readonly string[]).includes(level),
    ),
    jurisdictions: (input.jurisdictions ?? []).filter((code) => JURISDICTION_RE.test(code)),
    curriculumFlavour: input.curriculumFlavour,
  };
}

export interface MyFeatureAccess {
  tenantId: string | null;
  membershipKind: string | null;
  workforceKindCode: string | null;
  roleIds: readonly string[];
  enabled: readonly string[];
  decisions: readonly FeatureGateDecision[];
}

/** Self-scope: what can *I* use, and why? Fail-closed when unscoped. */
export const getMyFeatureAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({}).parse(input))
  .handler(async ({ context }): Promise<MyFeatureAccess> => {
    const roleRes = await context.supabase.rpc("get_my_role");
    const scopeRes = await context.supabase.rpc("get_my_school_id");
    const membershipKind = (roleRes.data as string | null) ?? null;
    const tenantId = (scopeRes.data as string | null) ?? null;

    const { data: positionRows } = await asKernelAdmin(context.supabase).rpc(
      "get_my_primary_workforce_position",
    );
    const position =
      Array.isArray(positionRows) && positionRows.length > 0
        ? (positionRows[0] as { kind_code?: string })
        : null;
    const workforceKindCode =
      position?.kind_code ??
      (membershipKind ? (MEMBERSHIP_TO_WORKFORCE_KIND[membershipKind] ?? null) : null);

    const roleIds = workforceKindCode ? roleIdsForWorkforceKind(workforceKindCode) : [];
    const decisions = featureGateSnapshot({
      actor: { identityId: context.userId, tenantId, roleIds },
    });

    return {
      tenantId,
      membershipKind,
      workforceKindCode,
      roleIds,
      enabled: decisions.filter((decision) => decision.enabled).map((decision) => decision.code),
      decisions,
    };
  });

export interface TenantExperiencePreview {
  tenantId: string;
  reality: {
    featureKeys: readonly string[];
    templateRefs: readonly string[];
    educationLevels: readonly string[];
    jurisdictions: readonly string[];
  };
  installedCodes: readonly { code: string; label: string; workspace: string }[];
  enabledCodes: readonly string[];
  generated: {
    brandName: string;
    sections: readonly {
      section: string;
      label: string;
      components: readonly string[];
      rationale: readonly string[];
      requiresApproval: boolean;
    }[];
    publicNavigation: readonly string[];
    workspaces: readonly { workspace: string; sourceRoles: readonly string[] }[];
    primaryWorkspace: string | null;
  };
  governance: { ok: boolean; issues: readonly string[] };
}

/** Admin-scope: preview the environment this tenant's reality generates. */
export const previewTenantExperience = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => realitySchema.parse(input))
  .handler(async ({ data, context }): Promise<TenantExperiencePreview> => {
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });
    const reality = normaliseReality(data);
    const experience: GeneratedExperience = generateExperience({ reality });
    const installed = featureCodesForReality(reality);

    const roleRes = await context.supabase.rpc("get_my_role");
    const membershipKind = (roleRes.data as string | null) ?? null;
    const workforceKindCode = membershipKind
      ? (MEMBERSHIP_TO_WORKFORCE_KIND[membershipKind] ?? null)
      : null;
    const roleIds = workforceKindCode ? roleIdsForWorkforceKind(workforceKindCode) : [];

    const decisions = featureGateSnapshot({
      actor: { identityId: context.userId, tenantId: schoolId, roleIds },
      reality,
    });

    const governance = governExperience({
      tenantId: schoolId,
      audience: "public_visitor",
      experience,
    });

    return {
      tenantId: schoolId,
      reality: {
        featureKeys: reality.featureKeys,
        templateRefs: reality.templateRefs ?? [],
        educationLevels: reality.educationLevels ?? [],
        jurisdictions: reality.jurisdictions ?? [],
      },
      installedCodes: installed.map((entry) => ({
        code: entry.code,
        label: entry.label,
        workspace: entry.workspace,
      })),
      enabledCodes: decisions.filter((decision) => decision.enabled).map((d) => d.code),
      generated: {
        brandName: experience.brand.name,
        sections: experience.sections.map((section) => ({
          section: section.section,
          label: section.label,
          components: section.components,
          rationale: section.rationale,
          requiresApproval: section.requiresApproval,
        })),
        publicNavigation: experience.publicNavigation,
        workspaces: experience.internalApplication.workspaces.map((assignment) => ({
          workspace: assignment.workspace,
          sourceRoles: assignment.sourceRoles,
        })),
        primaryWorkspace: experience.internalApplication.primary,
      },
      governance: { ok: governance.ok, issues: governance.issues },
    };
  });

export type MyFeatureAccessResult = Awaited<ReturnType<typeof getMyFeatureAccess>>;
export type TenantExperiencePreviewResult = Awaited<ReturnType<typeof previewTenantExperience>>;
