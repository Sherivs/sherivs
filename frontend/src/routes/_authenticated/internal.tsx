import { createFileRoute, Link } from "@tanstack/react-router";
import { RoleGuard } from "@/components/role-guard";
import { useApp } from "@/contexts/app-context";
import { PLATFORM_NAME } from "@/lib/platform";
import {
  Building2,
  Boxes,
  Bot,
  BrainCircuit,
  Cpu,
  GraduationCap,
  LayoutDashboard,
  LineChart,
  type LucideIcon,
  Shield,
  Sparkles,
  Users,
} from "lucide-react";

/**
 * Sherivs internal operating environment (PLANE 4) — the internal HQ.
 *
 * This is NOT a customer workspace. It is where Sherivs' own workforce
 * operates: engineering, architecture, infrastructure, security, the AI
 * workforce, missions, and company intelligence. Every section links to a
 * REAL internal surface (the Sherivs Control centre, the platform
 * architecture registries, or the internal super-admin governance pages);
 * nothing here is customer-facing and nothing exposes tenant data.
 *
 * Authorization: super_admin only (internal workforce). Super admins may
 * also enter customer workspaces for support, but this is their home.
 */
export const Route = createFileRoute("/_authenticated/internal")({
  ssr: false,
  component: () => (
    <RoleGuard allow={["super_admin"]}>
      <InternalHome />
    </RoleGuard>
  ),
});

interface InternalSection {
  title: string;
  description: string;
  href: string;
  internal: boolean;
  icon: LucideIcon;
}

const SECTIONS: InternalSection[] = [
  {
    title: "Sherivs Control",
    description: "The governed operating surface: organizations, provisioning, phases, evidence.",
    href: "/command-centre",
    internal: true,
    icon: LayoutDashboard,
  },
  {
    title: "Jarvis",
    description: "Executive intelligence coordinating missions, workforce, risk, and state.",
    href: "/command-centre",
    internal: true,
    icon: BrainCircuit,
  },
  {
    title: "Missions",
    description: "Mission registry and workforce delegation across the platform.",
    href: "/super-admin/worker-missions",
    internal: true,
    icon: Boxes,
  },
  {
    title: "AI Workforce",
    description: "Agent governance: lifecycle, permissions, and verification boundaries.",
    href: "/super-admin/agent-governance",
    internal: true,
    icon: Bot,
  },
  {
    title: "Engineering",
    description: "Kernel capability registry and phase contract coverage — internal architecture.",
    href: "/platform",
    internal: true,
    icon: Cpu,
  },
  {
    title: "Architecture",
    description: "The internal platform organization, generated from role reality.",
    href: "/platform/org",
    internal: true,
    icon: Boxes,
  },
  {
    title: "Infrastructure",
    description: "Platform configuration, infrastructure readiness, and preflight gates.",
    href: "/super-admin/platform-config",
    internal: true,
    icon: Cpu,
  },
  {
    title: "Security",
    description: "Trust fabric: security invariants, governance, and audit surfaces.",
    href: "/super-admin/trust-fabric",
    internal: true,
    icon: Shield,
  },
  {
    title: "Product",
    description: "Runtime registry — what is installed, and what each runtime consumes.",
    href: "/runtime",
    internal: true,
    icon: Sparkles,
  },
  {
    title: "Customers",
    description: "Tenant registry and customer support operations.",
    href: "/super-admin/tenants",
    internal: true,
    icon: Users,
  },
  {
    title: "Operations",
    description: "Financial operations and platform billing.",
    href: "/super-admin/financial-operations",
    internal: true,
    icon: LineChart,
  },
  {
    title: "Company Intelligence",
    description: "Reality classes — the platform's own generated organizational model.",
    href: "/reality/company",
    internal: true,
    icon: Building2,
  },
];

function InternalHome() {
  const { superAdmin } = useApp();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <header className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {PLATFORM_NAME} internal
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {PLATFORM_NAME} HQ
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The internal {PLATFORM_NAME} operating environment — separate from the public company site
          and from every customer workspace.
          {superAdmin?.full_name ? ` Signed in as ${superAdmin.full_name}.` : ""}
        </p>
      </header>

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => (
          <li key={section.title}>
            <Link
              to={section.href}
              className="uos-card group flex h-full flex-col p-5 transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted/40 text-primary">
                  <section.icon className="size-4" aria-hidden="true" />
                </span>
                <span className="font-display text-base font-semibold">{section.title}</span>
              </span>
              <span className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                {section.description}
              </span>
              <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                Open
                <span
                  aria-hidden="true"
                  className="transition-transform group-hover:translate-x-0.5"
                >
                  →
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <footer className="mt-12 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
        <GraduationCap className="size-4 shrink-0" aria-hidden="true" />
        <p>
          Customer organizations live in their own workspaces — {PLATFORM_NAME} never mixes tenant
          operations into this environment.
        </p>
      </footer>
    </div>
  );
}
