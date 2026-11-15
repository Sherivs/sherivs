/**
 * Model port backed by the existing AI gateway (ENGINE-07, ADR-085).
 *
 * The gateway keeps owning provider choice, budgets, rate limits and metering.
 * This adapter only maps one draft-only text generation onto it and maps every
 * gateway outcome onto the loop's `ModelResult`. It deliberately declares NO
 * `memoryContext`: the loop supplies its own context-scoped memory, so the
 * gateway's persistent-memory retrieval is never engaged for an agent turn.
 */
import { generateText } from "ai";
import { invokeAiGateway, type AiGatewayInvokeRequest } from "../ai-gateway.server";
import type { ModelRequest, ModelResult } from "./agent-loop";

export interface GatewayModelDeps {
  readonly tenantRef: string;
  /** The agent identity acting; never a human user id. */
  readonly actorRef: string;
  readonly agentRef: string;
  readonly missionRef?: string | null;
  readonly model: string;
  /** Gateway guard config (budget, ledger, rate limiter, failure policy, registry...). */
  readonly gatewayOptions?: Partial<
    Pick<
      AiGatewayInvokeRequest<string>,
      | "budget"
      | "ledger"
      | "rateLimiter"
      | "failurePolicy"
      | "modelRegistry"
      | "routingRequirements"
      | "rates"
      | "logSink"
    >
  >;
  /** Injectable for tests; defaults to the real gateway and text generation. */
  readonly gateway?: typeof invokeAiGateway;
  readonly generate?: typeof generateText;
}

export function createGatewayModelPort(deps: GatewayModelDeps) {
  const gateway = deps.gateway ?? invokeAiGateway;
  const generate = deps.generate ?? generateText;
  return {
    async generate(req: ModelRequest): Promise<ModelResult> {
      const outcome = await gateway<string>({
        tenantRef: deps.tenantRef,
        actorRef: deps.actorRef,
        agentRef: deps.agentRef,
        missionRef: deps.missionRef ?? null,
        model: deps.model,
        provider: "ai-gateway",
        purpose: "workflow_assistance",
        ...deps.gatewayOptions,
        invoke: async (provider) => {
          const { text, usage } = await generate({
            model: provider(deps.model),
            system: req.system,
            prompt: req.prompt,
            maxOutputTokens: req.maxOutputTokens,
          });
          return {
            payload: text,
            tokensIn: usage?.inputTokens ?? 0,
            tokensOut: usage?.outputTokens ?? 0,
          };
        },
      });
      if (outcome.decision === "deny") {
        return { ok: false, code: outcome.code === "provider_failed" ? "failed" : "denied" };
      }
      return {
        ok: true,
        text: outcome.payload,
        tokensIn: outcome.usage.tokensIn,
        tokensOut: outcome.usage.tokensOut,
      };
    },
  };
}
