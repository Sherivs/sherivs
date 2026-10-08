import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PLATFORM_NAME } from "@/lib/platform";
import { BreadcrumbTrail } from "@/components/experience/editorial";

export const Route = createFileRoute("/(site)/status")({
  component: StatusPage,
  head: () => ({
    meta: [
      { title: `Status — ${PLATFORM_NAME}` },
      { name: "description", content: "Live instance health from the public health endpoint." },
    ],
  }),
});

function StatusPage() {
  const health = useQuery({
    queryKey: ["public-health"],
    queryFn: async () => {
      const response = await fetch("/health.json", { headers: { Accept: "application/json" } });
      const body = (await response.json()) as {
        status: string;
        ts: string;
        uptime_s: number;
        version: string | null;
        checks: Array<{ name: string; status: string; detail?: string }>;
      };
      return { httpStatus: response.status, body };
    },
    refetchInterval: 30_000,
  });

  return (
    <article className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
      <BreadcrumbTrail items={[{ href: "/", label: PLATFORM_NAME }, { label: "Status" }]} />
      <h1 className="mt-6 font-serif text-4xl tracking-tight">Instance status</h1>
      <p className="mt-3 max-w-prose text-sm text-muted-foreground">
        This page reports the public <code className="font-mono">/health.json</code> payload for
        this instance. It is not a global multi-region status network.
      </p>
      {health.isLoading ? (
        <p className="mt-8 text-sm text-muted-foreground">Reading health endpoint…</p>
      ) : health.isError || !health.data ? (
        <p className="mt-8 text-sm text-destructive">The health endpoint could not be read.</p>
      ) : (
        <div className="mt-8 space-y-4">
          <p className="font-display text-2xl font-semibold uppercase tracking-[0.12em]">
            {health.data.body.status}
          </p>
          <dl className="grid gap-2 font-mono text-xs text-muted-foreground">
            <div>HTTP {health.data.httpStatus}</div>
            <div>ts {health.data.body.ts}</div>
            <div>uptime_s {health.data.body.uptime_s}</div>
            <div>version {health.data.body.version ?? "unspecified"}</div>
          </dl>
          <ul className="divide-y divide-border border-y border-border">
            {health.data.body.checks.length === 0 ? (
              <li className="py-4 text-sm text-muted-foreground">No dependency checks were attached to this payload.</li>
            ) : (
              health.data.body.checks.map((check) => (
                <li key={check.name} className="flex items-baseline justify-between gap-4 py-4 text-sm">
                  <span>{check.name}</span>
                  <span className="font-mono text-xs">{check.status}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </article>
  );
}
