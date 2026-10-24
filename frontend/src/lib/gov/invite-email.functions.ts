/**
 * SHERIVS-B07 — send an officer invite by email right after it is created.
 * The DB re-verifies caller (gov admin + MFA) and the one-time token by hash. Without RESEND_API_KEY /
 * RESEND_FROM_ADDRESS the adapter returns provider_not_configured, recorded as "stubbed"; the UI then
 * falls back to the copy-link flow. The token is never logged or stored in clear.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createResendEmailAdapter, createResendEmailProviderRegistry, resendEmailConfigFromEnv } from "@/lib/communications/resend-email.server";
import { buildInviteEmail, inviteLink, mapEmailOutcome, safeOrigin, type InviteMailContext } from "@/lib/gov/invite-email";

export const sendGovInviteEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: unknown) => z.object({ token: z.string().regex(/^[0-9a-f]{48}$/), origin: z.string().max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    // These RPCs are newer than the generated Database types.
    const db = context.supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };
    const origin = safeOrigin(process.env.PUBLIC_APP_ORIGIN ?? data.origin);
    if (!origin) throw new Error("invalid origin for invite link");
    const { data: ctx, error } = await db.rpc("gov_officer_invite_mail_context", { p_token: data.token });
    if (error || !ctx) throw new Error(error?.message ?? "invite not found");
    const c = ctx as InviteMailContext;
    const mail = buildInviteEmail(c, inviteLink(origin, data.token));
    const env = process.env as Record<string, string | undefined>;
    const adapter = createResendEmailAdapter(resendEmailConfigFromEnv(env));
    const result = await adapter.send({
      notification: { id: c.invite_id, tenantRef: "gov", recipientRef: c.invite_id, audienceKind: "user", category: "system",
        subject: mail.subject, body: mail.body, actionRef: "/gov-invite", state: "queued", createdAt: c.now },
      recipientAddress: c.email, subject: mail.subject, body: mail.body,
    }, createResendEmailProviderRegistry(env));
    const m = mapEmailOutcome(result as { outcome?: string; code?: string; providerMessageId?: string });
    const { error: e2 } = await db.rpc("gov_officer_invite_mark_email", { p_invite: c.invite_id, p_status: m.status, p_detail: m.detail });
    if (e2) throw new Error(e2.message);
    return { status: m.status };
  });
