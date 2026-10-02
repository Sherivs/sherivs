import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { TimetableGrid, type TimetableSlot } from "@/components/timetable-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateTimetableDraft, saveTimetable } from "@/lib/runtime/scholar/timetable.functions";
import {
  DAY_PRESETS,
  recommendDayRoutines,
  type AcademicWindow,
} from "@/lib/scholar/day-recommendation";

type ClosingPreset = keyof typeof DAY_PRESETS;

export const Route = createFileRoute("/_authenticated/admin/timetable")({
  ssr: false,
  component: AdminTimetablePage,
});

function AdminTimetablePage() {
  const { school } = useApp();
  const schoolId = school?.id;
  const generate = useServerFn(generateTimetableDraft);
  const save = useServerFn(saveTimetable);

  const [classId, setClassId] = useState<string>("");
  const [subjects, setSubjects] = useState(
    "Maths, English, Science, Social Studies, Computer, Art, PE",
  );
  const [year, setYear] = useState(`${new Date().getFullYear()}/${new Date().getFullYear() + 1}`);
  const [term, setTerm] = useState("First");
  const [draft, setDraft] = useState<TimetableSlot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<ClosingPreset>("fullDay_17");
  const [doubleShift, setDoubleShift] = useState(false);
  const [boarding, setBoarding] = useState(false);

  const classes = useQuery({
    queryKey: ["classes", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("classes")
        .select("id, name, grade_level")
        .eq("school_id", schoolId!)
        .order("name");
      return (data ?? []) as { id: string; name: string; grade_level: string | null }[];
    },
  });

  useEffect(() => {
    if (!classId && classes.data && classes.data.length > 0) setClassId(classes.data[0].id);
  }, [classes.data, classId]);

  const existing = useQuery({
    queryKey: ["timetable-existing", schoolId, classId, year, term],
    enabled: !!schoolId && !!classId,
    queryFn: async () => {
      const { data: tt } = await supabase
        .from("timetables")
        .select("id")
        .eq("school_id", schoolId!)
        .eq("class_id", classId)
        .eq("academic_year", year)
        .eq("term", term)
        .eq("is_active", true)
        .maybeSingle();
      if (!tt) return [] as TimetableSlot[];
      const { data: slots } = await supabase
        .from("timetable_slots")
        .select(
          "day_of_week, period_number, start_time, end_time, subject, room, is_break, break_label",
        )
        .eq("timetable_id", tt.id)
        .order("period_number");
      return (slots ?? []) as TimetableSlot[];
    },
  });

  const onGenerate = async () => {
    if (!classId) return toast.error("Pick a class first");
    setBusy(true);
    try {
      const r = await generate({
        data: {
          class_id: classId,
          subjects: subjects
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          periods_per_day: 7,
          start_hour: 8,
          period_minutes: 40,
          include_break: true,
        },
      });
      setDraft(r.slots as TimetableSlot[]);
      toast.success("Draft ready — review and save");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI generation failed");
    } finally {
      setBusy(false);
    }
  };

  const onSave = async (publish: boolean) => {
    if (!draft || !classId) return;
    setBusy(true);
    try {
      await save({
        data: { class_id: classId, academic_year: year, term, publish, slots: draft },
      });
      toast.success(publish ? "Saved & published" : "Saved as draft");
      setDraft(null);
      existing.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const display = draft ?? existing.data ?? [];

  const dayWindows = useMemo<AcademicWindow[]>(() => {
    const base = DAY_PRESETS[closing];
    if (!doubleShift) return [base];
    return [base, { open: "13:00", close: "18:00" }];
  }, [closing, doubleShift]);

  const dayRecommendation = useMemo(
    () =>
      recommendDayRoutines({
        name: "School day",
        windows: dayWindows,
        boardingPrep: boarding ? { open: "18:00", close: "20:30" } : null,
      }),
    [dayWindows, boarding],
  );

  return (
    <PortalPage
      title="Timetable"
      subtitle="Generate weekly schedules with AI and publish them to teachers and students."
    >
      <div className="mb-4 text-xs">
        <Link
          to="/admin/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Back
        </Link>
      </div>

      <details className="mb-5 rounded-lg border border-border bg-muted/15 px-4 py-3">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
          School-day windows — periods are generated inside these boundaries
        </summary>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <label className="text-muted-foreground" htmlFor="tt-closing">
            Closing time
          </label>
          <select
            id="tt-closing"
            value={closing}
            onChange={(e) => setClosing(e.target.value as ClosingPreset)}
            className="h-8 rounded-md border border-border bg-background px-2"
          >
            <option value="halfDay_12">Closes 12:00</option>
            <option value="halfDay_13">Closes 13:00</option>
            <option value="early_14">Closes 14:00</option>
            <option value="fullDay_17">Closes 17:00</option>
            <option value="extended_18">Closes 18:00</option>
          </select>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={doubleShift}
              onChange={(e) => setDoubleShift(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            Double shift
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={boarding}
              onChange={(e) => setBoarding(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            Boarding evening study
          </label>
        </div>
        {dayRecommendation.routines.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {dayRecommendation.routines.map((routine) => (
              <span
                key={routine.name}
                className="rounded-full border border-border bg-background px-2.5 py-1 font-mono text-[10px] text-muted-foreground"
              >
                {routine.name} {routine.open} → {routine.close}
                {routine.blocks.length > 0
                  ? ` · ${routine.blocks[0].label}: ${routine.blocks[0].start} → ${routine.blocks[0].end}`
                  : ""}
              </span>
            ))}
          </div>
        )}
      </details>

      <div className="uos-card mb-6 grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5 md:grid-cols-[1fr_1fr_140px_140px_auto]">
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Class</Label>
          <select
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
            className="h-11 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm"
          >
            {(classes.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.grade_level ? `— ${c.grade_level}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Subjects (comma-separated)
          </Label>
          <Input className="h-11" value={subjects} onChange={(e) => setSubjects(e.target.value)} />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Year</Label>
          <Input className="h-11" value={year} onChange={(e) => setYear(e.target.value)} />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Term</Label>
          <Input className="h-11" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <div className="flex items-end sm:col-span-2 md:col-span-1">
          <Button onClick={onGenerate} disabled={busy || !classId} className="min-h-11 w-full">
            {busy ? "Generating…" : "Generate with AI"}
          </Button>
        </div>
      </div>

      {draft && (
        <div className="mb-4 flex flex-col gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span className="text-amber-200">Draft — not yet saved.</span>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 flex-1 sm:flex-none"
              onClick={() => setDraft(null)}
              disabled={busy}
            >
              Discard
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 flex-1 sm:flex-none"
              onClick={() => onSave(false)}
              disabled={busy}
            >
              Save draft
            </Button>
            <Button
              size="sm"
              className="min-h-11 flex-1 sm:flex-none"
              onClick={() => onSave(true)}
              disabled={busy}
            >
              Save & publish
            </Button>
          </div>
        </div>
      )}

      <TimetableGrid slots={display} />
    </PortalPage>
  );
}
