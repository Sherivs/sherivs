/**
 * AIN-05: server functions behind the agent console (ADR-129). The person's id comes from the verified session and is
 * passed to SECURITY DEFINER database functions that decide everything else. Results carry codes, counts and the short
 * memory value a manager is allowed to see; never the text of a screened output.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  AgentConsoleError,
  AgentDemoteInput,
  MemoryDecideInput,
  MemoryListInput,
  MemoryRetireInput,
  SafetyListInput,
  SafetyReviewInput,
  consoleErrorMessage,
} from "./workflow/agent-console";
import type { AgentConsolePorts } from "./workflow/agent-console.server";

type Rpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: unknown; code?: unknown } | null }>;
};

async function ports(): Promise<AgentConsolePorts> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Rpc;
  return { rpc: (fn, args) => db.rpc(fn, args) };
}

function surface(err: unknown): never {
  if (err instanceof AgentConsoleError) throw new Error(err.message);
  throw new Error(consoleErrorMessage("unavailable"));
}

export const loadAgentConsole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      const { loadAgents } = await import("./workflow/agent-console.server");
      return await loadAgents(await ports(), { actorId: context.userId });
    } catch (err) {
      return surface(err);
    }
  });

export const listConsoleMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => MemoryListInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { listMemory } = await import("./workflow/agent-console.server");
      return await listMemory(await ports(), { actorId: context.userId, ...data });
    } catch (err) {
      return surface(err);
    }
  });

export const listConsoleSafety = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SafetyListInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { listSafety } = await import("./workflow/agent-console.server");
      return await listSafety(await ports(), { actorId: context.userId, ...data });
    } catch (err) {
      return surface(err);
    }
  });

export const decideConsoleMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => MemoryDecideInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { decideMemory } = await import("./workflow/agent-console.server");
      return await decideMemory(await ports(), { actorId: context.userId, ...data });
    } catch (err) {
      return surface(err);
    }
  });

export const retireConsoleMemory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => MemoryRetireInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { retireMemory } = await import("./workflow/agent-console.server");
      return await retireMemory(await ports(), { actorId: context.userId, ...data });
    } catch (err) {
      return surface(err);
    }
  });

export const reviewConsoleSafety = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SafetyReviewInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { reviewSafety } = await import("./workflow/agent-console.server");
      return await reviewSafety(await ports(), { actorId: context.userId, ...data });
    } catch (err) {
      return surface(err);
    }
  });

export const demoteConsoleAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => AgentDemoteInput.parse(input))
  .handler(async ({ context, data }) => {
    try {
      const { demoteAgent } = await import("./workflow/agent-console.server");
      return await demoteAgent(await ports(), { actorId: context.userId, ...data });
    } catch (err) {
      return surface(err);
    }
  });
