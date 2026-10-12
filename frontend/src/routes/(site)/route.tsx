import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import { SherivsLogo } from "@/components/brand/sherivs-logo";

/**
 * Sherivs platform public site — pathless layout group `(site)`.
 *
 * Presents the platform to visitors: what Sherivs is, its
 * capabilities, security posture, pricing, and real routes into the product
 * (sign up / sign in at /auth). Presentation only — no tenant context, no
 * database reads, no fake submissions; every interactive element links to a
 * real route.
 */

export const Route = createFileRoute("/(site)")({
  component: SiteLayout,
});

const NAV_LINKS = [
  { href: "/platform", label: "Platform" },
  { href: "/solutions", label: "Solutions" },
  { href: "/security", label: "Security" },
  { href: "/enterprise", label: "Enterprise" },
  { href: "/pricing", label: "Pricing" },
  { href: "/resources", label: "Resources" },
] as const;

const SECTION_LINKS = [
  { href: "/coregrid#capabilities", label: "Capabilities" },
  { href: "/coregrid#runtimes", label: "Runtimes" },
  { href: "/coregrid#security", label: "Security" },
  { href: "/coregrid#pricing", label: "Pricing" },
] as const;

function SiteLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <SherivsLogo size="sm" href="/" />

          <nav aria-label="Site" className="hidden md:flex items-center gap-x-6 text-sm font-medium">
            {NAV_LINKS.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className="text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {item.label}
              </Link>
            ))}
            <div className="hidden">
              {SECTION_LINKS.map((item) => (
                <a key={item.href} href={item.href}>{item.label}</a>
              ))}
            </div>
          </nav>

          <nav
            aria-label="Account"
            className="flex items-center gap-2 text-sm"
          >
            <Link
              to="/auth"
              className="rounded-md border border-border px-3 py-1.5 font-semibold transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Sign in
            </Link>
            <Link
              to="/request-demo"
              className="rounded-md bg-cyan-500 hover:bg-cyan-400 text-black px-3.5 py-1.5 font-semibold transition-all shadow-[0_0_15px_rgba(0,240,255,0.25)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Request Demo
            </Link>
          </nav>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border bg-[color:var(--surface-0)]">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-12 text-sm sm:grid-cols-2 sm:px-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <SherivsLogo size="sm" href="/" />
            <p className="mt-2 text-xs text-muted-foreground max-w-sm leading-relaxed">{PLATFORM_TAGLINE}</p>
            <p className="mt-4 text-xs text-muted-foreground/80">
              Sovereign, AI-native institutional operating system unifying people, physical twins, verified events, autonomous memory, and governed AI workforces.
            </p>
          </div>
          <nav aria-label="Platform" className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Platform
            </p>
            <Link
              to="/platform"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Kernel Overview
            </Link>
            <Link
              to="/platform/reality"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Reality Models
            </Link>
            <Link
              to="/platform/memory"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Autonomous Memory
            </Link>
            <Link
              to="/platform/ai-workforce"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              AI Workforce
            </Link>
            <Link
              to="/platform/governance"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Governance Fabric
            </Link>
          </nav>
          <nav aria-label="Solutions" className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Solutions
            </p>
            <Link
              to="/solutions/organizations"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Organizations
            </Link>
            <Link
              to="/solutions/enterprise"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Enterprise
            </Link>
            <Link
              to="/solutions/education"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Education (Scholar)
            </Link>
            <Link
              to="/solutions/ai-workforce"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Governed AI Fleet
            </Link>
            <Link
              to="/security"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Security Posture
            </Link>
          </nav>
          <nav aria-label="Company & Legal" className="grid gap-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Company & Legal
            </p>
            <Link
              to="/about"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              About
            </Link>
            <Link
              to="/careers"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Careers
            </Link>
            <Link
              to="/contact"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Contact
            </Link>
            <Link
              to="/legal/privacy"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Privacy Policy
            </Link>
            <Link
              to="/status"
              className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              System Status
            </Link>
          </nav>
        </div>
        <div className="border-t border-border py-4 text-center text-xs text-muted-foreground">
          {PLATFORM_NAME} · every runtime is a tenant of the kernel, never its owner.
        </div>
      </footer>
    </div>
  );
}
