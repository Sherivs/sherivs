import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/status")({
  component: StatusPage,
  head: () => ({
    meta: [
      { title: `Status — ${PLATFORM_NAME}` },
      { name: "description", content: "Live health from the platform health endpoint." },
    ],
  }),
});

type HealthPayload = {
  status?: string;
  ts?: string;
  version?: string | null;
  checks?: Array<{ name: string; status: string; detail?: string }>;
};

function StatusPage() {
  const health = useQuery({
    queryKey: ["platform-health"],
    queryFn: async (): Promise<HealthPayload> => {
      const response = await fetch("/health.json", { headers: { Accept: "application/json" } });
      return (await response.json()) as HealthPayload;
    },
    refetchInterval: 30_000,
  });

  return (
    <article className="sv-public-wrap py-16 sm:py-20">
      <p className="sv-kicker">System</p>
      <h1 className="sv-display mt-3">Status</h1>
      <p className="mt-5 max-w-2xl text-muted-foreground">
        This page reads the real <code className="font-mono text-xs">/health.json</code> endpoint. It
        does not invent uptime percentages.
      </p>
      {health.isLoading && <p className="mt-10 text-sm text-muted-foreground">Loading health…</p>}
      {health.isError && (
        <p className="mt-10 text-sm" role="alert">
          Health endpoint unreachable from this session.
        </p>
      )}
      {health.data && (
        <div className="mt-10 grid gap-4">
          <p className="font-display text-xl font-semibold capitalize">{health.data.status ?? "unknown"}</p>
          {health.data.ts && (
            <p className="text-sm text-muted-foreground">Observed at {health.data.ts}</p>
          )}
          {health.data.version && (
            <p className="text-sm text-muted-foreground">Version {health.data.version}</p>
          )}
          <ul className="sv-plane-list">
            {(health.data.checks ?? []).map((check) => (
              <li key={check.name}>
                <span className="font-semibold">{check.name}</span>
                <span className="ml-2 text-sm text-muted-foreground">{check.status}</span>
                {check.detail && <p className="mt-1 text-sm text-muted-foreground">{check.detail}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
