import { createFileRoute } from "@tanstack/react-router";
import {
  N8nWhatsAppReplySchema,
  verifyN8nWhatsAppSignature,
} from "@/lib/communications/whatsapp-n8n.server";
import { sendWhatsAppMessage } from "@/lib/communications/whatsapp-cloud.server";

type ReplyDb = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { code?: string } | null }>;
};

async function handleReply(request: Request): Promise<Response> {
  const secret = process.env.N8N_WHATSAPP_SIGNING_SECRET;
  if (!secret || secret.length < 32)
    return new Response("Reply endpoint is not configured", { status: 503 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 16 * 1024)
    return new Response("Payload too large", { status: 413 });
  if (
    !verifyN8nWhatsAppSignature({
      rawBody,
      timestamp: request.headers.get("x-sherivs-timestamp"),
      signature: request.headers.get("x-sherivs-signature"),
      secret,
    })
  )
    return new Response("Unauthorized", { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid reply payload", { status: 400 });
  }
  const parsed = N8nWhatsAppReplySchema.safeParse(payload);
  if (!parsed.success) return new Response("Invalid reply payload", { status: 400 });

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as ReplyDb;
  const { data, error } = await db.rpc("cg_whatsapp_prepare_n8n_reply", {
    p_reply_id: parsed.data.reply_id,
    p_inbound_provider_ref: parsed.data.inbound_provider_ref,
    p_conversation_id: parsed.data.conversation_id,
    p_body: parsed.data.body,
  });
  if (error) return new Response("Reply not authorized", { status: 403 });
  if (!Array.isArray(data) || data.length === 0)
    return Response.json({ ok: true, duplicate: true }, { status: 202 });
  if (data.length !== 1) return new Response("Reply not authorized", { status: 403 });
  const target = data[0] as Record<string, unknown>;
  if (
    typeof target.tenant_id !== "string" ||
    typeof target.org_ref !== "string" ||
    typeof target.principal_ref !== "string" ||
    typeof target.provider_sender_ref !== "string" ||
    typeof target.conversation_id !== "string" ||
    typeof target.recipient_address !== "string" ||
    typeof target.claim_token !== "string"
  )
    return new Response("Reply not authorized", { status: 403 });

  let result: Awaited<ReturnType<typeof sendWhatsAppMessage>>;
  try {
    result = await sendWhatsAppMessage({
      tenantId: target.tenant_id,
      orgRef: target.org_ref,
      principalRef: target.principal_ref,
      conversationId: target.conversation_id,
      inboundProviderSenderRef: target.provider_sender_ref,
      inboundProviderRef: parsed.data.inbound_provider_ref,
      expectedRecipientAddress: target.recipient_address,
      body: parsed.data.body,
      retryTransient: false,
    });
  } catch {
    result = { ok: false, error: "WhatsApp reply failed" };
  }
  const { data: recorded, error: recordError } = await db.rpc("cg_whatsapp_n8n_reply_result", {
    p_tenant_id: target.tenant_id,
    p_reply_id: parsed.data.reply_id,
    p_inbound_provider_ref: parsed.data.inbound_provider_ref,
    p_conversation_id: parsed.data.conversation_id,
    p_claim_token: target.claim_token,
    p_status: result.ok ? "sent" : "failed",
  });
  if (recordError || recorded !== true)
    return new Response("Reply outcome could not be recorded", { status: 503 });
  return result.ok
    ? Response.json({ ok: true }, { status: 200 })
    : Response.json({ ok: false, error: "reply_failed" }, { status: 502 });
}

export const Route = createFileRoute("/api/public/webhooks/whatsapp-reply")({
  server: { handlers: { POST: ({ request }) => handleReply(request) } },
});
