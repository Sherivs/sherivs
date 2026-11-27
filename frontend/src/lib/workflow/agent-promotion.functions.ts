/**
 * A3 (ADR-138): server functions for promoting an agent with a passkey. Only the platform founder (super admin) can
 * call them; the database re-checks that and the evidence. Two steps so the signed challenge is bound to one promotion.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clientIpFromHeaders } from "@/lib/security/request-safety";
import { WEBAUTHN_PUBLIC_ERROR } from "@/lib/auth/webauthn-policy";

const Promotion = z.object({
  orgId: z.string().uuid(),
  agentRef: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  toLevel: z.enum(["draft", "act_with_approval", "act_and_report"]),
  evidenceId: z.string().uuid(),
  reason: z.string().trim().min(10).max(300),
});

const AuthenticationResponseSchema = z.object({
  id: z.string().min(16).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().min(16).max(16_384),
    authenticatorData: z.string().min(16).max(16_384),
    signature: z.string().min(16).max(16_384),
    userHandle: z.string().max(256).optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  authenticatorAttachment: z.string().max(32).optional(),
});

type Rpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

async function assertFounder(context: { supabase: unknown }): Promise<void> {
  const { data, error } = await (context.supabase as Rpc).rpc("is_super_admin");
  if (error || data !== true) throw new Error("Not authorized");
}

async function build() {
  const [{ createProductionWebAuthnService, requestOrigin }, { supabaseAdmin }, core] =
    await Promise.all([
      import("@/lib/auth/webauthn-supabase.server"),
      import("@/integrations/supabase/client.server"),
      import("./agent-promotion-step-up"),
    ]);
  const service = await createProductionWebAuthnService();
  const origin = requestOrigin(getRequest());
  const db = supabaseAdmin as unknown as Rpc & {
    from: (t: string) => {
      insert: (row: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
    };
  };
  const rateKey = (userId: string) => `user:${userId}:${clientIpFromHeaders(getRequest().headers)}`;
  return core.createAgentPromotionStepUp({
    webauthn: {
      assertionOptions: (i) =>
        service.assertionOptions({ ...i, origin, rateKey: rateKey(i.userId) }),
      verifyAssertion: async (i) => {
        const r = await service.verifyAssertion({
          userId: i.userId,
          origin,
          rateKey: rateKey(i.userId),
          response: i.response as never,
          challengeAccepted: i.challengeAccepted,
        });
        return { verifiedAtMs: r.verifiedAtMs };
      },
    },
    evidence: {
      async record(row) {
        const { error } = await db.from("wf_sensitive_step_up").insert({
          user_id: row.userId,
          action_kind: row.actionKind,
          subject_digest: row.subjectDigest,
          verified_at: row.verifiedAt,
          expires_at: row.expiresAt,
        });
        if (error) throw new Error("insert_failed");
      },
    },
    gate: {
      async promote(i) {
        const { data, error } = await db.rpc("wf_autonomy_promote", {
          p_actor: i.actorId,
          p_org: i.orgId,
          p_agent: i.agentRef,
          p_to_level: i.toLevel,
          p_evidence: i.evidenceId,
          p_reason: i.reason,
        });
        if (error) return { ok: false, message: "The promotion was refused." };
        const r = (data ?? {}) as { from?: string; to?: string };
        return { ok: true, from: String(r.from ?? ""), to: String(r.to ?? "") };
      },
    },
  });
}

function publicMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === "passkey_failed") return WEBAUTHN_PUBLIC_ERROR.auth_failed;
  if (code === "invalid_request") return "The promotion request is not valid.";
  if (code === "promotion_refused") return "The promotion was refused.";
  return "The promotion could not be completed.";
}

export const beginAgentPromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => Promotion.parse(input))
  .handler(async ({ context, data }) => {
    await assertFounder(context);
    try {
      return await (await build()).begin({ userId: context.userId, req: data });
    } catch (err) {
      throw new Error(publicMessage(err));
    }
  });

export const finishAgentPromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        request: Promotion,
        nonce: z.string().length(22),
        response: AuthenticationResponseSchema,
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertFounder(context);
    try {
      return await (
        await build()
      ).finish({
        userId: context.userId,
        req: data.request,
        nonce: data.nonce,
        response: data.response,
      });
    } catch (err) {
      throw new Error(publicMessage(err));
    }
  });
