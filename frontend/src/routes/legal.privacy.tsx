import { createFileRoute } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import { ShieldCheck, Lock, Database, EyeOff } from "lucide-react";

export const Route = createFileRoute("/legal/privacy")({
  component: LegalPrivacyPage,
  head: () => ({
    meta: [
      { title: `${PLATFORM_NAME} Global Privacy & Data Sovereignty Policy` },
      {
        name: "description",
        content: `Comprehensive institutional privacy policy, tenant data sovereignty, and AI safety protections for ${PLATFORM_NAME}.`,
      },
    ],
  }),
});

function LegalPrivacyPage() {
  return (
    <div className="space-y-8">
      <div>
        <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Institutional Privacy</span>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-foreground">
          Global Privacy & Data Sovereignty Policy
        </h1>
        <p className="mt-2 text-xs font-mono text-muted-foreground">Effective Date: October 2026 • Version 4.2</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-[color:var(--surface-2)]/60 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400 mb-1">
            <Lock className="size-4" />
            <span>Zero AI Model Training</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Institutional reality data, student records, and operational communications are NEVER used to train foundational AI or LLM models.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-[color:var(--surface-2)]/60 p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-cyan-400 mb-1">
            <Database className="size-4" />
            <span>Tenant Row-Level Security</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            PostgreSQL RLS is cryptographically enforced at the database substrate. Tenant A cannot under any condition read or modify Tenant B data.
          </p>
        </div>
      </div>

      <div className="space-y-6 text-sm text-muted-foreground leading-relaxed border-t border-border/60 pt-6">
        <section>
          <h2 className="text-base font-bold text-foreground">1. Institutional Scope & Boundary</h2>
          <p className="mt-2">
            This Policy governs all data ingested, processed, and preserved by {PLATFORM_NAME} and its associated runtimes (including Sherivs Scholar). Customer organizations retain exclusive legal and technological ownership of all organizational records, student data, faculty communications, and operational logs.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-foreground">2. Canonical Truth vs. Intelligence Isolation</h2>
          <p className="mt-2">
            Under the CoreGrid ASI Constitution and Sherivs Experience Architecture, reality records (attendance, transcripts, financial ledgers, physical telemetry) are partitioned from AI inference. AI outputs are categorized as transient intelligence and cannot overwrite canonical records without explicit, audited human-in-the-loop authorization.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-foreground">3. Student Privacy & Compliance Frameworks</h2>
          <p className="mt-2">
            Sherivs adheres strictly to international student privacy standards, including the Family Educational Rights and Privacy Act (FERPA), Children's Online Privacy Protection Act (COPPA), General Data Protection Regulation (GDPR), and UK Data Protection Act 2018. All student personal identifiers (PII) are encrypted at rest with AES-256-GCM and in transit via TLS 1.3.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-foreground">4. Bitemporal Retention & Cryptographic Erasure</h2>
          <p className="mt-2">
            All records support valid-time and transaction-time queries. When a tenant issues a verified "Right to be Forgotten" or statutory records destruction request, Sherivs executes cryptographic erasure of corresponding encryption keys, rendering the historical ciphertext irreversibly unrecoverable across all replica planes.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-foreground">5. Data Jurisdiction & Sovereign VPC Deployments</h2>
          <p className="mt-2">
            Institutions may specify geographical data residency pins (Americas, European Union, United Kingdom, APAC, African Sovereign Cloud). Multi-tenant clusters enforce local jurisdiction boundaries, with air-gapped sovereign VPC deployments available for defense, medical, and national university consortia.
          </p>
        </section>
      </div>
    </div>
  );
}
