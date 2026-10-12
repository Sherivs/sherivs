import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, GitCommit, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/resources/changelog")({
  component: ResourcesChangelogPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Platform Releases & Changelog` },
      {
        name: "description",
        content: "Track continuous release engineering, architecture evolutions, and platform upgrades for Sherivs.",
      },
    ],
  }),
});

function ResourcesChangelogPage() {
  const releases = [
    {
      version: "v1.4.0",
      date: "October 8, 2026",
      summary: "Sherivs Experience Architecture Program Launch",
      changes: [
        "Unification of platform identity under canonical brand Sherivs and sherivs.com.",
        "Launch of Jarvis Executive Intelligence console with constitutional invariants.",
        "Universal Sherivs Application Shell with multi-plane navigation.",
        "Complete public marketing experience with 25+ dedicated architectural routes.",
      ],
    },
    {
      version: "v1.3.2",
      date: "October 2, 2026",
      summary: "Phase 14–16 Governed Worker Definition & Leases",
      changes: [
        "Added persistent worker definition substrate (cg_worker_definition).",
        "Bound worker leases to finite heartbeat timeouts (cg_mission_lease).",
        "Integrated multi-model provider-agnostic AI gateway with automated metering.",
      ],
    },
    {
      version: "v1.3.0",
      date: "September 30, 2026",
      summary: "V5.3 MVP Execution Profile & Neutral Tenant Primitives",
      changes: [
        "Eliminated legacy domain leaks from universal kernel helpers.",
        "Added get_my_tenant_id(), holds_tenant_role(), is_tenant_admin() security definers.",
        "Locked 51-phase registry baseline with strict zero-drift automated guards.",
      ],
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
          <div className="font-mono text-xs text-cyan-400">Release Register</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Continuous Engineering</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Platform Releases & Changelog
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Transparent, audited evolution record of the {PLATFORM_NAME} institutional operating system.
          </p>
        </div>

        <div className="mt-12 space-y-8">
          {releases.map((rel) => (
            <div key={rel.version} className="sherivs-card p-6">
              <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
                <div className="flex items-center gap-3">
                  <span className="font-display font-bold text-lg text-foreground">{rel.version}</span>
                  <span className="text-xs text-muted-foreground">{rel.date}</span>
                </div>
                <span className="sherivs-badge-verified text-[10px] px-2 py-0.5 rounded font-mono">Verified Release</span>
              </div>
              <h3 className="font-semibold text-sm text-foreground mb-3">{rel.summary}</h3>
              <ul className="space-y-2 text-xs text-muted-foreground">
                {rel.changes.map((c) => (
                  <li key={c} className="flex items-start gap-2">
                    <CheckCircle2 className="size-3.5 text-cyan-400 shrink-0 mt-0.5" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
