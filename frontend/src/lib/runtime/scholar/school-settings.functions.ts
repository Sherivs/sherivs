/**
 * School settings server functions — admin-only.
 *
 * Every write checks that the caller is an admin/principal of the school
 * via the existing public.is_school_admin() function and that
 * `school_id` matches their tenant via public.get_my_school_id().
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { writeAuditRecord } from "@/lib/server/write-audit";
import {
  nonEmptyText,
  optionalText,
  optionalEmail,
  optionalHexColor,
  phoneField,
  urlField,
  yearField,
} from "@/lib/validation";

const sectionFlags = [
  "section_hero_enabled",
  "section_about_enabled",
  "section_programs_enabled",
  "section_facilities_enabled",
  "section_faculty_enabled",
  "section_news_enabled",
  "section_testimonials_enabled",
  "section_faqs_enabled",
  "section_contact_enabled",
  "section_why_us_enabled",
  "section_blog_enabled",
  "section_admissions_enabled",
  "section_rules_enabled",
  "section_privacy_enabled",
] as const;

const profileSchema = z.object({
  name: nonEmptyText("School name", 120),
  email: optionalEmail,
  phone: phoneField,
  address: optionalText(300),
  motto: optionalText(160),
  founded_year: yearField.nullable().optional(),
  website_url: urlField,
  office_hours: optionalText(160),
});

const brandingSchema = z.object({
  logo_url: urlField,
  primary_color: optionalHexColor,
  secondary_color: optionalHexColor,
});

const sectionsSchema = z.object(
  Object.fromEntries(sectionFlags.map((k) => [k, z.boolean()])) as Record<
    (typeof sectionFlags)[number],
    z.ZodBoolean
  >,
);

const heroSchema = z.object({
  hero_headline: optionalText(160),
  hero_subheadline: optionalText(320),
  hero_cta_text: optionalText(40),
});

const aboutSchema = z.object({
  about: optionalText(4000),
  school_vision: optionalText(2000),
  school_mission: optionalText(2000),
});

const paymentsSchema = z.object({
  paystack_public_key: z
    .string()
    .trim()
    .max(120)
    .regex(
      /^(pk_test_|pk_live_)[A-Za-z0-9]+$/u,
      "Use a Paystack public key (pk_test_… or pk_live_…)",
    )
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null)),
});

const latField = z
  .union([z.number(), z.string(), z.null()])
  .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= -90 && v <= 90), {
    message: "Latitude must be between -90 and 90",
  });

const lngField = z
  .union([z.number(), z.string(), z.null()])
  .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
  .refine((v) => v === null || (Number.isFinite(v) && v >= -180 && v <= 180), {
    message: "Longitude must be between -180 and 180",
  });

const radiusField = z
  .union([z.number(), z.string(), z.null()])
  .transform((v) => (v === "" || v === null || v === undefined ? null : Number(v)))
  .refine((v) => v === null || (Number.isInteger(v) && v >= 10 && v <= 10000), {
    message: "Geofence radius must be 10–10000 meters",
  });

const locationSchema = z.object({
  geofence_latitude: latField.nullable(),
  geofence_longitude: lngField.nullable(),
  geofence_radius_meters: radiusField.nullable(),
  google_maps_embed_url: z
    .string()
    .trim()
    .max(4096)
    .optional()
    .or(z.literal(""))
    .transform((v) => (v ? v : null))
    .refine(
      (v) =>
        v === null ||
        /^https:\/\/(www\.)?google\.[a-z.]+\/maps\/embed/.test(v) ||
        /^<iframe[\s\S]+google\.[a-z.]+\/maps\/embed/.test(v),
      { message: "Use a Google Maps embed URL or full <iframe> snippet" },
    ),
  show_map_on_website: z.boolean(),
});

const tabSchema = z.discriminatedUnion("tab", [
  z.object({ tab: z.literal("profile"), values: profileSchema }),
  z.object({ tab: z.literal("branding"), values: brandingSchema }),
  z.object({ tab: z.literal("sections"), values: sectionsSchema }),
  z.object({ tab: z.literal("hero"), values: heroSchema }),
  z.object({ tab: z.literal("about"), values: aboutSchema }),
  z.object({ tab: z.literal("payments"), values: paymentsSchema }),
  z.object({ tab: z.literal("location"), values: locationSchema }),
]);

export type SchoolSettingsTab = z.infer<typeof tabSchema>["tab"];

export const updateSchoolSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => tabSchema.parse(input))
  .handler(async ({ data, context }) => {
    // Canonical Phase 08 role gate — resolves the actor's school scope and
    // fails closed (replaces the legacy inline RPC checks).
    // Lifecycle threading (DEFECT-1 follow-through): the JWT carries no
    // lifecycle claim, so `lifecycle: null` opts this call into the lifecycle
    // contract while flagging the identity lifecycle unverified (never silent);
    // session validity is attested from the verified token's exp claim.
    const schoolId = await requireSchoolAdminScope(context.supabase, {
      lifecycle: null,
      sessionValid: typeof context?.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0,
    });

    const { error } = await context.supabase.from("schools").update(data.values).eq("id", schoolId);
    if (error) throw new Error(error.message);

    // §27.6 AUDIT — fail-closed separate audit record for the canonical write.
    await writeAuditRecord(context.supabase, {
      action: "school_settings.update",
      gate: "requireSchoolAdminScope",
      tenantId: schoolId,
      actorId: context.userId,
      table: "schools",
      recordId: schoolId,
      outcome: "succeeded",
      details: { tab: data.tab },
    });

    return { ok: true, tab: data.tab };
  });

export const SECTION_FLAG_KEYS = sectionFlags;
