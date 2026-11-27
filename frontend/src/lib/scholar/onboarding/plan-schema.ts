/**
 * M6 (mission E-016, ADR-148) — the schema a staff-edited provisioning plan must satisfy.
 *
 * It is the runtime form of `OnboardingPlan` from the M5a plan generator (ADR-107): the same
 * fields, strict (no extra keys), bounded, and with every authority link still 'unverified'. A
 * unit test runs every M5a golden plan through it, so the generator and this schema cannot drift.
 *
 * What the schema cannot know (is the role pack published? does the ownership map to a stored
 * value?) is checked again by the database function that provisions the plan.
 */
import { z } from "zod";

const code = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const packCode = z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/);
const semver = z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/);
const unitKey = z.string().regex(/^[a-z0-9][a-z0-9_]{1,62}$/);
const flag = z.string().regex(/^[a-z_]+(:[a-z0-9_]+)?$/);

export const PLAN_ORG_UNIT_KINDS = [
  "organization",
  "campus",
  "section",
  "faculty",
  "school",
  "school_college",
  "department",
  "programme",
  "level",
  "class_arm",
  "house",
  "hostel",
  "clinical_site",
  "farm_unit",
  "directorate",
  "agency",
  "zone",
  "lga",
  "lgea",
  "shift",
  "trade",
] as const;

const orgUnit = z
  .object({
    key: unitKey,
    kind: z.enum(PLAN_ORG_UNIT_KINDS),
    parentKey: unitKey.nullable(),
    /** Optional display name a reviewer may add; otherwise the key is shown. */
    name: z.string().trim().min(2).max(120).optional(),
  })
  .strict();

const planModule = z
  .object({
    code,
    enabled: z.boolean(),
    gate: z
      .object({
        kind: z.literal("mandate_verification"),
        mandate_status: z.literal("unverified"),
      })
      .strict()
      .nullable(),
  })
  .strict();

const authorityLink = z
  .object({
    authority: code,
    relation: z.enum([
      "regulated_by",
      "supervised_by",
      "reports_to",
      "registered_with",
      "candidate_centre_of",
      "jurisdiction_over",
    ]),
    scope: z.string().max(64).nullable(),
    status: z.literal("unverified"),
  })
  .strict();

const attributeValue = z.union([
  z.string().max(200),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(120)).max(60),
]);

export const onboardingPlanSchema = z
  .object({
    rolePack: z.object({ code: packCode, version: semver }).strict(),
    orgUnits: z.array(orgUnit).min(1).max(200),
    calendarModel: code,
    gradingSystem: code,
    curricula: z.array(code).max(12),
    modules: z.array(planModule).max(60),
    websiteTemplate: code,
    admissions: z.object({ enabledByDefault: z.boolean(), mode: code }).strict(),
    authorityLinkCandidates: z.array(authorityLink).max(40),
    institutionProfile: z
      .object({
        institution_type: code.nullable(),
        ownership: code,
        regulators: z.array(code).max(12),
        calendar_model: code,
        grading_system: code,
        curricula: z.array(code).max(12),
        languages: z
          .array(z.string().regex(/^[a-z]{2,3}$/))
          .min(1)
          .max(12),
        attributes: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), attributeValue),
      })
      .strict(),
    flags: z.array(flag).max(80),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    let roots = 0;
    plan.orgUnits.forEach((u, i) => {
      if (seen.has(u.key))
        ctx.addIssue({
          code: "custom",
          path: ["orgUnits", i, "key"],
          message: "duplicate unit key",
        });
      if (u.parentKey === null) roots += 1;
      else if (!seen.has(u.parentKey))
        ctx.addIssue({
          code: "custom",
          path: ["orgUnits", i, "parentKey"],
          message: "a parent must be listed before its children",
        });
      seen.add(u.key);
    });
    if (roots !== 1)
      ctx.addIssue({ code: "custom", path: ["orgUnits"], message: "exactly one root unit" });
    const codes = new Set<string>();
    plan.modules.forEach((m, i) => {
      if (codes.has(m.code))
        ctx.addIssue({ code: "custom", path: ["modules", i, "code"], message: "duplicate module" });
      codes.add(m.code);
      if (m.gate && m.enabled)
        ctx.addIssue({
          code: "custom",
          path: ["modules", i, "enabled"],
          message: "a module gated on mandate verification stays disabled",
        });
    });
  });

export type ValidatedOnboardingPlan = z.infer<typeof onboardingPlanSchema>;

export type PlanValidation =
  | { readonly ok: true; readonly plan: ValidatedOnboardingPlan }
  | { readonly ok: false; readonly issues: readonly string[] };

export function validateOnboardingPlan(input: unknown): PlanValidation {
  const parsed = onboardingPlanSchema.safeParse(input);
  if (parsed.success) return { ok: true, plan: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues
      .slice(0, 20)
      .map((i) => `${i.path.join(".") || "plan"}: ${i.message}`),
  };
}
