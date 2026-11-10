import { z } from "zod";
import {
  decideVoiceConsent,
  parseVoiceRecipientRef,
} from "@/lib/communications/voice-number-binding";

const tenantInput = z.string().uuid();

export async function assertVoiceRecipientConsent(tenantRef: string, recipientUserId: string) {
  const tenant = tenantInput.parse(tenantRef);
  const recipient = parseVoiceRecipientRef(recipientUserId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: mapping, error: mappingError } = await supabaseAdmin
    .from("school_tenant_map" as never)
    .select("school_id" as never)
    .eq("tenant_id" as never, tenant)
    .maybeSingle();
  const parsedMapping = z.object({ school_id: z.string().uuid() }).safeParse(mapping);
  if (mappingError || !parsedMapping.success) {
    throw new Error("Recipient voice consent could not be verified.");
  }
  const callerOrgId = parsedMapping.data.school_id;

  const { data: membership, error: membershipError } = await supabaseAdmin
    .from("organization_memberships" as never)
    .select("school_id" as never)
    .eq("user_id" as never, recipient)
    .eq("school_id" as never, callerOrgId)
    .eq("is_active" as never, true)
    .maybeSingle();
  const parsedMembership = z.object({ school_id: z.string().uuid() }).safeParse(membership);
  if (membershipError || !parsedMembership.success) {
    throw new Error("Recipient is not a member of this organization.");
  }

  const { data: user, error: userError } = await supabaseAdmin
    .from("users" as never)
    .select("phone" as never)
    .eq("id" as never, recipient)
    .eq("school_id" as never, callerOrgId)
    .maybeSingle();
  const parsedUser = z.object({ phone: z.string().nullable() }).safeParse(user);
  if (userError || !parsedUser.success) {
    throw new Error("Recipient has no confirmed voice number.");
  }

  const phoneVariants = [parsedUser.data.phone, parsedUser.data.phone?.replace(/^\+/, "")].filter(
    (value): value is string => Boolean(value),
  );
  const { data: consent, error: consentError } = await supabaseAdmin
    .from("comms_optins" as never)
    .select("status" as never)
    .eq("school_id" as never, callerOrgId)
    .eq("channel" as never, "voice")
    .in("phone" as never, phoneVariants as never)
    .maybeSingle();
  const parsedConsent = z.object({ status: z.string() }).safeParse(consent);
  decideVoiceConsent({
    recipientUserId: recipient,
    callerOrgId,
    membershipOrgIds: [parsedMembership.data.school_id],
    phone: parsedUser.data.phone,
    phoneConfirmed: true,
    optedIn: !consentError && parsedConsent.success && parsedConsent.data.status === "opted_in",
  });
}
