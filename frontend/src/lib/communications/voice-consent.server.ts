import { z } from "zod";

const tenantInput = z.string().uuid();
const phoneInput = z.string().regex(/^\+[1-9][0-9]{7,14}$/);

export async function assertVoiceRecipientConsent(tenantRef: string, recipientPhone: string) {
  const tenant = tenantInput.parse(tenantRef);
  const phone = phoneInput.parse(recipientPhone);
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

  const phoneVariants = [phone, phone.slice(1)];
  const { data: consent, error: consentError } = await supabaseAdmin
    .from("comms_optins" as never)
    .select("status" as never)
    .eq("school_id" as never, parsedMapping.data.school_id)
    .eq("channel" as never, "voice")
    .in("phone" as never, phoneVariants as never)
    .maybeSingle();
  const parsedConsent = z.object({ status: z.string() }).safeParse(consent);
  if (consentError || !parsedConsent.success || parsedConsent.data.status !== "opted_in") {
    throw new Error("Recipient has not opted in to voice calls.");
  }
}
