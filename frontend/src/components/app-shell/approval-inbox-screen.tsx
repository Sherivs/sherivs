/**
 * WF-07: the tenant approval inbox (ADR-122), opened from the workspace shell at /home/s/approvals.
 *
 * Lazy-loaded from section-screen.tsx so the /home bundle does not grow. This screen only asks and
 * explains: who may decide, how many approvals are needed, whether a passkey is required and whether
 * the content changed are all decided by the database. A person the rules exclude sees why, a person
 * who has approved while more approvers are needed sees that the item is waiting for them, and a
 * high-risk approval asks for a passkey bound to the content digest shown here.
 */
import { useCallback, useEffect, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { Check, Fingerprint, RefreshCw, ShieldAlert, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { mapBrowserError } from "@/lib/auth/webauthn-client";
import { APP_SHELL_HOME } from "@/lib/shell/paths";
import {
  approvalDisplayState,
  approvalErrorMessage,
  currentApprovals,
  safeApprovalMessage,
  type ApprovalDetail,
  type ApprovalInboxFilter,
  type ApprovalInboxItem,
} from "@/lib/workflow/approval-inbox";
import { describeApprovalCategory, shortDigest } from "@/lib/workflow/approval-preview";
import {
  beginApprovalStepUp,
  decideApproval,
  getApprovalDetail,
  listApprovalInbox,
} from "@/lib/workflow-approvals.functions";
import "./approval-inbox.css";

function when(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString();
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for a decision",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  cancelled: "Cancelled",
};

type Phase = "idle" | "passkey" | "saving";

export default function ApprovalInboxScreen() {
  const [filter, setFilter] = useState<ApprovalInboxFilter>("pending");
  const [items, setItems] = useState<ApprovalInboxItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [note, setNote] = useState("");
  const [confirmReject, setConfirmReject] = useState(false);

  const loadList = useCallback(async (next: ApprovalInboxFilter) => {
    try {
      setItems(await listApprovalInbox({ data: { filter: next } }));
      setError(null);
    } catch (err) {
      setItems([]);
      setError(safeApprovalMessage(err));
    }
  }, []);

  const loadDetail = useCallback(async (approvalId: string) => {
    try {
      setDetail(await getApprovalDetail({ data: { approvalId } }));
      setError(null);
    } catch (err) {
      setDetail(null);
      setError(safeApprovalMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadList(filter);
  }, [filter, loadList]);

  useEffect(() => {
    setNote("");
    setConfirmReject(false);
    if (selected) void loadDetail(selected);
    else setDetail(null);
  }, [selected, loadDetail]);

  async function decide(decision: "approve" | "reject") {
    if (!detail) return;
    setError(null);
    setNotice(null);
    try {
      let proof: {
        nonce?: string;
        response?: Awaited<ReturnType<typeof startAuthentication>>;
      } = {};
      if (decision === "approve" && detail.stepUpRequired) {
        setPhase("passkey");
        let begun: Awaited<ReturnType<typeof beginApprovalStepUp>>;
        try {
          begun = await beginApprovalStepUp({ data: { approvalId: detail.approvalId } });
        } catch (err) {
          setError(safeApprovalMessage(err));
          return;
        }
        try {
          const response = await startAuthentication({ optionsJSON: begun.options });
          proof = { nonce: begun.nonce, response };
        } catch (err) {
          setError(mapBrowserError(err));
          return;
        }
      }
      setPhase("saving");
      const result = await decideApproval({
        data: {
          approvalId: detail.approvalId,
          decision,
          digest: detail.digest,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(proof.nonce && proof.response
            ? { nonce: proof.nonce, response: proof.response as never }
            : {}),
        },
      });
      if (result.status === "rejected") setNotice("Rejected. The workflow run was stopped.");
      else if (result.status === "approved") {
        setNotice(
          "Approved. The required approvals are recorded, and the action can now go ahead.",
        );
      } else {
        setNotice(
          `Your approval is recorded (${result.approvals} of ${result.required}). It is waiting for another approver.`,
        );
      }
    } catch (err) {
      setError(safeApprovalMessage(err));
    } finally {
      setPhase("idle");
      setConfirmReject(false);
      await loadList(filter);
      await loadDetail(detail.approvalId);
    }
  }

  const state = detail ? approvalDisplayState(detail) : null;
  const busy = phase !== "idle";

  return (
    <section className="wf-inbox" data-testid="approval-inbox">
      <Link to={APP_SHELL_HOME as never} className="app-shell-back">
        ← Home
      </Link>
      <header className="wf-inbox-heading">
        <div>
          <p className="wf-inbox-eyebrow">WORKFLOWS</p>
          <h1>Approvals</h1>
          <p className="wf-inbox-subtitle">
            Actions your workflows have drafted and need a person to approve. Money, safeguarding
            and large mass messages need two people, and each of them confirms with a passkey.
          </p>
        </div>
        <button
          type="button"
          className="wf-inbox-button"
          onClick={() => {
            void loadList(filter);
            if (selected) void loadDetail(selected);
          }}
          aria-label="Refresh approvals"
        >
          <RefreshCw size={16} aria-hidden="true" />
          Refresh
        </button>
      </header>

      <div className="wf-inbox-tabs" role="tablist" aria-label="Approval filter">
        {(["pending", "decided"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={filter === key ? "is-active" : ""}
            onClick={() => {
              setSelected(null);
              setFilter(key);
            }}
          >
            {key === "pending" ? "Waiting for a decision" : "Decided in the last 30 days"}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="wf-inbox-live">
        {notice ? <p className="wf-inbox-notice">{notice}</p> : null}
      </div>
      {error ? (
        <p role="alert" className="wf-inbox-error">
          {error}
        </p>
      ) : null}

      <div className="wf-inbox-layout">
        <ul className="wf-inbox-list" aria-label="Approvals">
          {items === null ? <li className="wf-inbox-empty">Loading approvals…</li> : null}
          {items !== null && items.length === 0 ? (
            <li className="wf-inbox-empty">
              {filter === "pending"
                ? "Nothing is waiting for a decision."
                : "No decisions in the last 30 days."}
            </li>
          ) : null}
          {(items ?? []).map((item) => (
            <li key={item.approvalId}>
              <button
                type="button"
                className={`wf-inbox-row${selected === item.approvalId ? " is-selected" : ""}`}
                onClick={() => setSelected(item.approvalId)}
                aria-current={selected === item.approvalId ? "true" : undefined}
              >
                <span className="wf-inbox-row-title">
                  {describeApprovalCategory(item.category)}
                  {item.actionKind ? ` · ${item.actionKind.replace(/_/g, " ")}` : ""}
                </span>
                <span className="wf-inbox-row-meta">
                  {item.workflow ? `${item.workflow} · ` : ""}
                  {item.status === "pending"
                    ? `Expires ${when(item.expiresAt)}`
                    : (STATUS_LABEL[item.status] ?? item.status)}
                </span>
                <span className="wf-inbox-row-tags">
                  {item.risk === "high" ? (
                    <span className="wf-inbox-tag is-high">
                      <ShieldAlert size={12} aria-hidden="true" /> High risk
                    </span>
                  ) : null}
                  <span className="wf-inbox-tag">
                    {item.approvals} of {item.required} approvals
                  </span>
                  {item.votedByMe ? <span className="wf-inbox-tag is-mine">You voted</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <article className="wf-inbox-detail" aria-live="polite">
          {!selected ? (
            <p className="wf-inbox-empty">Choose an item to review it.</p>
          ) : !detail ? (
            <p className="wf-inbox-empty">{error ? "" : "Loading…"}</p>
          ) : (
            <>
              <h2>{describeApprovalCategory(detail.category)}</h2>
              <p className="wf-inbox-summary">{detail.summary}</p>
              <p className="wf-inbox-meta">
                {STATUS_LABEL[detail.status] ?? detail.status} · requested{" "}
                {when(detail.requestedAt)}
                {detail.status === "pending" ? ` · expires ${when(detail.expiresAt)}` : ""}
              </p>

              {state?.kind === "waiting_for_others" ? (
                <p className="wf-inbox-banner" data-testid="approval-waiting">
                  Waiting for a second approver. {state.have} of {state.need} approvals are
                  recorded. Your decision is in; another person needs to decide before this can go
                  ahead.
                </p>
              ) : null}
              {state?.kind === "blocked" ? (
                <p className="wf-inbox-banner is-blocked" data-testid="approval-blocked">
                  {approvalErrorMessage(state.reason)}
                </p>
              ) : null}
              {state?.kind === "needs_step_up" ? (
                <p className="wf-inbox-banner is-high" data-testid="approval-step-up-note">
                  <Fingerprint size={16} aria-hidden="true" /> This is a high-risk item. To approve
                  it you confirm with your passkey, which is tied to the content fingerprint below.
                </p>
              ) : null}
              {detail.status === "pending" &&
              detail.required > 1 &&
              state?.kind !== "waiting_for_others" ? (
                <p className="wf-inbox-meta">
                  {detail.required} approvals are needed from {detail.required} different people;{" "}
                  {currentApprovals(detail)} recorded so far.
                </p>
              ) : null}

              {detail.draft ? (
                <section aria-label="What you are approving" className="wf-inbox-section">
                  <h3>What you are approving</h3>
                  {detail.preview?.text ? (
                    <blockquote className="wf-inbox-preview">{detail.preview.text}</blockquote>
                  ) : (
                    <p className="wf-inbox-meta">
                      The wording of this {detail.draft.kind.replace(/_/g, " ")} message is held
                      with your communications templates and is checked again when the action runs.
                      The fingerprint below covers the template reference and the values filled in.
                    </p>
                  )}
                  {detail.preview && detail.preview.unfilled.length > 0 ? (
                    <p className="wf-inbox-meta">
                      Not filled in: {detail.preview.unfilled.join(", ")}.
                    </p>
                  ) : null}
                  <dl className="wf-inbox-facts">
                    <div>
                      <dt>Channel</dt>
                      <dd>{detail.draft.kind.replace(/_/g, " ")}</dd>
                    </div>
                    <div>
                      <dt>Template</dt>
                      <dd>{detail.draft.templateRef ?? "none"}</dd>
                    </div>
                    <div>
                      <dt>Recipients</dt>
                      <dd>
                        {detail.draft.audience
                          ? detail.draft.audience.replace(/_/g, " ")
                          : `${detail.draft.recipientCount} ${detail.draft.recipientCount === 1 ? "person" : "people"}`}
                      </dd>
                    </div>
                    <div>
                      <dt>Data class</dt>
                      <dd>{detail.draft.dataClass.replace(/_/g, " ")}</dd>
                    </div>
                    <div>
                      <dt>Values supplied</dt>
                      <dd>{detail.draft.paramKeys.join(", ") || "none"}</dd>
                    </div>
                  </dl>
                </section>
              ) : null}

              <section aria-label="Content fingerprint" className="wf-inbox-section">
                <h3>Content fingerprint</h3>
                <p className="wf-inbox-meta">
                  Your decision is tied to this fingerprint. If the content changes after you open
                  it, you are asked to review it again.
                </p>
                <code className="wf-inbox-digest" data-testid="approval-digest">
                  {shortDigest(detail.digest)}
                </code>
                <details>
                  <summary>Show the full fingerprint</summary>
                  <code className="wf-inbox-digest-full">{detail.digest}</code>
                </details>
              </section>

              <section aria-label="Decisions so far" className="wf-inbox-section">
                <h3>Decisions so far</h3>
                {detail.votes.length === 0 ? (
                  <p className="wf-inbox-meta">No one has decided yet.</p>
                ) : (
                  <ul className="wf-inbox-votes">
                    {detail.votes.map((vote) => (
                      <li key={`${vote.approverRef}-${vote.decidedAt}`}>
                        {vote.mine ? "You" : `Approver ${vote.approverRef}`}{" "}
                        {vote.decision === "approve" ? "approved" : "rejected"} on{" "}
                        {when(vote.decidedAt)}
                        {vote.current ? "" : " (an earlier version of this content)"}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {detail.canDecide ? (
                <section aria-label="Your decision" className="wf-inbox-section">
                  <h3>Your decision</h3>
                  <label className="wf-inbox-note">
                    <span>Note (optional)</span>
                    <textarea
                      value={note}
                      maxLength={1000}
                      rows={2}
                      onChange={(event) => setNote(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                  {phase === "passkey" ? (
                    <p className="wf-inbox-banner" data-testid="approval-passkey-prompt">
                      <Fingerprint size={16} aria-hidden="true" /> Confirm with your passkey. Your
                      device will ask you to verify.
                    </p>
                  ) : null}
                  <div className="wf-inbox-actions">
                    <button
                      type="button"
                      className="wf-inbox-button is-primary"
                      disabled={busy}
                      onClick={() => void decide("approve")}
                    >
                      {detail.stepUpRequired ? (
                        <Fingerprint size={16} aria-hidden="true" />
                      ) : (
                        <Check size={16} aria-hidden="true" />
                      )}
                      {detail.stepUpRequired ? "Approve with passkey" : "Approve"}
                    </button>
                    {confirmReject ? (
                      <button
                        type="button"
                        className="wf-inbox-button is-danger"
                        disabled={busy}
                        onClick={() => void decide("reject")}
                      >
                        <X size={16} aria-hidden="true" />
                        Confirm: reject and stop the run
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="wf-inbox-button"
                        disabled={busy}
                        onClick={() => setConfirmReject(true)}
                      >
                        <X size={16} aria-hidden="true" />
                        Reject
                      </button>
                    )}
                  </div>
                </section>
              ) : null}
            </>
          )}
        </article>
      </div>
    </section>
  );
}
