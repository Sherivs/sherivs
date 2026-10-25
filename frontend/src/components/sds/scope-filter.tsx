/** ?scope= support for target pages (SHERIVS-UX3). A workspace card link like /teacher/attendance?scope=campus:<id>
 *  opens the page pre-filtered to that scope. The scope is validated on the server against the caller's own
 *  assignments (a scope they do not hold is ignored), and RLS still decides which rows exist at all. */
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useApp } from "@/contexts/app-context";
import { rpc } from "@/lib/scholar/rpc";
import {
  filterByScope,
  parseScopeParam,
  scopeLabel,
  type ScopeResolve,
} from "@/lib/sherivs-ws/live";

export function useScopeFilter() {
  const { school } = useApp();
  const raw = useRouterState({
    select: (s) => (s.location.search as Record<string, unknown>)?.scope,
  });
  const focus = parseScopeParam(raw);
  const q = useQuery({
    queryKey: ["workspace-scope", school?.id, raw],
    enabled: !!school?.id && !!focus,
    staleTime: 5 * 60_000,
    queryFn: () =>
      rpc<ScopeResolve>("workspace_scope_resolve", { p_org: school!.id, p_focus: focus }),
  });
  const res = focus ? (q.data ?? null) : null;
  return {
    focus: res?.focused ? focus : null,
    pending: !!focus && q.isLoading,
    label: res?.focused && focus ? scopeLabel(res.labels, focus) : null,
    subjects: res?.focused ? res.subjects : null,
    classIds: res?.focused ? res.class_ids : null,
    filter: <T,>(rows: T[] | undefined | null, classOf: (r: T) => string | null | undefined) =>
      filterByScope(rows, res, classOf),
    filterClasses: <T extends { id: string }>(rows: T[] | undefined | null) =>
      filterByScope(rows, res, (r) => r.id),
  };
}

export function ScopeBanner({ scope }: { scope: ReturnType<typeof useScopeFilter> }) {
  const navigate = useNavigate();
  if (!scope.label) return null;
  return (
    <div
      role="status"
      className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
    >
      <span>
        Showing <strong>{scope.label}</strong> only
      </span>
      <button
        type="button"
        className="ml-auto min-h-[44px] rounded-md border border-border px-3"
        onClick={() =>
          navigate({
            to: ".",
            search: (s: Record<string, unknown>) => {
              const n = { ...s };
              delete n.scope;
              return n;
            },
          } as never)
        }
      >
        Show all
      </button>
    </div>
  );
}
