import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, SectionGrid, StatCard, EmptyCard } from "@/components/portal-shell";

export const Route = createFileRoute("/_authenticated/super-admin/settings")({
  ssr: false,
  component: SuperAdminSettings,
});

function SuperAdminSettings() {
  const { superAdmin, authUser } = useApp();
  const qc = useQueryClient();
  const [fullName, setFullName] = useState(superAdmin?.full_name ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const admins = useQuery({
    queryKey: ["super-admins-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("super_admins")
        .select("id, full_name, email, is_active, created_at")
        .order("created_at", { ascending: true });
      return data ?? [];
    },
  });

  const logs = useQuery({
    queryKey: ["super-admin-logs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("super_admin_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!authUser) return;
    setSaving(true);
    setMsg(null);
    const { error } = await supabase
      .from("super_admins")
      .update({ full_name: fullName })
      .eq("id", authUser.id);
    setSaving(false);
    if (error) {
      setMsg(error.message);
    } else {
      setMsg("Saved.");
      void qc.invalidateQueries({ queryKey: ["super-admins-list"] });
    }
  }

  return (
    <PortalPage
      title="Platform settings"
      subtitle="Manage your super-admin profile and platform oversight"
    >
      <SectionGrid>
        <StatCard label="Super admins" value={admins.data?.length ?? 0} />
        <StatCard label="Active" value={admins.data?.filter((a) => a.is_active).length ?? 0} />
        <StatCard label="Recent actions" value={logs.data?.length ?? 0} />
      </SectionGrid>

      <div className="mt-10 grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2">
          <h2 className="font-display text-lg font-semibold mb-3">Your profile</h2>
          <form onSubmit={saveProfile} className="uos-card p-5 space-y-4">
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Email</label>
              <input className="uos-input mt-1" value={superAdmin?.email ?? ""} disabled />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Full name
              </label>
              <input
                className="uos-input mt-1"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
          </form>
        </div>

        <div className="lg:col-span-3">
          <h2 className="font-display text-lg font-semibold mb-3">Super admins</h2>
          {(admins.data?.length ?? 0) === 0 ? (
            <EmptyCard title="No super admins" body="There are no super-admin accounts yet." />
          ) : (
            <div className="uos-card divide-y divide-border">
              {admins.data!.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-4 gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{a.full_name}</div>
                    <div className="text-xs text-muted-foreground truncate">{a.email}</div>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                      a.is_active ? "uos-tenant-bg" : "border border-border"
                    }`}
                  >
                    {a.is_active ? "active" : "inactive"}
                  </span>
                </div>
              ))}
            </div>
          )}

          <h2 className="font-display text-lg font-semibold mt-8 mb-3">Recent platform activity</h2>
          {(logs.data?.length ?? 0) === 0 ? (
            <EmptyCard title="No activity yet" body="Platform-wide actions will appear here." />
          ) : (
            <div className="uos-card divide-y divide-border text-sm">
              {logs.data!.map((l) => (
                <div key={l.id} className="p-3 flex items-center justify-between gap-3">
                  <div className="truncate">
                    <span className="font-mono text-xs text-muted-foreground">
                      {new Date(l.created_at as string).toLocaleString()}
                    </span>{" "}
                    <span className="font-semibold">{l.action as string}</span>
                  </div>
                  <span className="text-xs text-muted-foreground truncate">
                    {l.target_school_id ?? ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PortalPage>
  );
}
