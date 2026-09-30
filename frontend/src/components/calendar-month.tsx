/**
 * Month-grid calendar that visually marks non-school days (from
 * `schools.school_days`) and overlays events from `school_calendar`.
 * Used by every portal so the same configuration is reflected everywhere.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { Button } from "@/components/ui/button";

type EventRow = {
  id: string;
  title: string;
  start_date: string;
  end_date: string | null;
  event_type: string | null;
  color: string | null;
  all_day: boolean | null;
};

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TYPE_DOT: Record<string, string> = {
  holiday: "bg-rose-400",
  exam: "bg-amber-400",
  event: "bg-sky-400",
  meeting: "bg-violet-400",
  term: "bg-emerald-400",
};

function ymd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CalendarMonth() {
  const { school } = useApp();
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });

  const schoolDays = useMemo<Record<string, boolean>>(() => {
    const raw = (school?.school_days as Record<string, unknown> | null) ?? null;
    const defaults: Record<string, boolean> = {
      mon: true,
      tue: true,
      wed: true,
      thu: true,
      fri: true,
      sat: false,
      sun: false,
    };
    if (!raw) return defaults;
    const next = { ...defaults };
    for (const k of Object.keys(defaults)) if (k in raw) next[k] = raw[k] === true;
    return next;
  }, [school?.school_days]);

  const firstOfMonth = cursor;
  const lastOfMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const startISO = ymd(firstOfMonth);
  const endISO = ymd(lastOfMonth);

  const events = useQuery<EventRow[]>({
    queryKey: ["calendar-month", school?.id, startISO, endISO],
    enabled: !!school?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("school_calendar")
        .select("id,title,start_date,end_date,event_type,color,all_day")
        .eq("school_id", school!.id)
        .lte("start_date", endISO)
        .or(`end_date.gte.${startISO},end_date.is.null`)
        .order("start_date", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as EventRow[];
    },
  });

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const e of events.data ?? []) {
      const start = new Date(e.start_date + "T00:00:00");
      const end = e.end_date ? new Date(e.end_date + "T00:00:00") : start;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = ymd(d);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(e);
      }
    }
    return map;
  }, [events.data]);

  // Build a 6-week grid (always 42 cells) starting Sunday.
  const cells: Array<{ date: Date; inMonth: boolean }> = [];
  const startGrid = new Date(firstOfMonth);
  startGrid.setDate(startGrid.getDate() - startGrid.getDay());
  for (let i = 0; i < 42; i++) {
    const d = new Date(startGrid);
    d.setDate(startGrid.getDate() + i);
    cells.push({ date: d, inMonth: d.getMonth() === firstOfMonth.getMonth() });
  }

  const todayKey = ymd(new Date());
  const monthLabel = firstOfMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="uos-card p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="size-4 text-muted-foreground" />
          <h2 className="font-display text-lg font-semibold">{monthLabel}</h2>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              const n = new Date();
              setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
            }}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
            aria-label="Next month"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px text-center text-[10px] uppercase tracking-widest text-muted-foreground">
        {DAY_LABELS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px rounded-lg bg-border/40 overflow-hidden">
        {cells.map(({ date, inMonth }) => {
          const key = ymd(date);
          const dow = DAY_KEYS[date.getDay()];
          const isSchoolDay = schoolDays[dow] === true;
          const dayEvents = eventsByDay.get(key) ?? [];
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={[
                "min-h-20 p-1.5 text-left text-xs",
                inMonth ? "bg-card" : "bg-card/40",
                !isSchoolDay ? "bg-stripes" : "",
                isToday ? "ring-1 ring-primary/60 ring-inset" : "",
              ].join(" ")}
              aria-label={!isSchoolDay ? `Non-school day, ${key}` : key}
            >
              <div
                className={[
                  "flex items-center justify-between",
                  inMonth ? "text-foreground" : "text-muted-foreground/60",
                ].join(" ")}
              >
                <span className={isToday ? "font-bold text-primary" : ""}>{date.getDate()}</span>
                {!isSchoolDay && inMonth && (
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70">
                    Off
                  </span>
                )}
              </div>
              <ul className="mt-1 space-y-0.5">
                {dayEvents.slice(0, 3).map((e) => (
                  <li key={e.id} className="flex items-center gap-1 truncate">
                    <span
                      className={`size-1.5 rounded-full shrink-0 ${TYPE_DOT[e.event_type ?? ""] ?? "bg-foreground/50"}`}
                    />
                    <span className="truncate text-[11px]">{e.title}</span>
                  </li>
                ))}
                {dayEvents.length > 3 && (
                  <li className="text-[10px] text-muted-foreground">
                    +{dayEvents.length - 3} more
                  </li>
                )}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-rose-400" /> Holiday
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-amber-400" /> Exam
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-sky-400" /> Event
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-violet-400" /> Meeting
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-2 rounded-full bg-emerald-400" /> Term
        </span>
        <span className="ml-auto inline-flex items-center gap-1">
          <span className="inline-block size-3 rounded bg-stripes border border-border" />{" "}
          Non-school day
        </span>
      </div>
    </div>
  );
}
