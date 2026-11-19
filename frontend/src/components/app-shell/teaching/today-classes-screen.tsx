/**
 * M7 (ADR-118) Today's classes: the signed-in teacher's own timetabled periods for today, from
 * the existing timetable tables through `m7_my_periods` (own periods only, enforced in the
 * database), plus the classes they are assigned to.
 */
import { getMyClasses, getMyPeriods } from "@/lib/runtime/scholar/teaching.functions";
import {
  localClock,
  localWeekday,
  PERIOD_STATE_LABEL,
  periodStates,
  type ClassOption,
  type Period,
} from "@/lib/scholar/teaching/today";
import { OfflineNotice, teachingClock, useCachedRead, useOnline } from "./teaching-common";

export function TodayClassesScreen() {
  const online = useOnline();
  const atMs = teachingClock.now().atMs;
  const day = localWeekday(atMs);
  const clock = localClock(atMs);
  const periods = useCachedRead<Period[]>("timetable", `m7:periods:${day}`, () =>
    getMyPeriods({ data: { day } }),
  );
  const classes = useCachedRead<ClassOption[]>("timetable", "m7:classes", () => getMyClasses());
  const rows = periods.data ? periodStates(periods.data, clock) : [];

  return (
    <section className="app-shell-section teaching-screen" data-testid="today-classes-screen">
      <h1>Today&apos;s classes</h1>
      <p className="teaching-muted">
        {day.charAt(0).toUpperCase() + day.slice(1)}. Only periods on your own timetable are shown.
      </p>
      <OfflineNotice online={online} source={periods.source} onRefresh={periods.reload} />
      {periods.loading && !periods.data ? <p aria-busy="true">Loading…</p> : null}
      {periods.error ? (
        <p role="alert" className="teaching-error">
          {periods.error}
        </p>
      ) : null}
      {periods.data && rows.length === 0 ? (
        <p>
          No periods on your timetable today. If that is wrong, ask the timetable officer to assign
          you to the right periods.
        </p>
      ) : null}
      <ol className="teaching-list" aria-label="Periods today">
        {rows.map(({ period, state }) => (
          <li
            key={period.slot_id}
            data-state={state}
            aria-current={state === "now" ? "time" : undefined}
          >
            <div>
              <strong>
                {period.start_time.slice(0, 5)}–{period.end_time.slice(0, 5)} · {period.subject}
              </strong>
              <div className="teaching-muted">
                {period.class_name}
                {period.room ? ` · Room ${period.room}` : ""} · {PERIOD_STATE_LABEL[state]}
              </div>
            </div>
            <a
              href={`/home/s/nav.attendance?class=${encodeURIComponent(period.class_id)}`}
              className="teaching-button"
            >
              Take attendance
            </a>
          </li>
        ))}
      </ol>
      <h2>My classes</h2>
      {classes.data && classes.data.length === 0 ? (
        <p>You are not assigned to any class yet.</p>
      ) : null}
      <ul className="teaching-list" aria-label="My classes">
        {(classes.data ?? []).map((c) => (
          <li key={c.class_id}>
            <span>
              {c.class_name}
              {c.is_form_class ? " · form class" : ""}
            </span>
            <span className="teaching-muted">
              {c.subjects.join(", ") || "No timetabled subject"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default TodayClassesScreen;
