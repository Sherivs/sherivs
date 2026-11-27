/**
 * M7 (ADR-149) Attendance. Today's register goes to the EXISTING M05 offline queue
 * (`createClassAttendanceQueue` -> `syncClassAttendance` -> `offline_attendance_capture_sync_m05`):
 * marks are stored on the device first, then sent; the server de-duplicates by item id and
 * reports conflicts, which are shown per learner. A past day is changed only through
 * `m7_correct_attendance`, with a reason, and is audited. Attendance events (WF-05) come from the
 * database trigger; this screen emits none.
 */
import { useEffect, useMemo, useState } from "react";
import { createClassAttendanceQueue } from "@/lib/offline/class-attendance-queue";
import type { AttendanceStatus } from "@/lib/offline/attendance-queue";
import {
  correctAttendance,
  getClassAttendance,
  getClassRoster,
  getMyClasses,
} from "@/lib/runtime/scholar/teaching.functions";
import {
  ATTENDANCE_STATUSES,
  attendanceMode,
  changedMarks,
  conflictText,
  correctionReasonError,
  initialSheet,
  markAll,
  STATUS_LABEL,
  summarise,
  type RosterEntry,
  type SavedMark,
  type Sheet,
} from "@/lib/scholar/teaching/attendance-sheet";
import { localIsoDate } from "@/lib/scholar/teaching/today";
import type { ClassOption } from "@/lib/scholar/teaching/today";
import { useOfflineScope } from "../offline-controls";
import {
  ClassPicker,
  errorText,
  newClientKey,
  OfflineNotice,
  teachingClock,
  useCachedRead,
  useOnline,
} from "./teaching-common";

function initialClass(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("class") ?? "";
}

export function AttendanceScreen({ initialClassId }: { initialClassId?: string } = {}) {
  const online = useOnline();
  const scope = useOfflineScope();
  const today = localIsoDate(teachingClock.now().atMs);
  const [classId, setClassId] = useState(() => initialClassId ?? initialClass());
  const [date, setDate] = useState(today);
  const [sheet, setSheet] = useState<Sheet>({});
  const [message, setMessage] = useState<string | null>(null);
  const [problems, setProblems] = useState<{ student_id?: string; why: string }[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [busy, setBusy] = useState(false);

  const queue = useMemo(
    () =>
      scope
        ? createClassAttendanceQueue({ scope, now: () => new Date(teachingClock.now().atMs) })
        : null,
    [scope],
  );
  const classes = useCachedRead<ClassOption[]>("attendance", "m7:classes", () => getMyClasses());
  const roster = useCachedRead<RosterEntry[]>(
    "attendance",
    classId ? `m7:roster:${classId}` : null,
    () => getClassRoster({ data: { class_id: classId } }),
  );
  const saved = useCachedRead<SavedMark[]>(
    "attendance",
    classId ? `m7:marks:${classId}:${date}` : null,
    () => getClassAttendance({ data: { class_id: classId, date } }),
  );
  const mode = attendanceMode(date, today);

  useEffect(() => {
    if (roster.data) setSheet(initialSheet(roster.data, saved.data ?? []));
  }, [roster.data, saved.data]);

  useEffect(() => {
    if (!queue) return;
    let active = true;
    const refresh = () => void queue.pending().then((p) => active && setWaiting(p.length));
    refresh();
    const stop = queue.autoFlush(window);
    const onOnline = () => setTimeout(refresh, 1500);
    window.addEventListener("online", onOnline);
    return () => {
      active = false;
      stop();
      window.removeEventListener("online", onOnline);
    };
  }, [queue]);

  async function save() {
    if (!queue || !roster.data) return;
    const marks = changedMarks(classId, date, sheet, saved.data ?? []);
    if (!marks.length) {
      setMessage("Nothing changed.");
      return;
    }
    setBusy(true);
    setMessage(null);
    setProblems([]);
    try {
      for (const mark of marks) await queue.markForClass(mark);
      if (online) {
        const report = await queue.flush();
        setProblems(report.conflicts);
        setMessage(
          report.error
            ? `Saved on this device; sending failed (${report.error}). It will retry.`
            : `Sent ${report.applied} mark${report.applied === 1 ? "" : "s"}${report.duplicates ? ` (${report.duplicates} already on the server)` : ""}.`,
        );
        saved.reload();
      } else {
        setMessage(`Saved ${marks.length} mark${marks.length === 1 ? "" : "s"} on this device.`);
      }
      setWaiting((await queue.pending()).length);
    } catch (cause) {
      setMessage(errorText(cause, "Could not save the register"));
    } finally {
      setBusy(false);
    }
  }

  const counts = summarise(sheet);
  const names = new Map((roster.data ?? []).map((r) => [r.student_id, r.display_name]));

  return (
    <section className="app-shell-section teaching-screen" data-testid="attendance-screen">
      <h1>Attendance</h1>
      <OfflineNotice
        online={online}
        source={roster.source}
        waiting={waiting}
        onRefresh={roster.reload}
      />
      <div className="teaching-row">
        <ClassPicker classes={classes.data ?? []} value={classId} onChange={setClassId} />
        <div className="teaching-field">
          <label htmlFor="attendance-date">Date</label>
          <input
            id="attendance-date"
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value || today)}
          />
        </div>
      </div>
      {classes.error ? (
        <p role="alert" className="teaching-error">
          {classes.error}
        </p>
      ) : null}
      {!classId ? <p>Choose one of your classes to take the register.</p> : null}
      {roster.error ? (
        <p role="alert" className="teaching-error">
          {roster.error}
        </p>
      ) : null}
      {mode === "future" ? <p role="alert">You cannot mark a future date.</p> : null}

      {classId && roster.data && mode === "register" ? (
        <>
          <p className="teaching-muted" aria-live="polite">
            {counts.present} present · {counts.absent} absent · {counts.late} late ·{" "}
            {counts.excused} excused · {counts.unmarked} not marked
          </p>
          <div className="teaching-row">
            <button
              type="button"
              className="teaching-button"
              onClick={() => setSheet(markAll(roster.data!, "present"))}
            >
              Mark everyone present
            </button>
          </div>
          <ul className="teaching-list" aria-label="Register">
            {roster.data.map((learner) => (
              <li key={learner.student_id}>
                <span id={`learner-${learner.student_id}`}>
                  {learner.display_name}
                  {learner.admission_number ? (
                    <span className="teaching-muted"> · {learner.admission_number}</span>
                  ) : null}
                </span>
                <div
                  className="teaching-status"
                  role="group"
                  aria-labelledby={`learner-${learner.student_id}`}
                >
                  {ATTENDANCE_STATUSES.map((status) => (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={sheet[learner.student_id] === status}
                      onClick={() => setSheet((s) => ({ ...s, [learner.student_id]: status }))}
                    >
                      {STATUS_LABEL[status]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <div className="teaching-row">
            <button
              type="button"
              className="teaching-button"
              data-variant="primary"
              disabled={busy || !queue}
              onClick={() => void save()}
            >
              {online ? "Save register" : "Save on this device"}
            </button>
          </div>
        </>
      ) : null}

      {classId && roster.data && mode === "correction" ? (
        <CorrectionList
          marks={saved.data ?? []}
          names={names}
          online={online}
          onDone={() => saved.reload()}
        />
      ) : null}

      {message ? <p role="status">{message}</p> : null}
      {problems.length ? (
        <ul role="alert" aria-label="Marks the server did not accept">
          {problems.map((p, i) => (
            <li key={`${p.student_id ?? "x"}-${i}`}>
              {names.get(p.student_id ?? "") ?? "A learner"}: {conflictText(p.why)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function CorrectionList({
  marks,
  names,
  online,
  onDone,
}: {
  marks: readonly SavedMark[];
  names: Map<string, string>;
  online: boolean;
  onDone: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState<AttendanceStatus>("present");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!marks.length)
    return <p>No register was saved for this day, so there is nothing to correct.</p>;

  async function submit(markId: string) {
    const problem = correctionReasonError(reason);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await correctAttendance({ data: { mark_id: markId, status, reason, client_key: key } });
      setEditing(null);
      onDone();
    } catch (cause) {
      setError(errorText(cause, "The correction was not saved"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p>
        This is a past day. Changing a mark needs a reason and is recorded with your name.
        {online ? "" : " You are offline: corrections need a connection."}
      </p>
      <ul className="teaching-list" aria-label="Saved marks">
        {marks.map((mark) => (
          <li key={mark.id}>
            <span>
              {names.get(mark.student_id) ?? "Learner"} · {STATUS_LABEL[mark.status]}
            </span>
            {editing === mark.id ? (
              <div className="teaching-row">
                <div className="teaching-field">
                  <label htmlFor={`status-${mark.id}`}>New status</label>
                  <select
                    id={`status-${mark.id}`}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
                  >
                    {ATTENDANCE_STATUSES.filter((s) => s !== mark.status).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="teaching-field">
                  <label htmlFor={`reason-${mark.id}`}>Reason</label>
                  <input
                    id={`reason-${mark.id}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    aria-describedby={error ? `error-${mark.id}` : undefined}
                  />
                </div>
                <button
                  type="button"
                  className="teaching-button"
                  data-variant="primary"
                  disabled={busy || !online}
                  onClick={() => void submit(mark.id)}
                >
                  Save correction
                </button>
                <button type="button" className="teaching-button" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                {error ? (
                  <p id={`error-${mark.id}`} role="alert" className="teaching-error">
                    {error}
                  </p>
                ) : null}
              </div>
            ) : (
              <button
                type="button"
                className="teaching-button"
                onClick={() => {
                  setEditing(mark.id);
                  setStatus(ATTENDANCE_STATUSES.find((s) => s !== mark.status)!);
                  setReason("");
                  setError(null);
                  // One key per correction attempt: a double tap or retry is a server-side replay.
                  setKey(newClientKey("att-fix"));
                }}
              >
                Correct
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export default AttendanceScreen;
