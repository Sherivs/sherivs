import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PLATFORM_NAME } from "@/lib/platform";
import {
  KERNEL_CAPABILITIES,
  type KernelCapability,
} from "@/lib/kernel/kernel-capability-registry";
import { phaseContractCoverageSnapshot } from "@/lib/kernel/phase-contracts";
import { foundationStandardsSnapshot } from "@/lib/foundation-standards";
import { scholarConsumedKernelCapabilities } from "@/lib/runtime/scholar-consumption";

export const Route = createFileRoute("/platform")({
  ssr: false,
  component: Platform,
  // Internal engineering surface: kernel capabilities, phase contracts and
  // coverage are internal architecture, never public product navigation.
  // Server-side session check keeps it off the public surface.
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
  },
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} internal — architecture & kernel contracts` },
      {
        name: "description",
        content: "Internal Sherivs engineering surface — for authorized Sherivs operators only.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:type", content: "website" },
    ],
  }),
});

function groupByPhase(capabilities: readonly KernelCapability[]): Array<{
  phase: string;
  capabilities: KernelCapability[];
}> {
  const groups = new Map<string, KernelCapability[]>();
  for (const capability of capabilities) {
    const list = groups.get(capability.ownerPhase) ?? [];
    list.push(capability);
    groups.set(capability.ownerPhase, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([phase, capabilities]) => ({ phase, capabilities }));
}

function Platform() {
  const phaseGroups = groupByPhase(KERNEL_CAPABILITIES);
  const foundation = foundationStandardsSnapshot();
  const scholar = scholarConsumedKernelCapabilities();
  const coverage = phaseContractCoverageSnapshot();

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <div className="font-display text-lg font-bold">{PLATFORM_NAME} · Internal</div>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/" className="text-muted-foreground hover:text-foreground">
              Sherivs Control
            </Link>
            <a href="/auth" className="text-muted-foreground hover:text-foreground">
              Sign in
            </a>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-10">
        <section className="mb-10">
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            One platform. Every organization. Their rules.
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Sherivs is a governed intelligence platform. Whatever an organization runs — a school, a
            ministry, a company — Sherivs adapts: identity and tenancy first, then the workspace and
            domain surfaces the organization actually uses. Nothing is forced on anyone.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="font-display text-xl font-semibold">
            The foundation standards behind every capability
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Capability <code className="font-mono text-xs">{foundation.capabilityId}</code> is owned
            by Phase 01 and is the one every other phase consumes. It provides the verification
            contracts the platform enforces on itself:
          </p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {foundation.standards.map((standard) => (
              <li key={standard.id} className="rounded-lg border border-border p-3">
                <p className="font-mono text-xs font-semibold">{standard.id}</p>
                <p className="mt-1 text-xs text-muted-foreground">{standard.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="font-display text-xl font-semibold">50 kernel capabilities</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every capability below is owned by a platform phase. Organizations consume the ones they
            need; runtimes never rewrite the kernel.
          </p>
        </section>

        <div className="space-y-6">
          {phaseGroups.map(({ phase, capabilities }) => (
            <section key={phase}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Phase {phase}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {capabilities.map((capability) => (
                  <article key={capability.id} className="rounded-lg border border-border p-3">
                    <h4 className="text-sm font-semibold">{capability.label}</h4>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {capability.id}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="mt-12 rounded-xl border border-border bg-muted/20 p-6">
          <h2 className="font-display text-lg font-semibold">
            The first installed runtime consumes {scholar.length} kernel capabilities
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A school inherits the platform's governed core — identity, tenancy, security,
            workspaces, AI — and adds only its own education domain. Remove that runtime and the
            kernel stays fully valid.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {scholar.map((capability) => (
              <span
                key={capability.id}
                className="rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-medium text-muted-foreground"
              >
                {capability.label}
              </span>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold">
            {coverage.total} phase contracts · {coverage.sectionsPerPhase} engineering sections each
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every phase declares the same sections — identity, ownership, boundaries, contracts,
            data model, events, workflows, security, tenancy, AI safety, observability, testing,
            integration, dependencies, risks, completion and extensions — and the claims below are
            read from the same contracts the verification chain enforces.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {coverage.byLayer.map(({ layer, phases }) => (
              <span
                key={layer}
                className="rounded-full border border-border bg-muted/20 px-3 py-1 text-[11px] font-medium"
              >
                {layer} · {phases}
              </span>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <article className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Sections complete</p>
              <p className="font-display text-lg font-semibold">
                {coverage.sectionsComplete}/{coverage.total}
              </p>
            </article>
            <article className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Connected roots</p>
              <p className="font-display text-lg font-semibold">{coverage.roots.join(", ")}</p>
            </article>
            <article className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Supervised autonomy</p>
              <p className="font-display text-lg font-semibold">
                {coverage.byAsiTier["supervised-autonomous"]}
              </p>
            </article>
            <article className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Governed autonomy</p>
              <p className="font-display text-lg font-semibold">
                {coverage.byAsiTier["governed-autonomous"] +
                  coverage.byAsiTier["civilization-scale"]}
              </p>
            </article>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="border-b border-border py-2 pr-3 font-medium">Phase</th>
                  <th className="border-b border-border py-2 pr-3 font-medium">Owned capability</th>
                  <th className="border-b border-border py-2 pr-3 font-medium">Sections</th>
                  <th className="border-b border-border py-2 pr-3 font-medium">Autonomy</th>
                  <th className="border-b border-border py-2 pr-3 font-medium">Depends on</th>
                  <th className="border-b border-border py-2 font-medium">Neutral seats</th>
                </tr>
              </thead>
              <tbody>
                {coverage.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="border-b border-border py-1.5 pr-3">
                      <span className="font-mono text-[10px] text-muted-foreground">{row.id}</span>{" "}
                      {row.name}
                    </td>
                    <td className="border-b border-border py-1.5 pr-3 font-mono text-[10px] text-muted-foreground">
                      {row.capability ?? "composes others"}
                    </td>
                    <td className="border-b border-border py-1.5 pr-3">
                      {row.sectionsDeclared}/{row.sectionsTotal}
                    </td>
                    <td className="border-b border-border py-1.5 pr-3">
                      {row.asiTier} · L{row.autonomyLevel}
                    </td>
                    <td className="border-b border-border py-1.5 pr-3">{row.dependencies}</td>
                    <td className="border-b border-border py-1.5">{row.neutralSeats}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground">
            Contracts are validated on every change: sections, capability ownership, dependency and
            consumer law, ASI invariants, neutral runtime seats and phase-name alignment with the
            canonical registry.
          </p>
        </section>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        {PLATFORM_NAME} internal engineering · governed intelligence platform · every runtime is a
        tenant of the kernel, never its owner.
      </footer>
    </div>
  );
}
