/**
 * Sherivs Entity Engine — Role Packs (ENGINE-01, ADR-078).
 *
 * A Role Pack is the single, versioned, declarative definition of what a
 * person's twin and agent may do while acting in one role. The engine compiles
 * a pack into a twin context and an agent specification; nothing is hand-wired
 * per feature.
 *
 * A pack is a CEILING, never a grant. At run time the effective permissions are
 * the intersection of the pack and what the server-resolved role assignment
 * already grants (see `role-lens.ts` in the personal-twin module). A pack can
 * only narrow authority.
 *
 * Pure module: no I/O, no clock, no environment reads, no vendor imports.
 * Validation fails closed: every rule below is enforced by `validateRolePack`,
 * and a pack that returns any finding must never be published.
 */
import { z } from "zod";

export const ROLE_PACK_SCHEMA = "sherivs.role-pack.v1" as const;

/** Risk tiers, aligned with the JARVIS risk policy (ADR-035). Kept local so the
 * engine has no dependency on the JARVIS stack; alignment is by convention until the JARVIS stack is restacked (ADR-082). */
export const ROLE_PACK_TIERS = ["T0", "T1", "T2", "T3", "T4"] as const;
export type RolePackTier = (typeof ROLE_PACK_TIERS)[number];

/** What a pack lets the agent do with a capability, before any earned trust. */
export const PACK_AUTONOMY_MODES = [
  "propose_only",
  "act_with_approval",
  "act_autonomously",
] as const;
export type PackAutonomyMode = (typeof PACK_AUTONOMY_MODES)[number];

export const PACK_KINDS = ["tenant_role", "platform_role"] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export const MEMORY_SENSITIVITIES = ["public", "internal", "restricted"] as const;
export type MemorySensitivity = (typeof MEMORY_SENSITIVITIES)[number];

export const ESCALATION_APPROVERS = ["role_owner", "platform_staff", "sheriff"] as const;
export type EscalationApprover = (typeof ESCALATION_APPROVERS)[number];

const ID = /^[a-z][a-z0-9_.:-]{1,63}$/;
const CODE = /^[a-z][a-z0-9-]{1,39}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

const idSchema = z.string().regex(ID);

const capabilitySchema = z
  .object({
    id: idSchema,
    title: z.string().min(3).max(120),
    tier: z.enum(ROLE_PACK_TIERS),
    autonomy: z.enum(PACK_AUTONOMY_MODES),
    requiresPermission: idSchema,
    /** Connector the capability acts through (never a credential, only a name). */
    connector: idSchema.optional(),
    /** Approver required when the capability needs a human decision. */
    approver: z.enum(ESCALATION_APPROVERS).optional(),
    /** T2 only: the sheriff MAY later promote this capability to autonomous. */
    promotableToAutonomous: z.boolean().optional(),
  })
  .strict();

const playbookSchema = z
  .object({
    id: idSchema,
    title: z.string().min(3).max(120),
    /** Wake events that may start this playbook. */
    wakeOn: z.array(idSchema).min(1).max(8),
    /** Ordered capability ids. */
    steps: z.array(idSchema).min(1).max(12),
    maxRunsPerDay: z.number().int().min(1).max(500),
  })
  .strict();

export const rolePackSchema = z
  .object({
    schema: z.literal(ROLE_PACK_SCHEMA),
    code: z.string().regex(CODE),
    version: z.string().regex(SEMVER),
    title: z.string().min(3).max(120),
    kind: z.enum(PACK_KINDS),
    /** Membership role codes this pack serves (the engine binds by this list). */
    appliesTo: z.array(idSchema).min(1).max(16),
    permissions: z.array(idSchema).min(1).max(64),
    capabilities: z.array(capabilitySchema).max(48),
    playbooks: z.array(playbookSchema).max(24),
    memory: z
      .object({
        domains: z.array(idSchema).min(1).max(16),
        maxSensitivity: z.enum(MEMORY_SENSITIVITIES),
        retentionDays: z.number().int().min(1).max(3650),
        /** Cross-tenant memory is never declarable. */
        crossTenant: z.literal(false),
      })
      .strict(),
    budget: z
      .object({
        dailyActions: z.number().int().min(1).max(100_000),
        dailyModelCalls: z.number().int().min(0).max(100_000),
        dailyCostCapMinor: z.number().int().min(0).max(100_000_000),
      })
      .strict(),
    escalation: z
      .object({
        defaultApprover: z.enum(ESCALATION_APPROVERS),
        t3Approver: z.enum(["platform_staff", "sheriff"]),
      })
      .strict(),
    /** Every agent starts in shadow mode and earns autonomy (ADR-078). */
    startsInShadow: z.literal(true),
  })
  .strict();

export type RolePack = z.infer<typeof rolePackSchema>;
export type RolePackCapability = RolePack["capabilities"][number];

const TIER_RANK: Readonly<Record<RolePackTier, number>> = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4 };

export const tierRank = (tier: RolePackTier): number => TIER_RANK[tier];

/** Highest tier a pack of each kind may declare. T4 is never declarable. */
export const MAX_DECLARABLE_TIER: Readonly<Record<PackKind, RolePackTier>> = Object.freeze({
  tenant_role: "T2",
  platform_role: "T3",
});

/** Highest tier whose capability may be declared fully autonomous. */
export const MAX_AUTONOMOUS_TIER: RolePackTier = "T1";

const dupes = (values: readonly string[]): string[] =>
  values.filter((v, i) => values.indexOf(v) !== i).filter((v, i, a) => a.indexOf(v) === i);

/**
 * Validate a candidate pack. Returns findings; an empty array means valid.
 * Never throws for malformed input (fail closed with a finding instead).
 */
export function validateRolePack(candidate: unknown): readonly string[] {
  const parsed = rolePackSchema.safeParse(candidate);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => `schema: ${i.path.join(".") || "(root)"}: ${i.message}`);
  }
  const pack = parsed.data;
  const findings: string[] = [];
  const maxTier = MAX_DECLARABLE_TIER[pack.kind];

  for (const d of dupes(pack.permissions)) findings.push(`duplicate permission: ${d}`);
  for (const d of dupes(pack.capabilities.map((c) => c.id)))
    findings.push(`duplicate capability: ${d}`);
  for (const d of dupes(pack.playbooks.map((p) => p.id))) findings.push(`duplicate playbook: ${d}`);

  const permissions = new Set(pack.permissions);
  const capabilities = new Map(pack.capabilities.map((c) => [c.id, c] as const));

  for (const c of pack.capabilities) {
    if (c.tier === "T4") findings.push(`capability ${c.id}: T4 is never declarable`);
    else if (tierRank(c.tier) > tierRank(maxTier)) {
      findings.push(
        `capability ${c.id}: tier ${c.tier} exceeds the ${maxTier} ceiling for ${pack.kind}`,
      );
    }
    if (!permissions.has(c.requiresPermission)) {
      findings.push(`capability ${c.id}: requires undeclared permission ${c.requiresPermission}`);
    }
    if (c.autonomy === "act_autonomously" && tierRank(c.tier) > tierRank(MAX_AUTONOMOUS_TIER)) {
      findings.push(`capability ${c.id}: ${c.tier} may not be declared autonomous`);
    }
    if (c.tier === "T3" && c.autonomy !== "act_with_approval" && c.autonomy !== "propose_only") {
      findings.push(`capability ${c.id}: T3 requires approval`);
    }
    if (c.tier === "T3" && c.approver !== undefined && c.approver === "role_owner") {
      findings.push(`capability ${c.id}: T3 cannot be approved by the role owner`);
    }
    if (c.promotableToAutonomous === true && c.tier !== "T2") {
      findings.push(`capability ${c.id}: only T2 capabilities may be promotable`);
    }
    if (c.autonomy === "act_with_approval" && c.approver === undefined) {
      findings.push(`capability ${c.id}: act_with_approval requires an approver`);
    }
  }

  for (const p of pack.playbooks) {
    for (const step of p.steps) {
      const cap = capabilities.get(step);
      if (!cap) {
        findings.push(`playbook ${p.id}: unknown capability ${step}`);
        continue;
      }
      if (
        cap.autonomy === "act_autonomously" &&
        tierRank(cap.tier) > tierRank(MAX_AUTONOMOUS_TIER)
      ) {
        findings.push(`playbook ${p.id}: step ${step} cannot run autonomously`);
      }
    }
  }

  if (pack.kind === "tenant_role" && pack.escalation.defaultApprover === "sheriff") {
    findings.push("tenant_role packs must not route default decisions to the sheriff");
  }
  return findings;
}

/** Deterministic JSON with sorted keys, so a pack hashes identically everywhere. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/** Parse and validate in one step; returns the pack or the findings. */
export function parseRolePack(
  candidate: unknown,
):
  | { readonly ok: true; readonly pack: RolePack }
  | { readonly ok: false; readonly findings: readonly string[] } {
  const findings = validateRolePack(candidate);
  if (findings.length > 0) return { ok: false, findings };
  return { ok: true, pack: rolePackSchema.parse(candidate) };
}
