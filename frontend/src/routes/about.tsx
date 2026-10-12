import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, Shield, Globe, Award, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/about")({
  component: AboutPage,
  head: () => ({
    meta: [
      { title: `About ${PLATFORM_NAME} — Institutional Intelligence Infrastructure` },
      {
        name: "description",
        content: "The history, founding principles, and sovereign mission behind Sherivs.",
      },
    ],
  }),
});

function AboutPage() {
  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Home</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">About Sherivs</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Company & Vision</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Architecting the Future of Institutional Intelligence
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            {PLATFORM_NAME} was founded on a singular conviction: as autonomous intelligence systems become active participants in operations and decision support, institutions require an immutable reality substrate that preserves human authority, tenant boundaries, and mathematical trust.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="sherivs-card p-6">
            <Shield className="size-6 text-cyan-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Correctness First</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Code that runs but violates institutional architecture is considered defective. We engineer for mathematical precision and auditability.
            </p>
          </div>
          <div className="sherivs-card p-6">
            <Globe className="size-6 text-emerald-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Data Sovereignty</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Every institution retains absolute ownership of its reality records, credentials, and telemetry. Zero vendor lock-in.
            </p>
          </div>
          <div className="sherivs-card p-6">
            <Award className="size-6 text-violet-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Governed Autonomy</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              AI workers operate under explicit leases and dual-control verification gates. Machine intelligence remains strictly aligned with human leadership.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
