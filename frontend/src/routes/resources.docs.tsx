import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, Terminal, Shield, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/resources/docs")({
  component: ResourcesDocsPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Developer Documentation & API Contracts` },
      {
        name: "description",
        content: "API contracts, database schema, server functions, and adapter development guides for Sherivs.",
      },
    ],
  }),
});

function ResourcesDocsPage() {
  const articles = [
    { title: "Universal Kernel Architecture", category: "Core", time: "12 min read" },
    { title: "PostgreSQL Row Level Security Model", category: "Security", time: "8 min read" },
    { title: "Governed Worker Leases & RPCs", category: "AI Workforce", time: "15 min read" },
    { title: "Server-Function HTTP Contract Specification", category: "API", time: "10 min read" },
    { title: "Autonomous Memory Vector Search (HNSW)", category: "Memory", time: "9 min read" },
    { title: "Developing Domain Runtimes on Sherivs", category: "Extensibility", time: "18 min read" },
  ];

  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/resources" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Resources</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">Technical Docs</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Engineering Documentation</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Developer Documentation & API Contracts
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Exhaustive specifications, schema definitions, and server-function contracts powering the {PLATFORM_NAME} ecosystem.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-4">
          {articles.map((art) => (
            <div key={art.title} className="sherivs-card p-5 flex items-center justify-between hover:border-cyan-500/30 transition-all cursor-pointer">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-400">{art.category}</span>
                <h3 className="font-display font-semibold text-sm text-foreground mt-1">{art.title}</h3>
                <span className="text-xs text-muted-foreground mt-1 block">{art.time}</span>
              </div>
              <Terminal className="size-4 text-muted-foreground shrink-0" />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
