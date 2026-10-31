import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PLATFORM_NAME } from "@/lib/platform";
import { publicHead } from "@/lib/public-site/seo";
import { MarketingPage } from "@/components/public/marketing-page";
import { GlassPanel, PageContainer, Section } from "@/components/public/ui";

/** Public status page. Reads the leak-free /health.json report only. */
export const Route = createFileRoute("/(site)/status")({
  component: StatusPage,
  head: () =>
    publicHead({
      title: `Status — ${PLATFORM_NAME}`,
      description: "Public Sherivs system status from the leak-free health report.",
      path: "/status",
    }),
});

type Report = {
  status: string;
  ts?: string;
  checks?: Record<string, { status: string }> | Array<{ name: string; status: string }>;
};

function StatusPage() {
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    const load = () =>
      fetch("/health.json", { cache: "no-store" })
        .then((x) => x.json())
        .then(setR)
        .catch(() => setErr(true));
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);
  const checks = r?.checks
    ? Array.isArray(r.checks)
      ? r.checks
      : Object.entries(r.checks).map(([name, v]) => ({ name, status: v.status }))
    : [];
  const tone = (s: string) =>
    s === "ok" || s === "healthy"
      ? "text-sherivs-success"
      : s === "degraded"
        ? "text-sherivs-warning"
        : "text-sherivs-warning";
  return (
    <MarketingPage
      eyebrow="Status"
      title={`${PLATFORM_NAME} status`}
      lead="This page reads /health.json. It does not expose internal diagnostics or customer data."
      crumbs={[
        { href: "/", label: "Home" },
        { href: "/status", label: "Status" },
      ]}
    >
      <Section labelledBy="status-body">
        <PageContainer className="py-16">
          <h2 id="status-body" className="sr-only">
            Health
          </h2>
          {err ? <p className="text-sherivs-warning">Status is unavailable right now.</p> : null}
          {r ? (
            <GlassPanel className="mx-auto max-w-2xl">
              <p className={`text-xl font-medium ${tone(r.status)}`}>Overall: {r.status}</p>
              <ul className="mt-6 divide-y divide-[var(--sherivs-border)]">
                {checks.map((c) => (
                  <li key={c.name} className="flex justify-between py-3">
                    <span>{c.name}</span>
                    <span className={tone(c.status)}>{c.status}</span>
                  </li>
                ))}
              </ul>
              {r.ts ? (
                <p className="mt-4 text-sm text-sherivs-muted">
                  Checked {new Date(r.ts).toLocaleString()}
                </p>
              ) : null}
            </GlassPanel>
          ) : null}
        </PageContainer>
      </Section>
    </MarketingPage>
  );
}
