import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, Building2, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/solutions/organizations")({
  component: SolutionsOrganizationsPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Solutions for Modern Organizations` },
      {
        name: "description",
        content: "Universal reality modeling, teams, departments, and policy control for modern institutions.",
      },
    ],
  }),
});

function SolutionsOrganizationsPage() {
  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/solutions" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Solutions</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">Organization Architecture</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Institutional Blueprint</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Universal Operating Model for Organizations
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Eliminate fragmented tools. {PLATFORM_NAME} establishes a single reality model for members, teams, assets, and workflows with automated policy enforcement and full provenance tracking.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="sherivs-card p-6">
            <h3 className="font-display font-bold text-base text-foreground">Unified People & Roles</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Fine-grained RBAC/ABAC role assignments bound to organizational positions and verified credentials.
            </p>
          </div>
          <div className="sherivs-card p-6">
            <h3 className="font-display font-bold text-base text-foreground">Continuous Audit</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Every status shift, permission elevation, and transaction is immutably recorded in PostgreSQL audit logs.
            </p>
          </div>
          <div className="sherivs-card p-6">
            <h3 className="font-display font-bold text-base text-foreground">Collaborative Workspaces</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Dynamic workspaces presenting exactly the tools and telemetry authorized for each team member's role.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
