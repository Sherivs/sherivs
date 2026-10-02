import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, StatCard, SectionGrid } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { generateTeacherCheckQr } from "@/lib/runtime/scholar/attendance.functions";

export const Route = createFileRoute("/_authenticated/admin/attendance")({
  ssr: false,
  component: AdminAttendancePage,
});

type LogRow = {
  id: string;
  teacher_id: string;
  type: "sign_in" | "sign_out";
  timestamp: string;
};

type Mode = "sign_in" | "sign_out";

function AdminAttendancePage() {
  const { school } = useApp();
  const schoolId = school?.id;
  const today = new Date().toISOString().slice(0, 10);
  const generate = useServerFn(generateTeacherCheckQr);

  const [mode, setMode] = useState<Mode>("sign_in");
  const [qr, setQr] = useState<{ token: string; expires_at: string; mode: Mode } | null>(null);
  const [remaining, setRemaining] = useState(0);

  const logs = useQuery({
    queryKey: ["teacher-signins-today", schoolId, today],
    enabled: !!schoolId,
    queryFn: async () => {
      const start = `${today}T00:00:00.000Z`;
      const end = `${today}T23:59:59.999Z`;
      const { data } = await supabase
        .from("attendance_logs")
        .select("id, teacher_id, type, timestamp")
        .eq("school_id", schoolId!)
        .gte("timestamp", start)
        .lte("timestamp", end)
        .order("timestamp", { ascending: false });
      return (data ?? []) as LogRow[];
    },
  });

  // Resolve teacher names
  const teacherIds = Array.from(new Set((logs.data ?? []).map((l) => l.teacher_id)));
  const names = useQuery({
    queryKey: ["teacher-names", teacherIds.sort().join(",")],
    enabled: teacherIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("users").select("id, full_name").in("id", teacherIds);
      return Object.fromEntries((data ?? []).map((u) => [u.id, u.full_name])) as Record<
        string,
        string
      >;
    },
  });

  // Realtime: refresh on new sign-ins
  useEffect(() => {
    if (!schoolId) return;
    const channel = supabase
      .channel(`signins-${schoolId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "attendance_logs",
          filter: `school_id=eq.${schoolId}`,
        },
        () => logs.refetch(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [schoolId, logs]);

  // QR countdown
  useEffect(() => {
    if (!qr) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((new Date(qr.expires_at).getTime() - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) setQr(null);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [qr]);

  const rows = logs.data ?? [];
  const uniqueSignIns = new Set(rows.filter((r) => r.type === "sign_in").map((r) => r.teacher_id))
    .size;
  const uniqueSignOuts = new Set(rows.filter((r) => r.type === "sign_out").map((r) => r.teacher_id))
    .size;

  const mint = async () => {
    try {
      const r = await generate({ data: { mode } });
      setQr({ token: r.token, expires_at: r.expires_at, mode });
      toast.success(`${mode === "sign_in" ? "Sign-in" : "Sign-out"} QR generated — expires in 30s`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const qrSrc = qr
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=6&data=${encodeURIComponent(qr.token)}`
    : null;

  return (
    <PortalPage
      title="Teacher Sign-In — QR Station"
      subtitle="Display this QR code for teachers to scan when they arrive and leave."
    >
      <div className="mb-4 text-xs">
        <Link
          to="/admin/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Back
        </Link>
      </div>

      <SectionGrid>
        <StatCard label="Sign-in events" value={rows.filter((r) => r.type === "sign_in").length} />
        <StatCard
          label="Sign-out events"
          value={rows.filter((r) => r.type === "sign_out").length}
        />
        <StatCard label="Teachers signed in" value={uniqueSignIns} />
        <StatCard label="Teachers signed out" value={uniqueSignOuts} />
      </SectionGrid>

      <div className="mt-8 grid gap-6 lg:grid-cols-[340px_1fr]">
        <div className="uos-card p-5">
          <h3 className="font-display text-base font-semibold">Teacher check-in QR</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Teachers scan this with their phone camera to record their arrival or departure. Codes
            expire after 30 seconds.
          </p>

          <div className="mt-3 inline-flex w-full rounded-md border border-border p-0.5">
            {(["sign_in", "sign_out"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setQr(null);
                }}
                className={`flex-1 rounded-sm px-3 py-1.5 text-xs font-semibold transition ${
                  mode === m
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/40"
                }`}
              >
                {m === "sign_in" ? "Sign In QR" : "Sign Out QR"}
              </button>
            ))}
          </div>

          <div className="mt-4 flex aspect-square items-center justify-center rounded-md border border-border bg-white">
            {qrSrc ? (
              <img src={qrSrc} alt="Teacher check-in QR" className="size-56" />
            ) : (
              <p className="px-6 text-center text-sm text-muted-foreground">No active code</p>
            )}
          </div>
          {qr && (
            <>
              <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-center font-mono text-xs">
                {qr.token}
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${(remaining / 30) * 100}%` }}
                />
              </div>
              <p className="mt-1 text-center text-xs text-muted-foreground">{remaining}s left</p>
            </>
          )}
          <Button onClick={mint} className="mt-4 w-full">
            {qr ? "Generate new" : `Generate ${mode === "sign_in" ? "Sign In" : "Sign Out"} QR`}
          </Button>
        </div>

        <div className="uos-card p-5">
          <h3 className="font-display text-base font-semibold">Teacher sign-ins today</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Live feed — updates automatically as teachers scan in or out.
          </p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-2">Time</th>
                  <th className="py-2">Teacher</th>
                  <th className="py-2">Type</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-muted-foreground">
                      No teacher sign-ins yet today.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/40">
                      <td className="py-2 text-muted-foreground">
                        {new Date(r.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-2">
                        {names.data?.[r.teacher_id] ?? r.teacher_id.slice(0, 8)}
                      </td>
                      <td className="py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                            r.type === "sign_in"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-blue-500/15 text-blue-400"
                          }`}
                        >
                          {r.type === "sign_in" ? "Signed in" : "Signed out"}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PortalPage>
  );
}
