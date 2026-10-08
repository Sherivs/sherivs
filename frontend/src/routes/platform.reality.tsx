import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, CheckCircle2, Database, Shield, GitCommit, Layers } from "lucide-react";

export const Route = createFileRoute("/platform/reality")({
  component: PlatformRealityPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Reality Kernel & Bitemporal State Architecture` },
      {
        name: "description",
        content:
          "Explore the Sherivs Reality Kernel: universal entities, relationships, bitemporal state tracking, and signed observations.",
      },
    ],
  }),
});

function PlatformRealityPage() {
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
          <div className="font-mono text-xs text-cyan-400">Phase 01–04 Reality Kernel</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Architecture Specification</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Bitemporal Reality Substrate
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            The foundation of {PLATFORM_NAME} is an immutable reality model separating canonical ground truth from derived machine intelligence. Reality objects exist in dual-timeline bitemporal space.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="sherivs-card p-6">
            <Database className="size-6 text-cyan-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Universal Primitives</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Objects inherit canonical attributes: entity ID, tenant scope, classification level, state hashes, and immutable actor stamps. Zero domain schema contamination.
            </p>
          </div>

          <div className="sherivs-card p-6">
            <GitCommit className="size-6 text-violet-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Bitemporal Coordinates</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Every record tracks valid-time (when reality occurred in the world) independently from transaction-time (when the platform committed the evidence).
            </p>
          </div>

          <div className="sherivs-card p-6">
            <Shield className="size-6 text-emerald-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Hermes Sensor Ingestion</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Physical twins, IoT gateways, and telemetry sources sign observations cryptographically before admission into the kernel event log.
            </p>
          </div>
        </div>

        <div className="mt-12 p-6 rounded-xl sherivs-surface-0 border border-border">
          <div className="text-xs uppercase font-mono text-muted-foreground mb-3">Database Contract: `cg_entity` Substrate</div>
          <pre className="font-mono text-xs text-foreground/90 overflow-x-auto leading-relaxed">
{`CREATE TABLE public.cg_entity (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES public.cg_tenant(id),
  entity_class text NOT NULL,
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('draft','active','suspended','archived','deleted')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by text NOT NULL,
  signature text NOT NULL
);`}
          </pre>
        </div>
      </main>
    </div>
  );
}
