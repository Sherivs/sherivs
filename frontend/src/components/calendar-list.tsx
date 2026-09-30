/**
 * Read-only school calendar list — used by teacher / student / parent portals.
 * Groups upcoming events by month and shows a friendly empty state.
 */
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, MapPin, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";

type CalendarRow = {
  id: string;
  title: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  event_type: string | null;
  color: string | null;
  all_day: boolean | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
};

const TYPE_COLOR: Record<string, string> = {
  holiday: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  exam: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  event: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  meeting: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  term: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
function monthKey(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function CalendarList() {
  const { school } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const q = useQuery<CalendarRow[]>({
    queryKey: ["calendar-read", school?.id],
    enabled: !!school?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("school_calendar")
        .select(
          "id,title,description,start_date,end_date,event_type,color,all_day,start_time,end_time,location",
        )
        .eq("school_id", school!.id)
        .gte("start_date", today)
        .order("start_date", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as CalendarRow[];
    },
  });

  if (q.isLoading) {
    return (
      <div className="uos-card p-8 text-center text-sm text-muted-foreground">
        Loading calendar…
      </div>
    );
  }
  if (q.error) {
    return (
      <div className="uos-card p-8 text-center text-sm text-red-400">
        {(q.error as Error).message}
      </div>
    );
  }
  const rows = q.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="uos-empty p-10 text-center">
        <CalendarDays className="mx-auto size-10 text-muted-foreground/60" />
        <h3 className="mt-3 font-display text-lg font-semibold">No upcoming events</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          When your school publishes events, they will appear here.
        </p>
      </div>
    );
  }

  const groups = rows.reduce<Record<string, CalendarRow[]>>((acc, r) => {
    const k = monthKey(r.start_date);
    (acc[k] = acc[k] ?? []).push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {Object.entries(groups).map(([month, items]) => (
        <section key={month}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {month}
          </h2>
          <div className="space-y-2">
            {items.map((e) => {
              const cls =
                TYPE_COLOR[e.event_type ?? ""] ?? "bg-muted text-muted-foreground border-border";
              return (
                <article key={e.id} className="uos-card p-4 flex gap-4 items-start">
                  <div className="text-center shrink-0 w-14">
                    <div className="text-2xl font-display font-bold leading-none">
                      {new Date(e.start_date + "T00:00:00").getDate()}
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                      {new Date(e.start_date + "T00:00:00").toLocaleDateString(undefined, {
                        month: "short",
                      })}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{e.title}</h3>
                      {e.event_type && (
                        <span
                          className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${cls}`}
                        >
                          {e.event_type}
                        </span>
                      )}
                    </div>
                    {e.description && (
                      <p className="mt-1 text-sm text-muted-foreground">{e.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="size-3" />
                        {fmtDate(e.start_date)}
                        {e.end_date && e.end_date !== e.start_date
                          ? ` → ${fmtDate(e.end_date)}`
                          : ""}
                      </span>
                      {!e.all_day && e.start_time && (
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" />
                          {e.start_time.slice(0, 5)}
                          {e.end_time ? `–${e.end_time.slice(0, 5)}` : ""}
                        </span>
                      )}
                      {e.location && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3" />
                          {e.location}
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
