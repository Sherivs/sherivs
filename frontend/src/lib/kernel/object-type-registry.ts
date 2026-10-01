/**
 * CoreGrid — Phase 33 Universal Kernel: canonical object type registry
 * (V1CAP-003 / J-002 / MISSION-R-11).
 *
 * THE type allowlist over kernel writes. A persistent kernel object may carry
 * an object_type only if SOME registered domain declared it. A type registered
 * by no domain is rejected at the kernel write API — unknown types never
 * silently enter the canonical store.
 *
 * Domain neutrality (Constitution §24, §111 runtime-neutrality law): the
 * kernel knows the REGISTRATION CONTRACT, never a domain's vocabulary.
 * Registration is by `domainRef` (e.g. "runtime:scholar", "fixture:restaurant")
 * and the declared types are supplied by the domain's own layer at its own
 * boundary — this module hardcodes no domain words.
 *
 * Fail-closed bootstrap: the registry starts with ONLY the kernel's own
 * substrate object types (the four cg_* CoreObject kinds), registered here
 * through the same public gate under "kernel:core". A registry with zero
 * registrations rejects every object type; deregistering a domain closes its
 * vocabulary at the write API immediately. `canonicalKernelObjectTypes()` is
 * the live snapshot injected into the envelope validation's `knownObjectTypes`
 * parameter (the MISSION-R-10 injection point).
 *
 * Boundary: pure in-memory registry state, no persistence, no imports from
 * the rest of the kernel (reality.ts consumes this module, never the reverse).
 */

/** A domain's declared slice of the canonical object-type allowlist. */
export interface KernelObjectTypeRegistration {
  /** Owning domain reference, e.g. "runtime:scholar" or "fixture:restaurant". */
  readonly domainRef: string;
  /** The object types this domain registered (trimmed, deduplicated). */
  readonly objectTypes: readonly string[];
}

/**
 * Typed rejection raised when a kernel write carries an object_type that no
 * registered domain declared. Extends Error, so existing catch sites and the
 * MISSION-R-10 message contract ("is not registered") remain compatible.
 */
export class KernelObjectTypeRejectedError extends Error {
  readonly objectType: string;

  constructor(objectType: string) {
    super(`envelope object_type "${objectType}" is not registered`);
    this.name = "KernelObjectTypeRejectedError";
    this.objectType = objectType;
  }
}

export function isKernelObjectTypeRejectedError(value: unknown): value is KernelObjectTypeRejectedError {
  return value instanceof KernelObjectTypeRejectedError;
}

/** Domain references are namespaced refs: "<namespace>:<name>" (e.g. runtime:scholar). */
const DOMAIN_REF_PATTERN = /^[a-z][a-z0-9_]*:[a-z0-9_-]+$/;

/** Validates a domainRef without kernel imports (registry must stay cycle-free). */
export function isKernelDomainRef(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 100 && DOMAIN_REF_PATTERN.test(trimmed);
}

/** Mirrors the substrate object_type constraint (1–128 characters). */
function normalizeObjectType(value: unknown, domainRef: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `object type registry: domain "${domainRef}" declared a non-string object type`,
    );
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 128) {
    throw new Error(
      `object type registry: domain "${domainRef}" declared an object_type violating the 1–128 character constraint`,
    );
  }
  return trimmed;
}

const registrationsByDomain = new Map<string, string[]>();
const ownerByType = new Map<string, string>();

function snapshot(domainRef: string): KernelObjectTypeRegistration {
  const objectTypes = registrationsByDomain.get(domainRef) ?? [];
  return Object.freeze({ domainRef, objectTypes: Object.freeze([...objectTypes]) });
}

/**
 * Register (or idempotently refresh) a domain's object-type vocabulary under
 * `domainRef`. Fails closed on: an invalid domainRef, a malformed object type
 * (must be 1–128 characters after trimming), or a type already owned by a
 * DIFFERENT domain — canonical ownership is exclusive (Constitution §12
 * provenance: every allowlist entry answers "who registered this").
 *
 * Relationship/relation vocabularies are NOT object types: they live on the
 * relation_type column and are allowlisted by their own contracts, never here.
 */
export function registerKernelObjectTypes(
  domainRef: string,
  objectTypes: readonly string[],
): KernelObjectTypeRegistration {
  if (!isKernelDomainRef(domainRef)) {
    throw new Error(
      `object type registry: "${String(domainRef)}" is not a valid domainRef (<namespace>:<name>, e.g. "runtime:scholar")`,
    );
  }
  const ref = domainRef.trim();
  if (!Array.isArray(objectTypes)) {
    throw new Error(`object type registry: domain "${ref}" must register an array of object types`);
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of objectTypes) {
    const objectType = normalizeObjectType(raw, ref);
    if (seen.has(objectType)) continue;
    const owner = ownerByType.get(objectType);
    if (owner != null && owner !== ref) {
      throw new Error(
        `object type registry: object type "${objectType}" is already owned by "${owner}" — rejected for "${ref}"`,
      );
    }
    seen.add(objectType);
    normalized.push(objectType);
  }
  const previous = registrationsByDomain.get(ref);
  if (previous != null) {
    for (const stale of previous) {
      if (ownerByType.get(stale) === ref) ownerByType.delete(stale);
    }
  }
  registrationsByDomain.set(ref, normalized);
  for (const objectType of normalized) {
    ownerByType.set(objectType, ref);
  }
  return snapshot(ref);
}

/**
 * Remove a domain's registration entirely. The domain's vocabulary stops being
 * a known object type immediately (fail-closed). Returns false when the domain
 * was not registered.
 */
export function deregisterKernelObjectTypes(domainRef: string): boolean {
  const ref = typeof domainRef === "string" ? domainRef.trim() : "";
  const previous = registrationsByDomain.get(ref);
  if (previous == null) return false;
  for (const objectType of previous) {
    if (ownerByType.get(objectType) === ref) ownerByType.delete(objectType);
  }
  registrationsByDomain.delete(ref);
  return true;
}

/** The canonical allowlist lookup: is this object_type registered by ANY domain? */
export function isRegisteredKernelObjectType(objectType: string): boolean {
  return ownerByType.has(objectType.trim());
}

/** The domain that registered an object type, or undefined when unregistered. */
export function kernelObjectTypeOwner(objectType: string): string | undefined {
  return ownerByType.get(objectType.trim());
}

/** Registered domainRefs, sorted for deterministic consumption. */
export function registeredKernelObjectDomains(): readonly string[] {
  return Object.freeze(Array.from(registrationsByDomain.keys()).sort());
}

/** A domain's registered types, or undefined when the domain is not registered. */
export function registeredKernelObjectTypesFor(domainRef: string): readonly string[] | undefined {
  const registration = registrationsByDomain.get(domainRef.trim());
  return registration ? Object.freeze([...registration]) : undefined;
}

/**
 * The live canonical allowlist — the union of every registered domain's object
 * types, sorted for determinism. This is the value the kernel write API injects
 * into the envelope validation's `knownObjectTypes` parameter. An empty return
 * (zero registrations) rejects every object type: fail-closed bootstrap.
 */
export function canonicalKernelObjectTypes(): readonly string[] {
  return Object.freeze(Array.from(ownerByType.keys()).sort());
}

/* ─────────────────────────────────────────────────────────────
 * Fail-closed bootstrap: the kernel registers its OWN substrate object
 * types (the four cg_* CoreObject kinds, MISSION-R-10 envelope vocabulary)
 * through the same public gate. Every domain vocabulary is additive to
 * this floor; a registry stripped to zero registrations rejects everything.
 * ────────────────────────────────────────────────────────────*/

export const KERNEL_CORE_DOMAIN_REF = "kernel:core";

export const KERNEL_CORE_OBJECT_TYPES: readonly string[] = Object.freeze([
  "core.entity",
  "core.relationship",
  "core.event",
  "core.observation",
]);

registerKernelObjectTypes(KERNEL_CORE_DOMAIN_REF, KERNEL_CORE_OBJECT_TYPES);
