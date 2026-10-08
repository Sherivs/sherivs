import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, BookOpen, FileText, Newspaper, HelpCircle, Terminal } from "lucide-react";

export const Route = createFileRoute("/resources")({
  component: ResourcesPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Resources, Research & Documentation` },
      {
        name: "description",
        content: "Explore Sherivs technical documentation, engineering blog, research guides, and case studies.",
      },
    ],
  }),
});

function ResourcesPage() {
  const sections = [
    { title: "Technical Documentation", icon: FileText, desc: "API contracts, kernel specifications, RLS guides, and adapter SDKs.", href: "/resources/docs" },
    { title: "Engineering & Architecture Blog", icon: Newspaper, desc: "Deep-dives into bitemporal state, vector memory, and governed AI workforces.", href: "/resources/blog" },
    { title: "Implementation Guides", icon: BookOpen, desc: "Step-by-step blueprints for deploying Sherivs and Scholar across multi-campus networks.", href: "/resources/guides" },
    { title: "Case Studies & Evidence", icon: HelpCircle, desc: "Verified performance metrics, institutional outcomes, and dual-control operational audits.", href: "/resources/case-studies" },
  ];

  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Home</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">Resources Hub</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Knowledge & Research</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Institutional Research & Documentation
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Architectural whitepapers, operational blueprints, API documentation, and continuous research on governed institutional intelligence.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          {sections.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="sherivs-card p-6 flex flex-col justify-between">
                <div>
                  <div className="size-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center mb-4">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="font-display font-bold text-lg text-foreground">{item.title}</h3>
                  <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
                <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">Resource Hub</span>
                  <Link to={item.href} className="text-xs font-semibold text-cyan-400 hover:underline">
                    Access Portal →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
