import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PortalPage, EmptyCard, PortalPagination, usePagination } from "@/components/portal-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/super-admin/logs")({
  ssr: false,
  component: SuperAdminLogsPage,
});

type Log = {
  id: string;
  action: string;
  target_school_id: string | null;
  admin_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string | null;
};

function toCSV(rows: Log[]) {
  const headers = ["when", "action", "target_school_id", "admin_id", "details"];
  const esc = (v: unknown) => {
    const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [
    headers.join(","),
    ...rows.map((r) =>
      [r.created_at ?? "", r.action, r.target_school_id ?? "", r.admin_id ?? "", r.details]
        .map(esc)
        .join(","),
    ),
  ].join("\n");
}

function SuperAdminLogsPage() {
  const [q, setQ] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const logs = useQuery<Log[]>({
    queryKey: ["sa-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("super_admin_logs")
        .select("id, action, target_school_id, admin_id, details, created_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Log[];
    },
  });

  const rows = logs.data ?? [];
  const actions = useMemo(() => Array.from(new Set(rows.map((r) => r.action))).sort(), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (actionFilter && r.action !== actionFilter) return false;
      if (!needle) return true;
      const hay = [
        r.action,
        r.target_school_id ?? "",
        r.admin_id ?? "",
        JSON.stringify(r.details ?? ""),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, actionFilter]);

  function downloadCSV() {
    const csv = toCSV(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `super-admin-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <PortalPage
      title="Audit logs"
      subtitle="Recent super-admin actions across all tenants. Showing the latest 500 records."
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={downloadCSV}
          disabled={filtered.length === 0}
        >
          <Download className="mr-2 size-4" /> Export CSV
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search action, target, admin…"
            className="pl-8"
          />
        </div>
        <select
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        >
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {rows.length}
        </span>
      </div>

      {logs.isLoading ? (
        <div className="uos-card p-8 text-center text-sm text-muted-foreground">Loading logs…</div>
      ) : logs.error ? (
        <div className="uos-card p-8 text-center text-sm text-red-400">
          {(logs.error as Error).message}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyCard
          title={rows.length === 0 ? "No logs yet" : "No logs match your filters"}
          body={
            rows.length === 0
              ? "Super-admin actions like creating schools or rotating keys will appear here."
              : "Try a different search term or action filter."
          }
        />
      ) : (
        <PaginatedSaLogs rows={filtered} />
      )}
    </PortalPage>
  );
}

function PaginatedSaLogs({ rows }: { rows: Log[] }) {
  const { page, pageCount, pageItems } = usePagination(rows, 25);
  return (
    <div className="space-y-3">
      <div className="uos-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="p-3">When</th>
              <th className="p-3">Action</th>
              <th className="p-3">Target school</th>
              <th className="p-3">Admin</th>
              <th className="p-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((r) => (
              <tr key={r.id} className="border-b border-border/40 align-top">
                <td className="p-3 font-mono text-xs whitespace-nowrap">
                  {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                </td>
                <td className="p-3 font-medium">{r.action}</td>
                <td className="p-3 text-muted-foreground font-mono text-[11px]">
                  {r.target_school_id ? `${r.target_school_id.slice(0, 8)}…` : "—"}
                </td>
                <td className="p-3 text-muted-foreground font-mono text-[11px]">
                  {r.admin_id ? `${r.admin_id.slice(0, 8)}…` : "—"}
                </td>
                <td className="p-3 max-w-md">
                  <code className="text-[10px] text-muted-foreground line-clamp-2 break-all">
                    {r.details ? JSON.stringify(r.details) : "—"}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PortalPagination page={page} pageCount={pageCount} />
    </div>
  );
}
