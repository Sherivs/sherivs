import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { Scale, CheckCircle2, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/legal/terms")({
  component: LegalTermsPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} Universal Terms of Service` },
      {
        name: "description",
        content: `Master institutional subscription terms, SLA commitments, and acceptable use governance for ${PLATFORM_NAME}.`,
      },
    ],
  }),
});

function LegalTermsPage() {
  return (
    <div className="space-y-8">
      <div>
        <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Master Agreement</span>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-foreground">
          Universal Terms of Service
        </h1>
        <p className="mt-2 text-xs font-mono text-muted-foreground">Effective Date: October 2026 • Version 5.1</p>
      </div>

      <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 flex items-start gap-3 text-xs text-muted-foreground">
        <Scale className="size-4 shrink-0 text-cyan-400 mt-0.5" />
        <p>
          These Universal Terms govern access to the {PLATFORM_NAME} platform, the Sherivs Scholar runtime, Jarvis executive intelligence, and the Sherivs AI Workforce. By provisioning an institutional tenant or accessing the application shell, the subscribing entity agrees to these covenants.
        </p>
      </div>

      <div className="space-y-6 text-sm text-muted-foreground leading-relaxed border-t border-border/60 pt-6">
        <section>
          <h2 className="text-base font-bold text-foreground">1. Institutional License & Tenant Isolation</h2>
          <p className="mt-2">
            Subject to the terms of the applicable Enterprise Order Form, {PLATFORM_NAME} grants the customer a non-exclusive, world-wide, cryptographically isolated license to access and configure institutional tenants, deploy autonomous worker leases, and run designated domain runtimes across authorized campus personnel.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-foreground">2. High Availability Service Level Agreement (SLA)</h2>
          <p className="mt-2">
            {PLATFORM_NAME} commits to a minimum 99.99% monthly operational uptime for all mission-critical planes (ReBAC Authorization, Reality Ingestion, and the Universal Application Shell). Scheduled maintenance is hot-swapped without service degradation. SLA failures qualify for proportional service credits as defined in the Enterprise SLA Schedule.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-foreground">3. Governance & AI Workforce Liability Bounds</h2>
          <p className="mt-2">
            Autonomous AI workers operate strictly as governed computational delegates under tenant-configured ReBAC policies. All actions requiring financial transfer, student disciplinary sanction, or statutory reporting require dual-control human authorization. The customer retains ultimate authority over operational decisions approved through the interface.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-foreground">4. Acceptable Institutional Use</h2>
          <p className="mt-2">
            Subscribers agree not to: (a) attempt to reverse engineer or penetrate tenant isolation airlocks; (b) inject synthetic poisoned telemetry into reality models; (c) bypass cryptographic lease limits on autonomous workers; or (d) use the infrastructure for unlawful surveillance or non-consensual biometric profiling.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-foreground">5. Termination & Data Portability Guarantee</h2>
          <p className="mt-2">
            Upon expiration or termination of service, the customer may execute a zero-loss institutional export of all reality graphs, transaction ledgers, and configurations in standard open formats (Parquet, JSON-LD, PostgreSQL dump). Following verified customer verification, all tenant cryptographic keys are purged in accordance with our Privacy Policy.
          </p>
        </section>
      </div>
    </div>
  );
}
