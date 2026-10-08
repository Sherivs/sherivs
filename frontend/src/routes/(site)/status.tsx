import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { PageTitle } from "@/components/sherivs/page-chrome";
import { SystemState } from "@/components/sherivs/states";
import { Container } from "@/components/sherivs/primitives";
import { publicHead } from "@/lib/experience-system/seo";

export const Route = createFileRoute("/(site)/status")({
  component: StatusPage,
  head: () => publicHead({ path: "/status" }),
});

type Health = "ok" | "degraded" | "failing";
interface HealthPayload {
  status: Health;
  ts: string;
  version: string | null;
  checks: Array<{ name: string; status: Health; detail?: string }>;
}

function isHealthPayload(v: unknown): v is HealthPayload {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    (r.status === "ok" || r.status === "degraded" || r.status === "failing") &&
    typeof r.ts === "string" &&
    Array.isArray(r.checks)
  );
}

const LABEL: Record<Health, string> = {
  ok: "Operational",
  degraded: "Degraded",
  failing: "Failing",
};

function StatusPage() {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "error" } | { kind: "ready"; report: HealthPayload }
  >({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/health.json", { cache: "no-store" });
      const body: unknown = await res.json();
      setState(isHealthPayload(body) ? { kind: "ready", report: body } : { kind: "error" });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageTitle
        path="/status"
        eyebrow="Status"
        title="System status"
        lead="Read live from the same health endpoint that uptime probes use. There is no incident history on this page because none is recorded here."
      />
      <Container className="py-12 sm:py-16">
        {state.kind === "loading" && <SystemState kind="loading" title="Checking platform health" />}
        {state.kind === "error" && (
          <SystemState
            kind="error"
            title="Health could not be read"
            description="The health endpoint did not return a valid report. This does not by itself mean the platform is down."
            action={
              <button
                type="button"
                onClick={() => void load()}
                className="sv-pressable sv-touch rounded-[var(--sv-radius-md)] border border-sv-border-strong px-4"
              >
                Try again
              </button>
            }
          />
        )}
        {state.kind === "ready" && (
          <div className="sv-reading">
            <p role="status" className="sv-h2" data-health={state.report.status}>
              {LABEL[state.report.status]}
            </p>
            <p className="sv-small mt-1 text-sv-text-subtle">
              Checked <time dateTime={state.report.ts}>{new Date(state.report.ts).toUTCString()}</time>
              {state.report.version ? ` · version ${state.report.version}` : ""}
            </p>
            {state.report.checks.length > 0 ? (
              <ul className="mt-8 divide-y divide-[var(--sv-border)] border-y border-sv-border">
                {state.report.checks.map((c) => (
                  <li key={c.name} className="flex items-baseline justify-between gap-4 py-3">
                    <span>{c.name}</span>
                    <span className="sv-data text-sv-text-muted">{LABEL[c.status]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-8 text-sv-text-muted">No dependency checks are registered for this deployment.</p>
            )}
          </div>
        )}
      </Container>
    </>
  );
}
