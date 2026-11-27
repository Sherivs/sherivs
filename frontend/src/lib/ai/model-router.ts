/**
 * Provider-agnostic model router (port only). No vendor SDK, no network, no real call lives here.
 * A provider is an adapter that implements `ModelProvider`; the router chooses one by data class, task, health and cost,
 * screens the input and the output with the AIN-04 guardrails, and refuses rather than falling back to a provider that
 * is not cleared for the data. Switching or adding a vendor is registering an adapter, never a change to callers.
 */
import { screenText } from "../workflow/ai-guardrails";

/** Most to least sensitive. A provider is cleared up to a ceiling; the request carries the class of what it sends. */
export type DataClass = "public" | "internal" | "personal" | "restricted";
const RANK: Readonly<Record<DataClass, number>> = {
  public: 0,
  internal: 1,
  personal: 2,
  restricted: 3,
};

export type TaskKind = "answer" | "draft" | "classify" | "summarise";

export interface ModelRequest {
  readonly org: string;
  readonly task: TaskKind;
  readonly dataClass: DataClass;
  readonly prompt: string;
  readonly maxOutputTokens: number;
}
export interface ModelResponse {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ModelProvider {
  readonly id: string;
  /** Highest data class this provider may be sent (set by the founder per provider after review, never by code). */
  readonly clearedUpTo: DataClass;
  readonly tasks: readonly TaskKind[];
  /** Minor units (kobo) per 1,000 tokens. */
  readonly inputCostPer1k: number;
  readonly outputCostPer1k: number;
  /** Lower is tried first among eligible providers. */
  readonly priority: number;
  call(req: ModelRequest): Promise<ModelResponse>;
}

export type RouterRefusal =
  | "input_blocked"
  | "no_eligible_provider"
  | "over_cost_cap"
  | "all_providers_failed"
  | "output_blocked";

export type RouteResult =
  | {
      readonly ok: true;
      readonly provider: string;
      readonly response: ModelResponse;
      readonly costMinor: number;
      /** `flagged` output needs a person's decision before use (AIN-04); `clean` is usable. */
      readonly outputVerdict: "clean" | "flagged";
      readonly attempts: readonly { provider: string; error?: string }[];
    }
  | {
      readonly ok: false;
      readonly refusal: RouterRefusal;
      readonly codes: readonly string[];
      readonly attempts: readonly { provider: string; error?: string }[];
    };

export interface RouterOptions {
  /** Hard cap for one call, in minor units, checked before any call from the stated token ceilings. */
  readonly maxCostMinorPerCall: number;
  /** Rough size estimate; the default is 4 characters per token. */
  readonly estimateTokens?: (text: string) => number;
}

export function estimateCostMinor(p: ModelProvider, inTok: number, outTok: number): number {
  return Math.ceil((inTok / 1000) * p.inputCostPer1k + (outTok / 1000) * p.outputCostPer1k);
}

export function eligibleProviders(
  providers: readonly ModelProvider[],
  req: ModelRequest,
): ModelProvider[] {
  return providers
    .filter((p) => RANK[p.clearedUpTo] >= RANK[req.dataClass] && p.tasks.includes(req.task))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export async function routeModelCall(
  providers: readonly ModelProvider[],
  req: ModelRequest,
  opts: RouterOptions,
): Promise<RouteResult> {
  const attempts: { provider: string; error?: string }[] = [];
  const input = screenText(req.prompt, "input");
  if (input.verdict === "blocked")
    return { ok: false, refusal: "input_blocked", codes: input.codes, attempts };

  const est = opts.estimateTokens ?? ((t: string) => Math.ceil(t.length / 4));
  const inTok = est(req.prompt);
  const eligible = eligibleProviders(providers, req);
  if (eligible.length === 0)
    return { ok: false, refusal: "no_eligible_provider", codes: [], attempts };

  const affordable = eligible.filter(
    (p) => estimateCostMinor(p, inTok, req.maxOutputTokens) <= opts.maxCostMinorPerCall,
  );
  if (affordable.length === 0) return { ok: false, refusal: "over_cost_cap", codes: [], attempts };

  for (const p of affordable) {
    try {
      const response = await p.call(req);
      attempts.push({ provider: p.id });
      const out = screenText(response.text, "output");
      if (out.verdict === "blocked")
        return { ok: false, refusal: "output_blocked", codes: out.codes, attempts };
      return {
        ok: true,
        provider: p.id,
        response,
        costMinor: estimateCostMinor(p, response.inputTokens, response.outputTokens),
        outputVerdict: out.verdict,
        attempts,
      };
    } catch (e) {
      // Fail over only within the eligible set. A failure never widens which providers may see the data.
      attempts.push({
        provider: p.id,
        error: e instanceof Error ? e.message.slice(0, 120) : "error",
      });
    }
  }
  return { ok: false, refusal: "all_providers_failed", codes: [], attempts };
}
