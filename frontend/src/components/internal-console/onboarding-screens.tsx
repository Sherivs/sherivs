/**
 * M6 (mission E-016, ADR-117) — /console/onboarding: the onboarding request queue and the review
 * screen (interview answers read-only, generated plan, plan under review, diff, staff edits,
 * assign to self, and approve-and-provision with a passkey bound to the plan hash).
 *
 * Presentation only: every permission, hash and state rule is enforced on the server and in the
 * database. Buttons that the server would refuse are hidden or disabled to save a round trip.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { startAuthentication } from "@simplewebauthn/browser";
import { CONSOLE_PATHS } from "@/lib/internal-console/paths";
import { mapBrowserError } from "@/lib/auth/webauthn-client";
import type { OnboardingRequestStatus } from "@/lib/onboarding/plan-review";
import {
  approveAndProvisionOnboarding,
  assignOnboardingRequestToSelf,
  beginOnboardingApproval,
  generateOnboardingPlan,
  loadOnboardingQueue,
  loadOnboardingRequest,
  saveOnboardingPlanEdit,
} from "@/lib/internal-console/onboarding-queue.functions";
import { ConsoleNotice } from "./console-primitives";

type QueueView = Awaited<ReturnType<typeof loadOnboardingQueue>>;
type RequestDetailView = Awaited<ReturnType<typeof loadOnboardingRequest>>;

export const ONBOARDING_STATUS_LABELS: Record<OnboardingRequestStatus, string> = {
  new: "New",
  in_interview: "In interview",
  plan_ready: "Plan ready",
  under_review: "Under review",
  approved: "Approved",
  provisioned: "Provisioned",
  rejected: "Rejected",
};

/** Stable server codes to plain sentences. */
export const ONBOARDING_ERROR_MESSAGES: Record<string, string> = {
  not_authorized: "You do not have the console role for this action.",
  not_found: "This request no longer exists.",
  stale: "The plan changed since you loaded it. Reload and review it again.",
  stale_plan: "The plan changed since you reviewed it. Nothing was provisioned.",
  invalid_plan: "The plan is not valid. Fix the listed problems first.",
  interview_incomplete: "The interview is not complete yet.",
  not_awaiting_approval: "This request is not waiting for approval.",
  editor_cannot_approve: "You edited this plan, so another manager must approve it.",
  mfa_required: "Approving needs a session with two-factor sign-in.",
  step_up_failed: "The passkey check failed. Nothing was approved.",
  not_allowed: "Provisioning was refused for your role. Nothing was created.",
  incomplete_organization:
    "Provisioning stopped because a required record was missing. Nothing was created.",
  conflict: "A name or address is already taken. Nothing was created.",
  unavailable: "The service is unavailable. Nothing was changed.",
};

export function onboardingErrorMessage(err: unknown): string {
  const code = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return ONBOARDING_ERROR_MESSAGES[code] ?? ONBOARDING_ERROR_MESSAGES.unavailable;
}

function StatusPill({ status }: { status: OnboardingRequestStatus }) {
  return (
    <span className={`sherivs-console-pill is-${status}`}>{ONBOARDING_STATUS_LABELS[status]}</span>
  );
}

function Mono({ children }: { children: string }) {
  return (
    <code style={{ fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
      {children}
    </code>
  );
}

function pretty(v: unknown): string {
  return v === undefined ? "" : JSON.stringify(v, null, 2);
}

export function ConsoleOnboardingQueue() {
  const [view, setView] = useState<QueueView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadOnboardingQueue()
      .then((v) => setView(v as QueueView))
      .catch((err) => setError(onboardingErrorMessage(err)));
  }, []);

  return (
    <section className="sherivs-console-card" aria-labelledby="onboarding-queue-title">
      <h1 id="onboarding-queue-title">Onboarding requests</h1>
      <p>
        Requests from the public interview. Review the plan, then approve it with your passkey to
        provision the organization in one step.
      </p>
      {error ? <ConsoleNotice tone="error">{error}</ConsoleNotice> : null}
      {!view && !error ? <p>Loading requests…</p> : null}
      {view && view.rows.length === 0 ? (
        <p className="sherivs-console-empty">No onboarding requests yet.</p>
      ) : null}
      {view && view.rows.length > 0 ? (
        <div style={{ overflowX: "auto", marginTop: "1rem" }}>
          <table className="sherivs-console-table">
            <caption className="sr-only">Onboarding requests, most urgent first</caption>
            <thead>
              <tr>
                <th scope="col">Organization</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Age</th>
                <th scope="col">Assigned</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link to={CONSOLE_PATHS.onboardingRequest(row.id) as never}>{row.orgName}</Link>
                  </td>
                  <td>
                    <Mono>{row.institutionType}</Mono>
                  </td>
                  <td>
                    <StatusPill status={row.status} />
                  </td>
                  <td>{row.age}</td>
                  <td>{row.assignedToMe ? "You" : (row.assignedStaffName ?? "Unassigned")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function ConsoleOnboardingRequest() {
  const { requestId } = useParams({ strict: false }) as { requestId: string };
  const [view, setView] = useState<RequestDetailView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [issues, setIssues] = useState<readonly string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const v = (await loadOnboardingRequest({ data: { requestId } })) as RequestDetailView;
      setView(v);
      setDraft(pretty(v.plan.underReview));
      setError(null);
    } catch (err) {
      setError(onboardingErrorMessage(err));
    }
  }, [requestId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (err) {
      setError(mapStepUpOrServerError(err));
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return (
      <section className="sherivs-console-card">
        <h1>Onboarding request</h1>
        {error ? <ConsoleNotice tone="error">{error}</ConsoleNotice> : <p>Loading…</p>}
      </section>
    );
  }

  const closed = view.status === "provisioned" || view.status === "rejected";

  return (
    <section className="sherivs-console-card" aria-labelledby="onboarding-request-title">
      <p>
        <Link to={CONSOLE_PATHS.onboarding as never}>All onboarding requests</Link>
      </p>
      <h1 id="onboarding-request-title">{view.orgName}</h1>
      <p>
        <StatusPill status={view.status} /> · <Mono>{view.institutionType}</Mono> · {view.age} old ·{" "}
        {view.assignedToMe
          ? "Assigned to you"
          : view.assignedStaffName
            ? `Assigned to ${view.assignedStaffName}`
            : "Unassigned"}
      </p>
      {error ? <ConsoleNotice tone="error">{error}</ConsoleNotice> : null}
      {notice ? <ConsoleNotice>{notice}</ConsoleNotice> : null}

      <div className="sherivs-console-actions">
        {!closed && (view.can.handle || view.can.manage) && !view.assignedToMe ? (
          <button
            type="button"
            className="sherivs-console-btn secondary"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await assignOnboardingRequestToSelf({ data: { requestId } });
                setNotice("Assigned to you.");
                await refresh();
              })
            }
          >
            Assign to me
          </button>
        ) : null}
        {!closed && view.can.handle && view.interview?.completed ? (
          <button
            type="button"
            className="sherivs-console-btn secondary"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await generateOnboardingPlan({
                  data: { requestId, expectedRevision: view.plan.revision },
                });
                setNotice("Plan generated from the interview answers.");
                await refresh();
              })
            }
          >
            {view.plan.generated ? "Regenerate plan" : "Generate plan"}
          </button>
        ) : null}
      </div>

      <h2>Request</h2>
      <dl className="sherivs-console-dl">
        <dt>Location</dt>
        <dd>{[view.lga, view.state].filter(Boolean).join(", ") || "Not given"}</dd>
        <dt>Contact</dt>
        <dd>
          {view.contact.name}
          {view.contact.role ? ` (${view.contact.role})` : ""} · {view.contact.email}
          {view.contact.phone ? ` · ${view.contact.phone}` : ""}
        </dd>
        <dt>Source</dt>
        <dd>{view.source}</dd>
        <dt>Received</dt>
        <dd>{new Date(view.createdAt).toLocaleString()}</dd>
        {view.note ? (
          <>
            <dt>Note</dt>
            <dd>{view.note}</dd>
          </>
        ) : null}
      </dl>

      <h2>Interview answers (read-only)</h2>
      {!view.interview ? (
        <p>No interview session.</p>
      ) : (
        <>
          <p>
            Graph <Mono>{view.interview.graphVersion}</Mono> · {view.interview.completionPct}% ·{" "}
            {view.interview.completed ? "completed" : "not completed"}
          </p>
          <div style={{ overflowX: "auto" }}>
            <table className="sherivs-console-table">
              <thead>
                <tr>
                  <th scope="col">Question</th>
                  <th scope="col">Class</th>
                  <th scope="col">Answer</th>
                </tr>
              </thead>
              <tbody>
                {view.interview.answers.map((a) => (
                  <tr key={a.questionId}>
                    <td>
                      <Mono>{a.questionId}</Mono>
                    </td>
                    <td>{a.dataClass ?? "unknown"}</td>
                    <td>
                      <Mono>{Array.isArray(a.value) ? a.value.join(", ") : String(a.value)}</Mono>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2>Plan</h2>
      {!view.plan.underReview ? (
        <p>No plan yet. Generate it once the interview is complete.</p>
      ) : (
        <>
          <p>
            Revision {view.plan.revision} · hash <Mono>{view.plan.hash ?? ""}</Mono>
            {view.plan.edited
              ? view.plan.editedByMe
                ? " · edited by you"
                : " · edited by staff"
              : " · as generated"}
          </p>
          {view.plan.issues.length > 0 ? (
            <ConsoleNotice tone="warning">
              Cannot be provisioned yet: {view.plan.issues.join("; ")}
            </ConsoleNotice>
          ) : null}

          <h3>Changes from the generated plan</h3>
          {view.plan.diff.length === 0 ? (
            <p>None. The plan under review is the generated plan.</p>
          ) : (
            <ul aria-label="Plan changes">
              {view.plan.diff.map((d) => (
                <li key={`${d.kind}:${d.path}:${JSON.stringify(d.after)}`}>
                  <strong>{d.kind}</strong> <Mono>{d.path}</Mono>
                  {d.kind !== "added" ? (
                    <>
                      {" "}
                      from <Mono>{JSON.stringify(d.before)}</Mono>
                    </>
                  ) : null}
                  {d.kind !== "removed" ? (
                    <>
                      {" "}
                      to <Mono>{JSON.stringify(d.after)}</Mono>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <details>
            <summary>Generated plan</summary>
            <pre className="sherivs-console-pre">{pretty(view.plan.generated)}</pre>
          </details>

          {!closed && view.can.handle ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  let parsed: unknown;
                  try {
                    parsed = JSON.parse(draft);
                  } catch {
                    setIssues(["The plan is not valid JSON."]);
                    return;
                  }
                  const result = (await saveOnboardingPlanEdit({
                    data: { requestId, expectedRevision: view.plan.revision, plan: parsed },
                  })) as { invalid?: readonly string[] };
                  if (result.invalid) {
                    setIssues(result.invalid);
                    return;
                  }
                  setIssues([]);
                  setNotice("Edit saved. Any earlier approval was withdrawn.");
                  await refresh();
                });
              }}
            >
              <label htmlFor="plan-editor">
                <h3>Plan under review (edit as JSON)</h3>
              </label>
              <textarea
                id="plan-editor"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={20}
                spellCheck={false}
                style={{ width: "100%", fontFamily: "ui-monospace, monospace" }}
                aria-describedby={issues.length ? "plan-editor-issues" : undefined}
              />
              {issues.length ? (
                <ul id="plan-editor-issues" role="alert">
                  {issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              ) : null}
              <button type="submit" className="sherivs-console-btn secondary" disabled={busy}>
                Save edit
              </button>
            </form>
          ) : (
            <details open>
              <summary>Plan under review</summary>
              <pre className="sherivs-console-pre">{pretty(view.plan.underReview)}</pre>
            </details>
          )}
        </>
      )}

      <h2>Approval and provisioning</h2>
      {view.approval.approvedHash ? (
        <p>
          Approved by {view.approval.approvedByName ?? "staff"}
          {view.approval.approvedAt
            ? ` on ${new Date(view.approval.approvedAt).toLocaleString()}`
            : ""}{" "}
          for hash <Mono>{view.approval.approvedHash}</Mono>.
        </p>
      ) : (
        <p>Not approved.</p>
      )}
      {view.provisioned.organizationId ? (
        <>
          <p>
            Provisioned as organization <Mono>{view.provisioned.organizationId}</Mono>.
          </p>
          <details>
            <summary>Applied result</summary>
            <pre className="sherivs-console-pre">{pretty(view.provisioned.appliedResult)}</pre>
          </details>
        </>
      ) : null}
      {!closed && view.can.manage && view.plan.hash ? (
        view.can.approve ? (
          <button
            type="button"
            className="sherivs-console-btn"
            disabled={busy}
            onClick={() =>
              act(async () => {
                const planHash = view.plan.hash as string;
                const begun = (await beginOnboardingApproval({
                  data: { requestId, planHash },
                })) as {
                  options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
                  nonce: string;
                };
                const response = await startAuthentication({ optionsJSON: begun.options });
                const result = (await approveAndProvisionOnboarding({
                  data: { requestId, planHash, nonce: begun.nonce, response: response as never },
                })) as { ok: boolean; code?: string; replay?: boolean };
                if (!result.ok) {
                  setError(onboardingErrorMessage(result.code ?? "unavailable"));
                } else {
                  setNotice(
                    result.replay
                      ? "Already provisioned. Nothing new was created."
                      : "Approved with your passkey and provisioned.",
                  );
                }
                await refresh();
              })
            }
          >
            Approve with passkey and provision
          </button>
        ) : (
          <ConsoleNotice tone="warning">
            {view.plan.editedByMe
              ? ONBOARDING_ERROR_MESSAGES.editor_cannot_approve
              : "This plan cannot be approved yet."}
          </ConsoleNotice>
        )
      ) : null}
    </section>
  );
}

function mapStepUpOrServerError(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  if (message in ONBOARDING_ERROR_MESSAGES) return ONBOARDING_ERROR_MESSAGES[message];
  if (err instanceof Error && (err.name === "NotAllowedError" || err.name === "AbortError"))
    return mapBrowserError(err);
  return ONBOARDING_ERROR_MESSAGES.unavailable;
}
