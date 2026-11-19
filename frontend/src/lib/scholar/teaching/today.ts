/**
 * M7 (ADR-118) today's classes: pure helpers. The clock is injected (time-authority discipline);
 * the weekday and date are read in the given IANA time zone (the device's by default), because a
 * teacher's "today" is local, not UTC.
 */
export type Weekday =
  "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export interface Period {
  slot_id: string;
  class_id: string;
  class_name: string;
  period_number: number;
  start_time: string;
  end_time: string;
  subject: string;
  room: string | null;
}

export interface ClassOption {
  class_id: string;
  class_name: string;
  grade_level?: string | null;
  is_form_class: boolean;
  subjects: string[];
}

export type PeriodState = "done" | "now" | "next" | "later";

function parts(atMs: number, timeZone?: string) {
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const out: Record<string, string> = {};
  for (const part of format.formatToParts(atMs)) out[part.type] = part.value;
  return out;
}

export function localWeekday(atMs: number, timeZone?: string): Weekday {
  return parts(atMs, timeZone).weekday!.toLowerCase() as Weekday;
}

/** YYYY-MM-DD in the given time zone. */
export function localIsoDate(atMs: number, timeZone?: string): string {
  const p = parts(atMs, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** HH:MM (24 h) in the given time zone. */
export function localClock(atMs: number, timeZone?: string): string {
  const p = parts(atMs, timeZone);
  return `${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

const hhmm = (time: string) => time.slice(0, 5);

export function sortPeriods(periods: readonly Period[]): Period[] {
  return [...periods].sort(
    (a, b) =>
      hhmm(a.start_time).localeCompare(hhmm(b.start_time)) || a.period_number - b.period_number,
  );
}

/** Label each period relative to `clock` (HH:MM): finished, in progress, the next one, or later. */
export function periodStates(
  periods: readonly Period[],
  clock: string,
): { period: Period; state: PeriodState }[] {
  let nextGiven = false;
  return sortPeriods(periods).map((period) => {
    const start = hhmm(period.start_time);
    const end = hhmm(period.end_time);
    let state: PeriodState;
    if (end <= clock) state = "done";
    else if (start <= clock) state = "now";
    else if (!nextGiven) state = "next";
    else state = "later";
    if (state === "next") nextGiven = true;
    return { period, state };
  });
}

export const PERIOD_STATE_LABEL: Record<PeriodState, string> = {
  done: "Finished",
  now: "Now",
  next: "Next",
  later: "Later",
};
