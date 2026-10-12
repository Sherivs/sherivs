import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, Plug, CheckCircle2, Globe, Shield, Terminal } from "lucide-react";

export const Route = createFileRoute("/platform/integrations")({
  component: PlatformIntegrationsPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Enterprise Adapters & Integrations` },
      {
        name: "description",
        content:
          "Provider-agnostic adapters for Supabase, AI gateways, payment providers, and hardware telemetry.",
      },
    ],
  }),
});

function PlatformIntegrationsPage() {
  const integrations = [
    { name: "Supabase Substrate", category: "Database & Auth", status: "Verified Active", desc: "PostgreSQL, pgvector, and native Row Level Security." },
    { name: "Paystack Gateway", category: "Payments", status: "Verified Active", desc: "Signed webhook idempotency and financial reconciliation." },
    { name: "PostHog Telemetry", category: "Observability", status: "Verified Active", desc: "Privacy-preserving telemetry and error tracing." },
    { name: "VAPID Push Service", category: "Notifications", status: "Verified Active", desc: "Encrypted web push notification delivery." },
    { name: "Hermes Telemetry", category: "Physical Twins", status: "Verified Active", desc: "Sensor stream observation and biometric verification." },
    { name: "Multi-Model AI Gateway", category: "Inference", status: "Verified Active", desc: "Provider-agnostic routing, cost tracking, and rate limits." },
  ];

  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link
            to="/platform"
            className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            <span>Platform Hub</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">Enterprise Integrations & Adapters</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Ecosystem Substrate</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Provider-Agnostic Adapters
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            In compliance with the engineering constitution §25, {PLATFORM_NAME} remains completely provider-agnostic. All external vendors connect through clean boundary adapters, allowing seamless migration between cloud infrastructure providers.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {integrations.map((item) => (
            <div key={item.name} className="sherivs-card p-6">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400">{item.category}</span>
                <span className="sherivs-badge-verified text-[10px] px-2 py-0.5 rounded font-mono">{item.status}</span>
              </div>
              <h3 className="font-display font-bold text-base text-foreground">{item.name}</h3>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
