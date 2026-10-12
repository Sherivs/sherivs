import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { INSTALLED_RUNTIME_NAME as SCHOLAR_RUNTIME_NAME } from "@/lib/runtime/installed-runtimes";
import { ArrowLeft, GraduationCap, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/solutions/education")({
  component: SolutionsEducationPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} Scholar — Institutional Academic Runtime` },
      {
        name: "description",
        content: "Campus operating system: gradebooks, multi-branch bursar ledgers, student tracking, and biometrics.",
      },
    ],
  }),
});

function SolutionsEducationPage() {
  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/solutions" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Solutions</span>
          </Link>
          <div className="font-mono text-xs text-cyan-400">Runtime-001: Scholar</div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12">
        <div className="max-w-3xl">
          <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Academic Runtime</span>
          <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            {PLATFORM_NAME} Scholar
          </h1>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            The canonical academic runtime installed on the {PLATFORM_NAME} substrate. Unifies the complete school lifecycle: admissions, biometrics, gradebooks, bursar split ledgers, and automated parent notifications.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="sherivs-card p-6">
            <h3 className="font-display font-bold text-base text-foreground">Role-Specific Workspaces</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Dedicated interfaces for Super Admins, Principals, Teachers, Students, Parents, Bursars, and Transit Drivers.
            </p>
          </div>
          <div className="sherivs-card p-6">
            <h3 className="font-display font-bold text-base text-foreground">Multi-Branch Bursar</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Automated fee calculations, installments, Paystack webhooks, and real-time bank reconciliation.
            </p>
          </div>
          <div className="sherivs-card p-6">
            <h3 className="font-display font-bold text-base text-foreground">Offline Transit & Attendance</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Mobile PWA with offline sync queue allowing teachers and drivers to record attendance and bus routes without active cellular coverage.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
