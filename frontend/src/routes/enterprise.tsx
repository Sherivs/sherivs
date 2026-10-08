import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, Landmark, Shield, Server, Cpu, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/enterprise")({
  component: EnterprisePage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Enterprise Deployments & Sovereignty` },
      {
        name: "description",
        content: "Private cloud topologies, air-gapped support, dedicated SLA, and compliance infrastructure.",
      },
    ],
  }),
});

function EnterprisePage() {
  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Home</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">Enterprise Sovereignty</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Institutional Longevity</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Enterprise & Sovereign Deployments
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            For state ministries, sovereign networks, and high-security enterprise environments that require complete infrastructure independence and dedicated compliance commitments.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="sherivs-card p-6">
            <Server className="size-6 text-cyan-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Private VPC or On-Prem</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Deploy {PLATFORM_NAME} into your private cloud perimeter. Zero shared infrastructure, zero external model leakage.
            </p>
          </div>

          <div className="sherivs-card p-6">
            <Shield className="size-6 text-emerald-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Hardware Security (HSM)</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Bring Your Own Key (BYOK) encryption for all database records, vector indexes, and backups.
            </p>
          </div>

          <div className="sherivs-card p-6">
            <Cpu className="size-6 text-violet-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Dedicated Engineering SLA</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              24/7 sovereign support, designated mission architects, and 99.99% uptime availability guarantees.
            </p>
          </div>
        </div>

        <div className="mt-12 p-8 rounded-xl sherivs-card bg-[color:var(--surface-2)] flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h3 className="font-display font-bold text-xl text-foreground">Speak with a Sovereign Mission Architect</h3>
            <p className="mt-1 text-sm text-muted-foreground">Review deployment topologies, compliance audits, and custom runtime requirements.</p>
          </div>
          <Link
            to="/request-demo"
            className="px-6 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs whitespace-nowrap shadow-[0_0_20px_rgba(0,240,255,0.25)]"
          >
            Schedule Consultation
          </Link>
        </div>
      </main>
    </div>
  );
}
