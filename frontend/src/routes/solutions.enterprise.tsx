import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, Landmark, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/solutions/enterprise")({
  component: SolutionsEnterprisePage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Sovereign Enterprise Infrastructure` },
      {
        name: "description",
        content: "Private cloud, multi-region residency, air-gapped readiness, and sovereign institutional compliance.",
      },
    ],
  }),
});

function SolutionsEnterprisePage() {
  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/solutions" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Solutions</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">Enterprise Sovereignty</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Sovereign Cloud</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Sovereign Enterprise Infrastructure
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Engineered for sovereign entities, defense contractors, and large-scale enterprises requiring absolute data ownership, private VPC isolation, and mathematical compliance verification.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="sherivs-card p-6">
            <h3 className="font-display font-bold text-base text-foreground">Dedicated VPC Deployment</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Full platform deployment into your private AWS, GCP, or on-premise Kubernetes cluster with zero external telemetry leakage.
            </p>
          </div>
          <div className="sherivs-card p-6">
            <h3 className="font-display font-bold text-base text-foreground">Custom Key Management (BYOK)</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Encrypt all reality objects, vector databases, and audit logs using your organization's own hardware security modules (HSM).
            </p>
          </div>
          <div className="sherivs-card p-6">
            <h3 className="font-display font-bold text-base text-foreground">99.99% Availability SLA</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              High-availability PostgreSQL replicas, automatic failover, and continuous sub-millisecond data replication.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
