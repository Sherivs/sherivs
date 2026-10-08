import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, Activity, ShieldCheck, Cpu, Layers } from "lucide-react";

export const Route = createFileRoute("/solutions/operations")({
  component: SolutionsOperationsPage,
  head: () => ({
    meta: [
      { title: `Campus & Physical Operations — ${PLATFORM_NAME} Solutions` },
      {
        name: "description",
        content: `Unified facility intelligence, physical digital twins, transport routing, and automated maintenance workflows on ${PLATFORM_NAME}.`,
      },
    ],
  }),
});

function SolutionsOperationsPage() {
  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
          <Link to="/solutions" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Solutions</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">Campus Operations</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <div className="max-w-2xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Physical & Operational Reality</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Operations & Facility Intelligence
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Synchronize physical facilities, multi-campus transport fleets, and automated resource scheduling through real-time digital twin state.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-xl border border-border bg-[color:var(--surface-2)]/60 p-6 space-y-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
              <Layers className="size-4" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Physical Digital Twins</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Model campus geography, building layouts, room capacities, and specialized labs as first-class twin entities with spatial and occupancy telemetry.
            </p>
          </div>

          <div className="rounded-xl border border-border bg-[color:var(--surface-2)]/60 p-6 space-y-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
              <Activity className="size-4" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Automated Incident Routing</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Detect facility maintenance needs and physical anomalies automatically, dispatching verified repair missions to operations personnel.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
