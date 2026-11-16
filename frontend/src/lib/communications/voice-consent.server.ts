import { z } from "zod";
import { parseVoiceRecipientRef } from "@/lib/communications/voice-number-binding";

const tenantInput = z.string().uuid();

function consentErrorMessage(error: { message?: string } | null): string {
  const message = error?.message ?? "";
  if (/outside this organization/i.test(message)) {
    return "Recipient is not a member of this organization.";
  }
  if (/opted in/i.test(message)) {
    return "Recipient has not opted in to voice calls.";
  }
  if (/confirmed voice number/i.test(message)) {
    return "Recipient has no confirmed voice number.";
  }
  return "Recipient voice consent could not be verified.";
}

/**
 * Confirms the member may receive a voice call.
 * Phone confirmation, membership, and normalized opt-in are decided by
 * voice_agent_assert_recipient_consent (service role). Membership comes from
 * organization_memberships inside that RPC. This function does not invent
 * phone confirmation.
 */
export async function assertVoiceRecipientConsent(tenantRef: string, recipientUserId: string) {
  const tenant = tenantInput.parse(tenantRef);
  const recipient = parseVoiceRecipientRef(recipientUserId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.rpc(
    "voice_agent_assert_recipient_consent" as never,
    { p_tenant_ref: tenant, p_recipient_user: recipient } as never,
  );
  if (error) {
    throw new Error(consentErrorMessage(error as { message?: string }));
  }
}
