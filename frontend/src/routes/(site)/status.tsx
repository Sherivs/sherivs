import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Section } from "@/components/sherivs/public-shell";
import { StateView } from "@/components/sherivs/state-view";
import { VerificationBadge } from "@/components/sherivs/trust";
import { publicHead } from "@/lib/sherivs/page-head";
import type { HealthReport, HealthStatus } from "@/lib/observability/health";

export const Route = createFileRoute("/(site)/status")({
  component: StatusPage,
  head: () =>
    publicHead({
      path: "/status",
      title: "System status",
      description: "Live health of this Sherivs deployment, read from its health endpoint.",
      breadcrumbs: true,
    }),
});

async function fetchHealth(): Promise<HealthReport> {
  const res = await fetch("/health.json", { headers: { accept: "application/json" }, cache: "no-store" });
  // 503 carries a valid "failing" report; anything else non-OK is an error.
  if (!res.ok && res.status !== 503) throw new Error(`Health endpoint returned ${res.status}`);
  return (await res.json()) as HealthReport;
}

const LABEL: Record<HealthStatus, string> = {
  ok: "Operational",
  degraded: "Degraded",
  failing: "Failing",
};

function StatusPage() {
  const q = useQuery({ queryKey: ["public-health"], queryFn: fetchHealth, refetchInterval: 30_000, retry: 1 });
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  return (
    <>
      <PageHeader
        path="/status"
        eyebrow="Status"
        title="System status"
        lead="Read live from this deployment's health endpoint. It reports only a fixed, leak-free set of fields."
      />
      <Section id="current" title="Current">
        {q.isPending ? (
          <StateView kind="loading" title="Checking status" description="Reading the health endpoint." />
        ) : q.isError ? (
          <StateView
            kind={offline ? "offline" : "error"}
            title={offline ? "You are offline" : "Status unavailable"}
            description={
              offline
                ? "Reconnect to read the live status."
                : "The health endpoint could not be read. This does not by itself mean the service is down."
            }
            actions={
              <button type="button" className="sv-btn" onClick={() => q.refetch()}>
                Try again
              </button>
            }
          />
        ) : (
          <div className="grid gap-8">
            <div className="grid gap-2">
              <p className="sv-label sv-muted">Overall</p>
              <p className="sv-h1" role="status">
                {LABEL[q.data.status]}
              </p>
              <p className="sv-caption sv-faint">
                Observed <time dateTime={q.data.ts}>{q.data.ts}</time>
                {q.data.version ? <> · version {q.data.version}</> : null}
              </p>
            </div>
            {q.data.checks.length > 0 ? (
              <ul aria-label="Dependency checks" className="grid">
                {q.data.checks.map((c) => (
                  <li key={c.name} className="sv-rule flex flex-wrap items-center justify-between gap-3 py-4">
                    <span className="sv-h4">{c.name}</span>
                    <span className="flex items-center gap-3">
                      {c.detail ? <span className="sv-caption sv-muted">{c.detail}</span> : null}
                      <VerificationBadge state={c.status === "ok" ? "verified" : c.status === "degraded" ? "pending" : "failed"} />
                      <span className="sv-small">{LABEL[c.status]}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sv-small sv-muted">No dependency checks are registered on this deployment.</p>
            )}
          </div>
        )}
      </Section>
      <Section
        id="history"
        tone="ground"
        title="History"
        lead="Incident history is not published here: this deployment keeps no incident record to display."
      />
    </>
  );
}
