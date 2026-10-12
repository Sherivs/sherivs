import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import { ArrowLeft, Shield, Lock, FileText, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/legal")({
  component: LegalLayout,
});

function LegalLayout() {
  const links = [
    { name: "Privacy Policy", to: "/legal/privacy" },
    { name: "Terms of Service", to: "/legal/terms" },
    { name: "Cookie & Telemetry Policy", to: "/legal/cookies" },
    { name: "Accessibility Statement", to: "/legal/accessibility" },
  ];

  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Home</span>
          </Link>
          <SherivsLogo size="sm" showTagline={false} />
          <div className="text-xs font-mono text-muted-foreground">Legal & Governance</div>
        </div>
      </header>

      <div className="border-b border-border bg-[color:var(--surface-2)]/40">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-2 sm:gap-6 px-4 py-3 overflow-x-auto text-xs">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              activeProps={{ className: "text-cyan-400 font-semibold border-b-2 border-cyan-400 pb-1" }}
              inactiveProps={{ className: "text-muted-foreground hover:text-foreground pb-1" }}
            >
              {link.name}
            </Link>
          ))}
        </div>
      </div>

      <main className="mx-auto w-full max-w-4xl px-4 py-12">
        <Outlet />
      </main>
    </div>
  );
}
