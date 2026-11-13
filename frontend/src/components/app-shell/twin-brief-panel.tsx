import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, ShieldCheck, Sparkles } from "lucide-react";
import type { TwinBriefClient, TwinBriefDecision } from "@/lib/assistant/twin-brief-client";
import {
  buildBriefViewModel,
  cacheForContext,
  rejectionMessage,
  type BriefCache,
  type BriefViewModel,
  type CardViewModel,
} from "@/lib/assistant/twin-brief-model";
import "./twin-brief-panel.css";

interface TwinBriefPanelProps {
  readonly client: TwinBriefClient;
  /** Identity, organization and role in force. Empty until all three have loaded. */
  readonly contextKey: string;
  /** Test and fixture hooks; the real shell leaves both unset. */
  readonly clock?: () => number;
  readonly forceOnline?: boolean;
}

const TICK_MS = 60_000;

/** Pure presentation of a view model. Rendered on the server for tests and in the browser. */
export function TwinBriefView(props: {
  readonly model: BriefViewModel;
  readonly confirmingId: string | null;
  readonly busyId: string | null;
  readonly message: string | null;
  readonly onRefresh: () => void;
  readonly onDecide: (id: string, decision: TwinBriefDecision) => void;
  readonly onAskConfirm: (id: string | null) => void;
  readonly headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const { model } = props;
  return (
    <section
      className="twin-brief"
      aria-labelledby="twin-brief-heading"
      data-testid="twin-brief"
      data-status={model.status}
    >
      <header className="twin-brief-header">
        <Sparkles size={18} aria-hidden="true" />
        <div>
          <h2 id="twin-brief-heading" tabIndex={-1} ref={props.headingRef}>
            Your twin brief
          </h2>
          <p className="twin-brief-freshness" data-testid="twin-brief-freshness">
            {model.freshness ?? "Suggestions only. Nothing runs without your approval."}
          </p>
        </div>
        <button
          type="button"
          className="twin-brief-refresh"
          onClick={props.onRefresh}
          disabled={!model.canRefresh}
          aria-label="Refresh your twin brief"
        >
          <RefreshCw size={16} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </header>

      <div role="status" aria-live="polite" className="twin-brief-live">
        {model.banner ? (
          <p className={`twin-brief-banner is-${model.banner.tone}`}>{model.banner.text}</p>
        ) : null}
        {model.status === "loading" ? (
          <p className="twin-brief-muted">Loading your brief…</p>
        ) : null}
        {props.message ? <p className="twin-brief-message">{props.message}</p> : null}
      </div>

      {model.status === "empty" ? (
        <p className="twin-brief-empty">Nothing needs your attention right now.</p>
      ) : null}

      {model.cards.length ? (
        <ul className="twin-brief-list" aria-label="Brief items">
          {model.cards.map((card) => (
            <li key={card.proposalId}>
              <Card
                card={card}
                confirming={props.confirmingId === card.proposalId}
                busy={props.busyId === card.proposalId}
                onDecide={props.onDecide}
                onAskConfirm={props.onAskConfirm}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {model.footnote ? <p className="twin-brief-muted">{model.footnote}</p> : null}
    </section>
  );
}

function Card(props: {
  card: CardViewModel;
  confirming: boolean;
  busy: boolean;
  onDecide: (id: string, decision: TwinBriefDecision) => void;
  onAskConfirm: (id: string | null) => void;
}) {
  const { card } = props;
  const titleId = `twin-card-${card.proposalId}`;
  const reasonId = `${titleId}-reason`;
  const confirmRef = useRef<HTMLButtonElement>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  // Keep keyboard focus on the step the person is in: into the confirmation, then back to Approve on cancel.
  useEffect(() => {
    if (props.confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) approveRef.current?.focus();
    wasConfirming.current = props.confirming;
  }, [props.confirming]);
  const disabledReason = [card.approve, card.dismiss, card.acknowledge].find(
    (a) => !a.enabled && a.reason,
  )?.reason;
  return (
    <article className="twin-brief-card" aria-labelledby={titleId} data-testid="twin-brief-card">
      <p className="twin-brief-tag" id={titleId}>
        {card.label}
      </p>
      <p className="twin-brief-summary">{card.summary}</p>
      <p className={`twin-brief-source${card.sourceStale ? " is-stale" : ""}`}>
        {card.sourceLine}
        {card.sourceStale ? " · out of date" : ""}
      </p>
      {card.confidenceLine ? <p className="twin-brief-confidence">{card.confidenceLine}</p> : null}

      {props.confirming ? (
        <div className="twin-brief-confirm" role="group" aria-label="Confirm approval">
          <p>
            <ShieldCheck size={15} aria-hidden="true" /> Approve this? It runs through your normal
            permissions, and the server checks them again.
          </p>
          <div className="twin-brief-actions">
            <button
              type="button"
              className="is-primary"
              ref={confirmRef}
              disabled={props.busy}
              onClick={() => props.onDecide(card.proposalId, "approve")}
            >
              Confirm approval
            </button>
            <button type="button" onClick={() => props.onAskConfirm(null)} disabled={props.busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="twin-brief-actions">
          {!card.informationOnly ? (
            <button
              type="button"
              className="is-primary"
              ref={approveRef}
              disabled={!card.approve.enabled || props.busy}
              aria-describedby={card.approve.reason ? reasonId : undefined}
              aria-label={`Approve: ${card.summary}`}
              onClick={() => props.onAskConfirm(card.proposalId)}
            >
              Approve
            </button>
          ) : (
            <button
              type="button"
              disabled={!card.acknowledge.enabled || props.busy}
              aria-describedby={card.acknowledge.reason ? reasonId : undefined}
              aria-label={`Got it: ${card.summary}`}
              onClick={() => props.onDecide(card.proposalId, "acknowledge")}
            >
              Got it
            </button>
          )}
          <button
            type="button"
            disabled={!card.dismiss.enabled || props.busy}
            aria-describedby={card.dismiss.reason ? reasonId : undefined}
            aria-label={`Dismiss: ${card.summary}`}
            onClick={() => props.onDecide(card.proposalId, "dismiss")}
          >
            Dismiss
          </button>
        </div>
      )}
      {disabledReason ? (
        <p className="twin-brief-reason" id={reasonId}>
          {disabledReason}
        </p>
      ) : null}
    </article>
  );
}

export function TwinBriefPanel({ client, contextKey, clock, forceOnline }: TwinBriefPanelProps) {
  const now = clock ?? Date.now;
  const [cache, setCache] = useState<BriefCache | null>(null);
  const [loading, setLoading] = useState(false);
  const [serviceAvailable, setServiceAvailable] = useState(true);
  const [lastFetchFailed, setLastFetchFailed] = useState(false);
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [nowMs, setNowMs] = useState(() => now());
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const generation = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const effectiveOnline = forceOnline ?? online;

  const load = useCallback(async () => {
    const mine = generation.current;
    setLoading(true);
    const result = await client.fetchBrief();
    if (mine !== generation.current) return;
    setLoading(false);
    setNowMs(now());
    if (result.status === "available") {
      setServiceAvailable(true);
      setLastFetchFailed(false);
      setCache({ contextKey, fetchedAtMs: now(), brief: result.brief });
    } else if (result.status === "unavailable") {
      setServiceAvailable(false);
    } else {
      setServiceAvailable(true);
      setLastFetchFailed(true);
    }
  }, [client, contextKey, now]);

  // A new identity, organization or role starts from nothing: drop the cache and every pending step.
  useEffect(() => {
    generation.current += 1;
    setCache(null);
    setLoading(false);
    setServiceAvailable(true);
    setLastFetchFailed(false);
    setConfirmingId(null);
    setBusyId(null);
    setMessage(null);
    if (contextKey && effectiveOnline) void load();
    // `effectiveOnline` is deliberately not a dependency: reconnecting is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey, client]);

  useEffect(() => {
    const update = () => {
      setOnline(typeof navigator === "undefined" || navigator.onLine);
      setNowMs(now());
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    document.addEventListener("visibilitychange", update);
    const tick = window.setInterval(() => setNowMs(now()), TICK_MS);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      document.removeEventListener("visibilitychange", update);
      window.clearInterval(tick);
    };
  }, [now]);

  const decide = useCallback(
    async (proposalId: string, decision: TwinBriefDecision) => {
      const mine = generation.current;
      setBusyId(proposalId);
      setMessage(null);
      const result = await client.decide(proposalId, decision);
      if (mine !== generation.current) return;
      setBusyId(null);
      setConfirmingId(null);
      if (result.status === "ok") {
        setMessage("Your decision was recorded.");
        await load();
      } else if (result.status === "rejected") {
        setMessage(rejectionMessage(result.reason));
        await load();
      } else if (result.status === "unavailable") {
        setMessage("The service is not available yet. Nothing was changed.");
      } else {
        setMessage("Could not reach the server. Nothing was changed.");
      }
      headingRef.current?.focus();
    },
    [client, load],
  );

  const model = buildBriefViewModel({
    contextKey,
    online: effectiveOnline,
    loading,
    serviceAvailable,
    lastFetchFailed,
    cache: cacheForContext(cache, contextKey),
    nowMs,
  });

  return (
    <TwinBriefView
      model={model}
      confirmingId={confirmingId}
      busyId={busyId}
      message={message}
      onRefresh={() => void load()}
      onDecide={(id, d) => void decide(id, d)}
      onAskConfirm={setConfirmingId}
      headingRef={headingRef}
    />
  );
}
