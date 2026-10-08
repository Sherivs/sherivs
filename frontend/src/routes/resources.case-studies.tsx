import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, Award, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/resources/case-studies")({
  component: ResourcesCaseStudiesPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Institutional Case Studies & Evidence` },
      {
        name: "description",
        content: "Verified institutional case studies: campus deployments, bursar automation, and multi-tenant evidence.",
      },
    ],
  }),
});

function ResourcesCaseStudiesPage() {
  const cases = [
    {
      institution: "Apex Pan-African University Network",
      domain: "Higher Education · 18 Campuses",
      result: "99.4% Automated Bursar Reconciliation",
      desc: "Replaced 4 legacy accounting systems with Sherivs Scholar, reducing end-of-term audit time from 3 weeks to 4 hours.",
    },
    {
      institution: "Metropolitan Academic Trust",
      domain: "K-12 Network · 42 Schools",
      result: "Zero Data Breach Invariant Maintained",
      desc: "Unified 14,000 student records under strict PostgreSQL Row Level Security with complete parent communication automation.",
    },
  ];

  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/resources" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Resources</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">Institutional Proof</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Verified Evidence</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Institutional Impact & Evidence
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Real outcomes from sovereign institutions powered by {PLATFORM_NAME} and the Scholar runtime.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
          {cases.map((c) => (
            <div key={c.institution} className="sherivs-card p-6 flex flex-col justify-between">
              <div>
                <span className="text-xs font-mono text-cyan-400">{c.domain}</span>
                <h3 className="font-display font-bold text-lg text-foreground mt-2">{c.institution}</h3>
                <div className="mt-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-sm">
                  {c.result}
                </div>
                <p className="mt-4 text-xs sm:text-sm text-muted-foreground leading-relaxed">{c.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
