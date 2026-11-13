import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardCheck, RefreshCw } from "lucide-react";
import {
  approveInterviewAnswers,
  clearInterviewAnswer,
  getInterview,
  submitInterviewAnswer,
  type InterviewOutcome,
} from "@/lib/runtime/scholar/reality-interview.functions";
import {
  STATE_LABEL,
  displayValue,
  draftFromAnswer,
  draftToValue,
  issueMessage,
  type AnswerView,
  type Draft,
  type InterviewView,
  type QuestionView,
} from "@/lib/scholar/reality";
import "./institution-interview-screen.css";

export interface ScreenMessage {
  readonly tone: "ok" | "error" | "info";
  readonly text: string;
}

const BLOCKER_TEXT: Record<string, string> = {
  type_unset: "Choose the type of school.",
  type_unsupported: "This type of institution is not part of this setup yet.",
  required_open: "Answer",
  conflicting: "Decide between different answers for",
  pending: "Confirm",
};

export interface InterviewScreenViewProps {
  readonly view: InterviewView;
  readonly activeId: string | null;
  readonly draft: Draft;
  readonly fieldError: string | null;
  readonly busy: boolean;
  readonly message: ScreenMessage | null;
  readonly confirmingApproval: boolean;
  readonly onDraft: (draft: Draft) => void;
  readonly onSave: () => void;
  readonly onUnknown: () => void;
  readonly onNotApplicable: () => void;
  readonly onEdit: (id: string) => void;
  readonly onClear: (id: string) => void;
  readonly onAskApprove: () => void;
  readonly onConfirmApprove: () => void;
  readonly onCancelApprove: () => void;
}

function QuestionInput({
  q,
  draft,
  onDraft,
  describedBy,
}: {
  q: QuestionView;
  draft: Draft;
  onDraft: (d: Draft) => void;
  describedBy?: string;
}) {
  const id = `interview-input-${q.id}`;
  const text = typeof draft === "string" ? draft : "";
  if (q.answerType === "bool") {
    return (
      <fieldset className="interview-choices" aria-describedby={describedBy}>
        <legend className="visually-hidden">{q.prompt}</legend>
        {[
          ["true", "Yes"],
          ["false", "No"],
        ].map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name={id}
              value={value}
              checked={draft === value}
              onChange={() => onDraft(value)}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  if (q.answerType === "single" && q.options) {
    return (
      <fieldset className="interview-choices" aria-describedby={describedBy}>
        <legend className="visually-hidden">{q.prompt}</legend>
        {q.options.map((option) => (
          <label key={option}>
            <input
              type="radio"
              name={id}
              value={option}
              checked={draft === option}
              onChange={() => onDraft(option)}
            />
            <span>{option.replace(/_/g, " ")}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  if (q.answerType === "multi" && q.options) {
    const picked = Array.isArray(draft) ? (draft as readonly string[]) : [];
    return (
      <fieldset className="interview-choices" aria-describedby={describedBy}>
        <legend className="visually-hidden">{q.prompt}</legend>
        {q.options.map((option) => (
          <label key={option}>
            <input
              type="checkbox"
              checked={picked.includes(option)}
              onChange={(e) =>
                onDraft(e.target.checked ? [...picked, option] : picked.filter((p) => p !== option))
              }
            />
            <span>{option.replace(/_/g, " ")}</span>
          </label>
        ))}
      </fieldset>
    );
  }
  if (q.answerType === "repeating_group" || q.answerType === "hierarchy") {
    return (
      <textarea
        id={id}
        rows={4}
        value={text}
        onChange={(e) => onDraft(e.target.value)}
        aria-label={q.prompt}
        aria-describedby={describedBy}
        aria-invalid={describedBy ? true : undefined}
        placeholder="One per line"
      />
    );
  }
  const type =
    q.answerType === "number"
      ? "number"
      : q.answerType === "date"
        ? "date"
        : q.answerType === "time"
          ? "time"
          : "text";
  return (
    <input
      id={id}
      type={type}
      inputMode={q.answerType === "number" ? "numeric" : undefined}
      min={q.min ?? undefined}
      max={q.max ?? undefined}
      maxLength={q.answerType === "text" ? (q.maxLength ?? 500) : undefined}
      value={text}
      onChange={(e) => onDraft(e.target.value)}
      aria-label={q.prompt}
      aria-describedby={describedBy}
      aria-invalid={describedBy ? true : undefined}
    />
  );
}

export function InterviewScreenView(props: InterviewScreenViewProps) {
  const { view } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const question = view.questions.find((q) => q.id === props.activeId) ?? null;
  const total = view.progress.visible;
  const done = view.progress.answered;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const approved = view.approvalValid;
  const blockedByType = view.type.status === "unsupported";

  useEffect(() => {
    if (props.confirmingApproval) confirmRef.current?.focus();
  }, [props.confirmingApproval]);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (wasConfirming.current && !props.confirmingApproval) approveRef.current?.focus();
    wasConfirming.current = props.confirmingApproval;
  }, [props.confirmingApproval]);
  const questionId = question?.id ?? null;
  useEffect(() => {
    if (questionId !== null) questionRef.current?.focus();
  }, [questionId]);

  const grouped = new Map<string, QuestionView[]>();
  for (const q of view.questions) grouped.set(q.domain, [...(grouped.get(q.domain) ?? []), q]);

  return (
    <section
      className="interview"
      aria-labelledby="interview-heading"
      data-testid="institution-interview"
      data-status={approved ? "approved" : "draft"}
    >
      <header className="interview-header">
        <ClipboardCheck size={20} aria-hidden="true" />
        <div>
          <h1 id="interview-heading" ref={headingRef} tabIndex={-1}>
            School setup interview
          </h1>
          <p className="interview-sub">
            Tell Sherivs how your school really works. Answers are saved as you go, and nothing is
            published or switched on by this page.
          </p>
        </div>
        <span
          className={`interview-chip ${approved ? "is-approved" : "is-draft"}`}
          data-testid="interview-status"
        >
          {approved ? "Approved" : "Draft"}
        </span>
      </header>

      <div className="interview-progress" role="group" aria-label="Progress">
        <div
          className="interview-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label="Questions answered"
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <p data-testid="interview-progress-text">
          {done} of {total} answered
          {view.progress.requiredOpen > 0
            ? ` · ${view.progress.requiredOpen} required still open`
            : ""}
        </p>
      </div>

      <div role="status" aria-live="polite" className="interview-live">
        {props.message ? (
          <p
            className={`interview-message is-${props.message.tone}`}
            data-testid="interview-message"
          >
            {props.message.text}
          </p>
        ) : null}
      </div>
      {view.notes.length > 0 ? (
        <ul className="interview-notes" aria-label="Notes about your saved answers">
          {view.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}

      {blockedByType ? (
        <div className="interview-card" data-testid="interview-unsupported">
          <h2>This setup covers nursery, primary and secondary schools</h2>
          <p>
            You chose “{view.type.chosen?.replace(/_/g, " ")}”. That type is not part of this setup
            yet, so no further questions are asked and nothing is approved. Choose a different type
            below if this was a mistake.
          </p>
        </div>
      ) : null}

      {question ? (
        <form
          className="interview-card"
          noValidate
          data-testid="interview-question"
          onSubmit={(e) => {
            e.preventDefault();
            props.onSave();
          }}
        >
          <p className="interview-tag">
            {question.required ? "Required" : "Optional"}
            {question.publicSafe
              ? " · can later appear on your public website, only after you approve it"
              : ""}
          </p>
          <h2 ref={questionRef} tabIndex={-1} className="interview-question-title">
            {question.prompt}
          </h2>
          <QuestionInput
            q={question}
            draft={props.draft}
            onDraft={props.onDraft}
            describedBy={props.fieldError ? "interview-field-error" : undefined}
          />
          {props.fieldError ? (
            <p id="interview-field-error" className="interview-field-error" role="alert">
              {props.fieldError}
            </p>
          ) : null}
          <div className="interview-actions">
            <button type="submit" className="is-primary" disabled={props.busy}>
              Save answer
            </button>
            <button type="button" onClick={props.onUnknown} disabled={props.busy}>
              I don’t know yet
            </button>
            {question.allowNotApplicable ? (
              <button type="button" onClick={props.onNotApplicable} disabled={props.busy}>
                Does not apply
              </button>
            ) : null}
          </div>
          <p className="interview-hint">
            “I don’t know yet” keeps this open. It is never recorded as “No”.
          </p>
        </form>
      ) : view.nextQuestionId === null && !blockedByType ? (
        <div className="interview-card" data-testid="interview-complete">
          <h2>Every question that applies has an answer or is marked unknown</h2>
          <p>Review your answers below, then approve them when they are right.</p>
        </div>
      ) : null}

      <section
        className="interview-card"
        aria-labelledby="interview-review-heading"
        data-testid="interview-review"
      >
        <h2 id="interview-review-heading">Your answers</h2>
        {[...grouped.entries()].map(([domain, qs]) => (
          <div key={domain} className="interview-group">
            <h3>{domain.replace(/_/g, " ")}</h3>
            <ul>
              {qs.map((q) => {
                const a: AnswerView | undefined = view.answers[q.id];
                const state = a?.state ?? "unknown";
                return (
                  <li key={q.id} data-state={state} data-testid="interview-row">
                    <div className="interview-row-main">
                      <p className="interview-row-prompt">{q.prompt}</p>
                      <p className="interview-row-value">{displayValue(q, a)}</p>
                      <span className={`interview-badge is-${state}`}>
                        {STATE_LABEL[state] ?? state}
                      </span>
                      {q.publicSafe ? (
                        <span className="interview-badge is-public">Public-safe</span>
                      ) : null}
                    </div>
                    <div className="interview-row-actions">
                      <button
                        type="button"
                        onClick={() => props.onEdit(q.id)}
                        aria-label={`${a ? "Change" : "Answer"}: ${q.prompt}`}
                        disabled={props.busy}
                      >
                        {a ? "Change" : "Answer"}
                      </button>
                      {a && a.state !== "unknown" ? (
                        <button
                          type="button"
                          onClick={() => props.onClear(q.id)}
                          aria-label={`Clear answer: ${q.prompt}`}
                          disabled={props.busy}
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        {view.questions.some((x) => x.publicSafe) ? (
          <p className="interview-hint">
            “Public-safe” marks answers that may later be offered for your public website. Nothing
            is published unless you separately review and approve it there.
          </p>
        ) : null}
        {view.dormantCount > 0 ? (
          <p className="interview-hint">
            {view.dormantCount} earlier answer{view.dormantCount === 1 ? " is" : "s are"} kept but
            hidden, because your other answers mean they no longer apply. They are not part of what
            you approve.
          </p>
        ) : null}
      </section>

      <section
        className="interview-card"
        aria-labelledby="interview-approve-heading"
        data-testid="interview-approval"
      >
        <h2 id="interview-approve-heading">Approve your answers</h2>
        {approved ? (
          <p>
            Approved
            {view.approvedAtMs
              ? ` on ${new Date(view.approvedAtMs).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`
              : ""}
            . Changing any answer returns this to draft. Approving does not publish anything or
            switch anything on.
          </p>
        ) : view.blockers.length > 0 ? (
          <>
            <p>These need attention before you can approve:</p>
            <ul className="interview-blockers" data-testid="interview-blockers">
              {view.blockers.map((b, i) => {
                const q = view.questions.find((x) => x.id === b.questionId);
                const lead = BLOCKER_TEXT[b.code] ?? b.code;
                return (
                  <li key={`${b.code}-${b.questionId ?? i}`}>
                    {b.code === "type_unset" || b.code === "type_unsupported"
                      ? lead
                      : `${lead}: ${q?.prompt ?? b.questionId}`}
                  </li>
                );
              })}
            </ul>
          </>
        ) : props.confirmingApproval ? (
          <div role="group" aria-label="Confirm approval">
            <p>
              You are confirming that these answers describe your school accurately. Unanswered
              questions stay unknown. You can change anything later.
            </p>
            <div className="interview-actions">
              <button
                type="button"
                ref={confirmRef}
                className="is-primary"
                onClick={props.onConfirmApprove}
                disabled={props.busy}
              >
                Yes, approve these answers
              </button>
              <button type="button" onClick={props.onCancelApprove} disabled={props.busy}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <p>Every required question is answered. Approving does not publish anything.</p>
            <div className="interview-actions">
              <button
                type="button"
                ref={approveRef}
                className="is-primary"
                onClick={props.onAskApprove}
                disabled={props.busy}
              >
                Approve answers
              </button>
            </div>
          </>
        )}
      </section>
    </section>
  );
}

/** The seam between the screen and its backend; the fixture swaps in the local engine. */
export interface InterviewApi {
  readonly get: () => Promise<InterviewView>;
  readonly submit: (
    answer: {
      questionId: string;
      state: "confirmed" | "unknown" | "not_applicable";
      value?: AnswerView["value"];
    },
    expectedRevision: number,
  ) => Promise<InterviewOutcome>;
  readonly clear: (questionId: string, expectedRevision: number) => Promise<InterviewOutcome>;
  readonly approve: (expectedRevision: number) => Promise<InterviewOutcome>;
}

const serverApi: InterviewApi = {
  get: () => getInterview({ data: {} }),
  submit: (answer, expectedRevision) =>
    submitInterviewAnswer({ data: { answer: answer as never, expectedRevision } }),
  clear: (questionId, expectedRevision) =>
    clearInterviewAnswer({ data: { questionId, expectedRevision } }),
  approve: (expectedRevision) => approveInterviewAnswers({ data: { expectedRevision } }),
};

function outcomeMessage(outcome: InterviewOutcome, okText: string): ScreenMessage {
  if (outcome.ok) return { tone: "ok", text: okText };
  const first = outcome.issues[0];
  return { tone: "error", text: issueMessage(first?.code ?? "") };
}

export function InstitutionInterviewScreen({ api = serverApi }: { api?: InterviewApi }) {
  const [view, setView] = useState<InterviewView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ScreenMessage | null>(null);
  const [confirming, setConfirming] = useState(false);

  const focusQuestion = useCallback((v: InterviewView, id: string | null) => {
    const target = id ?? v.nextQuestionId;
    const q = v.questions.find((x) => x.id === target);
    setActiveId(q?.id ?? null);
    setDraft(q ? draftFromAnswer(q, v.answers[q.id]) : "");
    setFieldError(null);
  }, []);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const v = await api.get();
      setView(v);
      focusQuestion(v, null);
    } catch {
      setLoadError(true);
    }
  }, [api, focusQuestion]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError)
    return (
      <section className="interview" data-testid="institution-interview-error">
        <h1>School setup interview</h1>
        <p role="alert">
          The interview could not be loaded. You need a school administrator account, and you need
          to be online.
        </p>
        <button type="button" className="interview-retry" onClick={() => void load()}>
          <RefreshCw size={14} aria-hidden="true" /> Try again
        </button>
      </section>
    );
  if (!view)
    return (
      <section className="interview" aria-busy="true">
        <h1>School setup interview</h1>
        <p role="status">Loading your interview…</p>
      </section>
    );

  const q = view.questions.find((x) => x.id === activeId) ?? null;

  const apply = async (run: () => Promise<InterviewOutcome>, okText: string, moveOn: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await run();
      setView(outcome.view);
      setMessage(outcomeMessage(outcome, okText));
      if (outcome.ok && moveOn) focusQuestion(outcome.view, null);
      if (!outcome.ok && outcome.issues[0]?.code === "revision_conflict")
        focusQuestion(outcome.view, null);
      setConfirming(false);
    } catch {
      setMessage({
        tone: "error",
        text: "That did not save. Check your connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const save = (state: "confirmed" | "unknown" | "not_applicable") => {
    if (!q) return;
    let payload: { questionId: string; state: typeof state; value?: AnswerView["value"] };
    if (state === "confirmed") {
      const r = draftToValue(q, draft);
      if (!r.ok) {
        setMessage(null);
        setFieldError(r.message);
        return;
      }
      payload = { questionId: q.id, state, value: r.value };
    } else payload = { questionId: q.id, state };
    setFieldError(null);
    void apply(
      () => api.submit(payload, view.revision),
      state === "confirmed"
        ? "Saved."
        : state === "unknown"
          ? "Kept open as not answered yet."
          : "Marked as not applying.",
      true,
    );
  };

  return (
    <InterviewScreenView
      view={view}
      activeId={activeId}
      draft={q ? draft : ""}
      fieldError={fieldError}
      busy={busy}
      message={message}
      confirmingApproval={confirming}
      onDraft={(d) => {
        setDraft(d);
        setFieldError(null);
      }}
      onSave={() => save("confirmed")}
      onUnknown={() => save("unknown")}
      onNotApplicable={() => save("not_applicable")}
      onEdit={(id) => focusQuestion(view, id)}
      onClear={(id) =>
        void apply(
          () => api.clear(id, view.revision),
          "Cleared. This question is open again.",
          false,
        )
      }
      onAskApprove={() => setConfirming(true)}
      onConfirmApprove={() =>
        void apply(
          () => api.approve(view.revision),
          "Approved. Nothing has been published or switched on.",
          false,
        )
      }
      onCancelApprove={() => setConfirming(false)}
    />
  );
}
