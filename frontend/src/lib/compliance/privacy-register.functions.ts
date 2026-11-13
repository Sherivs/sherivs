import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import type { Json } from "@/integrations/supabase/types";

type PrivacyContext = {
  userId: string;
  claims?: { exp?: number } | null;
  supabase: unknown;
};

type RpcClient = {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type RopaActivity = {
  id: string;
  activity_key: string;
  title: string;
  purpose: string;
  data_subject_categories: string[];
  data_categories: string[];
  recipients: string[];
  transfer_details: string[];
  retention_reference: string;
  security_measures: string;
  is_synthetic: boolean;
  owner_review_status: string;
};

export type DpiaRecord = {
  id: string;
  title: string;
  processing_activity: string;
  data_categories: string[];
  risk_level: "low" | "medium" | "high";
  risks: string[];
  mitigations: string | null;
  status: "draft" | "approved" | "retired";
  prepared_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  review_due: string | null;
};

export type PrivacyRegisterSnapshot = {
  ropa: RopaActivity[];
  dpia: DpiaRecord[];
  can_sign_off: boolean;
};

function sessionValid(context: PrivacyContext): boolean {
  return typeof context.claims?.exp === "number" && tokenMsRemaining(context.claims.exp) > 0;
}

async function callRpc(
  context: PrivacyContext,
  name: string,
  args: Record<string, unknown>,
): Promise<Json> {
  if (!sessionValid(context)) throw new Error("Session expired");
  const { data, error } = await (context.supabase as RpcClient).rpc(name, args);
  if (error) throw new Error("Privacy register operation failed");
  return data as Json;
}

const scopeSchema = z.object({ schoolId: z.string().uuid().nullable() });
const textArray = z.array(z.string().trim().min(1).max(500)).max(100);
const ropaSchema = scopeSchema.extend({
  id: z.string().uuid().nullable(),
  activityKey: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_.-]{1,95}$/u),
  title: z.string().trim().min(2).max(160),
  purpose: z.string().trim().min(2).max(2000),
  subjectCategories: textArray,
  dataCategories: textArray,
  recipients: textArray,
  transferDetails: textArray,
  retentionReference: z.string().trim().min(2).max(1000),
  securityMeasures: z.string().trim().min(2).max(2000),
});
const dpiaSchema = scopeSchema.extend({
  id: z.string().uuid().nullable(),
  title: z.string().trim().min(2).max(160),
  activity: z.string().trim().min(2).max(2000),
  categories: textArray,
  riskLevel: z.enum(["low", "medium", "high"]),
  risks: textArray,
  mitigations: z.string().trim().max(4000),
});
const signOffSchema = z.object({ dpiaId: z.string().uuid() });
const ownerReviewSchema = z.object({
  ropaId: z.string().uuid(),
  confirmedRealValues: z.boolean(),
});

export const loadPrivacyRegister = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => scopeSchema.parse(input))
  .handler(async ({ data, context }) =>
    callRpc(context as PrivacyContext, "privacy_register_snapshot", {
      p_school: data.schoolId,
    }),
  );

export const saveRopaActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ropaSchema.parse(input))
  .handler(async ({ data, context }) =>
    callRpc(context as PrivacyContext, "privacy_ropa_save", {
      p_id: data.id,
      p_school: data.schoolId,
      p_activity_key: data.activityKey,
      p_title: data.title,
      p_purpose: data.purpose,
      p_subject_categories: data.subjectCategories,
      p_data_categories: data.dataCategories,
      p_recipients: data.recipients,
      p_transfer_details: data.transferDetails,
      p_retention_reference: data.retentionReference,
      p_security_measures: data.securityMeasures,
    }),
  );

export const reviewPlatformRopa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ownerReviewSchema.parse(input))
  .handler(async ({ data, context }) =>
    callRpc(context as PrivacyContext, "privacy_ropa_owner_review", {
      p_id: data.ropaId,
      p_confirmed_real_values: data.confirmedRealValues,
    }),
  );

export const saveDpia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => dpiaSchema.parse(input))
  .handler(async ({ data, context }) =>
    callRpc(context as PrivacyContext, "privacy_dpia_save", {
      p_id: data.id,
      p_school: data.schoolId,
      p_title: data.title,
      p_activity: data.activity,
      p_categories: data.categories,
      p_risk_level: data.riskLevel,
      p_risks: data.risks,
      p_mitigations: data.mitigations,
    }),
  );

export const signOffDpia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => signOffSchema.parse(input))
  .handler(async ({ data, context }) =>
    callRpc(context as PrivacyContext, "dpia_approve", { p_dpia: data.dpiaId }),
  );

export const exportPrivacyRegister = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => scopeSchema.parse(input))
  .handler(async ({ data, context }) =>
    callRpc(context as PrivacyContext, "privacy_register_export", {
      p_school: data.schoolId,
    }),
  );
