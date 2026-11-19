/**
 * M7 (ADR-118) Lesson notes: write a draft, submit it (`lesson_note_submit`), and, for a reviewer
 * with `lesson_notes.approve`, approve or return it with a comment (`lesson_note_review`). The
 * author can never approve their own note: the database refuses it (reviewer <> submitter CHECK,
 * the review function, and the m7_lesson_plan_guard trigger); this screen also hides the buttons.
 * Needs a connection (lesson notes are not on the offline queue in M7).
 */
import { useState } from "react";
import { useApp } from "@/contexts/app-context";
import {
  getMyClasses,
  getMyLessonNotes,
  getPendingLessonNoteReviews,
  reviewLessonNote,
  saveLessonNote,
  submitLessonNote,
} from "@/lib/runtime/scholar/teaching.functions";
import {
  canEdit,
  canReview,
  canSubmit,
  displayStatus,
  returnCommentError,
  titleError,
  type LessonNote,
  type PendingReview,
} from "@/lib/scholar/teaching/lesson-notes";
import type { ClassOption } from "@/lib/scholar/teaching/today";
import { ClassPicker, errorText, OfflineNotice, useCachedRead, useOnline } from "./teaching-common";

type Draft = {
  id?: string;
  title: string;
  subject: string;
  class_id: string;
  topic: string;
  description: string;
};
const EMPTY: Draft = { title: "", subject: "", class_id: "", topic: "", description: "" };

export function LessonNotesScreen() {
  const app = useApp();
  const me = app.profile?.id ?? "";
  const online = useOnline();
  const notes = useCachedRead<LessonNote[]>("workspace", "m7:lesson-notes", () =>
    getMyLessonNotes(),
  );
  const pending = useCachedRead<PendingReview[]>("workspace", "m7:lesson-reviews", () =>
    getPendingLessonNoteReviews(),
  );
  const classes = useCachedRead<ClassOption[]>("workspace", "m7:classes", () => getMyClasses());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [comments, setComments] = useState<Record<string, string>>({});

  const toReview = (pending.data ?? []).filter((r) => canReview(r, me));

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(done);
      notes.reload();
      pending.reload();
    } catch (cause) {
      setError(errorText(cause, "That did not work"));
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(andSubmit: boolean) {
    if (!draft) return;
    const problem = titleError(draft.title);
    if (problem) {
      setError(problem);
      return;
    }
    await run(
      async () => {
        const { id } = await saveLessonNote({
          data: {
            ...(draft.id ? { id: draft.id } : {}),
            title: draft.title.trim(),
            subject: draft.subject.trim() || null,
            class_id: draft.class_id || null,
            topic: draft.topic.trim() || null,
            description: draft.description || null,
          },
        });
        if (andSubmit) await submitLessonNote({ data: { plan_id: id } });
        setDraft(null);
      },
      andSubmit ? "Submitted for review." : "Draft saved.",
    );
  }

  return (
    <section className="app-shell-section teaching-screen" data-testid="lesson-notes-screen">
      <h1>Lesson notes</h1>
      <OfflineNotice online={online} source={notes.source} onRefresh={notes.reload} />
      {!online ? <p>Writing and reviewing lesson notes needs a connection.</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? (
        <p role="alert" className="teaching-error">
          {error}
        </p>
      ) : null}

      {draft ? (
        <form
          className="teaching-screen"
          aria-label={draft.id ? "Edit lesson note" : "New lesson note"}
          onSubmit={(e) => {
            e.preventDefault();
            void saveDraft(false);
          }}
        >
          <div className="teaching-field">
            <label htmlFor="note-title">Title</label>
            <input
              id="note-title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              required
            />
          </div>
          <div className="teaching-row">
            <ClassPicker
              classes={classes.data ?? []}
              value={draft.class_id}
              onChange={(class_id) => setDraft({ ...draft, class_id })}
              id="note-class"
            />
            <div className="teaching-field">
              <label htmlFor="note-subject">Subject</label>
              <input
                id="note-subject"
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />
            </div>
            <div className="teaching-field">
              <label htmlFor="note-topic">Topic</label>
              <input
                id="note-topic"
                value={draft.topic}
                onChange={(e) => setDraft({ ...draft, topic: e.target.value })}
              />
            </div>
          </div>
          <div className="teaching-field">
            <label htmlFor="note-body">Note</label>
            <textarea
              id="note-body"
              rows={8}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </div>
          <div className="teaching-row">
            <button type="submit" className="teaching-button" disabled={busy || !online}>
              Save draft
            </button>
            <button
              type="button"
              className="teaching-button"
              data-variant="primary"
              disabled={busy || !online || !canSubmit({ status: "draft", title: draft.title })}
              onClick={() => void saveDraft(true)}
            >
              Save and submit
            </button>
            <button type="button" className="teaching-button" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="teaching-row">
          <button
            type="button"
            className="teaching-button"
            data-variant="primary"
            onClick={() => setDraft({ ...EMPTY })}
          >
            New lesson note
          </button>
        </div>
      )}

      <h2>My notes</h2>
      {notes.error ? (
        <p role="alert" className="teaching-error">
          {notes.error}
        </p>
      ) : null}
      {notes.data && notes.data.length === 0 ? <p>No lesson notes yet.</p> : null}
      <ul className="teaching-list" aria-label="My lesson notes">
        {(notes.data ?? []).map((note) => (
          <li key={note.id}>
            <div>
              <strong>{note.title}</strong>
              <div className="teaching-muted">
                {displayStatus(note)}
                {note.subject ? ` · ${note.subject}` : ""}
              </div>
              {note.review_notes ? <p>Reviewer: {note.review_notes}</p> : null}
            </div>
            {canEdit(note) ? (
              <div className="teaching-row">
                <button
                  type="button"
                  className="teaching-button"
                  onClick={() =>
                    setDraft({
                      id: note.id,
                      title: note.title,
                      subject: note.subject ?? "",
                      class_id: note.class_id ?? "",
                      topic: note.topic ?? "",
                      description: note.description ?? "",
                    })
                  }
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="teaching-button"
                  disabled={busy || !online || !canSubmit(note)}
                  onClick={() =>
                    void run(
                      () => submitLessonNote({ data: { plan_id: note.id } }),
                      "Submitted for review.",
                    )
                  }
                >
                  Submit
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {toReview.length ? (
        <>
          <h2>Waiting for your review</h2>
          <ul className="teaching-list" aria-label="Lesson notes to review">
            {toReview.map((review) => {
              const comment = comments[review.review_id] ?? "";
              return (
                <li key={review.review_id}>
                  <div>
                    <strong>{review.title}</strong>
                    {review.subject ? <div className="teaching-muted">{review.subject}</div> : null}
                    {review.description ? <p>{review.description}</p> : null}
                  </div>
                  <div className="teaching-field">
                    <label htmlFor={`comment-${review.review_id}`}>
                      Comment (needed to return)
                    </label>
                    <input
                      id={`comment-${review.review_id}`}
                      value={comment}
                      onChange={(e) =>
                        setComments((c) => ({ ...c, [review.review_id]: e.target.value }))
                      }
                    />
                  </div>
                  <div className="teaching-row">
                    <button
                      type="button"
                      className="teaching-button"
                      data-variant="primary"
                      disabled={busy || !online}
                      onClick={() =>
                        void run(
                          () =>
                            reviewLessonNote({
                              data: {
                                review_id: review.review_id,
                                approve: true,
                                comment: comment || null,
                              },
                            }),
                          "Approved.",
                        )
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="teaching-button"
                      disabled={busy || !online}
                      onClick={() => {
                        const problem = returnCommentError(comment);
                        if (problem) {
                          setError(problem);
                          return;
                        }
                        void run(
                          () =>
                            reviewLessonNote({
                              data: { review_id: review.review_id, approve: false, comment },
                            }),
                          "Returned with your comment.",
                        );
                      }}
                    >
                      Return
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export default LessonNotesScreen;
