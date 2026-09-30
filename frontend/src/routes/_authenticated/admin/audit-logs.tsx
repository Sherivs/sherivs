import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Download, Search, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, EmptyCard, PortalPagination, useCurrentPage } from "@/components/portal-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/admin/audit-logs")({
  ssr: false,
  component: AdminAuditLogsPage,
});

type Log = {
  id: string;
  action: string;
  table_name: string | null;
  record_id: string | null;
  user_id: string | null;
  ip_address: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string | null;
};

const PAGE_SIZE = 25;

const SECURITY_EVENTS = [
  "password_reset_requested",
  "password_reset_completed",
  "login_failed",
  "login_succeeded",
] as const;

type Preset =
  "all" | "security" | "password_reset_requested" | "password_reset_completed" | "login_failed";

function toCSV(rows: Log[]) {
  const headers = [
    "when",
    "action",
    "table",
    "record_id",
    "user_id",
    "ip",
    "old_value",
    "new_value",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.created_at ?? "",
        r.action,
        r.table_name ?? "",
        r.record_id ?? "",
        r.user_id ?? "",
        r.ip_address ?? "",
        r.old_value,
        r.new_value,
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n");
}

function AdminAuditLogsPage() {
  const { school } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<Preset>("all");
  const page = useCurrentPage();

  const resetPage = () => {
    navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => ({ ...prev, page: undefined })) as never,
      replace: true,
    });
  };

  const needle = q.trim();

  const logs = useQuery({
    queryKey: ["audit-logs", school?.id, preset, needle, page],
    enabled: !!school?.id,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let qy = supabase
        .from("audit_logs")
        .select(
          "id, action, table_name, record_id, user_id, ip_address, old_value, new_value, created_at",
          { count: "exact" },
        )
        .eq("school_id", school!.id);

      if (preset === "security") qy = qy.in("action", [...SECURITY_EVENTS]);
      else if (preset !== "all") qy = qy.eq("action", preset);

      if (needle) {
        // Search action, table, record_id, user_id (ILIKE), plus new_value/email
        const esc = needle.replace(/[%_,]/g, " ");
        qy = qy.or(
          `action.ilike.%${esc}%,table_name.ilike.%${esc}%,record_id.ilike.%${esc}%,user_id.ilike.%${esc}%,ip_address.ilike.%${esc}%`,
        );
      }

      const { data, error, count } = await qy
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as unknown as Log[], total: count ?? 0 };
    },
  });

  const rows = logs.data?.rows ?? [];
  const total = logs.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function setPresetAndReset(p: Preset) {
    setPreset(p);
    resetPage();
  }

  function downloadCSV() {
    const csv = toCSV(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}-p${page}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const chips = useMemo(
    () => [
      { id: "all" as const, label: "All events" },
      { id: "security" as const, label: "Security events", icon: true },
      { id: "login_failed" as const, label: "Login failures" },
      { id: "password_reset_requested" as const, label: "Password reset requests" },
      { id: "password_reset_completed" as const, label: "Password resets completed" },
    ],
    [],
  );

  return (
    <PortalPage
      title="Audit logs"
      subtitle="Recent changes and security events for your school."
      actions={
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={downloadCSV}
          disabled={rows.length === 0}
        >
          <Download className="mr-2 size-4" /> Export page CSV
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              resetPage();
            }}
            placeholder="Search action, table, record id, user id, IP…"
            className="pl-8"
          />
        </div>
        <span className="text-xs text-muted-foreground ml-auto">
          {logs.isLoading
            ? "Loading…"
            : `Page ${page} of ${pageCount} • ${total.toLocaleString()} events`}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setPresetAndReset(c.id)}
            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs ${
              preset === c.id
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {c.icon && <ShieldAlert className="size-3" />}
            {c.label}
          </button>
        ))}
      </div>

      {logs.isLoading ? (
        <div className="uos-card p-8 text-center text-sm text-muted-foreground">
          Loading audit logs…
        </div>
      ) : logs.error ? (
        <div className="uos-card p-8 text-center text-sm text-red-400">
          {(logs.error as Error).message}
        </div>
      ) : rows.length === 0 ? (
        <EmptyCard
          title={
            total === 0 && !needle && preset === "all"
              ? "No audit logs yet"
              : "No logs match your filters"
          }
          body={
            total === 0 && !needle && preset === "all"
              ? "Changes to records will show up here as people use the system."
              : "Try clearing the search or selecting a different category."
          }
        />
      ) : (
        <div className="space-y-3">
          <div className="uos-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="p-3">When</th>
                  <th className="p-3">Action</th>
                  <th className="p-3">Table</th>
                  <th className="p-3">Record</th>
                  <th className="p-3">User</th>
                  <th className="p-3">IP</th>
                  <th className="p-3">Changes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isSecurity = (SECURITY_EVENTS as readonly string[]).includes(r.action);
                  return (
                    <tr key={r.id} className="border-b border-border/40 align-top">
                      <td className="p-3 font-mono text-xs whitespace-nowrap">
                        {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
                      </td>
                      <td className="p-3 font-medium">
                        {isSecurity && (
                          <ShieldAlert className="mr-1 inline size-3 text-amber-500" />
                        )}
                        {r.action}
                      </td>
                      <td className="p-3 text-muted-foreground">{r.table_name ?? "—"}</td>
                      <td className="p-3 font-mono text-[11px] text-muted-foreground">
                        {r.record_id ? `${r.record_id.slice(0, 8)}…` : "—"}
                      </td>
                      <td className="p-3 font-mono text-[11px] text-muted-foreground">
                        {r.user_id ? `${r.user_id.slice(0, 8)}…` : "—"}
                      </td>
                      <td className="p-3 font-mono text-[11px] text-muted-foreground">
                        {r.ip_address ?? "—"}
                      </td>
                      <td className="p-3 max-w-md">
                        <code className="text-[10px] text-muted-foreground line-clamp-2 break-all">
                          {r.new_value
                            ? JSON.stringify(r.new_value)
                            : r.old_value
                              ? JSON.stringify(r.old_value)
                              : "—"}
                        </code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PortalPagination page={page} pageCount={pageCount} />
        </div>
      )}
    </PortalPage>
  );
}
