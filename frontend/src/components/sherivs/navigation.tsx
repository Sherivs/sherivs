import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { SherivsLogo, StatusBeacon } from "./brand";
import {
  Menu,
  X,
  ChevronDown,
  ArrowRight,
  Shield,
  Layers,
  Sparkles,
  Database,
  Lock,
  Cpu,
  BookOpen,
  FileCheck,
  Building,
  GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavLinkItem {
  label: string;
  href: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
}

const PLATFORM_ITEMS: NavLinkItem[] = [
  { label: "Platform Overview", href: "/platform", description: "The unified operating system for institutional reality", icon: Layers },
  { label: "Reality Substrate", href: "/platform/reality", description: "Canonical models of physical & digital organizational state", icon: Database },
  { label: "AI Workforce", href: "/platform/ai-workforce", description: "Governed autonomous workers operating alongside humans", icon: Cpu },
  { label: "Mission Engine", href: "/platform/missions", description: "Goal-oriented planning, execution & verifiable outcomes", icon: Sparkles },
  { label: "Institutional Memory", href: "/platform/memory", description: "Tamper-proof provenance & relationship knowledge graph", icon: BookOpen },
  { label: "Security & Zero Trust", href: "/platform/governance", description: "Cryptographic policy enforcement & row-level security", icon: Lock },
];

const SOLUTION_ITEMS: NavLinkItem[] = [
  { label: "Enterprises & Holdings", href: "/solutions/enterprise", description: "Multi-tenant operating layer for corporate scale", icon: Building },
  { label: "Education & Scholar", href: "/solutions/education", description: "The Sherivs Scholar institutional runtime", icon: GraduationCap },
  { label: "Operational Command", href: "/solutions/operations", description: "Real-time dispatch, assets, facilities & logistics", icon: Layers },
  { label: "Governed AI Workforce", href: "/solutions/ai-workforce", description: "Autonomous AI agents bound by human policy", icon: Cpu },
];

export function SherivsPublicNavbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [platformOpen, setPlatformOpen] = useState(false);
  const [solutionsOpen, setSolutionsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/80 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link to="/" className="flex items-center gap-2.5 focus-visible:outline-2 focus-visible:outline-cyan-500">
            <SherivsLogo size="md" glow />
          </Link>

          {/* Desktop Navigation */}
          <nav aria-label="Main" className="hidden lg:flex items-center gap-1 text-sm font-medium">
            {/* Platform Dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setPlatformOpen(true)}
              onMouseLeave={() => setPlatformOpen(false)}
            >
              <button
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                aria-expanded={platformOpen}
              >
                Platform
                <ChevronDown className={cn("size-3.5 transition-transform duration-200", platformOpen && "rotate-180")} />
              </button>

              {platformOpen && (
                <div className="absolute left-0 top-full w-96 p-2 rounded-xl border border-border/80 bg-popover/95 backdrop-blur-2xl shadow-2xl animate-fade-in">
                  <div className="grid gap-1">
                    {PLATFORM_ITEMS.map((item) => (
                      <Link
                        key={item.href}
                        to={item.href}
                        className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/70 transition-colors group"
                      >
                        {item.icon && <item.icon className="size-4 mt-0.5 text-cyan-400 shrink-0" />}
                        <div>
                          <div className="text-sm font-semibold text-foreground group-hover:text-cyan-400 transition-colors">
                            {item.label}
                          </div>
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {item.description}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Solutions Dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setSolutionsOpen(true)}
              onMouseLeave={() => setSolutionsOpen(false)}
            >
              <button
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                aria-expanded={solutionsOpen}
              >
                Solutions
                <ChevronDown className={cn("size-3.5 transition-transform duration-200", solutionsOpen && "rotate-180")} />
              </button>

              {solutionsOpen && (
                <div className="absolute left-0 top-full w-80 p-2 rounded-xl border border-border/80 bg-popover/95 backdrop-blur-2xl shadow-2xl animate-fade-in">
                  <div className="grid gap-1">
                    {SOLUTION_ITEMS.map((item) => (
                      <Link
                        key={item.href}
                        to={item.href}
                        className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-muted/70 transition-colors group"
                      >
                        {item.icon && <item.icon className="size-4 mt-0.5 text-blue-400 shrink-0" />}
                        <div>
                          <div className="text-sm font-semibold text-foreground group-hover:text-blue-400 transition-colors">
                            {item.label}
                          </div>
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            {item.description}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Link
              to="/security"
              className="px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              Security
            </Link>
            <Link
              to="/pricing"
              className="px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              Pricing
            </Link>
            <Link
              to="/resources"
              className="px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              Resources
            </Link>
            <Link
              to="/about"
              className="px-3 py-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              About
            </Link>
          </nav>
        </div>

        {/* Action Triggers */}
        <div className="hidden sm:flex items-center gap-3">
          <Link
            to="/auth"
            className="px-3.5 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign in
          </Link>
          <Link
            to="/request-demo"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:opacity-90 transition-all shadow-md hover:shadow-cyan-500/20"
          >
            Request Demo
            <ArrowRight className="size-3.5" />
          </Link>
        </div>

        {/* Mobile menu button */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:outline-cyan-500"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X className="size-6" /> : <Menu className="size-6" />}
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="lg:hidden border-b border-border bg-background/98 px-4 pt-2 pb-6 space-y-4">
          <nav className="grid gap-2">
            <Link to="/platform" onClick={() => setMobileOpen(false)} className="px-3 py-2 font-medium rounded-md hover:bg-muted">
              Platform Overview
            </Link>
            <Link to="/solutions" onClick={() => setMobileOpen(false)} className="px-3 py-2 font-medium rounded-md hover:bg-muted">
              Solutions
            </Link>
            <Link to="/security" onClick={() => setMobileOpen(false)} className="px-3 py-2 font-medium rounded-md hover:bg-muted">
              Security & Trust
            </Link>
            <Link to="/pricing" onClick={() => setMobileOpen(false)} className="px-3 py-2 font-medium rounded-md hover:bg-muted">
              Pricing
            </Link>
            <Link to="/resources" onClick={() => setMobileOpen(false)} className="px-3 py-2 font-medium rounded-md hover:bg-muted">
              Resources & Docs
            </Link>
            <Link to="/about" onClick={() => setMobileOpen(false)} className="px-3 py-2 font-medium rounded-md hover:bg-muted">
              Company
            </Link>
            <div className="pt-2 border-t border-border flex flex-col gap-2">
              <Link to="/auth" onClick={() => setMobileOpen(false)} className="w-full text-center py-2.5 rounded-lg border border-border font-medium">
                Sign In
              </Link>
              <Link to="/request-demo" onClick={() => setMobileOpen(false)} className="w-full text-center py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold">
                Request Demo
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

export function SherivsPublicFooter() {
  return (
    <footer className="border-t border-border bg-background/95 text-foreground">
      <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-5">
          {/* Brand info */}
          <div className="col-span-2">
            <SherivsLogo size="md" showTagline />
            <p className="mt-4 max-w-sm text-sm text-muted-foreground leading-relaxed">
              Sherivs is the AI-native institutional operating system. Unifying reality models,
              governed missions, and autonomous intelligence systems into one verifiable ecosystem.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <Link to="/status">
                <StatusBeacon status="operational" label="Systems 100% Operational" />
              </Link>
            </div>
          </div>

          {/* Platform */}
          <div>
            <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Platform
            </h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><Link to="/platform" className="hover:text-cyan-400 transition-colors">Architecture</Link></li>
              <li><Link to="/platform/reality" className="hover:text-cyan-400 transition-colors">Reality Substrate</Link></li>
              <li><Link to="/platform/ai-workforce" className="hover:text-cyan-400 transition-colors">AI Workforce</Link></li>
              <li><Link to="/platform/missions" className="hover:text-cyan-400 transition-colors">Mission Model</Link></li>
              <li><Link to="/platform/memory" className="hover:text-cyan-400 transition-colors">Memory & Graph</Link></li>
              <li><Link to="/platform/governance" className="hover:text-cyan-400 transition-colors">Zero Trust Defense</Link></li>
            </ul>
          </div>

          {/* Solutions & Resources */}
          <div>
            <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Solutions & Docs
            </h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><Link to="/solutions/enterprise" className="hover:text-cyan-400 transition-colors">Enterprise Systems</Link></li>
              <li><Link to="/solutions/education" className="hover:text-cyan-400 transition-colors">Sherivs Scholar</Link></li>
              <li><Link to="/solutions/operations" className="hover:text-cyan-400 transition-colors">Operational Command</Link></li>
              <li><Link to="/resources/docs" className="hover:text-cyan-400 transition-colors">Developer Docs</Link></li>
              <li><Link to="/resources/guides" className="hover:text-cyan-400 transition-colors">Guides & Playbooks</Link></li>
              <li><Link to="/resources/blog" className="hover:text-cyan-400 transition-colors">Research Journal</Link></li>
            </ul>
          </div>

          {/* Company & Legal */}
          <div>
            <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Company & Trust
            </h3>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><Link to="/about" className="hover:text-cyan-400 transition-colors">About Sherivs</Link></li>
              <li><Link to="/careers" className="hover:text-cyan-400 transition-colors">Careers</Link></li>
              <li><Link to="/security" className="hover:text-cyan-400 transition-colors">Trust Fabric</Link></li>
              <li><Link to="/pricing" className="hover:text-cyan-400 transition-colors">Pricing</Link></li>
              <li><Link to="/legal/privacy" className="hover:text-cyan-400 transition-colors">Privacy Policy</Link></li>
              <li><Link to="/legal/terms" className="hover:text-cyan-400 transition-colors">Terms of Service</Link></li>
              <li><Link to="/legal/accessibility" className="hover:text-cyan-400 transition-colors">Accessibility (WCAG)</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-border pt-8 flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} Sherivs Inc. All rights reserved. Institutional Intelligence Infrastructure.</p>
          <div className="flex items-center gap-6">
            <Link to="/status" className="hover:text-foreground">System Status</Link>
            <Link to="/legal/cookies" className="hover:text-foreground">Cookie Settings</Link>
            <Link to="/contact" className="hover:text-foreground">Contact Headquarters</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
