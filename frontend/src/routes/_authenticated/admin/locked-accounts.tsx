/**
 * Admin: face-lockout review.
 * Lists users whose face login is currently locked and lets an admin unlock.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { unlockFaceAccount } from "@/lib/runtime/scholar/notifications-fanout.functions";

export const Route = createFileRoute("/_authenticated/admin/locked-accounts")({
  ssr: false,
  component: LockedAccounts,
});

type LockedUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  face_attempt_count: number;
  face_locked_at: string | null;
};

function LockedAccounts() {
  const { school } = useApp();
  const qc = useQueryClient();
  const sid = school?.id;

  const q = useQuery<LockedUser[]>({
    queryKey: ["face-locked", sid],
    enabled: !!sid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, full_name, email, role, face_attempt_count, face_locked_at")
        .eq("school_id", sid!)
        .eq("is_face_locked", true)
        .order("face_locked_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as LockedUser[];
    },
  });

  const unlockFn = useServerFn(unlockFaceAccount);
  const m = useMutation({
    mutationFn: (userId: string) => unlockFn({ data: { userId } }),
    onSuccess: () => {
      toast.success("Account unlocked");
      qc.invalidateQueries({ queryKey: ["face-locked", sid] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data ?? [];

  return (
    <PortalPage
      title="Locked accounts"
      subtitle="Users whose face login has been locked after too many failed attempts."
    >
      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          to="/admin/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted/40"
        >
          ← Dashboard
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Role</th>
                <th className="px-4 py-3 text-left">Failed attempts</th>
                <th className="px-4 py-3 text-left">Locked at</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                    {q.isLoading ? "Loading…" : "No locked accounts. 🎉"}
                  </td>
                </tr>
              )}
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="font-medium">{u.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{u.email ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{u.role}</td>
                  <td className="px-4 py-3 font-mono">{u.face_attempt_count}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {u.face_locked_at ? new Date(u.face_locked_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => m.mutate(u.id)}
                      disabled={m.isPending}
                      className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-60"
                    >
                      {m.isPending ? "Unlocking…" : "Unlock"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PortalPage>
  );
}
