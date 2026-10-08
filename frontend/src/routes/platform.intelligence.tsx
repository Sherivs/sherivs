import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME, EXECUTIVE_INTELLIGENCE_NAME } from "@/lib/platform";
import { ArrowLeft, Brain, ShieldCheck, Lock, Activity } from "lucide-react";

export const Route = createFileRoute("/platform/intelligence")({
  component: PlatformIntelligencePage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — ${EXECUTIVE_INTELLIGENCE_NAME} Executive Intelligence` },
      {
        name: "description",
        content:
          "Sovereign executive intelligence, escalation protocols, and constitutional boundaries in Sherivs.",
      },
    ],
  }),
});

function PlatformIntelligencePage() {
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
          <div className="font-mono text-xs text-violet-400">Executive Orchestration Substrate</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-violet-400">Executive Architecture</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            {EXECUTIVE_INTELLIGENCE_NAME} Executive Intelligence
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            {EXECUTIVE_INTELLIGENCE_NAME} is the sovereign orchestration interface of {PLATFORM_NAME}. Operating with full institutional context, Jarvis observes platform state, correlates multi-campus telemetry, coordinates worker assignments, and presents verified action proposals for human leadership.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="sherivs-card p-6">
            <Brain className="size-6 text-violet-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Multi-Context Synthesis</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Synthesizes real-time attendance, bursar reconciliation, security anomalies, and fleet health into clean executive briefings.
            </p>
          </div>

          <div className="sherivs-card p-6">
            <ShieldCheck className="size-6 text-cyan-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Strict Fail-Closed Boundaries</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Every Part 15 prohibition is mechanically checked. Out-of-policy requests are immediately rejected before model invocation.
            </p>
          </div>

          <div className="sherivs-card p-6">
            <Lock className="size-6 text-amber-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Human Dual-Control</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              High-consequence actions require explicit cryptographic authorization from an authenticated institutional operator.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
