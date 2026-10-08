import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { DocPage } from "@/components/sherivs/doc-page";
import { ErrorState, LoadingState } from "@/components/sherivs/system-states";
import { SHERIVS_PUBLIC_ORIGIN } from "@/lib/sherivs-brand";

export const Route = createFileRoute("/status")({
  component: StatusPage,
  head: () => ({
    meta: [
      { title: "Sherivs platform status" },
      {
        name: "description",
        content:
          "Live health for this Sherivs deployment, read from its own machine health endpoint.",
      },
      { property: "og:title", content: "Sherivs platform status" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SHERIVS_PUBLIC_ORIGIN}/status` },
    ],
    links: [{ rel: "canonical", href: `${SHERIVS_PUBLIC_ORIGIN}/status` }],
  }),
});

interface HealthCheck {
  name?: string;
  ok?: boolean;
  status?: string;
  detail?: string;
}

interface HealthReport {
  status?: string;
  ts?: string;
  uptime?: number;
  version?: string | null;
  checks?: HealthCheck[];
  [key: string]: unknown;
}

function StatusPage() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/health.json", { cache: "no-store" });
        if (!response.ok) throw new Error(`Health endpoint returned ${response.status}`);
        const data = (await response.json()) as HealthReport;
        if (!cancelled) setReport(data);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Health check failed");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SherivsPublicShell>
      <DocPage
        title="Platform status"
        lead="Live machine health for this deployment — read from its own /health.json endpoint, not from a status marketing page."
        updated="2026-10-08"
      >
        {error && (
          <ErrorState
            title="Health check unreachable"
            body={error}
            onRetry={() => window.location.reload()}
          />
        )}
        {!error && !report && <LoadingState label="Checking platform health" />}
        {report && (
          <div className="grid gap-3" role="status" aria-live="polite">
            <div className="rounded-xl border border-border p-5">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Overall
              </p>
              <p className="mt-1 font-display text-2xl font-bold capitalize">
                {String(report.status ?? "unknown")}
              </p>
              {typeof report.uptime === "number" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Uptime {Math.round(report.uptime)}s
                  {typeof report.version === "string" && report.version
                    ? ` · version ${report.version}`
                    : ""}
                  {typeof report.ts === "string" && report.ts ? ` · ${report.ts}` : ""}
                </p>
              )}
            </div>
            {Array.isArray(report.checks) && report.checks.length > 0 && (
              <ul className="grid gap-2">
                {report.checks.map((check, index) => (
                  <li
                    key={check.name ?? index}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm"
                  >
                    <span className="font-medium">{check.name ?? `Check ${index + 1}`}</span>
                    <span className="text-xs text-muted-foreground">
                      {check.detail ?? check.status ?? (check.ok ? "ok" : "attention")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DocPage>
    </SherivsPublicShell>
  );
}
