import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, Cpu, Database, Sparkles, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/platform/memory")({
  component: PlatformMemoryPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Autonomous Memory & Knowledge Currency` },
      {
        name: "description",
        content:
          "Multi-tier vector storage, knowledge currency, and HNSW graph indexing in Sherivs.",
      },
    ],
  }),
});

function PlatformMemoryPage() {
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
          <div className="font-mono text-xs text-violet-400">Phase 11–12 Memory & Knowledge</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-violet-400">Architecture Specification</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Autonomous Memory & Knowledge Currency
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            AI workers in {PLATFORM_NAME} draw from a partitioned, multi-tier vector architecture. Memory is governed by decay laws, verification scoring, and continuous knowledge currency evaluation.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="sherivs-card p-6">
            <Cpu className="size-6 text-violet-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Tier 1: Ephemeral Working Memory</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Fast, session-scoped vector cache bound to the duration of an active worker lease. Discarded safely upon mission termination.
            </p>
          </div>

          <div className="sherivs-card p-6">
            <Database className="size-6 text-cyan-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Tier 2: Institutional Long-Term Vector Store</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Persisted embeddings with HNSW indexing (150x faster similarity search) indexed against tenant-isolated semantic collections.
            </p>
          </div>

          <div className="sherivs-card p-6">
            <Sparkles className="size-6 text-emerald-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Knowledge Currency Ledger</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Every indexed assertion carries a temporal decay rate and confidence floor. Outdated facts automatically trigger verification tasks.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
