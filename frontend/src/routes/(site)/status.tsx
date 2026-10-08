import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Chip, Metric, Panel, StateBlock } from "@/components/sherivs/primitives";
import { PublicPageIntro, PublicSection } from "@/components/sherivs/public/public-shell";
import { Button } from "@/components/ui/button";
import { canonicalUrl, pageTitle } from "@/lib/experience/brand";
import type { StatusTone } from "@/lib/experience/design-tokens";
import type { HealthReport, HealthStatus } from "@/lib/observability/health";

/**
 * Platform status — a projection of the real `/health.json` endpoint. The
 * page renders exactly what the endpoint returns, or an honest error state.
 * There is no historical uptime series yet, so none is drawn.
 */
const DESCRIPTION = "Live platform health, read from the health endpoint on every visit.";

export const Route = createFileRoute("/(site)/status")({
  ssr: false,
  component: StatusPage,
  head: () => ({
    meta: [
      { title: pageTitle("Status") },
      { name: "description", content: DESCRIPTION },
      { name: "robots", content: "noindex" },
      { property: "og:url", content: canonicalUrl("/status") },
    ],
    links: [{ rel: "canonical", href: canonicalUrl("/status") }],
  }),
});

const TONE: Record<HealthStatus, StatusTone> = {
  ok: "success",
  degraded: "warning",
  failing: "danger",
};

const LABEL: Record<HealthStatus, string> = {
  ok: "Operational",
  degraded: "Degraded",
  failing: "Failing",
};

async function fetchHealth(): Promise<HealthReport> {
  const response = await fetch("/health.json", { cache: "no-store" });
  // 503 carries a valid body (status: failing); only non-JSON is an error.
  const body = (await response.json()) as HealthReport;
  if (!body || typeof body.status !== "string") throw new Error("Malformed health report");
  return body;
}

function StatusPage() {
  const query = useQuery({
    queryKey: ["public-status"],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
    retry: 1,
  });

  return (
    <>
      <PublicPageIntro eyebrow="Status" title="Platform status." lead={DESCRIPTION}>
        {query.data && (
          <Chip tone={TONE[query.data.status]} dot live={query.data.status === "ok"}>
            {LABEL[query.data.status]}
          </Chip>
        )}
      </PublicPageIntro>

      <PublicSection labelledBy="status-heading">
        <h2 id="status-heading" className="sr-only">
          Current health report
        </h2>

        {query.isPending && (
          <StateBlock kind="loading" title="Reading the health endpoint" description="Fetching /health.json." />
        )}

        {query.isError && (
          <StateBlock
            kind="error"
            title="The health endpoint could not be read"
            description={query.error instanceof Error ? query.error.message : "Unknown error"}
            action={
              <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
                Retry
              </Button>
            }
          />
        )}

        {query.data && (
          <div className="grid gap-6">
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Metric label="Status" value={LABEL[query.data.status]} tone={TONE[query.data.status]} />
              <Metric label="Version" value={query.data.version ?? "—"} />
              <Metric label="Uptime" value={formatUptime(query.data.uptime_s)} />
              <Metric label="Reported at" value={formatTime(query.data.ts)} hint="Refreshes every 30 s" />
            </div>

            <Panel>
              <p className="sh-label">Dependency checks</p>
              {query.data.checks.length === 0 ? (
                <p className="sh-small mt-3 text-ink-2">No dependency probes are registered for this instance.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line-1">
                  {query.data.checks.map((check) => (
                    <li key={check.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="sh-small font-medium text-ink-1">{check.name}</p>
                        {(check.detail || check.error) && (
                          <p className="sh-caption mt-0.5 break-words">{check.detail ?? check.error}</p>
                        )}
                      </div>
                      <Chip tone={TONE[check.status]} dot>
                        {LABEL[check.status]}
                      </Chip>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <p className="sh-caption">
              This page shows the current report only. Sherivs does not yet publish historical
              uptime or incident history; nothing here is extrapolated.
            </p>
          </div>
        )}
      </PublicSection>
    </>
  );
}

function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString();
}
