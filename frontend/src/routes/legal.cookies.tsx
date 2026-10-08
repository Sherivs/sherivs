import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { Cookie, ShieldAlert, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/legal/cookies")({
  component: LegalCookiesPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} Cookie & Telemetry Policy` },
      {
        name: "description",
        content: `Transparent disclosure of essential session storage, telemetry boundaries, and zero third-party ad tracking in ${PLATFORM_NAME}.`,
      },
    ],
  }),
});

function LegalCookiesPage() {
  return (
    <div className="space-y-8">
      <div>
        <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Telemetry & Storage</span>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-foreground">
          Cookie & Telemetry Policy
        </h1>
        <p className="mt-2 text-xs font-mono text-muted-foreground">Effective Date: October 2026 • Version 3.0</p>
      </div>

      <div className="rounded-xl border border-border bg-[color:var(--surface-2)]/60 p-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 mb-1">
          <CheckCircle2 className="size-4" />
          <span>Zero Third-Party Advertising Trackers</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {PLATFORM_NAME} operates with zero commercial marketing ad networks, zero cross-site behavioral tracking cookies, and zero sale of telemetry data.
        </p>
      </div>

      <div className="space-y-6 text-sm text-muted-foreground leading-relaxed border-t border-border/60 pt-6">
        <section>
          <h2 className="text-base font-bold text-foreground">1. Strictly Essential Storage</h2>
          <p className="mt-2">
            We utilize secure, HTTP-only, SameSite cookies strictly necessary for authenticating institutional sessions, rotating cryptographic JWT tokens, and maintaining tenant context during navigation across the application shell.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-foreground">2. Client Performance & Preferences (Local Storage)</h2>
          <p className="mt-2">
            To provide instantaneous perceived latency, client local storage stores user interface preferences such as active theme (dark/light/system), collapsed sidebar state, recent command palette searches, and high-contrast accessibility flags. This data resides exclusively on the client device.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-foreground">3. Operational Telemetry & Health Monitoring</h2>
          <p className="mt-2">
            System performance telemetry (Core Web Vitals, API latency p95, render crashes) is collected in aggregate without personal profiling. This telemetry allows our reliability engineering teams to maintain 99.99% uptime and diagnose performance anomalies across edge nodes.
          </p>
        </section>
      </div>
    </div>
  );
}
