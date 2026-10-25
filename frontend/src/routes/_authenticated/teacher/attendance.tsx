import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { markClassAttendance, teacherCheckWithQr } from "@/lib/runtime/scholar/attendance.functions";
import { Input } from "@/components/ui/input";
import { rpc } from "@/lib/scholar/rpc";
import { createAttendanceQueue, type QueuedMark, type SyncResult } from "@/lib/offline/attendance-queue";
import { cached, saveOrQueue } from "@/lib/offline/save-or-queue";

export const Route = createFileRoute("/_authenticated/teacher/attendance")({
  ssr: false,
  component: TeacherAttendancePage,
});

type Status = "present" | "absent" | "late" | "excused";
type ClassRow = { id: string; name: string };
type StudentRow = { id: string; admission_number: string | null; user_id: string | null };
type StudentWithName = StudentRow & { full_name: string };

const STATUS_STYLES: Record<Status, { active: string; label: string; sr: string }> = {
  present: {
    active: "bg-emerald-500 text-white border-emerald-500",
    label: "P",
    sr: "Mark Present",
  },
  absent: { active: "bg-rose-500 text-white border-rose-500", label: "A", sr: "Mark Absent" },
  late: { active: "bg-amber-500 text-white border-amber-500", label: "L", sr: "Mark Late" },
  excused: { active: "bg-blue-500 text-white border-blue-500", label: "E", sr: "Mark Excused" },
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const browserStorage = () => (typeof window === "undefined" ? undefined : window.localStorage);

function TeacherAttendancePage() {
  const { school, profile } = useApp();
  const schoolId = school?.id;
  const teacherId = profile?.id;
  const save = useServerFn(markClassAttendance);
  const today = todayStr();

  // SHERIVS-A07b: offline queue. Marks made without a connection are kept on this device and synced
  // through offline_attendance_sync_v2 (per-item ids, device clock check); disagreements go to the admin queue.
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSync, setLastSync] = useState<{ applied: number; duplicates: number; conflicts: number; error?: string } | null>(null);
  const queue = useMemo(() => {
    const storage = browserStorage();
    if (!storage || !teacherId) return null;
    return createAttendanceQueue({
      storage,
      userId: teacherId,
      now: () => new Date(),
      sync: (batch: string, items: QueuedMark[], clientNow: string) =>
        rpc<SyncResult>("offline_attendance_sync_v2", { p_batch: batch, p_items: items, p_client_now: clientNow }),
    });
  }, [teacherId]);
  const myConflicts = useQuery({
    queryKey: ["my-attendance-conflicts", teacherId],
    enabled: !!teacherId && online,
    queryFn: async () => {
      const { data } = await supabase
        .from("attendance_sync_conflicts" as never)
        .select("id, student_id, date, yours, server, status")
        .eq("user_id", teacherId!)
        .order("created_at", { ascending: false })
        .limit(20);
      return (data ?? []) as unknown as { id: string; student_id: string; date: string; yours: string; server: string | null; status: string }[];
    },
  });
  const syncNow = useCallback(async () => {
    if (!queue) return;
    const r = await queue.flush();
    setPendingCount(queue.pending().length);
    if (r.sent || r.error) setLastSync({ applied: r.applied, duplicates: r.duplicates, conflicts: r.conflicts.length, error: r.error });
    if (r.sent && !r.error) {
      toast.success(`Synced ${r.applied} offline mark${r.applied === 1 ? "" : "s"}${r.conflicts.length ? `; ${r.conflicts.length} sent to the admin to review` : ""}`);
      void myConflicts.refetch();
    } else if (r.error) toast.error(`Offline marks not synced yet: ${r.error}`);
  }, [queue, myConflicts]);
  useEffect(() => {
    if (!queue) return;
    setPendingCount(queue.pending().length);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const off = queue.autoFlush(window);
    const onOnline = () => setTimeout(() => setPendingCount(queue.pending().length), 1500);
    window.addEventListener("online", onOnline);
    if (navigator.onLine && queue.pending().length) void syncNow();
    return () => { off(); window.removeEventListener("online", up); window.removeEventListener("offline", down); window.removeEventListener("online", onOnline); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  const [classId, setClassId] = useState<string | null>(null);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [saving, setSaving] = useState(false);

  // 1) Classes assigned to this teacher (direct OR via timetable_slots)
  const classes = useQuery({
    queryKey: ["teacher-classes", schoolId, teacherId],
    enabled: !!schoolId && !!teacherId,
    queryFn: async () => {
      const sid = schoolId!;
      const tid = teacherId!;
      const direct = await supabase
        .from("classes")
        .select("id, name")
        .eq("school_id", sid)
        .eq("teacher_id", tid);
      const slots = await supabase
        .from("timetable_slots")
        .select("timetable_id")
        .eq("school_id", sid)
        .eq("teacher_id", tid);
      const ids = new Map<string, ClassRow>();
      (direct.data ?? []).forEach((c) => ids.set(c.id, c));
      const ttIds = Array.from(new Set((slots.data ?? []).map((s) => s.timetable_id)));
      if (ttIds.length) {
        const tts = await supabase
          .from("timetables")
          .select("class_id, classes(id, name)")
          .in("id", ttIds);
        (tts.data ?? []).forEach((t) => {
          const c = (t as unknown as { classes: ClassRow | null }).classes;
          if (c) ids.set(c.id, c);
        });
      }
      const out = Array.from(ids.values()).sort((a, b) => a.name.localeCompare(b.name));
      cached<ClassRow[]>(browserStorage(), `classes.${tid}`).set(out);
      return out;
    },
    placeholderData: () => (teacherId ? cached<ClassRow[]>(browserStorage(), `classes.${teacherId}`).get() : undefined),
  });

  // 2) Students in the selected class
  const students = useQuery({
    queryKey: ["class-students", schoolId, classId],
    enabled: !!schoolId && !!classId,
    queryFn: async () => {
      const rows = await supabase
        .from("students")
        .select("id, admission_number, user_id")
        .eq("school_id", schoolId!)
        .eq("class_id", classId!)
        .eq("is_active", true);
      const list = (rows.data ?? []) as StudentRow[];
      const userIds = list.map((s) => s.user_id).filter((u): u is string => !!u);
      let names: Record<string, string> = {};
      if (userIds.length) {
        const u = await supabase.from("users").select("id, full_name").in("id", userIds);
        names = Object.fromEntries((u.data ?? []).map((r) => [r.id, r.full_name]));
      }
      return list
        .map((s) => ({
          ...s,
          full_name:
            (s.user_id && names[s.user_id]) || `Student ${s.admission_number ?? s.id.slice(0, 6)}`,
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name)) as StudentWithName[];
    },
    placeholderData: () => (classId ? cached<StudentWithName[]>(browserStorage(), `roster.${classId}`).get() : undefined),
  });
  useEffect(() => {
    if (classId && students.data && !students.isPlaceholderData) cached<StudentWithName[]>(browserStorage(), `roster.${classId}`).set(students.data);
  }, [classId, students.data, students.isPlaceholderData]);

  // 3) Pre-fill existing attendance for today
  const existing = useQuery({
    queryKey: ["attendance-existing", schoolId, classId, today],
    enabled: !!schoolId && !!classId,
    queryFn: async () => {
      const { data } = await supabase
        .from("attendance")
        .select("student_id, status")
        .eq("school_id", schoolId!)
        .eq("class_id", classId!)
        .eq("date", today);
      return (data ?? []) as { student_id: string; status: Status }[];
    },
  });

  useEffect(() => {
    if (!existing.data) return;
    const m: Record<string, Status> = {};
    existing.data.forEach((r) => {
      m[r.student_id] = r.status;
    });
    setMarks(m);
  }, [existing.data]);

  // 4) Teacher's own sign-in status today
  const myLog = useQuery({
    queryKey: ["my-signin-today", schoolId, teacherId, today],
    enabled: !!schoolId && !!teacherId,
    queryFn: async () => {
      const start = `${today}T00:00:00.000Z`;
      const end = `${today}T23:59:59.999Z`;
      const { data } = await supabase
        .from("attendance_logs")
        .select("id, type, timestamp")
        .eq("school_id", schoolId!)
        .eq("teacher_id", teacherId!)
        .gte("timestamp", start)
        .lte("timestamp", end)
        .order("timestamp", { ascending: true });
      return (data ?? []) as { id: string; type: "sign_in" | "sign_out"; timestamp: string }[];
    },
  });

  const studentList = students.data ?? [];
  const summary = useMemo(() => {
    const s = { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 };
    studentList.forEach((st) => {
      const m = marks[st.id];
      if (!m) s.unmarked += 1;
      else s[m] += 1;
    });
    return s;
  }, [studentList, marks]);

  const setAll = (status: Status) => {
    const next: Record<string, Status> = {};
    studentList.forEach((s) => {
      next[s.id] = status;
    });
    setMarks(next);
  };

  const setOne = (id: string, status: Status) => setMarks((m) => ({ ...m, [id]: status }));

  const onSave = async () => {
    if (!classId || !studentList.length) return;
    const entries = studentList
      .filter((s) => marks[s.id])
      .map((s) => ({ student_id: s.id, status: marks[s.id] }));
    if (!entries.length) return toast.error("Mark at least one student first");
    setSaving(true);
    try {
      const cls = classes.data?.find((c) => c.id === classId);
      const r = await saveOrQueue({
        online: typeof navigator === "undefined" ? true : navigator.onLine,
        marks: entries,
        save: (m) => save({ data: { class_id: classId, date: today, marks: m } }),
        queue: (m) => {
          if (!queue) throw new Error("Offline saving is not available in this browser");
          m.forEach((x) => queue.mark(x.student_id, today, x.status));
          setPendingCount(queue.pending().length);
        },
      });
      if (r.mode === "saved") {
        toast.success(`Attendance saved for ${cls?.name ?? "class"}`);
        void existing.refetch();
      } else {
        toast.success(`No connection: ${r.queued} mark${r.queued === 1 ? "" : "s"} saved on this device. They will sync when you are back online.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const signInTime = myLog.data?.find((l) => l.type === "sign_in")?.timestamp;
  const signOutTime = myLog.data?.find((l) => l.type === "sign_out")?.timestamp;

  return (
    <PortalPage
      title="Mark student attendance"
      subtitle={`Today, ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`}
    >
      <div className="mb-4 text-xs">
        <Link
          to="/teacher/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Back
        </Link>
      </div>

      <div
        role="status"
        className={`mb-4 flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm ${online ? "border-border" : "border-amber-500/40 bg-amber-500/10"}`}
      >
        <span className={online ? "text-emerald-400" : "text-amber-400"}>{online ? "Online" : "Offline: marks are saved on this device"}</span>
        <span className="text-muted-foreground">
          {pendingCount ? `${pendingCount} mark${pendingCount === 1 ? "" : "s"} waiting to sync` : "Nothing waiting to sync"}
        </span>
        {lastSync && (
          <span className="text-xs text-muted-foreground">
            Last sync: {lastSync.error ? `failed (${lastSync.error})` : `${lastSync.applied} applied, ${lastSync.duplicates} already synced, ${lastSync.conflicts} for admin review`}
          </span>
        )}
        {pendingCount > 0 && online && (
          <Button size="sm" variant="outline" onClick={() => void syncNow()}>Sync now</Button>
        )}
      </div>

      <div className="uos-card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">
              Class
            </label>
            <select
              value={classId ?? ""}
              onChange={(e) => setClassId(e.target.value || null)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">— Select a class —</option>
              {(classes.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {classId && (
            <>
              <Button variant="outline" onClick={() => setAll("present")}>
                All Present
              </Button>
              <Button onClick={onSave} disabled={saving}>
                {saving ? "Saving…" : "Save Attendance"}
              </Button>
            </>
          )}
        </div>

        {!classes.isLoading && (classes.data ?? []).length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            You're not assigned to any classes yet. Ask your school admin to assign you to a class
            or schedule a timetable slot.
          </p>
        )}

        {classId && (
          <>
            <div className="mt-5 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-400">
                Present {summary.present}
              </span>
              <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-rose-400">
                Absent {summary.absent}
              </span>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-400">
                Late {summary.late}
              </span>
              <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-blue-400">
                Excused {summary.excused}
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                Unmarked {summary.unmarked}
              </span>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2">Student</th>
                    <th className="py-2">Admission #</th>
                    <th className="py-2 text-right">Mark</th>
                  </tr>
                </thead>
                <tbody>
                  {students.isLoading ? (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-muted-foreground">
                        Loading students…
                      </td>
                    </tr>
                  ) : studentList.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-muted-foreground">
                        No students in this class yet.
                      </td>
                    </tr>
                  ) : (
                    studentList.map((s) => {
                      const current = marks[s.id];
                      return (
                        <tr key={s.id} className="border-b border-border/40">
                          <td className="py-2">{s.full_name}</td>
                          <td className="py-2 font-mono text-xs text-muted-foreground">
                            {s.admission_number ?? "—"}
                          </td>
                          <td className="py-2">
                            <div className="grid grid-cols-2 gap-1 sm:flex sm:justify-end sm:gap-1.5">
                              {(["present", "absent", "late", "excused"] as Status[]).map((st) => {
                                const isOn = current === st;
                                return (
                                  <button
                                    key={st}
                                    onClick={() => setOne(s.id, st)}
                                    aria-label={`${STATUS_STYLES[st].sr} for ${s.full_name}`}
                                    aria-pressed={isOn}
                                    className={`size-8 rounded-md border text-xs font-bold transition ${
                                      isOn
                                        ? STATUS_STYLES[st].active
                                        : "border-border text-muted-foreground hover:bg-muted/40"
                                    }`}
                                    title={st}
                                  >
                                    {STATUS_STYLES[st].label}
                                    <span className="sr-only">{STATUS_STYLES[st].sr}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {(myConflicts.data ?? []).length > 0 && (
        <div className="uos-card mt-6 p-5">
          <h3 className="font-display text-base font-semibold">Offline marks under admin review</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            These synced marks disagreed with one already saved by someone else. An admin decides which stands.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {(myConflicts.data ?? []).map((c) => (
              <li key={c.id}>
                {c.date} · {studentList.find((s) => s.id === c.student_id)?.full_name ?? c.student_id.slice(0, 8)} · you: {c.yours}, saved: {c.server ?? "—"} · {c.status.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <TeacherSelfCheckCard signInTime={signInTime} signOutTime={signOutTime} />
    </PortalPage>
  );
}

function TeacherSelfCheckCard({
  signInTime,
  signOutTime,
}: {
  signInTime: string | null | undefined;
  signOutTime: string | null | undefined;
}) {
  const check = useServerFn(teacherCheckWithQr);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const r = await check({ data: { token: code.trim() } });
      toast.success(r.mode === "sign_in" ? "Signed in" : "Signed out");
      setCode("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Check-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uos-card mt-6 p-5">
      <h3 className="font-display text-base font-semibold">My sign-in status</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Enter the short code under the staff QR (or scan it) to record your arrival or departure.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <div className="text-xs uppercase text-muted-foreground">Signed in</div>
          <div className="mt-1 font-semibold">
            {signInTime ? (
              new Date(signInTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            ) : (
              <span className="text-muted-foreground">Not signed in yet</span>
            )}
          </div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs uppercase text-muted-foreground">Signed out</div>
          <div className="mt-1 font-semibold">
            {signOutTime ? (
              new Date(signOutTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        </div>
      </div>

      <form onSubmit={submit} className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter staff check-in code"
          className="max-w-xs font-mono"
          autoComplete="off"
          maxLength={64}
        />
        <Button className="w-full sm:w-auto" type="submit" disabled={busy || !code.trim()}>
          {busy ? "Checking…" : "Submit code"}
        </Button>
        <span className="text-xs text-muted-foreground">
          Codes expire 30s after the admin generates them.
        </span>
      </form>
    </div>
  );
}
