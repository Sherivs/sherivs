import { createFileRoute, Link } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { SHERIVS_PUBLIC_ORIGIN } from "@/lib/sherivs-brand";

export const Route = createFileRoute("/enterprise")({
  component: EnterprisePage,
  head: () => ({
    meta: [
      { title: "Sherivs for enterprise organizations" },
      {
        name: "description",
        content:
          "Sherivs for complex institutions: tenant isolation, capability-driven workspaces, delegated authority, audit, and a kernel your sector runtime inherits.",
      },
      { property: "og:title", content: "Sherivs for enterprise organizations" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SHERIVS_PUBLIC_ORIGIN}/enterprise` },
    ],
    links: [{ rel: "canonical", href: `${SHERIVS_PUBLIC_ORIGIN}/enterprise` }],
  }),
});

const PILLARS = [
  {
    title: "One tenant, fully isolated",
    body: "Your organization's data lives behind database-enforced isolation with its own members, roles, policies and audit trail — no shared-everything shortcuts.",
  },
  {
    title: "Authority that delegates safely",
    body: "Executives set policy; administrators operate within it; members act within their roles. Approvals, verification states and revocation are built into missions and AI actions alike.",
  },
  {
    title: "Workspaces people actually use",
    body: "Navigation is capability-driven: each person sees the surfaces their role and permissions entitle them to — overview, people, missions, knowledge, AI workforce, governance — and nothing they are not authorized to touch.",
  },
  {
    title: "Evidence for every outcome",
    body: "Missions, AI worker actions and operational decisions capture evidence with provenance. Oversight stops being archaeology and starts being reading.",
  },
  {
    title: "A kernel your sector inherits",
    body: "Education, operations and future sector runtimes install on the same contracted kernel. Your domain stays yours; the platform guarantees underneath never change for one application.",
  },
  {
    title: "Rollout without disruption",
    body: "Progressive onboarding — identity first, then structure, members, policies and branding — activates an organization step by step instead of demanding a flag-day migration.",
  },
] as const;

function EnterprisePage() {
  return (
    <SherivsPublicShell>
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Enterprise
        </p>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold tracking-tight text-balance sm:text-5xl">
          Infrastructure for institutions that cannot afford to guess.
        </h1>
        <p className="mt-5 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Large organizations run on delegated authority: thousands of people making decisions
          inside policies set far above them. Sherivs makes that delegation legible — who may act,
          under what policy, with what evidence — and enforces it in the platform rather than
          documenting it in a binder.
        </p>
        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((pillar) => (
            <li
              key={pillar.title}
              className="rounded-xl border border-border p-5 transition-colors hover:bg-muted/30"
            >
              <h2 className="font-display text-base font-semibold">{pillar.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
            </li>
          ))}
        </ul>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            to="/request-demo"
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Request a demo
          </Link>
          <Link
            to="/security"
            className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold hover:bg-accent"
          >
            Review security
          </Link>
        </div>
      </div>
    </SherivsPublicShell>
  );
}
