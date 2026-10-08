import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, ShieldCheck, Lock, FileCheck, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/platform/governance")({
  component: PlatformGovernancePage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Governance, Authorization & Security Fabric` },
      {
        name: "description",
        content:
          "Layered authorization, Row Level Security, tenant boundaries, and immutable audit logs in Sherivs.",
      },
    ],
  }),
});

function PlatformGovernancePage() {
  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link
            to="/platform"
            className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            <span>Platform Hub</span>
          </Link>
          <div className="font-mono text-xs text-emerald-400">Security & Governance Fabric</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-emerald-400">Governance Fabric</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Sovereign Security & Layered Authorization
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            In {PLATFORM_NAME}, application code is never the only security layer. Security is continuous and enforced directly at the database tier via PostgreSQL Row Level Security (RLS) policies and cryptographic provenance.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="sherivs-card p-6">
            <Lock className="size-6 text-emerald-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Mandatory RLS Policies</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Every tenant table has RLS enabled. Tenant A cannot read, query, or observe Tenant B rows under any condition.
            </p>
          </div>

          <div className="sherivs-card p-6">
            <ShieldCheck className="size-6 text-cyan-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Multi-Dimensional Auth</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Layered evaluation combines Identity + Tenant + Role + Relationship + Resource + Action + Policy + Context + Risk.
            </p>
          </div>

          <div className="sherivs-card p-6">
            <FileCheck className="size-6 text-violet-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Immutable Audit Trail</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Every state change produces an append-only audit record stamped with actor reference, timestamp, and payload hash.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
