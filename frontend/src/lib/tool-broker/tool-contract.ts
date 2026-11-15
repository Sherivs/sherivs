/**
 * Sherivs Tool Broker: tool definitions (ENGINE-03, ADR-081).
 *
 * Every action a twin, agent or JARVIS can take on the outside world is a named
 * tool. A tool is registered once, with a tier that is FLOORED by what the action
 * touches, so a tool cannot be registered "cheaper" than its effect. The broker
 * (broker.ts) decides; this module only describes and validates.
 *
 * Pure module: no I/O, no clock, no environment reads, no vendor imports. A
 * tool names a connector; it never carries a credential (see connector-vault.ts).
 */
import { z } from "zod";
import { ROLE_PACK_TIERS, tierRank, type RolePackTier } from "../twin-engine/role-pack";

export const TOOL_DEFINITION_SCHEMA = "sherivs.tool.v1" as const;

/** What an action touches. The strongest effect sets the tier floor. */
export const TOOL_EFFECTS = [
  "none",
  "internal_state",
  "customer_visible",
  "public_post",
  "money",
  "prod_config",
  "access_grant",
  "legal",
] as const;
export type ToolEffect = (typeof TOOL_EFFECTS)[number];

/** Lowest tier an effect may be registered at. T4 is never registrable. */
export const EFFECT_TIER_FLOOR: Readonly<Record<ToolEffect, RolePackTier>> = Object.freeze({
  none: "T0",
  internal_state: "T1",
  customer_visible: "T2",
  public_post: "T3",
  money: "T3",
  prod_config: "T3",
  access_grant: "T3",
  legal: "T3",
});

export const TOOL_DIRECTIONS = ["read", "write"] as const;
export type ToolDirection = (typeof TOOL_DIRECTIONS)[number];

const ID = /^[a-z][a-z0-9_.:-]{1,63}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

export const toolDefinitionSchema = z
  .object({
    schema: z.literal(TOOL_DEFINITION_SCHEMA),
    id: z.string().regex(ID),
    version: z.string().regex(SEMVER),
    title: z.string().min(3).max(120),
    connector: z.string().regex(ID),
    direction: z.enum(TOOL_DIRECTIONS),
    effect: z.enum(TOOL_EFFECTS),
    tier: z.enum(ROLE_PACK_TIERS),
    /** True when repeating the call with the same idempotency key is safe. */
    idempotent: z.boolean(),
    maxCallsPerHour: z.number().int().min(1).max(10_000),
    /** Platform-only tools are never usable from a tenant context. */
    platformOnly: z.boolean(),
  })
  .strict();

export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;

/** Returns every rule a definition breaks. Empty means it may be registered. */
export function validateToolDefinition(candidate: unknown): readonly string[] {
  const parsed = toolDefinitionSchema.safeParse(candidate);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `schema: ${i.path.join(".") || "(root)"}: ${i.message}`);
  }
  const t = parsed.data;
  const findings: string[] = [];
  if (t.tier === "T4") findings.push("T4 actions are never registrable (never autonomous)");
  if (tierRank(t.tier) < tierRank(EFFECT_TIER_FLOOR[t.effect])) {
    findings.push(
      `effect ${t.effect} requires tier >= ${EFFECT_TIER_FLOOR[t.effect]}, got ${t.tier}`,
    );
  }
  if (t.direction === "write" && t.effect === "none") {
    findings.push("a write must declare an effect other than none");
  }
  if (t.direction === "read" && t.effect !== "none") {
    findings.push("a read must declare effect none");
  }
  if (t.direction === "write" && !t.idempotent && tierRank(t.tier) >= tierRank("T3")) {
    findings.push("a T3 write must be idempotent so an approved call cannot repeat its effect");
  }
  if (t.effect === "public_post" || t.effect === "money" || t.effect === "access_grant") {
    if (!t.platformOnly) findings.push(`${t.effect} tools must be platformOnly`);
  }
  return findings;
}

export function parseToolDefinition(candidate: unknown): ToolDefinition {
  const findings = validateToolDefinition(candidate);
  if (findings.length > 0) throw new Error(`tool definition rejected: ${findings.join("; ")}`);
  return toolDefinitionSchema.parse(candidate);
}
