import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { markClassAttendance, teacherCheckWithQr } from "@/lib/runtime/scholar/attendance.functions";
import { Input } from "@/components/ui/input";

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

function TeacherAttendancePage() {
  const { school, profile } = useApp();
  const schoolId = school?.id;
  const teacherId = profile?.id;
  const save = useServerFn(markClassAttendance);
  const today = todayStr();

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
      return Array.from(ids.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
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
  });

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
      await save({ data: { class_id: classId, date: today, marks: entries } });
      const cls = classes.data?.find((c) => c.id === classId);
      toast.success(`Attendance saved for ${cls?.name ?? "class"}`);
      void existing.refetch();
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
