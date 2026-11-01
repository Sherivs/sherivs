import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  africaTalkingVoiceConfigFromEnv,
  AFRICAS_TALKING_PROVIDER_ID,
} from "@/lib/communications/africas-talking-voice.server";
import {
  createAfricaTalkingVoiceAdapter,
  createAfricaTalkingVoiceProviderRegistry,
} from "@/lib/communications/africas-talking-outbound.server";
import {
  isTelephonyCallReceipt,
  type TelephonyCallCommand,
} from "@/lib/communications/telephony-adapter-contract";

const emptyInput = z.object({});
const callIdInput = z.object({ callId: z.string().uuid() });
const settingsInput = z.object({
  enabled: z.boolean(),
  provider: z.literal("africas_talking").nullable(),
  providerNumber: z.string().nullable(),
  extension: z.string().nullable(),
  voiceLive: z.boolean(),
  voiceMinutesQuota: z.coerce.number().int().nonnegative(),
  voiceMinutesUsed: z.coerce.number().int().nonnegative(),
});
const privateSettingsInput = settingsInput.extend({ tenantRef: z.string().uuid() });
const callInput = z.object({
  id: z.string().uuid(),
  category: z.enum(["fee_reminder", "absence_alert"]),
  recipient_redacted: z.string(),
  script: z.string(),
  status: z.enum(["pending", "approved"]),
  requested_by: z.string(),
  created_at: z.string(),
});

export type VoiceAgentSettings = z.infer<typeof settingsInput>;
export type VoiceAgentCall = z.infer<typeof callInput>;

async function loadPrivateSettings(supabase: unknown) {
  const rpcClient = supabase as {
    rpc: (name: never, args: never) => PromiseLike<{ data: unknown; error: unknown }>;
  };
  const { data, error } = await rpcClient.rpc("voice_agent_settings" as never, {} as never);
  if (error) throw new Error("Voice agent settings are unavailable.");
  return privateSettingsInput.parse(data);
}

export const getVoiceAgentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => emptyInput.parse(input ?? {}))
  .handler(async ({ context }) => {
    const settings = await loadPrivateSettings(context.supabase);
    return publicSettings(settings);
  });

export const configureVoiceAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        enabled: z.boolean(),
        provider: z.literal("africas_talking"),
        providerNumber: z
          .string()
          .trim()
          .regex(/^\+[1-9][0-9]{7,14}$/),
        extension: z
          .string()
          .trim()
          .max(12)
          .regex(/^[0-9A-Za-z*#]{1,12}$/)
          .optional()
          .or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc(
      "voice_agent_configure" as never,
      {
        p_enabled: data.enabled,
        p_provider: data.provider,
        p_provider_number: data.providerNumber,
        p_extension: data.extension || null,
      } as never,
    );
    if (error) throw new Error("Voice agent settings could not be saved.");
    return publicSettings(await loadPrivateSettings(context.supabase));
  });

function publicSettings(settings: z.infer<typeof privateSettingsInput>): VoiceAgentSettings {
  const { tenantRef: _tenantRef, ...visible } = settings;
  return visible;
}

export const requestVoiceCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        category: z.enum(["fee_reminder", "absence_alert"]),
        recipientPhone: z
          .string()
          .trim()
          .regex(/^\+[1-9][0-9]{7,14}$/),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const settings = await loadPrivateSettings(context.supabase);
    if (!settings.enabled) throw new Error("Voice agent is not enabled for this organization.");
    const { assertVoiceRecipientConsent } =
      await import("@/lib/communications/voice-consent.server");
    await assertVoiceRecipientConsent(settings.tenantRef, data.recipientPhone);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: callId, error } = await supabaseAdmin.rpc(
      "voice_agent_request_call" as never,
      {
        p_tenant_ref: settings.tenantRef,
        p_requester: context.userId,
        p_category: data.category,
        p_recipient_phone: data.recipientPhone,
        p_subject_ref: null,
      } as never,
    );
    if (error || typeof callId !== "string") {
      throw new Error("Voice call request could not be queued. Check consent and permissions.");
    }
    return { callId };
  });

export const listVoiceCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => emptyInput.parse(input ?? {}))
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc(
      "voice_agent_pending_calls" as never,
      {} as never,
    );
    if (error) throw new Error("Voice call approvals are unavailable.");
    return z.array(callInput).parse(data ?? []);
  });

export const decideVoiceCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ callId: z.string().uuid(), approve: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc(
      "voice_agent_decide_call" as never,
      { p_call_id: data.callId, p_approve: data.approve } as never,
    );
    if (error) throw new Error("Voice call decision could not be recorded.");
    return { status: data.approve ? "approved" : "rejected" };
  });

const claimedCallInput = z.object({
  id: z.string().uuid(),
  tenantRef: z.string().uuid(),
  provider: z.literal(AFRICAS_TALKING_PROVIDER_ID),
  category: z.enum(["fee_reminder", "absence_alert"]),
  fromNumber: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
  recipientPhone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
  script: z.string().min(1).max(500),
});

export const dispatchApprovedVoiceCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => callIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const settings = await loadPrivateSettings(context.supabase);
    if (!settings.enabled || !settings.voiceLive) return { status: "live_voice_disabled" as const };

    const config = africaTalkingVoiceConfigFromEnv(process.env);
    if (!config) return { status: "provider_not_configured" as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: target, error: targetError } = await supabaseAdmin.rpc(
      "voice_agent_approved_call_target" as never,
      { p_call_id: data.callId, p_tenant_ref: settings.tenantRef } as never,
    );
    if (targetError) throw new Error("Approved call could not be verified for dispatch.");
    const targetCall = z
      .object({
        tenantRef: z.string().uuid(),
        recipientPhone: z.string().regex(/^\+[1-9][0-9]{7,14}$/),
      })
      .parse(target);
    if (targetCall.tenantRef !== settings.tenantRef) {
      throw new Error("Approved call is outside the active organization.");
    }
    const { assertVoiceRecipientConsent } =
      await import("@/lib/communications/voice-consent.server");
    await assertVoiceRecipientConsent(settings.tenantRef, targetCall.recipientPhone);
    const { data: claimed, error: claimError } = await supabaseAdmin.rpc(
      "voice_agent_claim_call" as never,
      { p_call_id: data.callId, p_tenant_ref: settings.tenantRef } as never,
    );
    if (claimError) throw new Error("Approved call could not be claimed for dispatch.");
    const call = claimedCallInput.parse(claimed);
    const adapter = createAfricaTalkingVoiceAdapter({
      config,
      fromNumber: call.fromNumber,
      callId: call.id,
    });
    const registry = createAfricaTalkingVoiceProviderRegistry(process.env);
    const command: TelephonyCallCommand = {
      callKind: call.category,
      tenantRef: call.tenantRef,
      recipientName: "Recipient",
      recipientPhone: call.recipientPhone,
      script: call.script,
      triggerEvent: call.id,
    };

    let result: Awaited<ReturnType<typeof adapter.placeCall>>;
    try {
      result = await adapter.placeCall(command, registry);
    } catch {
      result = {
        outcome: "failed",
        code: "provider_error",
        reason: "Provider call failed.",
        retryable: false,
        httpStatus: null,
      };
    }
    const receipt = isTelephonyCallReceipt(result) ? result : null;
    const { error: finishError } = await supabaseAdmin.rpc(
      "voice_agent_finish_call" as never,
      {
        p_call_id: call.id,
        p_succeeded: receipt !== null,
        p_provider_call_id: receipt?.callId ?? null,
      } as never,
    );
    if (finishError) throw new Error("Voice call outcome could not be recorded.");
    return { status: receipt ? ("completed" as const) : ("failed" as const) };
  });
