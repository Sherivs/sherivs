/**
 * CoreGrid — Phase 51 Universal Reality OS Kernel: kernel-composition contracts
 * (H3 wave Squad G, mission G-071; Constitution §7, §9, §12, §16, §21, §24;
 * architecture/phase-51-universal-reality-operating-system-kernel.md and
 * architecture/phase-acceptance/phase-51-universal-reality-operating-system-kernel.json).
 *
 * WHAT: the typed COMPOSITION surface of the Universal Reality OS Kernel —
 * the layer that composes universal kernel objects, relationships and events
 * (the kernel substrate in `frontend/src/lib/kernel/reality.ts`, imported
 * READ-ONLY) into one declared, entry-addressable kernel unit with a single
 * governed tenant scope and fail-closed composition invariants. It owns
 * COMPOSITION ONLY: no identity, no authorization decisions, no canonical
 * truth, no persistence, no vendor access, no I/O, no wall-clock reads —
 * every instant is a supplied parameter.
 *
 * Law of this module (phase-51 boundary: "composition is not authority"):
 * - The kernel composes capabilities and never grants them. Nothing here
 *   returns an authorization decision, opens access, or bypasses tenancy,
 *   policy or authorization; a composition that cannot be resolved inside
 *   ONE tenant scope fails closed (§13 multi-tenancy, §16 authorization).
 * - No anonymous composition: the composition-graph record and EVERY member
 *   kernel object carry the canonical CoreObject envelope (J-001), are
 *   validated through the substrate's own fail-closed envelope validator,
 *   and are gated by the object-type allowlist. An EMPTY allowlist rejects
 *   every member type — fail-closed bootstrap posture; omitting the
 *   parameter defers to the substrate's live registry snapshot.
 * - No fabricated identity: member objects are composition-local keys, not
 *   persistent ids. Composed relationship drafts deliberately OMIT the
 *   endpoint columns — the plan structurally cannot be inserted until the
 *   server write path resolves keys to persistent ids. The composition
 *   surface never invents an entity id (§9 canonical truth).
 * - All-or-nothing: a composition that fails a member validation yields a
 *   typed failure and NO partial unit — a half-composed reality is not a
 *   reality.
 *
 * Fail-closed parsing: an untrusted declaration that violates an invariant
 * yields a typed failure with structured issues. A failed parse never
 * yields a partial declaration.
 *
 * Neutral vocabulary only (J-037 shrink-only): this is platform substrate.
 * A "member" is one kernel object, relationship or event composed into the
 * unit; no domain vocabulary appears here.
 */

import { z } from "zod";
import {
  DATA_CLASSIFICATIONS,
  KERNEL_OBJECT_STATUSES,
  entityDraft,
  eventDraft,
  relationshipDraft,
  stampKernelDraft,
  validateKernelObjectEnvelope,
  type EntityDraftInput,
  type EventDraftInput,
  type KernelObjectEnvelope,
  type KernelObjectEnvelopeInput,
  type RelationshipDraftInput,
} from "../kernel/reality";
import { canonicalKernelObjectTypes } from "../kernel/object-type-registry";

/* ─────────────────────────────────────────────────────────────
 * Version, bounds and boundary statement
 * ────────────────────────────────────────────────────────────*/

export const REALITY_OS_KERNEL_CONTRACT_SCHEMA_VERSION = "1.0";

/** Hard ceiling on members in one declared composition. */
export const MAX_COMPOSITION_MEMBERS = 256;

/** Structural boundary statement every composition surface carries. */
export const COMPOSITION_BOUNDARY_STATEMENT =
  "composition is not authority: the kernel composes capabilities, never grants them";

/** Composition-level schema version is MAJOR.MINOR (mirrors the substrate law). */
export const COMPOSITION_SCHEMA_VERSION_PATTERN = /^\d+\.\d+$/;

/* ─────────────────────────────────────────────────────────────
 * Vocabulary (phase doc: universal object/relationship/event composition)
 * ────────────────────────────────────────────────────────────*/

/** The three kernel-substrate member kinds a composition may declare. */
export const COMPOSITION_MEMBER_KINDS = ["object", "relationship", "event"] as const;
export type CompositionMemberKind = (typeof COMPOSITION_MEMBER_KINDS)[number];

/** The invariant ids every composed unit is evaluated against. */
export const COMPOSITION_INVARIANT_IDS = [
  "composition_stamped",
  "single_tenant_scope",
  "no_anonymous_members",
  "explicit_causation_root",
  "relationship_endpoints_resolved",
  "entry_resolvable",
  "bounded_unit",
] as const;
export type CompositionInvariantId = (typeof COMPOSITION_INVARIANT_IDS)[number];

/* ─────────────────────────────────────────────────────────────
 * Primitives (AGENTS §12 provenance; §9 canonical truth)
 * ────────────────────────────────────────────────────────────*/

export const identifierSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_:.-]{0,127}$/,
    "identifier must be 1-128 characters of letters, digits, underscore, colon, dot or hyphen, starting alphanumeric",
  );
export type Identifier = z.infer<typeof identifierSchema>;

export const tenantRefSchema = identifierSchema;

export const schemaVersionSchema = z
  .string()
  .regex(COMPOSITION_SCHEMA_VERSION_PATTERN, "schema_version must match MAJOR.MINOR (e.g. 1.0)");

/* ─────────────────────────────────────────────────────────────
 * Envelope declaration schemas (mirror of the substrate envelope
 * INPUT types; the substrate validator remains the authority)
 * ────────────────────────────────────────────────────────────*/

export const kernelProvenanceDeclarationSchema = z.strictObject({
  source: z.string().min(1),
  sourceRef: z.string().nullable().optional(),
  recordedBy: z.string().nullable().optional(),
  /** Declared tenant that produced this information; must match the unit tenant. */
  originTenantId: z.string().nullable().optional(),
  generatedByAi: z.boolean().optional(),
  verified: z.boolean().optional(),
});

export const kernelEnvelopeDeclarationSchema = z.strictObject({
  objectType: z.string().min(1).max(128),
  schemaVersion: schemaVersionSchema,
  status: z.enum(KERNEL_OBJECT_STATUSES),
  createdBy: z.string().min(1),
  updatedBy: z.string().min(1),
  provenance: kernelProvenanceDeclarationSchema,
  policyContext: z.record(z.string(), z.unknown()),
  traceId: z.string().min(1),
  correlationId: z.string().min(1),
  causationId: z.string().nullable().optional(),
  parentEventId: z.string().nullable().optional(),
  /** Explicit causation-chain root when the record originates a chain. */
  declaredOrigin: z.string().nullable().optional(),
});

/* ─────────────────────────────────────────────────────────────
 * Member draft declaration schemas
 *
 * These mirror the substrate draft INPUTS with three composition-level
 * omissions, each a fail-closed law (strictObject rejects them):
 * - `tenantId` — tenancy is owned by the composition frame; a member
 *   cannot declare its own tenant (§13).
 * - `envelope` — the stamp path is the member's own `envelope` field;
 *   a draft cannot smuggle a second envelope past the gate.
 * - entity/relationship `sourceEntityId`/`targetEntityId` on the
 *   relationship draft — endpoints are resolved by KEY at composition
 *   level, never fabricated as ids.
 *
 * Field law (bounds, kinds, confidence) is enforced authoritatively by
 * the substrate builders at composition time; the Zod layer only routes
 * untrusted input into the substrate's typed inputs.
 * ────────────────────────────────────────────────────────────*/

export const kernelBiTemporalDeclarationSchema = z.strictObject({
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  validTimeKnown: z.boolean().optional(),
  supersedes: z.string().nullable().optional(),
});

export const objectMemberDraftSchema = z.strictObject({
  entityType: z.string(),
  state: z.string().nullable().optional(),
  classification: z.enum(DATA_CLASSIFICATIONS).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  sourceType: z.string().nullable().optional(),
  sourceRef: z.string().nullable().optional(),
  observedAt: z.string().nullable().optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  biTemporal: kernelBiTemporalDeclarationSchema.optional(),
});

export const relationshipMemberDraftSchema = z.strictObject({
  relationType: z.string(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  sourceRef: z.string().nullable().optional(),
  observedAt: z.string().nullable().optional(),
  validFrom: z.string().nullable().optional(),
  validTo: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
});

export const eventMemberDraftSchema = z.strictObject({
  eventType: z.string(),
  aggregateType: z.string(),
  aggregateId: z.string(),
  actorIdentity: z.string().nullable().optional(),
  correlationId: z.string().nullable().optional(),
  idempotencyKey: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  occurredAt: z.string().optional(),
  biTemporal: kernelBiTemporalDeclarationSchema.optional(),
});

/* ─────────────────────────────────────────────────────────────
 * Composition declaration (the composition-graph record)
 * ────────────────────────────────────────────────────────────*/

const objectMemberSchema = z.strictObject({
  kind: z.literal("object"),
  key: identifierSchema,
  draft: objectMemberDraftSchema,
  envelope: kernelEnvelopeDeclarationSchema,
});

const relationshipMemberSchema = z.strictObject({
  kind: z.literal("relationship"),
  key: identifierSchema,
  /** Composition-local KEY of the object member at the source endpoint. */
  sourceKey: identifierSchema,
  /** Composition-local KEY of the object member at the target endpoint. */
  targetKey: identifierSchema,
  draft: relationshipMemberDraftSchema,
  envelope: kernelEnvelopeDeclarationSchema,
});

const eventMemberSchema = z.strictObject({
  kind: z.literal("event"),
  key: identifierSchema,
  draft: eventMemberDraftSchema,
  envelope: kernelEnvelopeDeclarationSchema,
});

export const compositionMemberSchema = z.discriminatedUnion("kind", [
  objectMemberSchema,
  relationshipMemberSchema,
  eventMemberSchema,
]);
export type CompositionMember = z.infer<typeof compositionMemberSchema>;

export const compositionDeclarationSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  compositionId: identifierSchema,
  tenantId: tenantRefSchema,
  /** The governed entry point: the KEY of an OBJECT member. */
  entryKey: identifierSchema,
  /** Envelope of the composition-graph record itself — no anonymous composition. */
  envelope: kernelEnvelopeDeclarationSchema,
  members: z.array(compositionMemberSchema).min(1).max(MAX_COMPOSITION_MEMBERS),
});
export type CompositionDeclaration = z.infer<typeof compositionDeclarationSchema>;

/* ─────────────────────────────────────────────────────────────
 * Parse plumbing (fail-closed, typed, never partial)
 * ────────────────────────────────────────────────────────────*/

export type CompositionParseFailureReason =
  | "invalid_shape"
  | "duplicate_member_key"
  | "unresolved_reference"
  | "cross_tenant_scope"
  | "unresolvable_entry"
  | "substrate_rejected";

export interface CompositionParseIssue {
  readonly path: string;
  readonly message: string;
}

export type CompositionParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: CompositionParseFailureReason;
      readonly issues: readonly CompositionParseIssue[];
    };

interface CompositionLawIssue {
  readonly reason: CompositionParseFailureReason;
  readonly path: string;
  readonly message: string;
}

function issuePath(path: readonly (string | number | symbol)[]): string {
  if (path.length === 0) return "(root)";
  return path.map((segment) => String(segment)).join(".");
}

function shapeFailure(error: z.ZodError): CompositionParseResult<never> {
  return {
    ok: false,
    reason: "invalid_shape",
    issues: error.issues.map((issue) => ({
      path: issuePath(issue.path),
      message: issue.message,
    })),
  };
}

function lawFailure(issues: readonly CompositionLawIssue[]): CompositionParseResult<never> {
  return {
    ok: false,
    reason: issues[0]?.reason ?? "invalid_shape",
    issues: issues.map((issue) => ({ path: issue.path, message: issue.message })),
  };
}

/** Declared tenant alignment: provenance may never cross the unit tenant. */
function tenantScopeIssues(tenantId: string, envelope: KernelObjectEnvelopeInput, path: string): CompositionLawIssue[] {
  const origin = envelope.provenance.originTenantId?.trim();
  if (origin != null && origin !== "" && origin !== tenantId) {
    return [
      {
        reason: "cross_tenant_scope",
        path,
        message: `provenance origin tenant "${origin}" does not match the composition tenant "${tenantId}" — composition never crosses a tenant boundary`,
      },
    ];
  }
  return [];
}

/**
 * Cross-member law over a (already shape-parsed) declaration: member keys
 * are unique, relationship endpoints resolve to OBJECT members and never
 * to themselves, the entry key resolves to an OBJECT member, and every
 * envelope's provenance stays inside the composition tenant.
 */
function crossMemberIssues(declaration: CompositionDeclaration): CompositionLawIssue[] {
  const issues: CompositionLawIssue[] = [];
  const seen = new Set<string>();
  const objectKeys = new Set<string>();
  for (const member of declaration.members) {
    if (seen.has(member.key)) {
      issues.push({
        reason: "duplicate_member_key",
        path: `members[${member.key}]`,
        message: `member key "${member.key}" is declared more than once — a composition-local key identifies exactly one member`,
      });
      continue;
    }
    seen.add(member.key);
    if (member.kind === "object") objectKeys.add(member.key);
  }
  for (const member of declaration.members) {
    if (member.kind !== "relationship") continue;
    for (const endpoint of ["sourceKey", "targetKey"] as const) {
      const key = member[endpoint];
      if (!objectKeys.has(key)) {
        issues.push({
          reason: "unresolved_reference",
          path: `members[${member.key}].${endpoint}`,
          message: `relationship "${member.key}" ${endpoint} "${key}" does not resolve to an OBJECT member of this composition`,
        });
      }
    }
    if (member.sourceKey === member.targetKey) {
      issues.push({
        reason: "unresolved_reference",
        path: `members[${member.key}]`,
        message: `relationship "${member.key}" binds an object to itself — a relationship needs two distinct endpoints`,
      });
    }
  }
  if (!objectKeys.has(declaration.entryKey)) {
    issues.push({
      reason: "unresolvable_entry",
      path: "entryKey",
      message: `entry key "${declaration.entryKey}" does not resolve to an OBJECT member — the governed entry point is an object, never a relationship or event`,
    });
  }
  issues.push(
    ...tenantScopeIssues(declaration.tenantId, declaration.envelope, "envelope"),
  );
  for (const member of declaration.members) {
    issues.push(
      ...tenantScopeIssues(declaration.tenantId, member.envelope, `members[${member.key}].envelope`),
    );
  }
  return issues;
}

/**
 * Parse an untrusted composition declaration. Fails closed on shape
 * violations and on every cross-member law (unique keys, resolvable
 * relationship endpoints, object-kind entry point, single tenant scope).
 */
export function parseCompositionDeclaration(
  input: unknown,
): CompositionParseResult<CompositionDeclaration> {
  const parsed = compositionDeclarationSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);
  const lawIssues = crossMemberIssues(parsed.data);
  if (lawIssues.length > 0) return lawFailure(lawIssues);
  return { ok: true, value: parsed.data };
}

/* ─────────────────────────────────────────────────────────────
 * Composed unit (the composition PLAN — never a persistent row)
 * ────────────────────────────────────────────────────────────*/

export type ComposedObjectDraft = ReturnType<typeof entityDraft> & KernelObjectEnvelope;
export type ComposedEventDraft = ReturnType<typeof eventDraft> & KernelObjectEnvelope;

/**
 * Endpoint-less relationship columns (AGENTS §9: no fabricated identity).
 * `source_entity_id`/`target_entity_id` are structurally ABSENT: the
 * server write path must resolve `sourceKey`/`targetKey` to persistent
 * ids before an insert is possible.
 */
export interface ComposedRelationshipColumns {
  relation_type: string;
  tenant_id: string;
  attributes: Record<string, unknown>;
  source_ref: string | null;
  observed_at: string | null;
  recorded_at: string;
  valid_from: string | null;
  valid_to: string | null;
  confidence: number | null;
}

export type ComposedRelationshipDraft = ComposedRelationshipColumns & KernelObjectEnvelope;

export interface ComposedObject {
  readonly key: Identifier;
  readonly draft: ComposedObjectDraft;
}

export interface ComposedRelationship {
  readonly key: Identifier;
  readonly sourceKey: Identifier;
  readonly targetKey: Identifier;
  readonly draft: ComposedRelationshipDraft;
}

export interface ComposedEvent {
  readonly key: Identifier;
  readonly draft: ComposedEventDraft;
}

export interface ComposedKernelUnit {
  readonly schemaVersion: string;
  readonly compositionId: Identifier;
  readonly tenantId: Identifier;
  readonly entryKey: Identifier;
  /** Envelope of the composition-graph record itself. */
  readonly compositionEnvelope: KernelObjectEnvelope;
  readonly objects: readonly ComposedObject[];
  readonly relationships: readonly ComposedRelationship[];
  readonly events: readonly ComposedEvent[];
}

/** Raised internally when the composition violates a non-substrate law. */
class CompositionLawError extends Error {
  readonly reason: CompositionParseFailureReason;
  readonly path: string;

  constructor(reason: CompositionParseFailureReason, path: string, message: string) {
    super(message);
    this.name = "CompositionLawError";
    this.reason = reason;
    this.path = path;
  }
}

function stampedTenantEnvelope(
  envelopeInput: KernelObjectEnvelopeInput,
  tenantId: string,
  path: string,
  knownObjectTypes: readonly string[],
): KernelObjectEnvelope {
  let envelope: KernelObjectEnvelope;
  try {
    envelope = validateKernelObjectEnvelope(envelopeInput, knownObjectTypes);
  } catch (error) {
    throw new CompositionLawError(
      "substrate_rejected",
      path,
      error instanceof Error ? error.message : "substrate rejected the envelope",
    );
  }
  const origin = envelope.provenance.originTenantId;
  if (origin != null && origin !== tenantId) {
    throw new CompositionLawError(
      "cross_tenant_scope",
      path,
      `provenance origin tenant "${origin}" does not match the composition tenant "${tenantId}" — composition never crosses a tenant boundary`,
    );
  }
  return envelope;
}

function composeUnit(
  declaration: CompositionDeclaration,
  now: string,
  knownObjectTypes: readonly string[],
): ComposedKernelUnit {
  const issues = crossMemberIssues(declaration);
  if (issues.length > 0) {
    throw new CompositionLawError(issues[0].reason, issues[0].path, issues[0].message);
  }

  const compositionEnvelope = stampedTenantEnvelope(
    declaration.envelope,
    declaration.tenantId,
    "envelope",
    knownObjectTypes,
  );

  const objects: ComposedObject[] = [];
  const relationships: ComposedRelationship[] = [];
  const events: ComposedEvent[] = [];

  for (const member of declaration.members) {
    const path = `members[${member.key}]`;
    const envelope = stampedTenantEnvelope(member.envelope, declaration.tenantId, `${path}.envelope`, knownObjectTypes);
    if (member.kind === "object") {
      const built = entityDraft(member.draft, now);
      objects.push({
        key: member.key,
        draft: stampKernelDraft({ ...built, tenant_id: declaration.tenantId }, member.envelope, knownObjectTypes),
      });
      continue;
    }
    if (member.kind === "relationship") {
      const built = relationshipDraft(
        { ...member.draft, sourceEntityId: member.sourceKey, targetEntityId: member.targetKey },
        now,
      );
      const columns: ComposedRelationshipColumns = {
        relation_type: built.relation_type,
        tenant_id: declaration.tenantId,
        attributes: built.attributes,
        source_ref: built.source_ref,
        observed_at: built.observed_at,
        recorded_at: built.recorded_at,
        valid_from: built.valid_from,
        valid_to: built.valid_to,
        confidence: built.confidence,
      };
      relationships.push({
        key: member.key,
        sourceKey: member.sourceKey,
        targetKey: member.targetKey,
        draft: stampKernelDraft(columns, member.envelope, knownObjectTypes),
      });
      continue;
    }
    const built = eventDraft(member.draft, now);
    events.push({
      key: member.key,
      draft: stampKernelDraft({ ...built, tenant_id: declaration.tenantId }, member.envelope, knownObjectTypes),
    });
  }

  return {
    schemaVersion: declaration.schemaVersion,
    compositionId: declaration.compositionId,
    tenantId: declaration.tenantId,
    entryKey: declaration.entryKey,
    compositionEnvelope,
    objects,
    relationships,
    events,
  };
}

/**
 * Compose a parsed declaration into a kernel unit using the substrate's
 * own fail-closed draft builders (READ-ONLY composition — this module
 * modifies nothing in the kernel). `knownObjectTypes` gates every envelope
 * (an EMPTY allowlist rejects every member type — fail-closed bootstrap);
 * omitting it defers to the substrate's live registry snapshot. The result
 * is all-or-nothing: a member failure yields a typed failure and NO unit.
 */
export function composeKernelUnit(
  declaration: CompositionDeclaration,
  now: string,
  knownObjectTypes?: readonly string[],
): CompositionParseResult<ComposedKernelUnit> {
  const gate = knownObjectTypes ?? canonicalKernelObjectTypes();
  try {
    return { ok: true, value: composeUnit(declaration, now, gate) };
  } catch (error) {
    if (error instanceof CompositionLawError) {
      return {
        ok: false,
        reason: error.reason,
        issues: [{ path: error.path, message: error.message }],
      };
    }
    return {
      ok: false,
      reason: "substrate_rejected",
      issues: [
        {
          path: "(composition)",
          message: error instanceof Error ? error.message : "substrate rejected the composition",
        },
      ],
    };
  }
}

/**
 * One-shot composition from untrusted input: parse the declaration, then
 * compose. Fails closed at whichever stage rejects first.
 */
export function composeFromUntrusted(
  input: unknown,
  now: string,
  knownObjectTypes?: readonly string[],
): CompositionParseResult<ComposedKernelUnit> {
  const parsed = parseCompositionDeclaration(input);
  if (!parsed.ok) return parsed;
  return composeKernelUnit(parsed.value, now, knownObjectTypes);
}

/* ─────────────────────────────────────────────────────────────
 * Governed entry resolution and composition invariants
 * ────────────────────────────────────────────────────────────*/

export type CompositionEntryResolution =
  | { readonly ok: true; readonly entry: ComposedObject }
  | { readonly ok: false; readonly reason: string };

/**
 * Resolve the governed entry point of a composed unit. Fails closed when
 * the entry key does not resolve to an OBJECT member — a composition
 * without a resolvable object entry has no governed way in.
 */
export function resolveComposedEntry(unit: ComposedKernelUnit): CompositionEntryResolution {
  const entry = unit.objects.find((object) => object.key === unit.entryKey);
  if (entry == null) {
    return {
      ok: false,
      reason: `fail-closed: entry key "${unit.entryKey}" does not resolve to an OBJECT member of composition "${unit.compositionId}"`,
    };
  }
  return { ok: true, entry };
}

export interface CompositionInvariantCheck {
  readonly id: CompositionInvariantId;
  readonly satisfied: boolean;
  readonly detail: string;
}

export interface CompositionInvariantReport {
  readonly compositionId: Identifier;
  readonly tenantId: Identifier;
  readonly satisfied: boolean;
  readonly checks: readonly CompositionInvariantCheck[];
}

function hasExplicitCausationRoot(envelope: KernelObjectEnvelope): boolean {
  return (
    (envelope.causation_id != null && envelope.causation_id.trim() !== "") ||
    (envelope.parent_event_id != null && envelope.parent_event_id.trim() !== "") ||
    (envelope.declared_origin != null && envelope.declared_origin.trim() !== "")
  );
}

function envelopeStamped(draft: Record<string, unknown>): boolean {
  return (
    typeof draft.object_type === "string" &&
    draft.object_type.trim() !== "" &&
    typeof draft.schema_version === "string" &&
    draft.schema_version.trim() !== "" &&
    typeof draft.trace_id === "string" &&
    draft.trace_id.trim() !== "" &&
    typeof draft.correlation_id === "string" &&
    draft.correlation_id.trim() !== "" &&
    typeof draft.created_by === "string" &&
    draft.created_by.trim() !== ""
  );
}

/**
 * Evaluate the composition invariants over a composed unit. Pure,
 * defense-in-depth: a unit produced by `composeKernelUnit` satisfies every
 * invariant by construction; the report exists so units arriving from other
 * paths are proven, never presumed.
 */
export function evaluateCompositionInvariants(unit: ComposedKernelUnit): CompositionInvariantReport {
  const checks: CompositionInvariantCheck[] = [];
  const memberCount = unit.objects.length + unit.relationships.length + unit.events.length;

  checks.push({
    id: "composition_stamped",
    satisfied: envelopeStamped(unit.compositionEnvelope as unknown as Record<string, unknown>),
    detail: "the composition-graph record carries a stamped canonical envelope",
  });

  const memberDrafts: Record<string, unknown>[] = [
    ...unit.objects.map((object) => object.draft as unknown as Record<string, unknown>),
    ...unit.relationships.map((relationship) => relationship.draft as unknown as Record<string, unknown>),
    ...unit.events.map((event) => event.draft as unknown as Record<string, unknown>),
  ];
  const offTenant = memberDrafts.filter((draft) => draft.tenant_id !== unit.tenantId);
  const crossTenantProvenance = memberDrafts.filter((draft) => {
    const provenance = draft.provenance as { originTenantId?: string | null } | undefined;
    const origin = provenance?.originTenantId;
    return origin != null && origin !== "" && origin !== unit.tenantId;
  });
  checks.push({
    id: "single_tenant_scope",
    satisfied: offTenant.length === 0 && crossTenantProvenance.length === 0,
    detail:
      offTenant.length + crossTenantProvenance.length === 0
        ? "every member draft and provenance origin stays inside the composition tenant"
        : `${offTenant.length} member draft(s) off the composition tenant and ${crossTenantProvenance.length} cross-tenant provenance origin(s)`,
  });

  const anonymous = memberDrafts.filter((draft) => !envelopeStamped(draft));
  checks.push({
    id: "no_anonymous_members",
    satisfied: anonymous.length === 0,
    detail:
      anonymous.length === 0
        ? "every member carries the canonical CoreObject envelope"
        : `${anonymous.length} member draft(s) missing envelope fields`,
  });

  checks.push({
    id: "explicit_causation_root",
    satisfied: hasExplicitCausationRoot(unit.compositionEnvelope),
    detail: "the composition record declares an explicit causation chain root",
  });

  const objectKeys = new Set(unit.objects.map((object) => object.key));
  const dangling = unit.relationships.filter(
    (relationship) =>
      !objectKeys.has(relationship.sourceKey) ||
      !objectKeys.has(relationship.targetKey) ||
      relationship.sourceKey === relationship.targetKey,
  );
  checks.push({
    id: "relationship_endpoints_resolved",
    satisfied: dangling.length === 0,
    detail:
      dangling.length === 0
        ? "every relationship binds two distinct OBJECT members of the unit"
        : `${dangling.length} relationship(s) with unresolved or self-referential endpoints`,
  });

  checks.push({
    id: "entry_resolvable",
    satisfied: objectKeys.has(unit.entryKey),
    detail: "the governed entry point resolves to an OBJECT member",
  });

  checks.push({
    id: "bounded_unit",
    satisfied: memberCount >= 1 && memberCount <= MAX_COMPOSITION_MEMBERS,
    detail: `${memberCount} member(s) against the 1–${MAX_COMPOSITION_MEMBERS} composition bound`,
  });

  return {
    compositionId: unit.compositionId,
    tenantId: unit.tenantId,
    satisfied: checks.every((check) => check.satisfied),
    checks,
  };
}
