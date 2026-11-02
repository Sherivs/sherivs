import { useEffect, useState } from "react";
import {
  getWhatsAppHealth,
  listWhatsAppRecipientLinkRequests,
  requestWhatsAppRecipientLink,
  reviewWhatsAppRecipientLink,
} from "@/lib/internal-console/whatsapp.functions";
import { useConsole } from "./console-shell";
import { ConsoleNotice } from "./console-primitives";

type Health = Awaited<ReturnType<typeof getWhatsAppHealth>>;
type RequestRow = {
  id: string;
  tenant_id: string;
  org_ref: string;
  principal_ref: string;
  address: string;
  consent_evidence: string;
  status: "pending" | "approved" | "rejected";
  requested_by: string;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

function timestamp(value: string | null): string {
  if (!value) return "No event recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unavailable" : date.toLocaleString();
}

export function WhatsAppOperationsScreen() {
  const { overview } = useConsole();
  const capabilities = overview?.viewer.capabilities ?? [];
  const canRead = capabilities.some((capability) =>
    ["platform.operations.read", "platform.tenants.manage"].includes(capability),
  );
  const canManage = capabilities.includes("platform.tenants.manage");
  const [health, setHealth] = useState<Health | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewTenantId, setReviewTenantId] = useState("");
  const [requestForm, setRequestForm] = useState({
    tenantId: "",
    orgRef: "",
    principalRef: "",
    address: "",
    consentEvidence: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(tenantId = reviewTenantId) {
    setBusy(true);
    setError(null);
    try {
      setHealth(await getWhatsAppHealth());
      if (canManage && tenantId.trim()) {
        setRequests(
          (await listWhatsAppRecipientLinkRequests({ data: { tenantId } })) as RequestRow[],
        );
      } else {
        setRequests([]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "WhatsApp operations could not load.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (canRead) void load();
    // Load only when the viewer's authorization is resolved or changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, canManage]);

  async function review(requestId: string, decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    try {
      await reviewWhatsAppRecipientLink({
        data: {
          tenantId: reviewTenantId,
          requestId,
          decision,
          reviewNote: reviewNote || undefined,
        },
      });
      setReviewNote("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "WhatsApp recipient-link review failed.");
    } finally {
      setBusy(false);
    }
  }

  if (!overview) {
    return (
      <section className="sherivs-console-card">
        <h1>WhatsApp operations</h1>
        <p>Loading authorization…</p>
      </section>
    );
  }
  if (!canRead) {
    return (
      <section className="sherivs-console-card">
        <h1>WhatsApp operations</h1>
        <p>WhatsApp health is limited to authorized platform operators.</p>
      </section>
    );
  }

  return (
    <section className="sherivs-console-card" data-testid="console-whatsapp-operations">
      <p className="sherivs-console-page-kicker">Communications</p>
      <h1>WhatsApp operations</h1>
      <p>Read-only gateway health and reviewed recipient-link requests.</p>
      {error ? <ConsoleNotice tone="error">{error}</ConsoleNotice> : null}
      <button
        type="button"
        className="sherivs-console-btn secondary"
        onClick={() => void load()}
        disabled={busy}
      >
        {busy ? "Refreshing…" : "Refresh"}
      </button>
      {health ? (
        <>
          <h2>Gateway health</h2>
          <dl>
            <dt>Token configured</dt>
            <dd>{health.configured.token ? "Yes" : "No"}</dd>
            <dt>Phone number ID configured</dt>
            <dd>{health.configured.phoneNumberId ? "Yes" : "No"}</dd>
            <dt>App secret configured</dt>
            <dd>{health.configured.appSecret ? "Yes" : "No"}</dd>
            <dt>Verify token configured</dt>
            <dd>{health.configured.verifyToken ? "Yes" : "No"}</dd>
            <dt>Graph API version explicitly configured</dt>
            <dd>{health.configured.graphVersion ? "Yes" : "No (defaults to v21.0)"}</dd>
            <dt>Automatic acknowledgement enabled</dt>
            <dd>{health.configured.autoAck ? "Yes" : "No"}</dd>
            <dt>Mapped sender count</dt>
            <dd>{health.mappedSenderCount}</dd>
            <dt>Unmapped sender count</dt>
            <dd>{health.unmappedSenderCount}</dd>
            <dt>Last inbound</dt>
            <dd>{timestamp(health.lastInboundAt)}</dd>
            <dt>Last delivery status</dt>
            <dd>{timestamp(health.lastStatusAt)}</dd>
          </dl>
        </>
      ) : null}
      {canManage ? (
        <>
          <h2>Recipient-link review</h2>
          <p>
            Submit a request for an existing organization member with recorded consent evidence.
            Approval records opt-in and requires a different reviewer with step-up authentication.
            This does not provision an account.
          </p>
          <form
            className="sherivs-console-form"
            onSubmit={(event) => {
              event.preventDefault();
              setBusy(true);
              setError(null);
              void requestWhatsAppRecipientLink({ data: requestForm })
                .then(() => {
                  setRequestForm({
                    tenantId: requestForm.tenantId,
                    orgRef: "",
                    principalRef: "",
                    address: "",
                    consentEvidence: "",
                  });
                  return load();
                })
                .catch((reason: unknown) =>
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "WhatsApp recipient-link request failed.",
                  ),
                )
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Tenant ID
              <input
                required
                maxLength={128}
                value={requestForm.tenantId}
                onChange={(event) => {
                  setRequestForm((current) => ({ ...current, tenantId: event.target.value }));
                  setReviewTenantId(event.target.value);
                }}
              />
            </label>
            <label>
              Organization reference
              <input
                required
                maxLength={160}
                value={requestForm.orgRef}
                onChange={(event) =>
                  setRequestForm((current) => ({ ...current, orgRef: event.target.value }))
                }
              />
            </label>
            <label>
              Existing principal reference
              <input
                required
                maxLength={160}
                value={requestForm.principalRef}
                onChange={(event) =>
                  setRequestForm((current) => ({ ...current, principalRef: event.target.value }))
                }
              />
            </label>
            <label>
              WhatsApp address
              <input
                required
                type="tel"
                autoComplete="off"
                maxLength={16}
                pattern="\+?[1-9][0-9]{7,14}"
                value={requestForm.address}
                onChange={(event) =>
                  setRequestForm((current) => ({ ...current, address: event.target.value }))
                }
              />
            </label>
            <label>
              Consent evidence
              <textarea
                required
                maxLength={500}
                value={requestForm.consentEvidence}
                onChange={(event) =>
                  setRequestForm((current) => ({ ...current, consentEvidence: event.target.value }))
                }
              />
            </label>
            <button type="submit" className="sherivs-console-btn" disabled={busy}>
              Submit for review
            </button>
          </form>
          <label>
            Review note
            <textarea
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              maxLength={500}
            />
          </label>
          {requests.length ? (
            <div style={{ overflowX: "auto" }}>
              <table className="sherivs-console-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Principal</th>
                    <th>WhatsApp address</th>
                    <th>Consent evidence</th>
                    <th>Request</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => (
                    <tr key={request.id}>
                      <td>{request.org_ref}</td>
                      <td>{request.principal_ref}</td>
                      <td>{request.address}</td>
                      <td>{request.consent_evidence}</td>
                      <td>
                        {request.status} by {request.requested_by}
                        <br />
                        {timestamp(request.requested_at)}
                      </td>
                      <td>
                        {request.status === "pending" ? (
                          <div className="sherivs-console-actions">
                            <button
                              type="button"
                              className="sherivs-console-btn"
                              disabled={busy}
                              onClick={() => void review(request.id, "approved")}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="sherivs-console-btn secondary"
                              disabled={busy}
                              onClick={() => void review(request.id, "rejected")}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <>
                            {request.reviewed_by ?? "Unknown reviewer"}
                            <br />
                            {timestamp(request.reviewed_at)}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No recipient-link requests are recorded.</p>
          )}
        </>
      ) : null}
    </section>
  );
}
