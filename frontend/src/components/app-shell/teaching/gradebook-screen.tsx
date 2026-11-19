/**
 * M7 (ADR-118) Gradebook / CA entry. Reads the class sheet through `m7_class_gradebook` (own
 * classes only) and the weights PR #313 configures; writes ONLY via `enterResultScores`
 * (`m06_enter_result_scores`) through the generic outbox (PR #449), with one idempotency key per
 * save and learner. Approved or published results are shown locked: changing them is an audited
 * amendment, not an edit here.
 */
import { useEffect, useMemo, useState } from "react";
import { createOutbox, registerOutboxSender, type OutboxContext } from "@/lib/offline/outbox";
import { enterResultScores } from "@/lib/runtime/scholar/results.functions";
import { getGradebook, getMyClasses } from "@/lib/runtime/scholar/teaching.functions";
import {
  buildPayload,
  CA_SCORE_KIND,
  caIdempotencyKey,
  createCaScoreSender,
  draftChanged,
  draftFromRow,
  ROW_STATE_LABEL,
  rowEditable,
  type DraftRow,
  type GradebookRow,
  type WeightProfile,
} from "@/lib/scholar/teaching/gradebook";
import type { ClassOption } from "@/lib/scholar/teaching/today";
import { useOfflineScope } from "../offline-controls";
import {
  ClassPicker,
  errorText,
  newClientKey,
  OfflineNotice,
  useCachedRead,
  useOnline,
} from "./teaching-common";

const caSender = createCaScoreSender((input) => enterResultScores(input));
// Registered when the screen chunk loads, so the shell's "send now" can also deliver CA rows.
registerOutboxSender(CA_SCORE_KIND, caSender);

type Sheet = { rows: GradebookRow[]; profile: WeightProfile | null };

export function GradebookScreen() {
  const online = useOnline();
  const scope = useOfflineScope();
  const [classId, setClassId] = useState("");
  const [subject, setSubject] = useState("");
  const [term, setTerm] = useState("First");
  const [year, setYear] = useState("");
  const [opened, setOpened] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ label?: string; reason: string }[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [busy, setBusy] = useState(false);

  const context: OutboxContext | null = useMemo(
    () =>
      scope ? { userId: scope.userId, organizationId: scope.tenantId, role: scope.role } : null,
    [scope],
  );
  const outbox = useMemo(() => (context ? createOutbox({ context }) : null), [context]);
  const classes = useCachedRead<ClassOption[]>("results", "m7:classes", () => getMyClasses());
  const chosen = (classes.data ?? []).find((c) => c.class_id === classId);
  const sheet = useCachedRead<Sheet>("results", opened, () =>
    getGradebook({
      data: {
        class_id: classId,
        subject: subject.trim(),
        term: term.trim(),
        academic_year: year.trim(),
      },
    }),
  );
  const profile = sheet.data?.profile ?? null;
  const original = useMemo(() => {
    const out: Record<string, DraftRow> = {};
    if (profile)
      for (const row of sheet.data?.rows ?? []) out[row.student_id] = draftFromRow(row, profile);
    return out;
  }, [sheet.data, profile]);

  useEffect(() => setDrafts(original), [original]);

  useEffect(() => {
    if (!outbox) return;
    let active = true;
    const refresh = () =>
      void outbox.summary().then((s) => {
        if (!active) return;
        setWaiting(s.waiting);
        setFailures(s.failures.filter((f) => f.kind === CA_SCORE_KIND));
      });
    refresh();
    const onOnline = () =>
      void outbox.drain({ [CA_SCORE_KIND]: caSender }).then(() => {
        refresh();
        sheet.reload();
      });
    window.addEventListener("online", onOnline);
    window.addEventListener("sherivs:outbox-status", refresh);
    return () => {
      active = false;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("sherivs:outbox-status", refresh);
    };
    // sheet.reload is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outbox]);

  function open() {
    if (!classId || !subject.trim() || !term.trim() || year.trim().length < 4) {
      setMessage("Choose a class and enter the subject, term and academic year.");
      return;
    }
    setMessage(null);
    setOpened(`m7:gradebook:${classId}:${subject.trim()}:${term.trim()}:${year.trim()}`);
  }

  async function save() {
    if (!outbox || !profile || !sheet.data) return;
    const saveId = newClientKey("save");
    const nextErrors: Record<string, string[]> = {};
    const queued: string[] = [];
    setBusy(true);
    setMessage(null);
    try {
      for (const row of sheet.data.rows) {
        const draft = drafts[row.student_id];
        if (
          !draft ||
          !rowEditable(row.state) ||
          !draftChanged(draft, original[row.student_id] ?? {})
        )
          continue;
        const built = buildPayload(row.student_id, draft, profile);
        if ("errors" in built) {
          nextErrors[row.student_id] = built.errors;
          continue;
        }
        await outbox.enqueue(
          CA_SCORE_KIND,
          built.payload,
          caIdempotencyKey(profile, row.student_id, saveId),
          { label: `${row.display_name} · ${profile.subject}` },
        );
        queued.push(row.student_id);
      }
      setErrors(nextErrors);
      if (!queued.length) {
        setMessage(
          Object.keys(nextErrors).length ? "Fix the marked rows first." : "Nothing changed.",
        );
        return;
      }
      if (online) {
        const report = await outbox.drain({ [CA_SCORE_KIND]: caSender });
        setMessage(
          `Sent ${report.sent} of ${queued.length}.` +
            (report.rejected.length ? ` ${report.rejected.length} refused by the server.` : "") +
            (report.waiting ? ` ${report.waiting} waiting to retry.` : ""),
        );
        sheet.reload();
      } else {
        setMessage(`Saved ${queued.length} on this device; they send when you are back online.`);
      }
    } catch (cause) {
      setMessage(errorText(cause, "Could not save scores"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="app-shell-section teaching-screen" data-testid="gradebook-screen">
      <h1>Gradebook</h1>
      <OfflineNotice
        online={online}
        source={sheet.source}
        waiting={waiting}
        onRefresh={sheet.reload}
      />
      <div className="teaching-row">
        <ClassPicker
          classes={classes.data ?? []}
          value={classId}
          onChange={setClassId}
          id="gradebook-class"
        />
        <div className="teaching-field">
          <label htmlFor="gradebook-subject">Subject</label>
          <input
            id="gradebook-subject"
            list="gradebook-subjects"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <datalist id="gradebook-subjects">
            {(chosen?.subjects ?? []).map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="teaching-field">
          <label htmlFor="gradebook-term">Term</label>
          <input id="gradebook-term" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <div className="teaching-field">
          <label htmlFor="gradebook-year">Academic year</label>
          <input
            id="gradebook-year"
            placeholder="2026/2027"
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </div>
        <button type="button" className="teaching-button" onClick={open}>
          Open sheet
        </button>
      </div>
      {sheet.error ? (
        <p role="alert" className="teaching-error">
          {sheet.error}
        </p>
      ) : null}
      {opened && sheet.data && !profile ? (
        <p role="status">
          Score weights for this subject and term are not set up yet. The exams officer sets them;
          until then scores cannot be entered.
        </p>
      ) : null}
      {profile && sheet.data ? (
        <>
          <p className="teaching-muted">
            CA {profile.ca_weight}% (
            {profile.ca_components.map((c) => `${c.code} out of ${c.max_score}`).join(", ")}) · exam{" "}
            {profile.terminal_weight}% out of {profile.terminal_max_score}
          </p>
          <div className="teaching-scroll">
            <table className="teaching-table">
              <caption className="teaching-muted">
                Leave a box empty if the score is not in yet.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Learner</th>
                  {profile.ca_components.map((c) => (
                    <th scope="col" key={c.code}>
                      {c.code} (/{c.max_score})
                    </th>
                  ))}
                  <th scope="col">Exam (/{profile.terminal_max_score})</th>
                  <th scope="col">Total</th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {sheet.data.rows.map((row) => {
                  const editable = rowEditable(row.state);
                  const draft = drafts[row.student_id] ?? {};
                  const rowErrors = errors[row.student_id];
                  const set = (k: string, v: string) =>
                    setDrafts((d) => ({ ...d, [row.student_id]: { ...draft, [k]: v } }));
                  return (
                    <tr key={row.student_id} aria-invalid={rowErrors ? true : undefined}>
                      <th scope="row">
                        {row.display_name}
                        {rowErrors ? (
                          <div role="alert" className="teaching-error">
                            {rowErrors.join("; ")}
                          </div>
                        ) : null}
                      </th>
                      {[...profile.ca_components.map((c) => c.code), "terminal"].map((k) => (
                        <td key={k}>
                          <input
                            inputMode="decimal"
                            aria-label={`${row.display_name} ${k === "terminal" ? "exam" : k}`}
                            value={draft[k] ?? ""}
                            disabled={!editable}
                            onChange={(e) => set(k, e.target.value)}
                            style={{ minHeight: 44 }}
                          />
                        </td>
                      ))}
                      <td>{row.total_score ?? "–"}</td>
                      <td className="teaching-muted">{ROW_STATE_LABEL[row.state]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="teaching-row">
            <button
              type="button"
              className="teaching-button"
              data-variant="primary"
              disabled={busy || !outbox}
              onClick={() => void save()}
            >
              {online ? "Save scores" : "Save on this device"}
            </button>
          </div>
        </>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {failures.length ? (
        <div role="alert">
          <h2>Not accepted by the server</h2>
          <ul>
            {failures.map((f, i) => (
              <li key={i}>
                {f.label ?? "A score"}: {f.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export default GradebookScreen;
