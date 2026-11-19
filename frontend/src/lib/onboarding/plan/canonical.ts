/**
 * Sherivs — deterministic plan serialisation (domain-neutral; ADR-107).
 *
 * A provisioning plan is compared, hashed and stored as data, so two runs over
 * the same input must produce byte-identical output. These helpers give every
 * plan one canonical form: plain JSON values, object keys sorted at every
 * depth, `undefined` dropped, arrays kept in their given order (callers sort
 * set-like arrays before they get here).
 *
 * Pure. No clock, no I/O, no domain vocabulary.
 */

export type PlanJson =
  null | boolean | number | string | readonly PlanJson[] | { readonly [key: string]: PlanJson };

/** Deep, key-sorted, plain-JSON copy. Throws on values JSON cannot carry. */
export function canonicalize(value: unknown): PlanJson {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonicalize: non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => canonicalize(v === undefined ? null : v));
  if (typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, PlanJson> = {};
    for (const key of Object.keys(src).sort()) {
      if (src[key] === undefined) continue;
      out[key] = canonicalize(src[key]);
    }
    return out;
  }
  throw new TypeError(`canonicalize: unsupported value of type ${typeof value}`);
}

/** Canonical JSON text. `indent` 0 gives the compact form used for hashing. */
export function canonicalPlanJson(value: unknown, indent = 0): string {
  return JSON.stringify(canonicalize(value), null, indent);
}

/** FNV-1a 32-bit over the compact canonical JSON. Drift detection only, not a secret. */
export function planDigest(value: unknown): string {
  const text = canonicalPlanJson(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Sorted, de-duplicated copy of a string list (set semantics). */
export function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}
