/**
 * CoreGrid — memory-scope enforcement across session/mission/long-term tiers
 * (H3 wave, Squad B, mission B-018 / J-029 — Memory Scoping Enforcer).
 *
 * WHAT: a pure, Zod-validated contract that bounds every memory access by a
 * DECLARED scope in one of three retention tiers —
 *
 * - `session`  — bound to a live session and an explicit expiry;
 * - `mission`  — bound to a governing mission reference;
 * - `long_term` — durable, not bound to a session or a single mission.
 *
 * LAWS OF THIS MODULE:
 * - NO SILENT SCOPE EXPANSION (AGENTS §6/§8): an access that would exceed the
 *   declared scope is DENIED with a typed reason — never clamped, never
 *   coerced, never partially satisfied. The declared scope is never widened
 *   as a side effect of enforcement, and a failed access attempt never
 *   mutates the scope.
 * - Expansion is an EXPLICIT, AUDITED, TYPED ACT: a scope changes only when
 *   `applyMemoryScopeExpansion` is called with a typed expansion act
 *   (discriminated union) that names the exact widening, carries provenance
 *   (who, under which authority, why, when — AGENTS §12/§43), lands in an
 *   append-only per-scope expansion ledger, and bumps the scope's revision.
 *   There is no other mutation path; shrinking is a separately governed
 *   operation and is deliberately NOT offered here.
 * - DENY-BY-DEFAULT: empty principals, empty domains, or empty actions grant
 *   NOTHING. An undeclared scope grants nothing. A expired session scope
 *   grants nothing.
 * - EVERYTHING IS AUDITED: every access decision (allowed AND denied) and
 *   every expansion decision appends a first-class record with the injected
 *   audit instant (§12 provenance, §29 observability). Nothing is withheld
 *   or granted silently.
 * - Retention-tier binding is structural: session scopes MUST carry a session
 *   binding with an expiry; mission scopes MUST carry a mission reference;
 *   long-term scopes MUST carry neither. Only session scopes can be extended.
 *
 * Composition: the sensitivity vocabulary is REUSED from the context-assembly
 * domain (`ContextSensitivity`) — never redefined. Like the durable memory
 * tier (`../memory/memory-store.ts`), this module is authorization-gated and
 * scope-bounded; it performs no I/O, no persistence, no vendor access, and no
 * wall-clock sampling — time is always injected. It grants no authority of
 * its own: it bounds access that a server-side authorization layer has
 * already authenticated (Constitution §15/§17 — this is one layer, never the
 * only one).
 */

import { z } from "zod";
import type { ContextSensitivity } from "../context-assembly";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

/** The three memory-scope retention tiers (V1 envelope). */
export type MemoryScopeTier = "session" | "mission" | "long_term";

export const MEMORY_SCOPE_TIERS: readonly MemoryScopeTier[] = [
  "session",
  "mission",
  "long_term",
] as const;

/** Sensitivity vocabulary — reused from context-assembly, never redefined. */
export type MemoryScopeSensitivity = ContextSensitivity;

export const MEMORY_SCOPE_SENSITIVITIES: readonly MemoryScopeSensitivity[] = [
  "public",
  "internal",
  "restricted",
] as const;

const SENSITIVITY_RANK: Record<MemoryScopeSensitivity, 0 | 1 | 2> = {
  public: 0,
  internal: 1,
  restricted: 2,
};

/** Actions a declared scope may permit. Empty grants nothing. */
export type MemoryScopeAction = "read" | "write";

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const DOMAIN_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function nonEmptyBounded(label: string, max: number) {
  return z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .max(max, `${label} must be at most ${max} characters`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`);
}

export const memoryScopeKeySchema = z
  .string()
  .regex(
    IDENTIFIER_PATTERN,
    "scopeKey must be a lowercase identifier (letters, digits, underscore, hyphen; starts with a letter; at most 64 characters)",
  );

export const memoryScopeDomainSchema = z
  .string()
  .regex(
    DOMAIN_PATTERN,
    "memory domain must be a lowercase snake_case identifier (at most 64 characters)",
  );

export const memoryScopeSensitivitySchema = z.enum(
  MEMORY_SCOPE_SENSITIVITIES as [MemoryScopeSensitivity, ...MemoryScopeSensitivity[]],
);

export const memoryScopeActionSchema = z.enum(["read", "write"]);

export const memoryScopeProvenanceSchema = z.strictObject({
  /** Who declared the scope (role or principal reference, not a secret). */
  declaredBy: nonEmptyBounded("provenance.declaredBy", 160),
  /** Under which authority the declaration was made (AGENTS §43). */
  authorityRef: nonEmptyBounded("provenance.authorityRef", 200),
  /** ISO-8601 instant of the declaration. */
  declaredAt: z.string().datetime(),
});

export type MemoryScopeProvenance = z.infer<typeof memoryScopeProvenanceSchema>;

export const memoryScopeSessionBindingSchema = z.strictObject({
  /** The live session the scope is bound to (a session tier scope grants nothing without it). */
  sessionRef: nonEmptyBounded("sessionBinding.sessionRef", 160),
  /** Expiry instant — after it, the scope grants nothing (fail-closed). */
  expiresAt: z.string().datetime(),
});

export type MemoryScopeSessionBinding = z.infer<typeof memoryScopeSessionBindingSchema>;

/* ─────────────────────────────────────────────────────────────
 * Declared scope
 * ────────────────────────────────────────────────────────────*/

export const memoryScopeDeclarationSchema = z
  .strictObject({
    scopeKey: memoryScopeKeySchema,
    tenantRef: nonEmptyBounded("tenantRef", 128),
    tier: z.enum(MEMORY_SCOPE_TIERS as [MemoryScopeTier, ...MemoryScopeTier[]]),
    /** Identities the scope bounds. Empty bounds NOTHING (deny-by-default). */
    principals: z.array(nonEmptyBounded("principals[]", 160)).max(64),
    /** Memory domains the scope covers. Empty covers NOTHING (deny-by-default). */
    domains: z.array(memoryScopeDomainSchema).max(64),
    /** Sensitivity ceiling — accesses above it are denied, never clamped. */
    maxSensitivity: memoryScopeSensitivitySchema,
    /** Permitted actions. Empty permits NOTHING (deny-by-default). */
    actions: z.array(memoryScopeActionSchema).max(2),
    /** Governing mission reference — REQUIRED for the `mission` tier, forbidden otherwise. */
    missionRef: nonEmptyBounded("missionRef", 200).nullable(),
    /** Session binding — REQUIRED for the `session` tier, forbidden otherwise. */
    sessionBinding: memoryScopeSessionBindingSchema.nullable(),
    provenance: memoryScopeProvenanceSchema,
  })
  .superRefine((declaration, ctx) => {
    if (declaration.tier === "mission" && declaration.missionRef === null) {
      ctx.addIssue({
        code: "custom",
        path: ["missionRef"],
        message: "a mission-tier scope requires a missionRef",
      });
    }
    if (declaration.tier !== "mission" && declaration.missionRef !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["missionRef"],
        message: `a ${declaration.tier}-tier scope must not carry a missionRef`,
      });
    }
    if (declaration.tier === "session" && declaration.sessionBinding === null) {
      ctx.addIssue({
        code: "custom",
        path: ["sessionBinding"],
        message: "a session-tier scope requires a sessionBinding with an expiry",
      });
    }
    if (declaration.tier !== "session" && declaration.sessionBinding !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["sessionBinding"],
        message: `a ${declaration.tier}-tier scope must not carry a sessionBinding`,
      });
    }
  });

export type MemoryScopeDeclaration = z.infer<typeof memoryScopeDeclarationSchema>;

/** One declared scope plus its revision and append-only expansion ledger. */
export interface MemoryScopeEntry {
  declaration: MemoryScopeDeclaration;
  /** Starts at 1; increments ONLY via an applied expansion act. */
  revision: number;
  expansionLedger: readonly MemoryScopeExpansionRecord[];
}

/* ─────────────────────────────────────────────────────────────
 * Registry + audit records
 * ────────────────────────────────────────────────────────────*/

export interface MemoryScopeRegistry {
  entries: readonly MemoryScopeEntry[];
  decisionLog: readonly MemoryScopeDecisionRecord[];
}

export function emptyMemoryScopeRegistry(): MemoryScopeRegistry {
  return { entries: [], decisionLog: [] };
}

/** Typed denial reasons for access enforcement — every denial names its gate. */
export type MemoryScopeDenialReason =
  | "invalid_clock"
  | "malformed_request"
  | "undeclared_scope"
  | "cross_tenant"
  | "principal_not_in_scope"
  | "action_not_declared"
  | "scope_expired"
  | "domain_outside_scope"
  | "sensitivity_above_ceiling";

/**
 * ONE auditable record per access decision (§12/§29): who attempted what,
 * under which scope, with which outcome, when.
 */
export interface MemoryScopeDecisionRecord {
  id: string;
  scopeKey: string | null;
  tenantRef: string | null;
  principalRef: string | null;
  action: MemoryScopeAction | null;
  outcome: "allowed" | "denied";
  reason: MemoryScopeDenialReason | null;
  detail: string;
  recordedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Expansion acts — the ONLY way a scope widens
 * ────────────────────────────────────────────────────────────*/

/**
 * A typed expansion act (discriminated union). Each variant names the exact
 * widening it performs. An act must actually EXPAND the current declaration —
 * a no-op or narrowing act is rejected, never silently absorbed.
 */
export const memoryScopeExpansionActSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("add_domains"),
    scopeKey: memoryScopeKeySchema,
    /** NEW domains to cover; must add at least one domain not already covered. */
    domains: z.array(memoryScopeDomainSchema).min(1, "an expansion act must name at least one domain"),
    reason: nonEmptyBounded("reason", 500),
    declaredBy: nonEmptyBounded("declaredBy", 160),
    authorityRef: nonEmptyBounded("authorityRef", 200),
    decidedAt: z.string().datetime(),
  }),
  z.strictObject({
    kind: z.literal("add_principals"),
    scopeKey: memoryScopeKeySchema,
    /** NEW principals to bound; must add at least one principal not already bounded. */
    principals: z.array(nonEmptyBounded("principals[]", 160)).min(1, "an expansion act must name at least one principal"),
    reason: nonEmptyBounded("reason", 500),
    declaredBy: nonEmptyBounded("declaredBy", 160),
    authorityRef: nonEmptyBounded("authorityRef", 200),
    decidedAt: z.string().datetime(),
  }),
  z.strictObject({
    kind: z.literal("raise_sensitivity_ceiling"),
    scopeKey: memoryScopeKeySchema,
    /** The new ceiling — must be STRICTLY above the current one (expansion, not a no-op). */
    maxSensitivity: memoryScopeSensitivitySchema,
    reason: nonEmptyBounded("reason", 500),
    declaredBy: nonEmptyBounded("declaredBy", 160),
    authorityRef: nonEmptyBounded("authorityRef", 200),
    decidedAt: z.string().datetime(),
  }),
  z.strictObject({
    kind: z.literal("extend_session"),
    scopeKey: memoryScopeKeySchema,
    /** New expiry — must be STRICTLY later than the current expiry. */
    newExpiresAt: z.string().datetime(),
    reason: nonEmptyBounded("reason", 500),
    declaredBy: nonEmptyBounded("declaredBy", 160),
    authorityRef: nonEmptyBounded("authorityRef", 200),
    decidedAt: z.string().datetime(),
  }),
]);

export type MemoryScopeExpansionAct = z.infer<typeof memoryScopeExpansionActSchema>;

/** Append-only per-scope record of one applied expansion act (§12). */
export interface MemoryScopeExpansionRecord {
  id: string;
  scopeKey: string;
  /** Scope revision AFTER the act was applied. */
  revision: number;
  act: MemoryScopeExpansionAct;
  appliedAt: string;
}

/** Typed failure reasons for expansion acts. */
export type MemoryScopeExpansionFailureReason =
  | "malformed_act"
  | "undeclared_scope"
  | "tier_mismatch_for_extension"
  | "act_does_not_expand";

/* ─────────────────────────────────────────────────────────────
 * Results
 * ────────────────────────────────────────────────────────────*/

export type MemoryScopeAccessVerdict =
  | {
      verdict: "allowed";
      registry: MemoryScopeRegistry;
      decisionRecord: MemoryScopeDecisionRecord;
    }
  | {
      verdict: "denied";
      registry: MemoryScopeRegistry;
      decisionRecord: MemoryScopeDecisionRecord;
      reason: MemoryScopeDenialReason;
      detail: string;
    };

export type MemoryScopeExpansionVerdict =
  | {
      ok: true;
      registry: MemoryScopeRegistry;
      entry: MemoryScopeEntry;
      expansionRecord: MemoryScopeExpansionRecord;
    }
  | {
      ok: false;
      registry: MemoryScopeRegistry;
      reason: MemoryScopeExpansionFailureReason;
      error: string;
    };

export type MemoryScopeDeclareVerdict =
  | { ok: true; registry: MemoryScopeRegistry; entry: MemoryScopeEntry }
  | { ok: false; registry: MemoryScopeRegistry; error: string };

/* ─────────────────────────────────────────────────────────────
 * Deterministic audit plumbing (purity law)
 * ────────────────────────────────────────────────────────────*/

function pad6(value: number): string {
  return String(value).padStart(6, "0");
}

function appendDecision(
  registry: MemoryScopeRegistry,
  record: Omit<MemoryScopeDecisionRecord, "id">,
): { record: MemoryScopeDecisionRecord; registry: MemoryScopeRegistry } {
  const complete: MemoryScopeDecisionRecord = {
    id: `mem-scope-decision-${pad6(registry.decisionLog.length + 1)}`,
    ...record,
  };
  return { record: complete, registry: { ...registry, decisionLog: [...registry.decisionLog, complete] } };
}

function parseInstant(now: string): number | null {
  const ms = Date.parse(now);
  return Number.isNaN(ms) ? null : ms;
}

/* ─────────────────────────────────────────────────────────────
 * declareMemoryScope — declare a bounded scope (fail-closed)
 * ────────────────────────────────────────────────────────────*/

/**
 * Declare a memory scope. Fails closed on malformed declarations (tier
 * binding invariants, malformed identifiers, missing provenance) and on
 * duplicate scope keys. Never mutates the input registry.
 */
export function declareMemoryScope(
  registry: MemoryScopeRegistry,
  declaration: MemoryScopeDeclaration,
): MemoryScopeDeclareVerdict {
  const parsed = memoryScopeDeclarationSchema.safeParse(declaration);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue && issue.path.length > 0 ? issue.path.join(".") : "declaration";
    return {
      ok: false,
      registry,
      error: `memory scope declaration rejected at "${path}": ${issue?.message ?? "invalid declaration"}`,
    };
  }
  if (registry.entries.some((entry) => entry.declaration.scopeKey === parsed.data.scopeKey)) {
    return {
      ok: false,
      registry,
      error: `memory scope "${parsed.data.scopeKey}" is already declared`,
    };
  }
  const entry: MemoryScopeEntry = {
    declaration: parsed.data,
    revision: 1,
    expansionLedger: [],
  };
  return { ok: true, registry: { ...registry, entries: [...registry.entries, entry] }, entry };
}

/* ─────────────────────────────────────────────────────────────
 * enforceMemoryScopeAccess — the no-silent-expansion gate
 * ────────────────────────────────────────────────────────────*/

export const memoryScopeAccessRequestSchema = z.strictObject({
  scopeKey: z.string(),
  tenantRef: z.string(),
  principalRef: z.string(),
  action: memoryScopeActionSchema,
  /** The domain the access draws on or writes to. */
  domain: z.string(),
  sensitivity: memoryScopeSensitivitySchema,
  purpose: nonEmptyBounded("purpose", 500),
});

export type MemoryScopeAccessRequest = z.infer<typeof memoryScopeAccessRequestSchema>;

export interface MemoryScopeAccessConfig {
  /** Decision instant (ISO-8601). Required for purity — never wall-clock sampled. */
  now: string;
}

/**
 * Evaluate one memory access against the DECLARED scope. Gates run in a
 * fixed deterministic order; EVERY outcome (allowed and every denial reason)
 * appends one auditable decision record stamped with the injected instant.
 *
 * The gate is an upper bound, never a normalizer: an access whose domain is
 * outside the declared domains or whose sensitivity is above the declared
 * ceiling is DENIED outright (`domain_outside_scope`,
 * `sensitivity_above_ceiling`) — it is never clamped to the scope, and the
 * scope is never widened to admit it. Widening happens only through an
 * explicit, audited, typed expansion act.
 */
export function enforceMemoryScopeAccess(
  registry: MemoryScopeRegistry,
  request: MemoryScopeAccessRequest,
  config: MemoryScopeAccessConfig,
): MemoryScopeAccessVerdict {
  const deny = (
    reason: MemoryScopeDenialReason,
    detail: string,
    partial: Pick<MemoryScopeDecisionRecord, "scopeKey" | "tenantRef" | "principalRef" | "action">,
  ): MemoryScopeAccessVerdict => {
    const { record, registry: audited } = appendDecision(registry, {
      ...partial,
      outcome: "denied",
      reason,
      detail,
      recordedAt: config.now,
    });
    return { verdict: "denied", registry: audited, decisionRecord: record, reason, detail };
  };

  if (parseInstant(config.now) === null) {
    return deny("invalid_clock", "Config `now` is not a valid ISO-8601 timestamp", {
      scopeKey: null,
      tenantRef: null,
      principalRef: null,
      action: null,
    });
  }

  const parsed = memoryScopeAccessRequestSchema.safeParse(request);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return deny(
      "malformed_request",
      `Access request rejected: ${issue?.message ?? "invalid request"}`,
      {
        scopeKey: typeof request?.scopeKey === "string" ? request.scopeKey : null,
        tenantRef: typeof request?.tenantRef === "string" ? request.tenantRef : null,
        principalRef: typeof request?.principalRef === "string" ? request.principalRef : null,
        action: null,
      },
    );
  }
  const access = parsed.data;
  const partial = {
    scopeKey: access.scopeKey,
    tenantRef: access.tenantRef,
    principalRef: access.principalRef,
    action: access.action,
  };

  const entry = registry.entries.find((e) => e.declaration.scopeKey === access.scopeKey);
  if (entry === undefined) {
    return deny(
      "undeclared_scope",
      `Access denied: memory scope "${access.scopeKey}" is not declared — an undeclared scope grants nothing`,
      partial,
    );
  }
  const scope = entry.declaration;
  if (scope.tenantRef !== access.tenantRef) {
    return deny(
      "cross_tenant",
      `Access denied: scope "${scope.scopeKey}" is bound to tenant "${scope.tenantRef}", access declared tenant "${access.tenantRef}"`,
      partial,
    );
  }
  if (!scope.principals.includes(access.principalRef)) {
    return deny(
      "principal_not_in_scope",
      `Access denied: principal "${access.principalRef}" is not bounded by the declared scope "${scope.scopeKey}"`,
      partial,
    );
  }
  if (!scope.actions.includes(access.action)) {
    return deny(
      "action_not_declared",
      `Access denied: action "${access.action}" is not declared by scope "${scope.scopeKey}"`,
      partial,
    );
  }
  if (scope.tier === "session" && scope.sessionBinding !== null) {
    const expiresMs = parseInstant(scope.sessionBinding.expiresAt);
    const nowMs = parseInstant(config.now);
    if (expiresMs !== null && nowMs !== null && nowMs > expiresMs) {
      return deny(
        "scope_expired",
        `Access denied: session scope "${scope.scopeKey}" expired at "${scope.sessionBinding.expiresAt}"`,
        partial,
      );
    }
  }
  if (!scope.domains.includes(access.domain)) {
    return deny(
      "domain_outside_scope",
      `Access denied: domain "${access.domain}" is outside the declared domains of scope "${scope.scopeKey}" — no silent scope expansion`,
      partial,
    );
  }
  if (SENSITIVITY_RANK[access.sensitivity] > SENSITIVITY_RANK[scope.maxSensitivity]) {
    return deny(
      "sensitivity_above_ceiling",
      `Access denied: sensitivity "${access.sensitivity}" exceeds the declared ceiling "${scope.maxSensitivity}" of scope "${scope.scopeKey}" — no silent scope expansion`,
      partial,
    );
  }

  const { record, registry: audited } = appendDecision(registry, {
    ...partial,
    outcome: "allowed",
    reason: null,
    detail: `Access allowed: ${access.action} on domain "${access.domain}" (sensitivity "${access.sensitivity}") within declared scope "${scope.scopeKey}" for purpose "${access.purpose}"`,
    recordedAt: config.now,
  });
  return { verdict: "allowed", registry: audited, decisionRecord: record };
}

/* ─────────────────────────────────────────────────────────────
 * applyMemoryScopeExpansion — the explicit, audited, typed act
 * ────────────────────────────────────────────────────────────*/

/**
 * Apply one typed expansion act. This is the ONLY mutation path that widens
 * a scope. Requirements (all fail-closed):
 *
 * - the act must parse against the discriminated union (`malformed_act`);
 * - the scope must be declared (`undeclared_scope`);
 * - `extend_session` applies only to a `session`-tier scope
 *   (`tier_mismatch_for_extension`);
 * - the act must ACTUALLY expand the current declaration: at least one new
 *   domain/principal, a strictly higher ceiling, or a strictly later expiry
 *   (`act_does_not_expand`).
 *
 * On success the scope's revision increments by exactly 1, the declaration is
 * replaced with the widened one, the act is appended to the scope's
 * append-only expansion ledger, and the applied act is returned. Failed acts
 * mutate nothing.
 */
export function applyMemoryScopeExpansion(
  registry: MemoryScopeRegistry,
  act: MemoryScopeExpansionAct,
): MemoryScopeExpansionVerdict {
  const parsed = memoryScopeExpansionActSchema.safeParse(act);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      registry,
      reason: "malformed_act",
      error: `expansion act rejected: ${issue?.message ?? "invalid act"}`,
    };
  }
  const typedAct = parsed.data;
  const entry = registry.entries.find((e) => e.declaration.scopeKey === typedAct.scopeKey);
  if (entry === undefined) {
    return {
      ok: false,
      registry,
      reason: "undeclared_scope",
      error: `expansion act rejected: memory scope "${typedAct.scopeKey}" is not declared`,
    };
  }
  const scope = entry.declaration;

  let widened: MemoryScopeDeclaration;
  if (typedAct.kind === "add_domains") {
    const fresh = typedAct.domains.filter((d) => !scope.domains.includes(d));
    if (fresh.length === 0) {
      return {
        ok: false,
        registry,
        reason: "act_does_not_expand",
        error: `expansion act rejected: all named domains are already covered by scope "${scope.scopeKey}"`,
      };
    }
    widened = { ...scope, domains: [...scope.domains, ...fresh] };
  } else if (typedAct.kind === "add_principals") {
    const fresh = typedAct.principals.filter((p) => !scope.principals.includes(p));
    if (fresh.length === 0) {
      return {
        ok: false,
        registry,
        reason: "act_does_not_expand",
        error: `expansion act rejected: all named principals are already bounded by scope "${scope.scopeKey}"`,
      };
    }
    widened = { ...scope, principals: [...scope.principals, ...fresh] };
  } else if (typedAct.kind === "raise_sensitivity_ceiling") {
    if (SENSITIVITY_RANK[typedAct.maxSensitivity] <= SENSITIVITY_RANK[scope.maxSensitivity]) {
      return {
        ok: false,
        registry,
        reason: "act_does_not_expand",
        error: `expansion act rejected: ceiling "${typedAct.maxSensitivity}" does not raise the current ceiling "${scope.maxSensitivity}" of scope "${scope.scopeKey}"`,
      };
    }
    widened = { ...scope, maxSensitivity: typedAct.maxSensitivity };
  } else {
    if (scope.tier !== "session" || scope.sessionBinding === null) {
      return {
        ok: false,
        registry,
        reason: "tier_mismatch_for_extension",
        error: `expansion act rejected: only session-tier scopes can be extended, scope "${scope.scopeKey}" is "${scope.tier}"-tier`,
      };
    }
    const currentMs = parseInstant(scope.sessionBinding.expiresAt);
    const nextMs = parseInstant(typedAct.newExpiresAt);
    if (currentMs === null || nextMs === null || nextMs <= currentMs) {
      return {
        ok: false,
        registry,
        reason: "act_does_not_expand",
        error: `expansion act rejected: new expiry "${typedAct.newExpiresAt}" is not later than the current expiry "${scope.sessionBinding.expiresAt}" of scope "${scope.scopeKey}"`,
      };
    }
    widened = {
      ...scope,
      sessionBinding: { ...scope.sessionBinding, expiresAt: typedAct.newExpiresAt },
    };
  }

  const revision = entry.revision + 1;
  const expansionRecord: MemoryScopeExpansionRecord = {
    id: `mem-scope-expansion-${pad6(entry.expansionLedger.length + 1)}-${scope.scopeKey}`,
    scopeKey: scope.scopeKey,
    revision,
    act: typedAct,
    appliedAt: typedAct.decidedAt,
  };
  const updatedEntry: MemoryScopeEntry = {
    declaration: widened,
    revision,
    expansionLedger: [...entry.expansionLedger, expansionRecord],
  };
  const updatedRegistry: MemoryScopeRegistry = {
    ...registry,
    entries: registry.entries.map((e) =>
      e.declaration.scopeKey === scope.scopeKey ? updatedEntry : e,
    ),
  };
  return { ok: true, registry: updatedRegistry, entry: updatedEntry, expansionRecord };
}

/* ─────────────────────────────────────────────────────────────
 * readMemoryScopeEntry — read-only introspection
 * ────────────────────────────────────────────────────────────*/

/**
 * Read one scope entry (declaration, revision, expansion ledger) without
 * mutating anything. Returns null for an undeclared scope.
 */
export function readMemoryScopeEntry(
  registry: MemoryScopeRegistry,
  scopeKey: string,
): MemoryScopeEntry | null {
  return registry.entries.find((e) => e.declaration.scopeKey === scopeKey) ?? null;
}
