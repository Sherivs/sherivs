import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, Workflow, CheckCircle2, ShieldCheck, FileText } from "lucide-react";

export const Route = createFileRoute("/platform/missions")({
  component: PlatformMissionsPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Mission Lifecycle & Verification Pipeline` },
      {
        name: "description",
        content:
          "Intent, lease acquisition, worker assignment, execution, evidence stamping, and dual-control verification.",
      },
    ],
  }),
});

function PlatformMissionsPage() {
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
          <div className="font-mono text-xs text-cyan-400">Phase 17–19 Mission System</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Architecture Specification</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Governed Mission Pipeline
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            In {PLATFORM_NAME}, work is never performed arbitrarily. Every operational task executes as a typed, audited mission following a 15-state canonical lifecycle machine.
          </p>
        </div>

        {/* Pipeline Diagram */}
        <div className="mt-10 p-6 rounded-xl sherivs-card border-cyan-500/20 bg-[color:var(--surface-2)]">
          <div className="text-xs uppercase font-mono text-muted-foreground mb-4">Canonical Mission Progression</div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-center text-xs">
            <div className="p-3 rounded-lg bg-background/60 border border-border">
              <div className="font-bold text-foreground">01 · Intent</div>
              <div className="text-[10px] text-muted-foreground mt-1">Goal formulated</div>
            </div>
            <div className="p-3 rounded-lg bg-background/60 border border-border">
              <div className="font-bold text-foreground">02 · Planning</div>
              <div className="text-[10px] text-muted-foreground mt-1">Dependencies checked</div>
            </div>
            <div className="p-3 rounded-lg bg-background/60 border border-border">
              <div className="font-bold text-foreground">03 · Lease</div>
              <div className="text-[10px] text-muted-foreground mt-1">Worker bound</div>
            </div>
            <div className="p-3 rounded-lg bg-background/60 border border-border">
              <div className="font-bold text-foreground">04 · Execution</div>
              <div className="text-[10px] text-muted-foreground mt-1">Tool calls executed</div>
            </div>
            <div className="p-3 rounded-lg bg-background/60 border border-border">
              <div className="font-bold text-foreground">05 · Evidence</div>
              <div className="text-[10px] text-muted-foreground mt-1">Payload hashed</div>
            </div>
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <div className="font-bold">06 · Verification</div>
              <div className="text-[10px] mt-1">Dual-control signed</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
