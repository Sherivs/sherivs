import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import {
  capabilitiesForRoles,
  isPlatformRoleCode,
  PLATFORM_ROLE_LABELS,
  visibleInternalSections,
  type InternalWorkspaceSection,
} from "@/lib/platform-staff/catalogue";
import { InternalSecurityGate } from "@/components/security/internal-security-gate";
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
import { SherivsLogo } from "@/components/brand/sherivs-logo";

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
  component: InternalGate,
});

/** Super admins, or ACTIVE platform staff (SHERIVS-008); everyone else bounces. */
function InternalGate() {
  const { superAdmin, platformStaff } = useApp();
  if (superAdmin) {
    return (
      <RoleGuard allow={["super_admin"]}>
        <InternalSecurityGate>
          <InternalHome />
        </InternalSecurityGate>
      </RoleGuard>
    );
  }
  if (platformStaff)
    return (
      <InternalSecurityGate>
        <InternalHome />
      </InternalSecurityGate>
    );
  return <Navigate to="/welcome" replace />;
}

interface InternalSection extends Omit<InternalWorkspaceSection, "key"> {
  key?: string;
  internal: boolean;
  icon: LucideIcon;
}

const SECTIONS: InternalSection[] = [
  {
    title: "Support access",
    description: "Time-limited, audited read access to one customer organization.",
    href: "/internal/support",
    capability: "platform.support.handle",
    superAdminOnly: false,
    internal: true,
    icon: Users,
  },
  {
    title: "Government access",
    description: "Create jurisdictions and grant or revoke government officer accounts (audited).",
    href: "/internal/gov-access",
    capability: "platform.gov.manage",
    superAdminOnly: false,
    internal: true,
    icon: Shield,
  },
  {
    title: "Access review",
    description: "Who holds platform access, live support grants, and the staff audit trail.",
    href: "/internal/access-review",
    capability: "platform.audit.read",
    superAdminOnly: false,
    internal: true,
    icon: Shield,
  },
  {
    title: "Staff",
    description: "Invite internal Sherivs staff, assign platform roles, suspend or revoke access.",
    href: "/super-admin/staff",
    capability: "platform.staff.manage",
    superAdminOnly: true,
    internal: true,
    icon: Users,
  },
  {
    title: "Sherivs Control",
    capability: "platform.operations.read",
    // Target surface is still super-admin gated (staff access lands in Phase 4).
    superAdminOnly: true,
    description: "The governed operating surface: organizations, provisioning, phases, evidence.",
    href: "/command-centre",
    internal: true,
    icon: LayoutDashboard,
  },
  {
    title: "Jarvis",
    capability: "platform.operations.read",
    // Target surface is still super-admin gated (staff access lands in Phase 4).
    superAdminOnly: true,
    description: "Executive intelligence coordinating missions, workforce, risk, and state.",
    href: "/command-centre",
    internal: true,
    icon: BrainCircuit,
  },
  {
    title: "Missions",
    capability: "platform.operations.read",
    // Target surface is still super-admin gated (staff access lands in Phase 4).
    superAdminOnly: true,
    description: "Mission registry and workforce delegation across the platform.",
    href: "/super-admin/worker-missions",
    internal: true,
    icon: Boxes,
  },
  {
    title: "AI Workforce",
    capability: "platform.operations.read",
    // Target surface is still super-admin gated (staff access lands in Phase 4).
    superAdminOnly: true,
    description: "Agent governance: lifecycle, permissions, and verification boundaries.",
    href: "/super-admin/agent-governance",
    internal: true,
    icon: Bot,
  },
  {
    title: "Engineering",
    capability: "platform.engineering.read",
    // Target surface is still super-admin gated (staff access lands in Phase 4).
    superAdminOnly: true,
    description: "Kernel capability registry and phase contract coverage — internal architecture.",
    href: "/platform",
    internal: true,
    icon: Cpu,
  },
  {
    title: "Architecture",
    capability: "platform.engineering.read",
    // Target surface is still super-admin gated (staff access lands in Phase 4).
    superAdminOnly: true,
    description: "The internal platform organization, generated from role reality.",
    href: "/platform/org",
    internal: true,
    icon: Boxes,
  },
  {
    title: "Infrastructure",
    capability: "platform.config.read",
    // Target surface is still super-admin gated (staff access lands in Phase 4).
    superAdminOnly: true,
    description: "Platform configuration, infrastructure readiness, and preflight gates.",
    href: "/super-admin/platform-config",
    internal: true,
    icon: Cpu,
  },
  {
    title: "Security",
    capability: "platform.security.read",
    // Target surface is still super-admin gated (staff access lands in Phase 4).
    superAdminOnly: true,
    description: "Trust fabric: security invariants, governance, and audit surfaces.",
    href: "/super-admin/trust-fabric",
    internal: true,
    icon: Shield,
  },
  {
    title: "Product",
    capability: "platform.engineering.read",
    // Target surface is still super-admin gated (staff access lands in Phase 4).
    superAdminOnly: true,
    description: "Runtime registry — what is installed, and what each runtime consumes.",
    href: "/runtime",
    internal: true,
    icon: Sparkles,
  },
  {
    title: "Customers",
    capability: "platform.tenants.read",
    // Target surface is still super-admin gated (staff access lands in Phase 4).
    superAdminOnly: true,
    description: "Tenant registry and customer support operations.",
    href: "/super-admin/tenants",
    internal: true,
    icon: Users,
  },
  {
    title: "Operations",
    capability: "platform.finance.read",
    // Target surface is still super-admin gated (staff access lands in Phase 4).
    superAdminOnly: true,
    description: "Financial operations and platform billing.",
    href: "/super-admin/financial-operations",
    internal: true,
    icon: LineChart,
  },
  {
    title: "Company Intelligence",
    capability: "platform.operations.read",
    // Target surface is still super-admin gated (staff access lands in Phase 4).
    superAdminOnly: true,
    description: "Reality classes — the platform's own generated organizational model.",
    href: "/reality/company",
    internal: true,
    icon: Building2,
  },
];

function InternalHome() {
  const { superAdmin, platformStaff } = useApp();
  const roles = (platformStaff?.roles ?? []).filter(isPlatformRoleCode);
  const sections = visibleInternalSections(SECTIONS, {
    isSuperAdmin: Boolean(superAdmin),
    capabilities: capabilitiesForRoles(roles),
  });
  const signedInAs = superAdmin?.full_name ?? platformStaff?.full_name;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <header className="max-w-2xl">
        <SherivsLogo size={40} wordmarkClassName="text-xl" className="mb-6" />
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {PLATFORM_NAME} internal
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {PLATFORM_NAME} HQ
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The internal {PLATFORM_NAME} operating environment — separate from the public company site
          and from every customer workspace.
          {signedInAs ? ` Signed in as ${signedInAs}.` : ""}
        </p>
      </header>

      {!superAdmin && platformStaff && (
        <section className="mt-8 uos-card p-5" aria-label="Your workspace">
          <h2 className="font-display text-base font-semibold">Your workspace</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Roles:{" "}
            {roles.length ? roles.map((r) => PLATFORM_ROLE_LABELS[r]).join(", ") : "none assigned"}
          </p>
          {sections.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              Your role surfaces are being opened to staff in stages. A super admin can assign
              further roles from Staff.
            </p>
          )}
        </section>
      )}

      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sections.map((section) => (
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
