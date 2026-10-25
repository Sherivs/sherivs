/** Live workspace data (SHERIVS-UX3). Cards and target pages read through RLS-respecting server functions:
 *  workspace_widget_data (counts/summaries per card, SECURITY INVOKER) and workspace_scope_resolve
 *  (validates ?scope=dim:ref against the caller's own assigned scopes and returns the classes it covers). */
import type { ScopeFocus } from "./engine";

export interface CardData {
  metric?: string | number;
  money?: boolean;
  note?: string;
  list?: [string, string][];
  bar?: number;
  warn?: string;
  unavailable?: boolean;
}
export interface WidgetDataResponse {
  scope: Record<string, string[]>;
  labels: Record<string, Record<string, string>>;
  cards: Record<string, CardData>;
}
export interface ScopeResolve {
  focused: boolean;
  scope: Record<string, string[]> | null;
  class_ids: string[] | null;
  subjects: string[] | null;
  labels: Record<string, Record<string, string>>;
}

/** "campus:abc" -> { dim: "campus", ref: "abc" }; anything malformed -> null (the server re-validates anyway). */
export function parseScopeParam(v: unknown): ScopeFocus | null {
  if (typeof v !== "string") return null;
  const i = v.indexOf(":");
  if (i < 1 || i === v.length - 1 || v.length > 120) return null;
  const dim = v.slice(0, i),
    ref = v.slice(i + 1);
  return /^[a-z_]{2,16}$/.test(dim) ? { dim, ref } : null;
}
export const scopeParam = (f: ScopeFocus) => `${f.dim}:${f.ref}`;
export const scopeLabel = (labels: WidgetDataResponse["labels"] | undefined, f: ScopeFocus) =>
  `${f.dim}: ${labels?.[f.dim]?.[f.ref] ?? f.ref}`;

/** Narrow any list of rows that carry a class id to the resolved scope (null scope = unchanged). */
export function filterByScope<T>(
  rows: T[] | undefined | null,
  res: ScopeResolve | null | undefined,
  classOf: (r: T) => string | null | undefined,
): T[] {
  const list = rows ?? [];
  if (!res?.focused || !res.class_ids) return list;
  const ok = new Set(res.class_ids);
  return list.filter((r) => {
    const c = classOf(r);
    return !!c && ok.has(c);
  });
}
export const naira = (n: number) => "₦" + Math.round(n).toLocaleString("en-NG");
