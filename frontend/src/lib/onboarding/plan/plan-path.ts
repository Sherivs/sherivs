/**
 * Sherivs — plan paths (domain-neutral; ADR-107).
 *
 * An interview question declares WHERE its answer lands in the provisioning
 * plan as a dotted path ("profile.ownership"). The engine only knows the
 * grammar; each domain publishes its own list of known paths. A known path
 * may end in `*`, which stands for exactly one further lower-snake segment
 * ("profile.attributes.*" admits "profile.attributes.campus_count").
 *
 * Pure. No domain vocabulary.
 */

/** A segment is camelCase or lower_snake, starting with a letter. */
const SEGMENT = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const WILDCARD_SEGMENT = /^[a-z][a-z0-9_]*$/;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export function parsePlanPath(path: string): string[] | null {
  if (typeof path !== "string" || path.length === 0 || path.length > 120) return null;
  const parts = path.split(".");
  for (const p of parts) if (!SEGMENT.test(p) || FORBIDDEN_SEGMENTS.has(p)) return null;
  return parts;
}

export interface PlanPathMatcher {
  readonly known: readonly string[];
  isKnown(path: string): boolean;
}

/** Build a matcher from a domain's list of known paths (exact or ending in `.*`). */
export function planPathMatcher(known: readonly string[]): PlanPathMatcher {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const k of known) {
    if (k.endsWith(".*")) {
      const base = k.slice(0, -2);
      if (!parsePlanPath(base)) throw new Error(`invalid known plan path: ${k}`);
      prefixes.push(base);
    } else {
      if (!parsePlanPath(k)) throw new Error(`invalid known plan path: ${k}`);
      exact.add(k);
    }
  }
  return {
    known: [...known],
    isKnown(path: string): boolean {
      const parts = parsePlanPath(path);
      if (!parts) return false;
      if (exact.has(path)) return true;
      const base = parts.slice(0, -1).join(".");
      const last = parts[parts.length - 1];
      return prefixes.includes(base) && WILDCARD_SEGMENT.test(last);
    },
  };
}

/**
 * Immutable write: returns a copy of `target` with `value` at `path`.
 * Intermediate objects are created as needed; arrays are never indexed into.
 */
export function setAtPlanPath<T extends Record<string, unknown>>(
  target: T,
  path: string,
  value: unknown,
): T {
  const parts = parsePlanPath(path);
  if (!parts) throw new Error(`invalid plan path: ${path}`);
  const write = (node: unknown, i: number): unknown => {
    const base =
      node && typeof node === "object" && !Array.isArray(node)
        ? { ...(node as Record<string, unknown>) }
        : ({} as Record<string, unknown>);
    base[parts[i]] = i === parts.length - 1 ? value : write(base[parts[i]], i + 1);
    return base;
  };
  return write(target, 0) as T;
}

/** Read a value at a plan path; `undefined` when any segment is missing. */
export function getAtPlanPath(target: unknown, path: string): unknown {
  const parts = parsePlanPath(path);
  if (!parts) return undefined;
  let node: unknown = target;
  for (const p of parts) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(node, p)) return undefined;
    node = (node as Record<string, unknown>)[p];
  }
  return node;
}
