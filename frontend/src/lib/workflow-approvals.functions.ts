/**
 * WF-07: server functions behind the tenant approval inbox (ADR-122).
 *
 * Every function requires a signed-in session; the person's id comes from the verified session and
 * is passed to SECURITY DEFINER database functions that decide everything else (permission,
 * requester/author separation, one vote each, content digest, passkey evidence). Results carry
 * codes and counts, never secrets or provider text. Time never enters here: the database owns the
 * clock for expiry and the five-minute passkey window.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clientIpFromHeaders } from "@/lib/security/request-safety";
import {
  ApprovalDecideInput,
  ApprovalIdInput,
  ApprovalInboxError,
  ApprovalListInput,
  approvalErrorMessage,
} from "./workflow/approval-inbox";
import type { ApprovalInboxPorts } from "./workflow/approval-inbox.server";

type Rpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: unknown; code?: unknown } | null }>;
};

async function ports(): Promise<ApprovalInboxPorts> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { newApprovalStepUpNonce } = await import("./workflow/approval-step-up");
  const request = getRequest();
  return {
    rpc: (fn, args) => (supabaseAdmin as unknown as Rpc).rpc(fn, args),
    webauthn: async () => {
      const { createProductionWebAuthnService, requestOrigin } =
        await import("@/lib/auth/webauthn-supabase.server");
      return {
        service: await createProductionWebAuthnService(),
        origin: requestOrigin(request),
      };
    },
    rateKey: (userId) => `user:${userId}:${clientIpFromHeaders(request.headers)}`,
    nonce: newApprovalStepUpNonce,
  };
}

/** Server functions throw plain messages; a refusal carries its safe sentence, nothing else. */
function surface(err: unknown): never {
  if (err instanceof ApprovalInboxError) throw new Error(err.message);
  throw new Error(approvalErrorMessage("unavailable"));
}

export const listApprovalInbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ApprovalListInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { listApprovals } = await import("./workflow/approval-inbox.server");
      return await listApprovals(await ports(), { actorId: context.userId, filter: data.filter });
    } catch (err) {
      return surface(err);
    }
  });

export const getApprovalDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ApprovalIdInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { viewApproval } = await import("./workflow/approval-inbox.server");
      return await viewApproval(await ports(), {
        actorId: context.userId,
        approvalId: data.approvalId,
      });
    } catch (err) {
      return surface(err);
    }
  });

export const beginApprovalStepUp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ApprovalIdInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { beginApprovalStepUp: begin } = await import("./workflow/approval-inbox.server");
      return await begin(await ports(), { actorId: context.userId, approvalId: data.approvalId });
    } catch (err) {
      return surface(err);
    }
  });

export const decideApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ApprovalDecideInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { decideApproval: decide } = await import("./workflow/approval-inbox.server");
      return await decide(await ports(), { ...data, actorId: context.userId });
    } catch (err) {
      return surface(err);
    }
  });
