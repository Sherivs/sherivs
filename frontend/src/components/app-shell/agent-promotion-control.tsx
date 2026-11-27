/**
 * A4: "Promote with passkey" for one agent, shown to the founder only when the latest evaluation meets the bar.
 * The screen asks; the database decides. The passkey is bound to this one promotion (A3, ADR-138).
 */
import { useState } from "react";
import { startAuthentication } from "@simplewebauthn/browser";
import { mapBrowserError } from "@/lib/auth/webauthn-client";
import { AGENT_LEVEL_LABELS, type AutonomyLevel } from "@/lib/workflow/agent-console";
import { reasonProblem } from "@/lib/workflow/agent-promotion";
import {
  beginAgentPromotion,
  finishAgentPromotion,
  latestPromotionEvidence,
} from "@/lib/workflow/agent-promotion.functions";

type Level = "draft" | "act_with_approval" | "act_and_report";

export function AgentPromotionControl(props: {
  orgId: string;
  agentRef: string;
  codename: string;
  to: AutonomyLevel;
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = reasonProblem(reason);

  async function run() {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { evidenceId } = await latestPromotionEvidence({ data: { agentRef: props.agentRef } });
      const request = {
        orgId: props.orgId,
        agentRef: props.agentRef,
        toLevel: props.to as Level,
        evidenceId,
        reason: reason.trim(),
      };
      const begun = await beginAgentPromotion({ data: request });
      let response: Awaited<ReturnType<typeof startAuthentication>>;
      try {
        response = await startAuthentication({ optionsJSON: begun.options as never });
      } catch (err) {
        setError(mapBrowserError(err));
        return;
      }
      await finishAgentPromotion({
        data: { request, nonce: begun.nonce, response: response as never },
      });
      setOpen(false);
      setReason("");
      props.onDone(`${props.codename} now works at ${AGENT_LEVEL_LABELS[props.to]}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The promotion could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="wf-inbox-button" onClick={() => setOpen(true)}>
        Promote to {AGENT_LEVEL_LABELS[props.to]}
      </button>
    );
  }
  return (
    <div role="group" aria-label={`Promote ${props.codename}`} className="wf-inbox-confirm">
      <label>
        Why this agent has earned it (10 to 300 characters)
        <textarea value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
      </label>
      {reason && problem ? <p role="alert">{problem}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <button
        type="button"
        className="wf-inbox-button"
        disabled={busy || problem !== null}
        onClick={() => void run()}
      >
        {busy ? "Waiting for your passkey…" : "Promote with passkey"}
      </button>
      <button
        type="button"
        className="wf-inbox-button"
        disabled={busy}
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>
    </div>
  );
}
