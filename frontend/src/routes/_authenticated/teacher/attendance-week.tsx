/**
 * Teacher weekly attendance grid — bulk-mark a class for a 5-day week.
 * Columns: Mon-Fri. Click a cell to cycle P → A → L → E → (clear).
 * Save sends all dirty marks in one request per day.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { markClassAttendance } from "@/lib/runtime/scholar/attendance.functions";

export const Route = createFileRoute("/_authenticated/teacher/attendance-week")({
  ssr: false,
  component: TeacherAttendanceWeekPage,
});

type Status = "present" | "absent" | "late" | "excused";
type ClassRow = { id: string; name: string };
type StudentRow = {
  id: string;
  admission_number: string | null;
  user_id: string | null;
  full_name: string;
};

const CYCLE: (Status | null)[] = [null, "present", "absent", "late", "excused"];
const STATUS_STYLES: Record<Status, { cls: string; label: string }> = {
  present: { cls: "bg-emerald-500 text-white border-emerald-500", label: "P" },
  absent: { cls: "bg-rose-500 text-white border-rose-500", label: "A" },
  late: { cls: "bg-amber-500 text-white border-amber-500", label: "L" },
  excused: { cls: "bg-blue-500 text-white border-blue-500", label: "E" },
};

function startOfWeek(d: Date): Date {
  const dt = new Date(d);
  const day = dt.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day; // Monday
  dt.setDate(dt.getDate() + diff);
  dt.setHours(0, 0, 0, 0);
  return dt;
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function TeacherAttendanceWeekPage() {
  const { school, profile } = useApp();
  const schoolId = school?.id;
  const teacherId = profile?.id;
  const save = useServerFn(markClassAttendance);

  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [classId, setClassId] = useState<string | null>(null);
  // key: `${studentId}|${date}` -> Status | null (current edited state)
  const [marks, setMarks] = useState<Record<string, Status | null>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const days = useMemo(() => {
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const classes = useQuery<ClassRow[]>({
    queryKey: ["teacher-classes-week", schoolId, teacherId],
    enabled: !!schoolId && !!teacherId,
    queryFn: async () => {
      const direct = await supabase
        .from("classes")
        .select("id, name")
        .eq("school_id", schoolId!)
        .eq("teacher_id", teacherId!);
      const slots = await supabase
        .from("timetable_slots")
        .select("timetable_id")
        .eq("school_id", schoolId!)
        .eq("teacher_id", teacherId!);
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

  useEffect(() => {
    if (!classId && classes.data?.[0]) setClassId(classes.data[0].id);
  }, [classes.data, classId]);

  const students = useQuery<StudentRow[]>({
    queryKey: ["class-students-week", schoolId, classId],
    enabled: !!schoolId && !!classId,
    queryFn: async () => {
      const rows = await supabase
        .from("students")
        .select("id, admission_number, user_id")
        .eq("school_id", schoolId!)
        .eq("class_id", classId!)
        .eq("is_active", true);
      const list = (rows.data ?? []) as {
        id: string;
        admission_number: string | null;
        user_id: string | null;
      }[];
      const uids = list.map((s) => s.user_id).filter((u): u is string => !!u);
      const nameOf: Record<string, string> = {};
      if (uids.length) {
        const u = await supabase.from("users").select("id, full_name").in("id", uids);
        (u.data ?? []).forEach((r) => (nameOf[r.id] = r.full_name as string));
      }
      return list
        .map((s) => ({
          ...s,
          full_name:
            (s.user_id && nameOf[s.user_id]) || `Student ${s.admission_number ?? s.id.slice(0, 6)}`,
        }))
        .sort((a, b) => a.full_name.localeCompare(b.full_name));
    },
  });

  // Load existing attendance for the week
  const existing = useQuery({
    queryKey: ["att-week", schoolId, classId, fmt(weekStart)],
    enabled: !!schoolId && !!classId,
    queryFn: async () => {
      const last = new Date(weekStart);
      last.setDate(last.getDate() + 4);
      const { data } = await supabase
        .from("attendance")
        .select("student_id, date, status")
        .eq("school_id", schoolId!)
        .eq("class_id", classId!)
        .gte("date", fmt(weekStart))
        .lte("date", fmt(last));
      return (data ?? []) as { student_id: string; date: string; status: Status }[];
    },
  });

  useEffect(() => {
    if (!existing.data) return;
    const next: Record<string, Status | null> = {};
    existing.data.forEach((r) => {
      next[`${r.student_id}|${r.date}`] = r.status;
    });
    setMarks(next);
    setDirty(new Set());
  }, [existing.data]);

  function cycle(studentId: string, date: string) {
    const key = `${studentId}|${date}`;
    const cur = marks[key] ?? null;
    const idx = CYCLE.indexOf(cur);
    const nxt = CYCLE[(idx + 1) % CYCLE.length];
    setMarks((m) => ({ ...m, [key]: nxt }));
    setDirty((d) => new Set(d).add(key));
  }

  function fillCol(date: string, status: Status) {
    if (!students.data) return;
    setMarks((m) => {
      const next = { ...m };
      students.data!.forEach((s) => {
        const k = `${s.id}|${date}`;
        next[k] = status;
      });
      return next;
    });
    setDirty((d) => {
      const next = new Set(d);
      students.data!.forEach((s) => next.add(`${s.id}|${date}`));
      return next;
    });
  }

  async function saveAll() {
    if (!classId || dirty.size === 0) return;
    setSaving(true);
    try {
      const byDate = new Map<string, { student_id: string; status: Status }[]>();
      dirty.forEach((k) => {
        const [sid, date] = k.split("|");
        const st = marks[k];
        if (!st) return; // skip cleared cells
        if (!byDate.has(date)) byDate.set(date, []);
        byDate.get(date)!.push({ student_id: sid, status: st });
      });
      let total = 0;
      for (const [date, list] of byDate) {
        if (list.length === 0) continue;
        const r = await save({ data: { class_id: classId, date, marks: list } });
        total += r.saved;
      }
      toast.success(`Saved ${total} record(s)`);
      setDirty(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function shiftWeek(weeks: number) {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + weeks * 7);
    setWeekStart(startOfWeek(next));
  }

  return (
    <PortalPage
      title="Weekly attendance"
      subtitle="Bulk-mark a class for the whole school week. Click a cell to cycle Present → Absent → Late → Excused."
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <Link
          to="/teacher/attendance"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Daily view
        </Link>
        <Button size="sm" variant="outline" onClick={() => shiftWeek(-1)}>
          ◀ Prev week
        </Button>
        <Button size="sm" variant="outline" onClick={() => setWeekStart(startOfWeek(new Date()))}>
          This week
        </Button>
        <Button size="sm" variant="outline" onClick={() => shiftWeek(1)}>
          Next week ▶
        </Button>
        <span className="ml-2 text-muted-foreground">
          Week of <strong className="text-foreground">{weekStart.toDateString()}</strong>
        </span>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Class</label>
        <select
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          value={classId ?? ""}
          onChange={(e) => setClassId(e.target.value || null)}
        >
          <option value="" disabled>
            Choose…
          </option>
          {(classes.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{dirty.size} unsaved</span>
          <Button size="sm" onClick={saveAll} disabled={saving || dirty.size === 0}>
            {saving ? "Saving…" : "Save all"}
          </Button>
        </div>
      </div>

      {students.data && students.data.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Student</th>
                {days.map((d) => (
                  <th key={fmt(d)} className="px-3 py-2 text-center font-medium">
                    <div>{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                    <div className="text-[10px] text-muted-foreground">{fmt(d).slice(5)}</div>
                    <div className="mt-1 flex justify-center gap-1">
                      {(["present", "absent"] as Status[]).map((s) => (
                        <button
                          key={s}
                          className="rounded border border-border px-1 py-0.5 text-[9px] hover:bg-muted/50"
                          onClick={() => fillCol(fmt(d), s)}
                          title={`Mark all ${s}`}
                        >
                          all {STATUS_STYLES[s].label}
                        </button>
                      ))}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.data.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium">{s.full_name}</div>
                    {s.admission_number && (
                      <div className="text-[11px] text-muted-foreground">{s.admission_number}</div>
                    )}
                  </td>
                  {days.map((d) => {
                    const k = `${s.id}|${fmt(d)}`;
                    const v = marks[k] ?? null;
                    const isDirty = dirty.has(k);
                    return (
                      <td key={k} className="px-2 py-2 text-center">
                        <button
                          onClick={() => cycle(s.id, fmt(d))}
                          className={
                            "inline-flex h-8 w-10 items-center justify-center rounded-md border text-xs font-semibold transition " +
                            (v
                              ? STATUS_STYLES[v].cls
                              : "border-dashed border-border text-muted-foreground hover:bg-muted/50") +
                            (isDirty ? " ring-2 ring-primary/40" : "")
                          }
                          title={v ?? "Not marked"}
                        >
                          {v ? STATUS_STYLES[v].label : "—"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {classId ? "No active students in this class." : "Pick a class above to start."}
        </div>
      )}
    </PortalPage>
  );
}
