import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { publicPageHead } from "@/content/sherivs/seo";
import {
  HEALTH_STATUS_COPY,
  formatUptime,
  parseHealthPayload,
  type HealthReading,
  type PublicHealthStatus,
} from "@/content/sherivs/status";
import { Plane, SectionHeading, StatusDot } from "@/components/sherivs/primitives";
import { SystemState } from "@/components/sherivs/system-state";

/**
 * Sherivs system status at /status — reads the public health endpoint from the browser
 * at view time. There is no cached, simulated or hand-set status on this page: when the
 * endpoint cannot be read, the page says so.
 */
export const Route = createFileRoute("/(site)/status")({
  ssr: false,
  component: StatusPage,
  head: () => publicPageHead("/status"),
});

const STATUS_TONE: Record<PublicHealthStatus, "verification" | "action" | "danger"> = {
  ok: "verification",
  degraded: "action",
  failing: "danger",
};

async function readHealth(): Promise<HealthReading> {
  const response = await fetch("/health.json", {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  // A failing instance answers 503 with a valid report; anything else non-JSON is unreadable.
  const body: unknown = await response.json();
  return parseHealthPayload(body);
}

function StatusPage() {
  const health = useQuery({
    queryKey: ["sherivs", "public-health"],
    queryFn: readHealth,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  return (
    <Plane labelledBy="status-heading" className="border-t-0">
      <SectionHeading
        id="status-heading"
        as="h1"
        label="System status"
        title="Live health of this instance"
        lead="Read from the public health endpoint when you opened this page. It reports the instance that served you, not a history or a forecast."
      />
      <div className="mt-14 lg:ml-[33.333%]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-y border-sx-line-strong py-5">
          {health.isPending ? (
            <SystemState kind="loading" title="Reading the health endpoint" headingLevel="h2" />
          ) : health.isError || health.data.kind === "invalid" ? (
            <SystemState
              kind="error"
              headingLevel="h2"
              title="Status unavailable"
              description="The health endpoint could not be read or returned an unexpected shape. That is itself a signal: treat the platform's state as unknown, not as healthy."
            />
          ) : (
            <div className="grid gap-2" role="status">
              <StatusDot
                tone={STATUS_TONE[health.data.payload.status]}
                label={HEALTH_STATUS_COPY[health.data.payload.status].label}
              />
              <h2 className="sx-h3">{HEALTH_STATUS_COPY[health.data.payload.status].detail}</h2>
            </div>
          )}
          <button
            type="button"
            onClick={() => void health.refetch()}
            disabled={health.isFetching}
            className="sx-button sx-button-secondary"
          >
            <RefreshCw
              aria-hidden="true"
              className={health.isFetching ? "size-4 animate-spin" : "size-4"}
            />
            {health.isFetching ? "Reading…" : "Read again"}
          </button>
        </div>

        {health.data?.kind === "reading" && (
          <>
            <dl className="mt-8 grid border-t border-sx-line sm:grid-cols-3">
              <div className="border-b border-sx-line py-4 pr-6">
                <dt className="sx-label">Checked at</dt>
                <dd className="sx-data mt-1 text-sx-strong">
                  <time dateTime={health.data.payload.ts}>
                    {new Date(health.data.payload.ts).toLocaleString()}
                  </time>
                </dd>
              </div>
              <div className="border-b border-sx-line py-4 pr-6">
                <dt className="sx-label">Instance uptime</dt>
                <dd className="sx-data mt-1 text-sx-strong">
                  {formatUptime(health.data.payload.uptime_s)}
                </dd>
              </div>
              <div className="border-b border-sx-line py-4 pr-6">
                <dt className="sx-label">Version</dt>
                <dd className="sx-data mt-1 text-sx-strong">
                  {health.data.payload.version ?? "Not reported"}
                </dd>
              </div>
            </dl>

            <section aria-labelledby="checks-heading" className="mt-12">
              <h2 id="checks-heading" className="sx-label">
                Dependency checks
              </h2>
              {health.data.payload.checks.length === 0 ? (
                <p className="sx-small mt-4 text-sx-muted">
                  This instance reports no dependency checks — only that the process is serving.
                </p>
              ) : (
                <ul className="mt-4 border-t border-sx-line">
                  {health.data.payload.checks.map((check) => (
                    <li
                      key={check.name}
                      className="flex flex-wrap items-baseline justify-between gap-3 border-b border-sx-line py-3"
                    >
                      <span className="text-sm text-sx-strong">{check.name}</span>
                      <StatusDot
                        tone={STATUS_TONE[check.status]}
                        label={HEALTH_STATUS_COPY[check.status].label}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </Plane>
  );
}
