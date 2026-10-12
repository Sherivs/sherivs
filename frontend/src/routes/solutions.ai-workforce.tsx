import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, Cpu, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/solutions/ai-workforce")({
  component: SolutionsWorkforcePage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Governed AI Workforce for Institutions` },
      {
        name: "description",
        content: "Deploy governed AI workers with bounded authority, finite leases, and cryptographic verification.",
      },
    ],
  }),
});

function SolutionsWorkforcePage() {
  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/solutions" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Solutions</span>
          </Link>
          <div className="font-mono text-xs text-amber-400">Governed AI Workforce</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-amber-400">Autonomous Operations</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Governed AI Workers Operating Under Leases
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Move beyond fragile chat prompts. Deploy persistent AI workers defined in your database (`cg_worker_definition`) that operate alongside human teams under strict authority bounds and mission leases.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="sherivs-card p-6">
            <h3 className="font-display font-bold text-base text-foreground">Mission Intent Dispatch</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Workers execute explicit, parameter-validated mission intents rather than executing arbitrary shell commands.
            </p>
          </div>
          <div className="sherivs-card p-6">
            <h3 className="font-display font-bold text-base text-foreground">Heartbeat Leases</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Workers must renew their leases via heartbeat RPCs. If a worker hangs or strays out of policy, its lease is revoked immediately.
            </p>
          </div>
          <div className="sherivs-card p-6">
            <h3 className="font-display font-bold text-base text-foreground">Evidence Verification</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Every worker execution yields an evidence payload that must be verified by an independent actor or human supervisor.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
