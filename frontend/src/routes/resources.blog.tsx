import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, BookOpen, Clock, Tag, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/resources/blog")({
  component: BlogResourcesPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} Engineering & Architecture Journal` },
      {
        name: "description",
        content: `Deep-dive architectural essays, system design notes, and formal specifications for ${PLATFORM_NAME} institutional intelligence infrastructure.`,
      },
    ],
  }),
});

interface Article {
  slug: string;
  title: string;
  summary: string;
  category: string;
  readingTime: string;
  date: string;
  author: string;
  authorRole: string;
}

const ARTICLES: Article[] = [
  {
    slug: "bitemporal-reality-mesh-architecture",
    title: "The Bitemporal Reality Mesh: Separating Fact from Intelligence in Large Institutions",
    summary:
      "Why traditional relational databases fail when modeling institutional reality, and how we engineered valid-time versus transaction-time isolation to prevent AI inference from corrupting canonical records.",
    category: "Architecture",
    readingTime: "12 min read",
    date: "October 2026",
    author: "Architecture Board",
    authorRole: "Core Systems",
  },
  {
    slug: "rebac-zero-trust-worker-leases",
    title: "Governing the Autonomous AI Workforce: Cryptographic Leases and ReBAC Policy Airlocks",
    summary:
      "A deep dive into how Jarvis delegates missions to autonomous worker agents with hardware-bounded capability tokens, zero-bypass RLS, and cryptographic dual-control revocation.",
    category: "Security",
    readingTime: "9 min read",
    date: "September 2026",
    author: "Trust & Safety Group",
    authorRole: "Security Engineering",
  },
  {
    slug: "designing-the-universal-application-shell",
    title: "Designing for Institutional Calm: The Spatial Architecture of the Sherivs Application Shell",
    summary:
      "Moving beyond dashboard clutter: how our 5-level spatial surface hierarchy, luminous optical contrast, and keyboard-first command interface reduce cognitive strain for campus executives.",
    category: "Design System",
    readingTime: "8 min read",
    date: "September 2026",
    author: "Experience Architecture",
    authorRole: "Interface Systems",
  },
  {
    slug: "scholar-runtime-academic-scheduling",
    title: "NP-Hard Timetabling at Scale: Constraint Satisfaction in the Sherivs Scholar Runtime",
    summary:
      "How Scholar solves multi-campus faculty timetabling, physical room capacity allocations, and student prerequisites in under 60 seconds with deterministic audit guarantees.",
    category: "Algorithms",
    readingTime: "14 min read",
    date: "August 2026",
    author: "Applied Algorithms",
    authorRole: "Scholar Runtime",
  },
];

function BlogResourcesPage() {
  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
          <Link to="/resources" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Resources</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">Engineering Journal</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-12">
        <div className="max-w-2xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Engineering & Research</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Architecture Journal
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            In-depth engineering notes, formal verification proofs, and technical whitepapers authored by the {PLATFORM_NAME} core systems team.
          </p>
        </div>

        <div className="mt-12 space-y-6">
          {ARTICLES.map((art) => (
            <article
              key={art.slug}
              className="rounded-2xl border border-border bg-[color:var(--surface-2)]/60 p-6 sm:p-8 transition-all hover:border-cyan-500/40 hover:bg-[color:var(--surface-2)]"
            >
              <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-muted-foreground mb-3">
                <span className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-2 py-0.5 text-cyan-400">
                  {art.category}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3 text-muted-foreground" />
                  {art.readingTime}
                </span>
                <span>•</span>
                <span>{art.date}</span>
              </div>

              <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-foreground hover:text-cyan-300">
                {art.title}
              </h2>

              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                {art.summary}
              </p>

              <div className="mt-6 pt-4 border-t border-border/50 flex items-center justify-between">
                <div className="text-xs">
                  <span className="font-semibold text-foreground">{art.author}</span>
                  <span className="text-muted-foreground"> — {art.authorRole}</span>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-cyan-400 hover:text-cyan-300">
                  Read Technical Paper <ArrowRight className="size-3" />
                </span>
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
