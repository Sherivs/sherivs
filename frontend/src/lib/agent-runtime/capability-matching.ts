/**
 * CoreGrid — capability-overlap matching depth for delegation contracts
 * (H3 wave Squad B, mission B-017 / J-028).
 *
 * WHAT: the matching depth that sits between the PERSISTENT capability
 * declarations a governed actor owns (`workforce/worker-definition.ts`) and
 * the capability bound a delegation contract grants
 * (`mission/delegation-contract.ts`, `grantedActions`). A delegation may only
 * draw authority that its delegate's declared capability set actually
 * overlaps; this module computes that overlap and FAILS CLOSED on every
 * required capability that is not explicitly declared.
 *
 * Laws of this module:
 * - EXPLICIT OVERLAP ONLY: a required capability is covered when, and only
 *   when, a declaration with the identical capability id exists in the
 *   registry. There is no fuzzy matching, no prefix/substring matching, no
 *   case normalization, no inheritance and no defaults — coverage that is
 *   not explicit does not exist.
 * - FAIL CLOSED ON UNKNOWN CAPABILITIES: any required capability absent
 *   from the declared registry denies the whole match with a named code
 *   (`unknown_capability`) and the exact unknown ids. A partial overlap is
 *   REPORTED (depth `partial`) but never authorizes — `ok` is true only at
 *   depth `full`.
 * - NOTHING FROM NOTHING: an empty requirement set denies (`empty_requirements`)
 *   rather than trivially passing, mirroring the delegation law that a
 *   delegation grants at least one action. An empty DECLARED registry is
 *   valid — it matches nothing (untrusted by default, zero authority).
 * - DUPLICATES DENY: a requirement list naming the same capability twice is
 *   malformed and denies (`duplicate_requirements`) — silent deduplication
 *   could mask a caller bug on exactly the surface that computes authority.
 * - BOUNDED: capability ids are trimmed, non-empty, at most 160 characters,
 *   control-character free; registries are bounded at 1024 declarations.
 *
 * Composition (read-only): `matchWorkerCapabilities` consumes a persistent
 * `WorkerDefinition` and denies unusable lifecycles before any overlap is
 * computed; `matchDelegationCapabilities` consumes the capability bound of a
 * delegation record via the structural `DelegationCapabilityBound` view
 * (`MissionDelegation` satisfies it — the adapter `delegationCapabilityBound`
 * extracts it). Neither import is mutated; ownership boundaries are preserved.
 *
 * Neutral vocabulary only (J-037 shrink-only): a "capability" is any named
 * ability a governed actor may declare. No domain vocabulary appears here.
 *
 * Pure contract module: no I/O, no persistence, no vendor imports, no
 * wall-clock reads, no secrets, no execution.
 */

import { z } from "zod";
import { isIdentityUsable } from "../identity";
import type { MissionDelegation } from "../mission/delegation-contract";
import type { WorkerDefinition } from "../workforce/worker-definition";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

export const CAPABILITY_MATCH_SCHEMA_VERSION = "1.0";

const CAPABILITY_ID_MAX = 160;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function trimmedNonEmpty(label: string, maxLength: number) {
  return z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .max(maxLength, `${label} must be at most ${maxLength} characters`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`)
    .refine((value) => value === value.trim(), `${label} must not have leading or trailing whitespace`)
    .refine((value) => !CONTROL_CHARS.test(value), `${label} must not contain control characters`);
}

export const capabilityIdSchema = trimmedNonEmpty("capabilityId", CAPABILITY_ID_MAX);

export type CapabilityId = z.infer<typeof capabilityIdSchema>;

/** One owned capability declaration — explicit and documented. */
export const capabilityDeclarationSchema = z.strictObject({
  capabilityId: capabilityIdSchema,
  description: trimmedNonEmpty("description", 500),
});

export type CapabilityDeclaration = z.infer<typeof capabilityDeclarationSchema>;

/** One required capability — what a delegation or mission needs covered. */
export const capabilityRequirementSchema = z.strictObject({
  capabilityId: capabilityIdSchema,
  /** Why the capability is required (provenance of the demand, AGENTS §12). */
  purpose: trimmedNonEmpty("purpose", 500),
});

export type CapabilityRequirement = z.infer<typeof capabilityRequirementSchema>;

/**
 * A declared capability registry: the closed set of capabilities a governed
 * actor owns. An empty registry is valid and has ZERO authority.
 */
export const capabilityRegistrySchema = z.strictObject({
  capabilities: z
    .array(capabilityDeclarationSchema)
    .max(1_024, "registry exceeds the bounded maximum of 1024 capability declarations"),
});

export type CapabilityRegistry = z.infer<typeof capabilityRegistrySchema>;

/* ─────────────────────────────────────────────────────────────
 * Parsing (fail-closed: no partial registries)
 * ────────────────────────────────────────────────────────────*/

export type CapabilityRegistryParseFailureReason =
  /** The input does not match the schema at all. */
  | "invalid_shape"
  /** A cross-record invariant failed (duplicate declared capability ids). */
  | "cross_record_invariant";

export interface CapabilityRegistryIssue {
  readonly path: string;
  readonly message: string;
}

export type CapabilityRegistryParseResult =
  | { readonly ok: true; readonly registry: CapabilityRegistry }
  | {
      readonly ok: false;
      readonly reason: CapabilityRegistryParseFailureReason;
      readonly issues: readonly CapabilityRegistryIssue[];
    };

/**
 * Parse an untrusted input into a capability registry. Any violation —
 * shape, bounds, duplicate declarations — yields `ok: false` with structured
 * issues; a failed parse never yields a partial registry.
 */
export function parseCapabilityRegistry(input: unknown): CapabilityRegistryParseResult {
  const parsed = capabilityRegistrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_shape",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.length === 0 ? "(root)" : issue.path.map((segment) => String(segment)).join("."),
        message: issue.message,
      })),
    };
  }

  const registry = parsed.data;
  const issues: CapabilityRegistryIssue[] = [];
  const seen = new Set<string>();
  for (const declaration of registry.capabilities) {
    if (seen.has(declaration.capabilityId)) {
      issues.push({
        path: `capabilities[capabilityId=${declaration.capabilityId}]`,
        message: `duplicate declaration for capability "${declaration.capabilityId}" — one capability carries exactly one declaration`,
      });
    } else {
      seen.add(declaration.capabilityId);
    }
  }
  if (issues.length > 0) {
    return { ok: false, reason: "cross_record_invariant", issues };
  }
  return { ok: true, registry };
}

/** Build a registry view over already-typed declarations (worker definitions). */
export function capabilityRegistryFromDeclarations(
  declarations: readonly CapabilityDeclaration[],
): CapabilityRegistry {
  return { capabilities: [...declarations] };
}

/* ─────────────────────────────────────────────────────────────
 * Capability-overlap matching (the depth; fail closed)
 * ────────────────────────────────────────────────────────────*/

export const FAIL_CLOSED_UNKNOWN_CAPABILITY_DETAIL =
  "fail-closed capability matching: every required capability must be covered by an explicit declaration in the registry — there is no partial, fuzzy or case-normalized coverage, and unmatched requirements authorize nothing";

export type CapabilityMatchDenyCode =
  | "unknown_capability"
  | "empty_requirements"
  | "duplicate_requirements"
  | "definition_lifecycle_unusable";

/**
 * Matching depth: `full` when every required capability is declared, `partial`
 * when some are, `none` when the match was denied before overlap was computed
 * (or nothing at all overlapped). Partial depth NEVER yields `ok: true` —
 * reported depth is observability, not authority.
 */
export type CapabilityMatchDepth = "full" | "partial" | "none";

export type CapabilityMatchResult =
  | {
      readonly ok: true;
      readonly depth: "full";
      /** Declared ids covering the requirements (distinct, requirement order). */
      readonly matched: readonly string[];
      readonly requiredCount: number;
    }
  | {
      readonly ok: false;
      readonly depth: CapabilityMatchDepth;
      readonly code: CapabilityMatchDenyCode;
      /** Required ids with no declared coverage (fail-closed enumeration). */
      readonly unknown: readonly string[];
      readonly matched: readonly string[];
      readonly requiredCount: number;
      readonly detail: string;
    };

function deny(
  code: Extract<CapabilityMatchDenyCode, "empty_requirements" | "duplicate_requirements">,
  requiredCount: number,
  detail: string,
): CapabilityMatchResult {
  return { ok: false, depth: "none", code, unknown: [], matched: [], requiredCount, detail };
}

/**
 * THE capability-overlap match: required capabilities against a declared
 * registry. Fails closed on unknown capabilities — the deny result names the
 * exact uncovered ids so the gap is actionable, never absorbed.
 */
export function matchCapabilities(
  registry: CapabilityRegistry,
  required: readonly CapabilityRequirement[],
): CapabilityMatchResult {
  if (required.length === 0) {
    return deny(
      "empty_requirements",
      0,
      "matching requires at least one required capability — an empty requirement set authorizes nothing by default",
    );
  }
  const seen = new Set<string>();
  for (const requirement of required) {
    if (seen.has(requirement.capabilityId)) {
      return deny(
        "duplicate_requirements",
        required.length,
        `required capability "${requirement.capabilityId}" is listed more than once — deduplicate the requirement list before matching`,
      );
    }
    seen.add(requirement.capabilityId);
  }

  const declared = new Set(registry.capabilities.map((declaration) => declaration.capabilityId));
  const matched: string[] = [];
  const unknown: string[] = [];
  for (const requirement of required) {
    if (declared.has(requirement.capabilityId)) {
      matched.push(requirement.capabilityId);
    } else {
      unknown.push(requirement.capabilityId);
    }
  }

  if (unknown.length > 0) {
    return {
      ok: false,
      depth: matched.length === 0 ? "none" : "partial",
      code: "unknown_capability",
      unknown,
      matched,
      requiredCount: required.length,
      detail: FAIL_CLOSED_UNKNOWN_CAPABILITY_DETAIL,
    };
  }
  return { ok: true, depth: "full", matched, requiredCount: required.length };
}

/* ─────────────────────────────────────────────────────────────
 * Delegation-contract composition (read-only)
 * ────────────────────────────────────────────────────────────*/

/**
 * The capability bound of a delegation contract, as this matcher sees it.
 * `MissionDelegation` satisfies this structurally (its `grantedActions` are
 * the capability ids the delegate may exercise); the adapter below extracts
 * the view without mutating or re-validating the record — lifecycle, time
 * window, tenant and mission checks remain owned by the delegation contract's
 * own evaluation (`evaluateDelegationAsOf` / `authorizeDelegatedAction`).
 */
export interface DelegationCapabilityBound {
  readonly delegationId: string;
  readonly grantedActions: readonly string[];
}

/** Extract the capability bound view of a delegation record (read-only). */
export function delegationCapabilityBound(delegation: MissionDelegation): DelegationCapabilityBound {
  return { delegationId: delegation.delegationId, grantedActions: delegation.grantedActions };
}

/**
 * Match a delegation contract's capability bound against a declared
 * capability registry: every capability the delegation grants must overlap
 * the delegate's declared set, fail closed on unknown capabilities. This is
 * the capability dimension ONLY — the delegation contract's own laws
 * (non-escalation, expiry, revocation, scope) are enforced there and are
 * never relaxed here.
 */
export function matchDelegationCapabilities(
  bound: DelegationCapabilityBound,
  registry: CapabilityRegistry,
): CapabilityMatchResult {
  const required: CapabilityRequirement[] = bound.grantedActions.map((capabilityId) => ({
    capabilityId,
    purpose: `delegation capability bound (${bound.delegationId})`,
  }));
  return matchCapabilities(registry, required);
}

/* ─────────────────────────────────────────────────────────────
 * Worker-definition composition (read-only)
 * ────────────────────────────────────────────────────────────*/

/**
 * Match required capabilities against a persistent worker definition's
 * declared capability set. Denies BEFORE any overlap is computed when the
 * definition's lifecycle is not usable — a suspended, archived or deleted
 * definition matches no capability regardless of its declarations (the same
 * usable-state predicate the identity model enforces). The definition is
 * consumed read-only; claim-time authorization remains owned by
 * `claimWorkerRuntime`.
 */
export function matchWorkerCapabilities(
  definition: WorkerDefinition,
  required: readonly CapabilityRequirement[],
): CapabilityMatchResult {
  if (!isIdentityUsable({ lifecycle: definition.lifecycle })) {
    return {
      ok: false,
      depth: "none",
      code: "definition_lifecycle_unusable",
      unknown: [],
      matched: [],
      requiredCount: required.length,
      detail: `worker definition lifecycle "${definition.lifecycle}" is not usable — an unusable definition matches no capability, fail closed`,
    };
  }
  return matchCapabilities(capabilityRegistryFromDeclarations(definition.capabilities), required);
}
