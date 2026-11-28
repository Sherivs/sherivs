/**
 * Website review screen (ADR-164), opened at /home/s/website-review. A school reads each generated standard
 * text (rules, policies, privacy and safeguarding notices) and accepts or removes it. The database refuses to
 * publish while any text is pending, so this is the only way to make those texts live. The screen only edits
 * the school's draft through the existing `website_save_draft` rpc, and never changes anything the school wrote.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useApp } from "@/contexts/app-context";
import { rpc } from "@/lib/scholar/rpc";
import { APP_SHELL_HOME } from "@/lib/shell/paths";
import type { Facts } from "@/lib/website/generator";
import {
  acceptReview,
  addStandardTexts,
  pendingReviewBlocks,
  publishReadiness,
  removePending,
} from "@/lib/website/review";
import type { SiteDocument } from "@/lib/website/types";

interface Loaded {
  exists: boolean;
  draft: SiteDocument | null;
  rev: number;
}

export function WebsiteReviewScreen() {
  const org = useApp().school?.id ?? "";
  const [doc, setDoc] = useState<SiteDocument | null>(null);
  const [rev, setRev] = useState(0);
  const [exists, setExists] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!org) return;
    try {
      const r = await rpc<{ exists: boolean; draft: SiteDocument | null; draft_rev: number }>("website_get", { p_school: org });
      const state: Loaded = { exists: r.exists, draft: r.draft, rev: r.draft_rev };
      setExists(state.exists);
      setDoc(state.draft);
      setRev(state.rev);
      setError("");
    } catch {
      setError("The website could not be loaded. Nothing was changed.");
    }
  }, [org]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: SiteDocument, done: string) {
    setBusy(true);
    setNotice("");
    try {
      const newRev = await rpc<number>("website_save_draft", { p_school: org, p_document: next, p_expected_rev: rev });
      setDoc(next);
      setRev(newRev);
      setError("");
      setNotice(done);
    } catch {
      setError("Your change could not be saved. Reload and try again.");
    }
    setBusy(false);
  }

  async function offerStandardTexts() {
    if (!doc) return;
    setBusy(true);
    try {
      const facts = await rpc<Facts>("website_facts", { p_school: org });
      const r = addStandardTexts(doc, facts);
      setBusy(false);
      if (!r.added) {
        setNotice(r.reason === "already_present" ? "The standard texts are already on your site." : "There is nothing to add.");
        return;
      }
      await save(r.doc, "Standard texts added. Read each one, then accept or remove it.");
    } catch {
      setBusy(false);
      setError("The standard texts could not be prepared.");
    }
  }

  const pending = doc ? pendingReviewBlocks(doc) : [];
  const ready = doc ? publishReadiness(doc) : { ready: false, pending: 0 };

  return (
    <section className="wf-inbox" aria-labelledby="wr-heading">
      <Link to={APP_SHELL_HOME as never} className="app-shell-back">
        ← Home
      </Link>
      <p className="wf-inbox-eyebrow">Website</p>
      <h1 id="wr-heading" className="wf-inbox-heading">
        Review standard texts
      </h1>
      <p className="wf-inbox-subtitle">
        School rules, policies and notices are standard wording, not your answers. Nothing standard goes on your
        public website until you have read it and accepted it.
      </p>
      {error ? (
        <p className="wf-inbox-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="wf-inbox-notice" aria-live="polite">
          {notice}
        </p>
      ) : null}
      {!exists ? <p className="wf-inbox-empty">Your school has no website yet.</p> : null}
      {doc ? (
        <>
          <p className="wf-inbox-live" aria-live="polite">
            {ready.ready ? "Nothing is waiting for review." : `${ready.pending} text${ready.pending === 1 ? "" : "s"} waiting for your review.`}
          </p>
          <div>
            <button type="button" className="wf-inbox-button" disabled={busy} onClick={() => void offerStandardTexts()}>
              Add the standard texts for review
            </button>{" "}
            {pending.length > 0 ? (
              <>
                <button type="button" className="wf-inbox-button" disabled={busy} onClick={() => void save(acceptReview(doc, "all"), "All accepted.")}>
                  Accept all
                </button>{" "}
                <button type="button" className="wf-inbox-button" disabled={busy} onClick={() => void save(removePending(doc, "all"), "All removed.")}>
                  Remove all
                </button>
              </>
            ) : null}
          </div>
          <ul>
            {pending.map((b) => (
              <li key={b.blockId} className="wf-inbox-detail">
                <h2>
                  {b.pageTitle}: {b.type === "rules" ? "School rules" : "Policies and notices"}
                </h2>
                {b.entries.map((e, i) => (
                  <details key={`${b.blockId}-${i}`}>
                    <summary>{e.title || "Untitled"}</summary>
                    <p style={{ whiteSpace: "pre-wrap" }}>{e.text}</p>
                  </details>
                ))}
                <button type="button" className="wf-inbox-button" disabled={busy} onClick={() => void save(acceptReview(doc, [b.blockId]), "Accepted.")}>
                  Accept
                </button>{" "}
                <button type="button" className="wf-inbox-button" disabled={busy} onClick={() => void save(removePending(doc, [b.blockId]), "Removed.")}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <p className="wf-inbox-subtitle">
            Accepting changes your draft only. Publish from the website builder when you are ready.
          </p>
        </>
      ) : null}
    </section>
  );
}
