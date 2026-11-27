/**
 * WF-12: server functions behind the workflow limits and retention screen (ADR-124).
 *
 * Every function requires a signed-in session; the person's id comes from the verified session and
 * is passed to SECURITY DEFINER database functions that decide everything else (organisation,
 * permission, safe bounds, dry-run-before-purge) and audit the change. Results carry counts and
 * codes, never row contents. Time never enters here.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  LimitsError,
  LimitsUpdateInput,
  RetentionRunInput,
  limitErrorMessage,
} from "./workflow/limits";
import type { LimitsPorts } from "./workflow/limits.server";

type Rpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: unknown; code?: unknown } | null }>;
};

async function ports(): Promise<LimitsPorts> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { rpc: (fn, args) => (supabaseAdmin as unknown as Rpc).rpc(fn, args) };
}

/** Server functions throw plain messages; a refusal carries its safe sentence, nothing else. */
function surface(err: unknown): never {
  if (err instanceof LimitsError) throw new Error(err.message);
  throw new Error(limitErrorMessage("unavailable"));
}

export const getWorkflowLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { getLimits } = await import("./workflow/limits.server");
      return await getLimits(await ports(), { actorId: context.userId });
    } catch (err) {
      return surface(err);
    }
  });

export const updateWorkflowLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => LimitsUpdateInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { updateLimits } = await import("./workflow/limits.server");
      return await updateLimits(await ports(), { actorId: context.userId, patch: data });
    } catch (err) {
      return surface(err);
    }
  });

export const runWorkflowRetention = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => RetentionRunInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { runRetention } = await import("./workflow/limits.server");
      return await runRetention(await ports(), { actorId: context.userId, ...data });
    } catch (err) {
      return surface(err);
    }
  });
