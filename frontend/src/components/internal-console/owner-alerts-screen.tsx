import { useCallback, useEffect, useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { ConsoleNotice } from "./console-primitives";
import {
  acknowledgeOwnerAlert,
  beginOwnerApprovalStepUp,
  decideOwnerApproval,
  loadOwnerConsole,
  type OwnerConsoleView,
} from "@/lib/jarvis-bridge/owner-console.functions";
import { mapBrowserError } from "@/lib/auth/webauthn-client";

const SEVERITY_LABEL: Record<string, string> = {
  S1: "S1 · Critical",
  S2: "S2 · High",
  S3: "S3 · Medium",
  S4: "S4 · Low",
};

const CODE_MESSAGE: Record<string, string> = {
  passkey_step_up_required: "A passkey check is required to approve this.",
  role_insufficient: "Only the sheriff can approve this.",
  self_approval_forbidden: "The requester cannot approve its own request.",
  already_decided: "This request was already decided.",
  expired: "This request has expired.",
  not_found: "This request no longer exists.",
  store_unavailable: "The approval store is unavailable. Nothing was changed.",
};

function when(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString();
}

export function OwnerAlertsScreen() {
  const [view, setView] = useState<OwnerConsoleView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setView(await loadOwnerConsole());
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error && err.message === "Not authorized"
          ? "This screen is for the sheriff only."
          : "Alerts could not be loaded.",
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function acknowledge(alertId: string) {
    setBusy(alertId);
    try {
      await acknowledgeOwnerAlert({ data: { alertId } });
      setNotice("Alert acknowledged. JARVIS will stop reminding you about it.");
      await refresh();
    } catch {
      setError("The alert could not be acknowledged.");
    } finally {
      setBusy(null);
    }
  }

  async function decide(approvalId: string, decision: "approve" | "deny") {
    setBusy(approvalId);
    setError(null);
    setNotice(null);
    try {
      let proof: { nonce?: string; response?: Awaited<ReturnType<typeof startAuthentication>> } =
        {};
      if (decision === "approve") {
        const begun = await beginOwnerApprovalStepUp({ data: { approvalId, decision } });
        const response = await startAuthentication({ optionsJSON: begun.options });
        proof = { nonce: begun.nonce, response };
      }
      const result = await decideOwnerApproval({
        data: { approvalId, decision, nonce: proof.nonce, response: proof.response as never },
      });
      if (result.ok) {
        setNotice(decision === "approve" ? "Approved with your passkey." : "Denied.");
      } else {
        setError(CODE_MESSAGE[result.code] ?? "The decision was refused. Nothing was changed.");
      }
      await refresh();
    } catch (err) {
      setError(mapBrowserError(err));
    } finally {
      setBusy(null);
    }
  }

  if (!view && !error) return <section className="sherivs-console-card">Loading alerts…</section>;
  if (!view) {
    return (
      <section className="sherivs-console-card">
        <h1>Alerts and approvals</h1>
        <ConsoleNotice tone="error">{error}</ConsoleNotice>
      </section>
    );
  }

  const openAlerts = view.alerts.filter((a) => a.status === "open");
  const closedAlerts = view.alerts.filter((a) => a.status !== "open");

  return (
    <section className="sherivs-console-card" aria-labelledby="owner-alerts-title">
      <h1 id="owner-alerts-title">Alerts and approvals</h1>
      {error ? <ConsoleNotice tone="error">{error}</ConsoleNotice> : null}
      {notice ? <ConsoleNotice>{notice}</ConsoleNotice> : null}

      {!view.storeReady ? (
        <ConsoleNotice tone="warning">
          The alert store is not set up yet, so JARVIS cannot raise alerts. Approvals below still
          work.
        </ConsoleNotice>
      ) : null}

      <h2>Waiting for your decision</h2>
      {view.passkeyCount === 0 ? (
        <ConsoleNotice tone="warning">
          You have no passkey enrolled. You can deny a request, but approving needs a passkey. Add
          one in Account settings first.
        </ConsoleNotice>
      ) : null}
      {view.approvals.length === 0 ? (
        <p>Nothing is waiting for approval.</p>
      ) : (
        <ul aria-label="Pending approvals">
          {view.approvals.map((a) => (
            <li key={a.approvalId}>
              <strong>{a.actionId}</strong> · {a.riskTier} · requested by {a.requesterRef}
              <br />
              <small>Expires {when(a.expiresAt)}</small>
              <div role="group" aria-label={`Decide ${a.actionId}`}>
                <button
                  type="button"
                  disabled={busy === a.approvalId || view.passkeyCount === 0}
                  onClick={() => void decide(a.approvalId, "approve")}
                >
                  Approve with passkey
                </button>{" "}
                <button
                  type="button"
                  disabled={busy === a.approvalId}
                  onClick={() => void decide(a.approvalId, "deny")}
                >
                  Deny
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <h2>Open alerts</h2>
      {openAlerts.length === 0 ? (
        <p>No open alerts.</p>
      ) : (
        <ul aria-label="Open alerts">
          {openAlerts.map((a) => (
            <li key={a.id}>
              <strong>{SEVERITY_LABEL[a.severity] ?? a.severity}</strong> · {a.title}
              <br />
              <small>
                {when(a.createdAt)} · {a.source}
              </small>
              <ul aria-label="Delivery">
                {a.deliveries.slice(0, 8).map((d, i) => (
                  <li key={`${d.channel}-${i}`}>
                    {d.channel}: {d.status}
                    {d.kind === "test_sink" ? " (test only, nothing was sent)" : ""}
                    {d.reason ? ` — ${d.reason.replace(/_/g, " ")}` : ""}
                  </li>
                ))}
              </ul>
              <button type="button" disabled={busy === a.id} onClick={() => void acknowledge(a.id)}>
                Acknowledge
              </button>
            </li>
          ))}
        </ul>
      )}

      {closedAlerts.length > 0 ? (
        <>
          <h2>Earlier</h2>
          <ul aria-label="Earlier alerts">
            {closedAlerts.slice(0, 10).map((a) => (
              <li key={a.id}>
                {SEVERITY_LABEL[a.severity] ?? a.severity} · {a.title} · {a.status}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h2>Delivery gateway</h2>
      {view.gateway ? (
        <>
          <p>
            Mode: <strong>{view.gateway.mode === "live" ? "Live" : "Test"}</strong>
            {view.gateway.mode === "test"
              ? " — alerts reach this console only; phone, WhatsApp, SMS and email go to test sinks."
              : view.gateway.liveAuthorizationExpiresAt
                ? ` — authorized until ${when(view.gateway.liveAuthorizationExpiresAt)}.`
                : ""}
          </p>
          <ul aria-label="Channels">
            {["voice", "whatsapp", "sms", "email"].map((c) => (
              <li key={c}>
                {c}: {view.gateway?.channels[c] ? "switched on" : "switched off"}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>Gateway settings are not available yet.</p>
      )}
    </section>
  );
}
