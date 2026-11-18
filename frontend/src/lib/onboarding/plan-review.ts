/**
 * M6 (mission E-016, ADR-117) — pure helpers for staff review of a provisioning plan
 * (domain-neutral).
 *
 *  - `diffPlans`: a deterministic, path-level diff between the generated plan and the plan under
 *    review, for the console's diff view. Arrays of objects that carry a `key` or `code` are
 *    matched by that identity, so reordering is not reported as a change.
 *  - `queueAge` / `sortQueue`: queue ordering and age labels from an injected clock.
 *  - `onboardingApprovalId`: the id the passkey step-up is bound to for one request.
 *
 * No clock, no I/O, no domain vocabulary.
 */

export type PlanDiffKind = "added" | "removed" | "changed";

export interface PlanDiffEntry {
  readonly path: string;
  readonly kind: PlanDiffKind;
  readonly before: unknown;
  readonly after: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function identity(v: unknown): string | null {
  if (!isObject(v)) return null;
  for (const k of ["key", "code"]) if (typeof v[k] === "string") return `${k}=${v[k] as string}`;
  return null;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (isObject(v)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = sortDeep(v[k]);
    return out;
  }
  return v;
}

function walk(before: unknown, after: unknown, path: string, out: PlanDiffEntry[]): void {
  if (same(before, after)) return;
  if (isObject(before) && isObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const k of keys) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in after)) out.push({ path: p, kind: "removed", before: before[k], after: undefined });
      else if (!(k in before)) out.push({ path: p, kind: "added", before: undefined, after: after[k] });
      else walk(before[k], after[k], p, out);
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const ids = before.map(identity);
    const idsAfter = after.map(identity);
    const keyed = ids.every((x) => x !== null) && idsAfter.every((x) => x !== null);
    if (keyed) {
      const a = new Map(before.map((v, i) => [ids[i] as string, v]));
      const b = new Map(after.map((v, i) => [idsAfter[i] as string, v]));
      for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
        const p = `${path}[${id}]`;
        if (!b.has(id)) out.push({ path: p, kind: "removed", before: a.get(id), after: undefined });
        else if (!a.has(id)) out.push({ path: p, kind: "added", before: undefined, after: b.get(id) });
        else walk(a.get(id), b.get(id), p, out);
      }
      return;
    }
    const scalar = (xs: unknown[]) => xs.every((x) => !isObject(x) && !Array.isArray(x));
    if (scalar(before) && scalar(after)) {
      const a = new Set(before.map((x) => JSON.stringify(x)));
      const b = new Set(after.map((x) => JSON.stringify(x)));
      for (const x of [...a].sort())
        if (!b.has(x)) out.push({ path, kind: "removed", before: JSON.parse(x), after: undefined });
      for (const x of [...b].sort())
        if (!a.has(x)) out.push({ path, kind: "added", before: undefined, after: JSON.parse(x) });
      if (a.size === b.size && [...a].every((x) => b.has(x)))
        out.push({ path, kind: "changed", before, after }); // same members, new order
      return;
    }
  }
  out.push({ path: path || "(plan)", kind: "changed", before, after });
}

/** Differences from `before` (generated) to `after` (under review). Empty when equal. */
export function diffPlans(before: unknown, after: unknown): PlanDiffEntry[] {
  const out: PlanDiffEntry[] = [];
  walk(before ?? null, after ?? null, "", out);
  return out;
}

export const ONBOARDING_REQUEST_STATUSES = [
  "new",
  "in_interview",
  "plan_ready",
  "under_review",
  "approved",
  "provisioned",
  "rejected",
] as const;
export type OnboardingRequestStatus = (typeof ONBOARDING_REQUEST_STATUSES)[number];

/** Work that still needs staff attention sorts first; oldest first within a status. */
const STATUS_ORDER: Record<OnboardingRequestStatus, number> = {
  under_review: 0,
  plan_ready: 1,
  approved: 2,
  in_interview: 3,
  new: 4,
  provisioned: 5,
  rejected: 6,
};

export function isOnboardingRequestStatus(v: unknown): v is OnboardingRequestStatus {
  return typeof v === "string" && (ONBOARDING_REQUEST_STATUSES as readonly string[]).includes(v);
}

export function sortQueue<T extends { status: OnboardingRequestStatus; createdAt: string }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      Date.parse(a.createdAt) - Date.parse(b.createdAt),
  );
}

/** Human age such as "3d", "5h", "12m" from an injected now (ms). */
export function queueAge(createdAt: string, nowMs: number): string {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.floor((nowMs - t) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const PLAN_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The approval id a passkey step-up is bound to (distinct from any JARVIS approval id). */
export function onboardingApprovalId(requestId: string): string {
  if (!UUID.test(requestId)) throw new Error("invalid_request_id");
  return `onboarding-request:${requestId}`;
}
