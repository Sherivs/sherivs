/**
 * SV1-REALITY R9 (#335) — "Start your public website" step on the School setup screen.
 *
 * Separate from approving the interview: approving never publishes. This panel shows exactly
 * which approved, public-safe answers will be used, and publishes only after a second,
 * explicit confirmation. All wording is for a school administrator, not an engineer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, RefreshCw } from "lucide-react";
import {
  previewWebsiteFromReality,
  publishWebsiteFromReality,
  type WebsiteSyncPreview,
  type WebsiteSyncPublish,
} from "@/lib/runtime/scholar/reality-website.functions";

type Ready = Extract<WebsiteSyncPreview, { status: "ready" }>;

/** Plain names for the public-site field keys; an unknown key is shown as a generic phrase. */
const WEBSITE_FIELD_LABEL: Readonly<Record<string, string>> = {
  institution_type: "Type of school",
  levels_offered: "Levels offered",
  campus_count: "Number of campuses",
  streams_offered: "Senior streams",
  examinations: "External examinations",
};
const fieldLabel = (key: string): string =>
  Object.prototype.hasOwnProperty.call(WEBSITE_FIELD_LABEL, key)
    ? WEBSITE_FIELD_LABEL[key]
    : "Another approved answer";

export type PanelState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "preview"; readonly preview: Ready }
  | { readonly kind: "blocked"; readonly status: Exclude<WebsiteSyncPreview["status"], "ready"> }
  | { readonly kind: "done"; readonly result: WebsiteSyncPublish };

export interface WebsiteSyncPanelViewProps {
  readonly state: PanelState;
  readonly confirming: boolean;
  readonly busy: boolean;
  readonly onAsk: () => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onRefresh: () => void;
}

const BLOCKED_TEXT: Record<Exclude<WebsiteSyncPreview["status"], "ready">, string> = {
  not_approved: "Approve your answers first. Then you can start your website from them.",
  website_exists:
    "Your school already has a website, so nothing was changed. This step never replaces an existing website. Use the website builder to edit it.",
  invalid:
    "A website could not be built from these answers yet. Nothing was published and nothing was changed.",
  not_allowed: "Your account is not allowed to manage the website, so nothing was changed.",
};

const DONE_TEXT = (r: WebsiteSyncPublish): { tone: "ok" | "info" | "error"; text: string } => {
  switch (r.status) {
    case "published":
      return {
        tone: "ok",
        text: `Your website was created and published (version ${r.version}). You can keep editing it in the website builder.`,
      };
    case "saved_not_published":
      return {
        tone: "error",
        text: "Your website was created as a draft, but it could not be published. Open the website builder to publish it.",
      };
    case "stale":
      return {
        tone: "info",
        text: "Your answers or website changed since this preview. Nothing was published. Check the new preview below.",
      };
    default:
      return { tone: "info", text: BLOCKED_TEXT[r.status] };
  }
};

export function WebsiteSyncPanelView(props: WebsiteSyncPanelViewProps) {
  const { state } = props;
  const askRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (props.confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) askRef.current?.focus();
    wasConfirming.current = props.confirming;
  }, [props.confirming]);

  return (
    <section
      className="interview-card"
      aria-labelledby="website-sync-heading"
      aria-busy={state.kind === "loading" || props.busy}
      data-testid="website-sync"
      data-status={state.kind === "preview" ? "ready" : state.kind}
    >
      <h2 id="website-sync-heading" className="website-sync-title">
        <Globe size={18} aria-hidden="true" /> Start your public website
      </h2>

      {state.kind === "loading" ? <p role="status">Checking what your website can use…</p> : null}

      {state.kind === "error" ? (
        <>
          <p role="alert">
            We could not check your website. You need a school administrator account, and you need
            to be online. Nothing was changed.
          </p>
          <div className="interview-actions">
            <button type="button" onClick={props.onRefresh}>
              <RefreshCw size={14} aria-hidden="true" /> Try again
            </button>
          </div>
        </>
      ) : null}

      {state.kind === "blocked" ? (
        <p role="status" data-testid="website-sync-blocked">
          {BLOCKED_TEXT[state.status]}
        </p>
      ) : null}

      {state.kind === "done" ? (
        <>
          <p
            role={DONE_TEXT(state.result).tone === "error" ? "alert" : "status"}
            className={`interview-message is-${DONE_TEXT(state.result).tone}`}
            data-testid="website-sync-result"
          >
            {DONE_TEXT(state.result).text}
          </p>
          {state.result.status === "stale" ? (
            <div className="interview-actions">
              <button type="button" onClick={props.onRefresh}>
                <RefreshCw size={14} aria-hidden="true" /> Check again
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {state.kind === "preview" ? (
        <>
          <p>
            Approving your answers did not publish anything. This is a separate step: only the
            answers listed below are used, and nothing is published until you confirm.
          </p>

          <div>
            <h3>Will be used</h3>
            {state.preview.applied.length > 0 ? (
              <ul className="interview-blockers" data-testid="website-sync-applied">
                {state.preview.applied.map((a) => (
                  <li key={a.questionId}>
                    <strong>{fieldLabel(a.websiteField)}:</strong> {a.summary}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                None of your approved answers change the website yet. A website can still be created
                from the information your school already has.
              </p>
            )}
          </div>

          {state.preview.notSupported.length > 0 ? (
            <div>
              <h3>Approved, but no place on the website yet</h3>
              <ul className="interview-blockers" data-testid="website-sync-unsupported">
                {state.preview.notSupported.map((n) => (
                  <li key={n.questionId}>{fieldLabel(n.websiteField)}</li>
                ))}
              </ul>
              <p className="interview-hint">These are not published.</p>
            </div>
          ) : null}

          {state.preview.withheldCount > 0 ? (
            <p className="interview-hint" data-testid="website-sync-private">
              {state.preview.withheldCount === 1
                ? "1 approved answer is not marked public-safe and stays private."
                : `${state.preview.withheldCount} approved answers are not marked public-safe and stay private.`}
            </p>
          ) : null}

          {state.preview.pages.length > 0 ? (
            <div>
              <h3>Pages that will be created</h3>
              <p data-testid="website-sync-pages">{state.preview.pages.join(", ")}</p>
            </div>
          ) : null}

          {props.confirming ? (
            <div role="group" aria-label="Confirm publishing">
              <p>
                This makes your website public. You can edit it afterwards in the website builder.
              </p>
              <div className="interview-actions">
                <button
                  type="button"
                  ref={confirmRef}
                  className="is-primary"
                  onClick={props.onConfirm}
                  disabled={props.busy}
                >
                  Yes, publish my website
                </button>
                <button type="button" onClick={props.onCancel} disabled={props.busy}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="interview-actions">
              <button
                type="button"
                ref={askRef}
                className="is-primary"
                onClick={props.onAsk}
                disabled={props.busy}
              >
                Create and publish my website
              </button>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}

/** The seam between the panel and its backend; the fixture swaps in a local stand-in. */
export interface WebsiteSyncApi {
  readonly preview: () => Promise<WebsiteSyncPreview>;
  readonly publish: (planHash: string) => Promise<WebsiteSyncPublish>;
}

const websiteSyncServerApi: WebsiteSyncApi = {
  preview: () => previewWebsiteFromReality({ data: {} }),
  publish: (planHash) => publishWebsiteFromReality({ data: { planHash } }),
};

export function WebsiteSyncPanel({ api = websiteSyncServerApi }: { api?: WebsiteSyncApi }) {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setState({ kind: "loading" });
    setConfirming(false);
    try {
      const p = await api.preview();
      setState(
        p.status === "ready"
          ? { kind: "preview", preview: p }
          : { kind: "blocked", status: p.status },
      );
    } catch {
      setState({ kind: "error" });
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const confirm = async () => {
    if (state.kind !== "preview") return;
    setBusy(true);
    try {
      const result = await api.publish(state.preview.planHash);
      setConfirming(false);
      setState({ kind: "done", result });
    } catch {
      setConfirming(false);
      setState({ kind: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <WebsiteSyncPanelView
      state={state}
      confirming={confirming}
      busy={busy}
      onAsk={() => setConfirming(true)}
      onConfirm={() => void confirm()}
      onCancel={() => setConfirming(false)}
      onRefresh={() => void refresh()}
    />
  );
}
