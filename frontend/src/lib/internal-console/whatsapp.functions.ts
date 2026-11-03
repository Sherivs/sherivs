import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeWhatsAppPhone } from "@/lib/communications/whatsapp-phone";

const requestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128),
  orgRef: z.string().trim().min(1).max(160),
  principalRef: z.string().trim().min(1).max(160),
  address: z
    .string()
    .trim()
    .transform((value) => normalizeWhatsAppPhone(value) ?? "")
    .pipe(z.string().regex(/^\+[1-9]\d{7,14}$/)),
  consentEvidence: z.string().trim().min(1).max(500),
});

export const requestWhatsAppRecipientLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => requestSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requestRecipientLink } = await import("./whatsapp.store.server");
    return requestRecipientLink(context as never, data);
  });

export const getWhatsAppHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getWhatsAppHealthReport } = await import("./whatsapp.store.server");
    return getWhatsAppHealthReport(context as never);
  });

export const listWhatsAppRecipientLinkRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ tenantId: z.string().trim().min(1).max(128) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { listRecipientLinkRequests } = await import("./whatsapp.store.server");
    return listRecipientLinkRequests(context as never, data);
  });

const reviewSchema = z.object({
  tenantId: z.string().trim().min(1).max(128),
  requestId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  reviewNote: z.string().trim().max(500).optional(),
});

export const reviewWhatsAppRecipientLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => reviewSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { reviewRecipientLink } = await import("./whatsapp.store.server");
    return reviewRecipientLink(context as never, data);
  });
