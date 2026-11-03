import { assertInternalAal2 } from "@/lib/security/mfa-server";
import { writeAuditRecord } from "@/lib/server/write-audit";
import { assertConsoleCapability, hasConsoleCapability } from "./console-access.server";

type Context = {
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> };
  claims: { exp: number; aal?: unknown };
  userId: string;
};

type RpcResult = { data: unknown; error: { code?: string } | null };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as {
    rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
  };
}

export async function requestRecipientLink(
  context: Context,
  input: {
    tenantId: string;
    orgRef: string;
    principalRef: string;
    address: string;
    consentEvidence: string;
  },
) {
  const isConsoleAdmin = await hasConsoleCapability(context, "platform.tenants.manage");
  const db = isConsoleAdmin ? await admin() : context.supabase;
  const { data, error } = await db.rpc(
    isConsoleAdmin
      ? "cg_whatsapp_request_recipient_link_internal"
      : "cg_whatsapp_request_recipient_link",
    {
      p_tenant_id: input.tenantId,
      p_org_ref: input.orgRef,
      p_principal_ref: input.principalRef,
      p_address: input.address,
      p_consent_evidence: input.consentEvidence,
      ...(isConsoleAdmin ? { p_requested_by: context.userId } : {}),
    },
  );
  if (error || typeof data !== "string") throw new Error("WhatsApp recipient-link request failed.");
  return { id: data };
}

export async function getWhatsAppHealthReport(context: Context) {
  const canReadOperations = await hasConsoleCapability(
    context,
    "platform.operations.read",
    "organization.summary.read",
  );
  if (!canReadOperations) await assertConsoleCapability(context, "platform.tenants.manage");
  const db = await admin();
  const { data, error } = await db.rpc("cg_whatsapp_health");
  if (error || !Array.isArray(data) || data.length !== 1) {
    throw new Error("WhatsApp health report is unavailable.");
  }
  const row = data[0] as Record<string, unknown>;
  return {
    configured: {
      token: Boolean(process.env.WHATSAPP_TOKEN?.trim()),
      phoneNumberId: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()),
      appSecret: Boolean(process.env.WHATSAPP_APP_SECRET?.trim()),
      verifyToken: Boolean(process.env.WHATSAPP_VERIFY_TOKEN?.trim()),
      graphVersion: Boolean(process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v21.0"),
      autoAck: Boolean(
        (
          process.env.WHATSAPP_AUTO_ACK_TEXT ??
          "Thanks for your message. A Sherivs team member will respond soon."
        ).trim(),
      ),
    },
    mappedSenderCount: typeof row.mapped_sender_count === "number" ? row.mapped_sender_count : 0,
    lastInboundAt: typeof row.last_inbound_at === "string" ? row.last_inbound_at : null,
    lastStatusAt: typeof row.last_status_at === "string" ? row.last_status_at : null,
    unmappedSenderCount:
      typeof row.unmapped_sender_count === "number" ? row.unmapped_sender_count : 0,
  };
}

export async function listRecipientLinkRequests(context: Context, input: { tenantId: string }) {
  await assertConsoleCapability(context, "platform.tenants.manage");
  const { data: isTenantAdmin, error: scopeError } = await context.supabase.rpc("is_tenant_admin", {
    p_tenant: input.tenantId,
  });
  if (scopeError || isTenantAdmin !== true) {
    throw new Error("WhatsApp recipient-link requests are unavailable.");
  }
  const db = await admin();
  const { data, error } = await db.rpc("cg_whatsapp_list_recipient_link_requests", {
    p_tenant_id: input.tenantId,
  });
  if (error || !Array.isArray(data)) {
    throw new Error("WhatsApp recipient-link requests are unavailable.");
  }
  return data;
}

export async function reviewRecipientLink(
  context: Context,
  input: {
    tenantId: string;
    requestId: string;
    decision: "approved" | "rejected";
    reviewNote?: string;
  },
) {
  assertInternalAal2(context.claims);
  await assertConsoleCapability(context, "platform.tenants.manage");
  const { data: isTenantAdmin, error: scopeError } = await context.supabase.rpc("is_tenant_admin", {
    p_tenant: input.tenantId,
  });
  if (scopeError || isTenantAdmin !== true) {
    throw new Error("WhatsApp recipient-link review failed.");
  }
  const db = await admin();
  const { data, error } = await db.rpc("cg_whatsapp_review_recipient_link", {
    p_request_id: input.requestId,
    p_tenant_id: input.tenantId,
    p_decision: input.decision,
    p_reviewer_ref: context.userId,
    p_review_note: input.reviewNote ?? null,
  });
  if (error || data !== true) throw new Error("WhatsApp recipient-link review failed.");
  await writeAuditRecord(db as never, {
    action: `communications.whatsapp.recipient_link.${input.decision}`,
    gate: "has_internal_console_capability:platform.tenants.manage",
    tenantId: null,
    actorId: context.userId,
    table: "cg_whatsapp_recipient_link_request",
    recordId: input.requestId,
    outcome: "succeeded",
    details: { decision: input.decision },
  });
  return { ok: true as const };
}
