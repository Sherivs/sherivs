import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, Briefcase, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/careers")({
  component: CareersPage,
  head: () => ({
    meta: [
      { title: `Careers at ${PLATFORM_NAME} — Build Institutional Infrastructure` },
      {
        name: "description",
        content: "Join the elite engineering and design organization building Sherivs.",
      },
    ],
  }),
});

function CareersPage() {
  const roles = [
    { title: "Staff Distributed Systems Engineer", dept: "Kernel & Consensus", loc: "Remote / Hybrid" },
    { title: "Principal Experience Architect", dept: "Product & Design", loc: "Remote / London" },
    { title: "Senior Cryptographic Security Engineer", dept: "Security & RLS", loc: "Remote" },
    { title: "Autonomous AI Systems Researcher", dept: "Reasoning & Jarvis", loc: "Remote / San Francisco" },
  ];

  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Home</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">Careers</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Join the Mission</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Engineer Sovereign Intelligence
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            We are assembling an elite team of distributed systems engineers, security specialists, and product architects to build the operating system for institutional longevity.
          </p>
        </div>

        <div className="mt-12 space-y-4">
          {roles.map((r) => (
            <div key={r.title} className="sherivs-card p-5 flex items-center justify-between hover:border-cyan-500/40 transition-all">
              <div>
                <h3 className="font-display font-bold text-base text-foreground">{r.title}</h3>
                <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{r.dept}</span>
                  <span>·</span>
                  <span>{r.loc}</span>
                </div>
              </div>
              <Link
                to="/contact"
                className="px-4 py-2 rounded-lg border border-border text-xs font-semibold hover:bg-accent text-foreground"
              >
                Apply →
              </Link>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
