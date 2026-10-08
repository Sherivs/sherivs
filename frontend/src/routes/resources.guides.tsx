import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, BookOpen, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/resources/guides")({
  component: ResourcesGuidesPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Implementation Guides & Blueprints` },
      {
        name: "description",
        content: "Step-by-step institutional deployment blueprints, campus onboarding, and governance setup.",
      },
    ],
  }),
});

function ResourcesGuidesPage() {
  const guides = [
    { title: "Institutional Onboarding & Role Provisioning", category: "Deployment", steps: 5 },
    { title: "Configuring Sovereign Domain & SSL Certificates", category: "Infrastructure", steps: 4 },
    { title: "Deploying AI Workers with Restricted Tool Leases", category: "AI Workforce", steps: 6 },
    { title: "Scholar Academic Year Transition & Data Migration", category: "Education", steps: 7 },
  ];

  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/resources" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Resources</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">Implementation Blueprints</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Operational Runbooks</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Implementation Guides & Blueprints
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Prescriptive, battle-tested operational blueprints for rolling out {PLATFORM_NAME} across campuses, departments, and enterprise clusters.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4">
          {guides.map((g) => (
            <div key={g.title} className="sherivs-card p-5 flex items-center justify-between hover:border-cyan-500/30 transition-all cursor-pointer">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400">{g.category}</span>
                <h3 className="font-display font-semibold text-sm text-foreground mt-1">{g.title}</h3>
                <span className="text-xs text-muted-foreground mt-1 block">{g.steps} procedural steps</span>
              </div>
              <BookOpen className="size-4 text-muted-foreground shrink-0" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
