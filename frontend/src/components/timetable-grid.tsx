/**
 * Read-only weekly timetable grid. Renders day columns × period rows.
 */
export type TimetableSlot = {
  day_of_week: string;
  period_number: number;
  start_time: string;
  end_time: string;
  subject: string;
  room?: string | null;
  is_break?: boolean | null;
  break_label?: string | null;
  teacher_name?: string | null;
};

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
const DAY_LABELS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
};

export function TimetableGrid({ slots }: { slots: TimetableSlot[] }) {
  if (!slots || slots.length === 0) {
    return (
      <div className="uos-empty p-8 text-center text-sm text-muted-foreground">
        No timetable available yet.
      </div>
    );
  }
  const periods = Array.from(new Set(slots.map((s) => s.period_number))).sort((a, b) => a - b);
  const byKey = new Map<string, TimetableSlot>();
  for (const s of slots) byKey.set(`${s.day_of_week}-${s.period_number}`, s);

  return (
    <div className="uos-card overflow-x-auto p-2">
      <table className="w-full min-w-[640px] border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="w-16 px-2 py-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
              Period
            </th>
            {DAYS.map((d) => (
              <th
                key={d}
                className="px-2 py-2 text-left text-xs uppercase tracking-wide text-muted-foreground"
              >
                {DAY_LABELS[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
            <tr key={p}>
              <td className="px-2 py-2 align-top text-xs text-muted-foreground">{p}</td>
              {DAYS.map((d) => {
                const slot = byKey.get(`${d}-${p}`);
                if (!slot)
                  return (
                    <td
                      key={d}
                      className="rounded-md border border-dashed border-border/50 px-2 py-3"
                    />
                  );
                const isBreak = !!slot.is_break;
                return (
                  <td
                    key={d}
                    className={`rounded-md border px-2 py-2 align-top ${
                      isBreak
                        ? "border-amber-500/30 bg-amber-500/10"
                        : "border-primary/30 bg-primary/5"
                    }`}
                  >
                    <div className="font-medium">
                      {isBreak ? (slot.break_label ?? "Break") : slot.subject}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {slot.start_time?.slice(0, 5)}–{slot.end_time?.slice(0, 5)}
                    </div>
                    {slot.room && (
                      <div className="text-[11px] text-muted-foreground">Room {slot.room}</div>
                    )}
                    {slot.teacher_name && (
                      <div className="text-[11px] text-muted-foreground">{slot.teacher_name}</div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
