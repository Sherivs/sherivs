import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, ShieldCheck, Lock, KeyRound, FileCheck, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/security")({
  component: SecurityPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Security Architecture & Data Sovereignty` },
      {
        name: "description",
        content: "PostgreSQL Row Level Security, layered authorization, continuous audit, and zero-trust guarantees.",
      },
    ],
  }),
});

function SecurityPage() {
  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Home</span>
          </Link>
          <div className="font-mono text-xs text-emerald-400">Security Architecture</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-emerald-400">Continuous Security</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Sovereign Security Architecture
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            Security in {PLATFORM_NAME} is not an add-on or a network firewall rule. It is a mathematical invariant woven directly into the relational schema, server functions, and execution lifecycle.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="sherivs-card p-6">
            <Lock className="size-6 text-emerald-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Database Row Level Security (RLS)</h3>
            <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Every table in the database is protected with PostgreSQL Row Level Security. Application code is never the only security layer. Even direct SQL connections cannot breach tenant boundaries.
            </p>
          </div>

          <div className="sherivs-card p-6">
            <KeyRound className="size-6 text-cyan-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Layered Authorization Model</h3>
            <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Decisions synthesize Identity + Tenant + Role + Relationship + Resource + Action + Policy + Risk. Client-supplied tenant IDs and roles are always rejected.
            </p>
          </div>

          <div className="sherivs-card p-6">
            <FileCheck className="size-6 text-violet-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Immutable Cryptographic Provenance</h3>
            <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Every state change produces an append-only audit record containing the actor's cryptographic signature, input hash, and timestamp. Tamper-evident and court-admissible.
            </p>
          </div>

          <div className="sherivs-card p-6">
            <ShieldCheck className="size-6 text-amber-400 mb-3" />
            <h3 className="font-display font-bold text-base text-foreground">Dual-Control Critical Operations</h3>
            <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
              High-consequence mutations (financial payouts, identity deletion, role elevation) require dual-control authorization from independent signatories.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
