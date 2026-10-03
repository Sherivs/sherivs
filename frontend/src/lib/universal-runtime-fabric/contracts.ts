/**
 * CoreGrid — Phase 40 Universal Runtime Fabric: registration contracts
 * (H3 wave Squad G, mission G-060, Contract Architect role).
 *
 * WHAT: the typed, fail-closed contract surface for the fabric's substrate
 * operation — neutral runtime registration. Under RULING-1 (runtimes are
 * data to the platform, never platform content) a runtime joins CoreGrid as
 * a declaration over a stable contract: installing, suspending, resuming or
 * retiring it is a data operation that never rewrites the kernel and never
 * grants a runtime privileges the declaration does not carry.
 *
 * WHERE/WHY: phase 40 canonically owns runtime composition-and-isolation,
 * runtime lifecycle, and runtime health (phase-40 acceptance evidence map).
 * This module encodes the SEMANTICS of that ownership as pure contracts:
 *   - a runtime descriptor (ontology names, consumed canonical capability
 *     references, policy bindings, interfaces, isolation, resource ceilings)
 *   - a registration request (install | suspend | resume | retire) carrying
 *     complete provenance (AGENTS §12)
 *   - a server-resolved registration context (the caller never supplies the
 *     tenant or the registry view; the decision only trusts the context)
 *   - an allow/deny decision that FAILS CLOSED: every missing, malformed,
 *     unresolvable or cross-tenant input denies with a typed reason
 *   - runtime health signals whose unproven state is "unknown", never
 *     optimistically "healthy"
 *
 * UNDER WHICH POLICY: AGENTS §16 (layered authorization, DENY result),
 * §21 (AI/proposal output is untrusted — installation never self-activates),
 * §27 (server functions authenticate → resolve tenant → authorize → validate
 * → execute → audit → return permitted data), §12 (provenance), §31
 * (tenant A cannot act on tenant B; suspended access fails); RULING-1;
 * phase-40 acceptance map; kernel lifecycle law is imported read-only from
 * `kernel/domain-manifest.ts` + `kernel/runtime-registry.ts` so the two
 * vocabularies cannot drift.
 *
 * BOUNDARY: pure typed CONTRACT module — no I/O, no persistence, no vendor
 * imports, no secrets, no timers (all instants flow in from the caller).
 * Volumetric quota enforcement and the concurrency lease plane are owned by
 * the reliability contracts; this module only bounds what a runtime may
 * DECLARE. Domain-neutral throughout (J-037): every vocabulary a runtime
 * brings arrives as namespaced data inside the descriptor, never as code.
 */

import { z } from "zod";
import {
  RUNTIME_INTERFACE_KINDS,
  isValidManifestId,
  isValidManifestVersion,
  type RuntimeManifestStatus,
} from "../kernel/domain-manifest";
import {
  RUNTIME_STATUS_TRANSITIONS,
  canTransitionRuntimeStatus,
} from "../kernel/runtime-registry";

/* ─────────────────────────────────────────────────────────────
 * Hard ceilings (no unbounded runtime declarations)
 * ────────────────────────────────────────────────────────────*/

export const MAX_ONT_ENTITY_TYPES = 512;
export const MAX_ONT_RELATIONSHIP_TYPES = 1_024;
export const MAX_CAPABILITY_REFS = 256;
export const MAX_POLICY_REFS = 64;
export const MAX_INTERFACE_DECLARATIONS = 128;
export const MAX_DEPENDENCY_REFS = 64;
export const MAX_REGISTRY_SNAPSHOT_ENTRIES = 10_000;
export const MAX_CONCURRENT_TASKS = 10_000;
export const MAX_MEMORY_MB = 65_536;
export const MAX_STORAGE_MB = 1_048_576;
export const MAX_DECISION_DETAIL_ITEMS = 20;

/* ─────────────────────────────────────────────────────────────
 * Shared vocabulary and primitives
 * ────────────────────────────────────────────────────────────*/

const REF_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/;
const ONTOLOGY_NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
/** Strict RFC-3339 instant (UTC), e.g. 2026-10-03T00:00:00.000Z. */
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

function refSchema(label: string) {
  return z
    .string()
    .regex(
      REF_PATTERN,
      `${label} must be a lowercase reference identifier (letters, digits, _ . : -; starts with a letter; at most 128 characters)`,
    );
}

export const isoInstantSchema = z
  .string()
  .regex(ISO_INSTANT_PATTERN, "must be a UTC RFC-3339 instant (e.g. 2026-10-03T00:00:00.000Z)")
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be a parseable instant");

/**
 * Canonical runtime reference. Validated against the kernel manifest-id law
 * (read-only import) AND pinned to the fabric's `runtime:` namespace — the
 * fabric only registers runtimes, never other kernel objects.
 */
export const runtimeRefSchema = z
  .string()
  .refine(isValidManifestId, "must be a canonical kernel manifest id of the form <namespace>:<slug>")
  .refine((value) => value.startsWith("runtime:"), 'must use the canonical "runtime:" namespace');

/**
 * Runtime lifecycle vocabulary, kept in lockstep with the kernel manifest
 * statuses by construction (a lockstep assertion is part of the test suite
 * and the kernel transition law below is imported, not re-declared).
 */
export const RUNTIME_LIFECYCLE_STATUSES = [
  "proposed",
  "review",
  "approved",
  "active",
  "suspended",
  "retired",
] as const;

export type RuntimeLifecycleStatus = (typeof RUNTIME_LIFECYCLE_STATUSES)[number];

export const runtimeLifecycleStatusSchema = z.enum(RUNTIME_LIFECYCLE_STATUSES);

/**
 * Registration intents — the fabric's data-operation verbs. "install" is the
 * entry act (a runtime registers as `proposed` and NEVER self-activates:
 * activation is the kernel review/approval chain, AGENTS §21).
 */
export const REGISTRATION_INTENTS = ["install", "suspend", "resume", "retire"] as const;

export type RegistrationIntent = (typeof REGISTRATION_INTENTS)[number];

export const registrationIntentSchema = z.enum(REGISTRATION_INTENTS);

/** Target status a lifecycle intent drives an existing registration toward. */
export const LIFECYCLE_INTENT_TARGET: Readonly<
  Record<Exclude<RegistrationIntent, "install">, RuntimeLifecycleStatus>
> = {
  suspend: "suspended",
  resume: "active",
  retire: "retired",
} as const;

/** Entry status an install lands in (never "active" — no self-activation). */
export const INSTALL_TARGET_STATUS: RuntimeLifecycleStatus = "proposed";

/** Kernel transition law, re-exposed under the fabric's vocabulary. */
export function canTransitionRuntimeLifecycle(
  from: RuntimeLifecycleStatus,
  to: RuntimeLifecycleStatus,
): boolean {
  return canTransitionRuntimeStatus(from as RuntimeManifestStatus, to as RuntimeManifestStatus);
}

export const RUNTIME_LIFECYCLE_TRANSITIONS = RUNTIME_STATUS_TRANSITIONS;

/**
 * Universal pseudo-types that any runtime ontology may reference without
 * declaring (mirrors the kernel manifest's universal vocabulary).
 */
export const UNIVERSAL_ONT_TYPES = ["actor", "entity", "relationship", "event"] as const;

/* ─────────────────────────────────────────────────────────────
 * Runtime descriptor (the registration payload — data, not code)
 * ────────────────────────────────────────────────────────────*/

export const ontTypeNameSchema = z
  .string()
  .regex(
    ONTOLOGY_NAME_PATTERN,
    "ontology type name must be a lowercase identifier (letters, digits, _; starts with a letter; at most 64 characters)",
  );

export const capabilityRefSchema = refSchema("capabilityRef");
export const policyRefSchema = refSchema("policyRef");

export const runtimeInterfaceSchema = z.strictObject({
  name: z.string().min(1).max(128),
  /** Interface-kind vocabulary imported read-only from the kernel manifest. */
  kind: z.enum(RUNTIME_INTERFACE_KINDS),
  description: z.string().max(512).optional(),
});

export const runtimeIsolationSchema = z.strictObject({
  /**
   * Fail-closed: only `true` parses. A runtime that does not explicitly
   * declare tenant scoping cannot be registered at all (AGENTS §13, §17).
   */
  tenantScoped: z.literal(true),
  /** Egress posture; the least-privilege value must be declared explicitly. */
  egress: z.enum(["none", "allowlisted"]),
  /** State namespace posture; declared explicitly, never defaulted. */
  stateMode: z.enum(["dedicated", "shared_readonly"]),
});

export const runtimeResourceCeilingSchema = z.strictObject({
  maxConcurrentTasks: z.number().int().min(1).max(MAX_CONCURRENT_TASKS),
  maxMemoryMb: z.number().int().min(1).max(MAX_MEMORY_MB),
  maxStorageMb: z.number().int().min(1).max(MAX_STORAGE_MB),
});

export const runtimeDescriptorSchema = z
  .strictObject({
    runtimeRef: runtimeRefSchema,
    name: z.string().min(1).max(128),
    version: z
      .string()
      .refine(isValidManifestVersion, "must be a semantic version of the form <major>.<minor>.<patch>"),
    summary: z.string().min(1).max(512),
    ontology: z.strictObject({
      entityTypes: z
        .array(z.strictObject({ name: ontTypeNameSchema, description: z.string().max(512).optional() }))
        .min(1)
        .max(MAX_ONT_ENTITY_TYPES),
      relationshipTypes: z
        .array(
          z.strictObject({
            name: ontTypeNameSchema,
            sourceTypes: z.array(ontTypeNameSchema).min(1).max(MAX_ONT_ENTITY_TYPES),
            targetTypes: z.array(ontTypeNameSchema).min(1).max(MAX_ONT_ENTITY_TYPES),
            description: z.string().max(512).optional(),
          }),
        )
        .max(MAX_ONT_RELATIONSHIP_TYPES),
    }),
    /** Canonical capability ids this runtime CONSUMES; ownership stays with the kernel. */
    capabilityRefs: z.array(capabilityRefSchema).max(MAX_CAPABILITY_REFS),
    /** Policy-set bindings; a runtime with no declared policies cannot be registered. */
    policyRefs: z.array(policyRefSchema).min(1).max(MAX_POLICY_REFS),
    interfaces: z.array(runtimeInterfaceSchema).max(MAX_INTERFACE_DECLARATIONS),
    isolation: runtimeIsolationSchema,
    resourceCeiling: runtimeResourceCeilingSchema,
  })
  .superRefine((descriptor, ctx) => {
    const addIssue = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: "custom", message, path });

    const entityNames = new Set<string>();
    for (const [index, entity] of descriptor.ontology.entityTypes.entries()) {
      if (entityNames.has(entity.name)) {
        addIssue(`duplicate entity type name "${entity.name}"`, ["ontology", "entityTypes", index]);
      }
      entityNames.add(entity.name);
    }

    const resolvable = new Set<string>([...entityNames, ...UNIVERSAL_ONT_TYPES]);
    const relationshipNames = new Set<string>();
    descriptor.ontology.relationshipTypes.forEach((relationship, index) => {
      if (relationshipNames.has(relationship.name)) {
        addIssue(
          `duplicate relationship type name "${relationship.name}"`,
          ["ontology", "relationshipTypes", index],
        );
      }
      relationshipNames.add(relationship.name);
      for (const endpoint of ["sourceTypes", "targetTypes"] as const) {
        relationship[endpoint].forEach((typeName, typeIndex) => {
          if (!resolvable.has(typeName)) {
            addIssue(
              `${endpoint}[${typeIndex}] "${typeName}" resolves to neither a declared entity type nor a universal type`,
              ["ontology", "relationshipTypes", index, endpoint, typeIndex],
            );
          }
        });
      }
    });

    const capabilityRefs = new Set<string>();
    descriptor.capabilityRefs.forEach((ref, index) => {
      if (capabilityRefs.has(ref)) {
        addIssue(`duplicate capabilityRef "${ref}"`, ["capabilityRefs", index]);
      }
      capabilityRefs.add(ref);
    });

    const policyRefs = new Set<string>();
    descriptor.policyRefs.forEach((ref, index) => {
      if (policyRefs.has(ref)) {
        addIssue(`duplicate policyRef "${ref}"`, ["policyRefs", index]);
      }
      policyRefs.add(ref);
    });

    const interfaceNames = new Set<string>();
    descriptor.interfaces.forEach((iface, index) => {
      if (interfaceNames.has(iface.name)) {
        addIssue(`duplicate interface name "${iface.name}"`, ["interfaces", index]);
      }
      interfaceNames.add(iface.name);
    });
  });

export type RuntimeDescriptor = z.infer<typeof runtimeDescriptorSchema>;

/* ─────────────────────────────────────────────────────────────
 * Provenance (AGENTS §12 — every declaration answers WHO/WHEN/WHY)
 * ────────────────────────────────────────────────────────────*/

export const registrationProvenanceSchema = z.strictObject({
  /** Requesting actor or role REFERENCE — never a credential. */
  requestedBy: refSchema("requestedBy"),
  /** Governing authority the request is made under (policy/mission citation). */
  authority: z.string().min(1).max(256),
  requestedAt: isoInstantSchema,
  justification: z.string().min(1).max(512),
});

export type RegistrationProvenance = z.infer<typeof registrationProvenanceSchema>;

/* ─────────────────────────────────────────────────────────────
 * Registration requests (discriminated on intent — fail closed)
 * ────────────────────────────────────────────────────────────*/

const installRequestSchema = z.strictObject({
  intent: z.literal("install"),
  descriptor: runtimeDescriptorSchema,
  provenance: registrationProvenanceSchema,
});

const lifecycleRequestSchema = z.strictObject({
  intent: z.enum(["suspend", "resume", "retire"]),
  runtimeRef: runtimeRefSchema,
  provenance: registrationProvenanceSchema,
});

export const runtimeRegistrationRequestSchema = z.discriminatedUnion("intent", [
  installRequestSchema,
  lifecycleRequestSchema,
]);

export type RuntimeRegistrationRequest = z.infer<typeof runtimeRegistrationRequestSchema>;

/* ─────────────────────────────────────────────────────────────
 * Server-resolved registration context
 * (the caller NEVER supplies tenant or registry view — §26/§27)
 * ────────────────────────────────────────────────────────────*/

export const registrationContextSchema = z.strictObject({
  actorRef: refSchema("actorRef"),
  resolvedTenantRef: refSchema("resolvedTenantRef"),
  /** Instant the context was resolved; every decision stamps this instant. */
  observedAt: isoInstantSchema,
  /** Canonical capability vocabulary the kernel currently declares. */
  knownCapabilityRefs: z.array(capabilityRefSchema).max(MAX_CAPABILITY_REFS),
  /** Registry snapshot visible to this tenant resolution. */
  registrySnapshot: z
    .array(
      z.strictObject({
        runtimeRef: runtimeRefSchema,
        tenantRef: refSchema("tenantRef"),
        status: runtimeLifecycleStatusSchema,
      }),
    )
    .max(MAX_REGISTRY_SNAPSHOT_ENTRIES),
});

export type RegistrationContext = z.infer<typeof registrationContextSchema>;

/* ─────────────────────────────────────────────────────────────
 * Decisions (ALLOW / DENY — §16; denial always carries typed reasons)
 * ────────────────────────────────────────────────────────────*/

export const DENIAL_REASONS = [
  "invalid_request_shape",
  "invalid_context",
  "unknown_source",
  "duplicate_registration",
  "unregistered_runtime_ref",
  "tenant_mismatch",
  "unresolved_capability_ref",
  "invalid_lifecycle_transition",
  "retired_runtime",
] as const;

export type DenialReason = (typeof DENIAL_REASONS)[number];

export const denialReasonSchema = z.enum(DENIAL_REASONS);

export const runtimeRegistrationDecisionSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("allow"),
    intent: registrationIntentSchema,
    runtimeRef: runtimeRefSchema,
    tenantRef: refSchema("tenantRef"),
    targetStatus: runtimeLifecycleStatusSchema,
    decidedAt: isoInstantSchema,
    decidedBy: refSchema("actorRef"),
  }),
  z.strictObject({
    outcome: z.literal("deny"),
    intent: registrationIntentSchema.optional(),
    runtimeRef: runtimeRefSchema.optional(),
    tenantRef: refSchema("tenantRef").optional(),
    reasons: z.array(denialReasonSchema).min(1).max(DENIAL_REASONS.length),
    detail: z.array(z.string().max(300)).max(MAX_DECISION_DETAIL_ITEMS),
    decidedAt: isoInstantSchema,
    decidedBy: refSchema("actorRef").optional(),
  }),
]);

export type RuntimeRegistrationDecision = z.infer<typeof runtimeRegistrationDecisionSchema>;

/* ─────────────────────────────────────────────────────────────
 * Fail-closed parsing (unknown input is untrusted; shape is proven)
 * ────────────────────────────────────────────────────────────*/

export type RuntimeContractParse<T> =
  | { ok: true; value: T }
  | { ok: false; issues: readonly string[] };

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return `${path.length > 0 ? path : "(root)"}: ${issue.message}`;
  });
}

function parseWith<T>(schema: z.ZodType<T>, input: unknown): RuntimeContractParse<T> {
  const result = schema.safeParse(input);
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, issues: zodIssues(result.error) };
}

export function parseRuntimeDescriptor(input: unknown): RuntimeContractParse<RuntimeDescriptor> {
  return parseWith(runtimeDescriptorSchema, input);
}

export function parseRuntimeRegistrationRequest(
  input: unknown,
): RuntimeContractParse<RuntimeRegistrationRequest> {
  return parseWith(runtimeRegistrationRequestSchema, input);
}

export function parseRegistrationContext(input: unknown): RuntimeContractParse<RegistrationContext> {
  return parseWith(registrationContextSchema, input);
}

export function parseRuntimeRegistrationDecision(
  input: unknown,
): RuntimeContractParse<RuntimeRegistrationDecision> {
  return parseWith(runtimeRegistrationDecisionSchema, input);
}

/* ─────────────────────────────────────────────────────────────
 * The fail-closed decision function
 * ────────────────────────────────────────────────────────────*/

function deny(
  intent: RegistrationIntent | undefined,
  runtimeRef: string | undefined,
  tenantRef: string | undefined,
  context: RegistrationContext | undefined,
  reasons: readonly DenialReason[],
  detail: readonly string[],
): RuntimeRegistrationDecision {
  return {
    outcome: "deny",
    intent,
    runtimeRef,
    tenantRef,
    reasons: [...reasons],
    detail: detail.slice(0, MAX_DECISION_DETAIL_ITEMS),
    decidedAt: context?.observedAt ?? "1970-01-01T00:00:00.000Z",
    decidedBy: context?.actorRef,
  };
}

/**
 * Decide a runtime registration request against a server-resolved context.
 *
 * Fail-closed invariants:
 * - an unparseable request or context denies (never throws, never guesses);
 * - the tenant and registry view come ONLY from the context (§26: never
 *   trust client-supplied tenant/role fields);
 * - a canonical runtime ref is globally unique: installing an already
 *   registered ref denies as duplicate (same tenant) or cross-tenant
 *   collision (§31: tenant A cannot act on tenant B);
 * - lifecycle operations resolve the runtime through the context registry —
 *   an unknown ref, a foreign-tenant ref, or a retired runtime denies;
 * - every accepted lifecycle move must satisfy the kernel transition law
 *   (defense in depth: the intent→target mapping can never authorize a
 *   transition the kernel forbids);
 * - installing registers the runtime as `proposed` only — no path in this module
 *   activates a runtime (§21: proposals never execute themselves).
 */
export function decideRuntimeRegistration(
  request: unknown,
  context: unknown,
): RuntimeRegistrationDecision {
  const parsedContext = parseRegistrationContext(context);
  if (!parsedContext.ok) {
    return deny(undefined, undefined, undefined, undefined, ["invalid_context"], parsedContext.issues);
  }
  const ctx = parsedContext.value;
  if (ctx.actorRef.length === 0 || ctx.resolvedTenantRef.length === 0) {
    return deny(undefined, undefined, undefined, ctx, ["unknown_source"], []);
  }

  const parsedRequest = parseRuntimeRegistrationRequest(request);
  if (!parsedRequest.ok) {
    return deny(undefined, undefined, ctx.resolvedTenantRef, ctx, ["invalid_request_shape"], parsedRequest.issues);
  }
  const req = parsedRequest.value;

  if (req.intent === "install") {
    const existing = ctx.registrySnapshot.find((row) => row.runtimeRef === req.descriptor.runtimeRef);
    if (existing !== undefined) {
      return existing.tenantRef === ctx.resolvedTenantRef
        ? deny(req.intent, req.descriptor.runtimeRef, ctx.resolvedTenantRef, ctx, ["duplicate_registration"], [])
        : deny(req.intent, req.descriptor.runtimeRef, ctx.resolvedTenantRef, ctx, ["tenant_mismatch"], [
            "canonical runtime ref is already registered to another tenant",
          ]);
    }
    const unresolved = req.descriptor.capabilityRefs.filter(
      (ref) => !ctx.knownCapabilityRefs.includes(ref),
    );
    if (unresolved.length > 0) {
      return deny(req.intent, req.descriptor.runtimeRef, ctx.resolvedTenantRef, ctx, ["unresolved_capability_ref"], [
        ...unresolved.map((ref) => `capabilityRef "${ref}" is not in the canonical capability vocabulary`),
      ]);
    }
    return {
      outcome: "allow",
      intent: req.intent,
      runtimeRef: req.descriptor.runtimeRef,
      tenantRef: ctx.resolvedTenantRef,
      targetStatus: INSTALL_TARGET_STATUS,
      decidedAt: ctx.observedAt,
      decidedBy: ctx.actorRef,
    };
  }

  const registered = ctx.registrySnapshot.find((row) => row.runtimeRef === req.runtimeRef);
  if (registered === undefined) {
    return deny(req.intent, req.runtimeRef, ctx.resolvedTenantRef, ctx, ["unregistered_runtime_ref"], []);
  }
  if (registered.tenantRef !== ctx.resolvedTenantRef) {
    return deny(req.intent, req.runtimeRef, ctx.resolvedTenantRef, ctx, ["tenant_mismatch"], [
      "runtime is registered to another tenant",
    ]);
  }
  if (registered.status === "retired") {
    return deny(req.intent, req.runtimeRef, ctx.resolvedTenantRef, ctx, ["retired_runtime"], []);
  }

  const target = LIFECYCLE_INTENT_TARGET[req.intent];
  if (registered.status === target) {
    return deny(req.intent, req.runtimeRef, ctx.resolvedTenantRef, ctx, ["invalid_lifecycle_transition"], [
      `runtime is already ${registered.status}`,
    ]);
  }
  if (!canTransitionRuntimeLifecycle(registered.status, target)) {
    return deny(req.intent, req.runtimeRef, ctx.resolvedTenantRef, ctx, ["invalid_lifecycle_transition"], [
      `kernel transition law forbids ${registered.status} → ${target}`,
    ]);
  }
  return {
    outcome: "allow",
    intent: req.intent,
    runtimeRef: req.runtimeRef,
    tenantRef: ctx.resolvedTenantRef,
    targetStatus: target,
    decidedAt: ctx.observedAt,
    decidedBy: ctx.actorRef,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Runtime health signals (unproven is "unknown", never optimistic)
 * ────────────────────────────────────────────────────────────*/

export const RUNTIME_HEALTH_STATUSES = ["healthy", "degraded", "unhealthy", "unknown"] as const;

export type RuntimeHealthStatus = (typeof RUNTIME_HEALTH_STATUSES)[number];

export const runtimeHealthSignalSchema = z.strictObject({
  runtimeRef: runtimeRefSchema,
  tenantRef: refSchema("tenantRef"),
  observedAt: isoInstantSchema,
  status: z.enum(RUNTIME_HEALTH_STATUSES),
  failingDependencyRefs: z.array(refSchema("dependencyRef")).max(MAX_DEPENDENCY_REFS).default([]),
  summary: z.string().max(512).optional(),
});

export type RuntimeHealthSignal = z.infer<typeof runtimeHealthSignalSchema>;

export function parseRuntimeHealthSignal(input: unknown): RuntimeContractParse<RuntimeHealthSignal> {
  return parseWith(runtimeHealthSignalSchema, input);
}

/** The fail-closed health posture for a runtime with no proven observation. */
export function unknownRuntimeHealthSignal(
  runtimeRef: string,
  tenantRef: string,
  observedAt: string,
): RuntimeHealthSignal {
  return {
    runtimeRef,
    tenantRef,
    observedAt,
    status: "unknown",
    failingDependencyRefs: [],
  };
}