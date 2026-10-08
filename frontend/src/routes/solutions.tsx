import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ArrowLeft, Building2, Landmark, GraduationCap, ShieldAlert, Cpu, Wrench } from "lucide-react";

export const Route = createFileRoute("/solutions")({
  component: SolutionsHubPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} — Institutional Solutions Matrix` },
      {
        name: "description",
        content:
          "Explore Sherivs solutions for organizations, sovereign enterprise, education, and autonomous AI workforces.",
      },
    ],
  }),
});

function SolutionsHubPage() {
  const solutions = [
    {
      title: "Organizations",
      href: "/solutions/organizations" as const,
      icon: Building2,
      desc: "Universal reality modeling, bitemporal state tracking, and policy control for modern institutions.",
    },
    {
      title: "Enterprise & Sovereign Cloud",
      href: "/solutions/enterprise" as const,
      icon: Landmark,
      desc: "Private cloud deployments, air-gapped readiness, strict tenant isolation, and mathematical compliance.",
    },
    {
      title: "Education (Sherivs Scholar)",
      href: "/solutions/education" as const,
      icon: GraduationCap,
      desc: "Complete campus intelligence: gradebooks, multi-branch bursar ledgers, student tracking, and biometrics.",
    },
    {
      title: "Campus & Physical Operations",
      href: "/solutions/operations" as const,
      icon: Wrench,
      desc: "Digital twin telemetry, automated maintenance routing, transport fleet tracking, and facilities dispatch.",
    },
    {
      title: "Governed AI Workforce",
      href: "/solutions/ai-workforce" as const,
      icon: Cpu,
      desc: "Persistent AI worker definitions, bounded tool permissions, and dual-control verification loops.",
    },
  ];

  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            <span>Home</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">Solutions Directory</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Institutional Impact</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Tailored for High-Stakes Institutional Environments
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            {PLATFORM_NAME} provides purpose-built capability profiles across diverse institutional sectors while maintaining a unified, sovereign kernel.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          {solutions.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.href} className="sherivs-card p-6 flex flex-col justify-between">
                <div>
                  <div className="size-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center mb-4">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="font-display font-bold text-lg text-foreground">{item.title}</h3>
                  <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
                <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
                  <span className="text-xs font-mono text-muted-foreground">Solution Domain</span>
                  <Link
                    to={item.href}
                    className="text-xs font-semibold text-cyan-400 hover:underline"
                  >
                    View Details →
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
