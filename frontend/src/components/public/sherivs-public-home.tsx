import React, { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ShieldCheck,
  Brain,
  Cpu,
  Layers,
  ArrowRight,
  CheckCircle2,
  Lock,
  Sparkles,
  Workflow,
  Database,
  Globe2,
  FileCheck,
  KeyRound,
  Users,
  Activity,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import { SherivsLogo, SherivsSymbol } from "@/components/brand/sherivs-logo";
import {
  PLATFORM_NAME,
  PLATFORM_TAGLINE,
  EXECUTIVE_INTELLIGENCE_NAME,
  AI_WORKFORCE_NAME,
} from "@/lib/platform";
import { INSTALLED_RUNTIME_NAME as SCHOLAR_RUNTIME_NAME } from "@/lib/runtime/installed-runtimes";

export function SherivsPublicHome() {
  const [activeTab, setActiveTab] = useState<"reality" | "intelligence" | "missions" | "governance">("reality");

  return (
    <div className="flex min-h-dvh flex-col bg-[color:var(--surface-1)] text-foreground selection:bg-cyan-500/20 selection:text-cyan-300">
      {/* Universal Navigation Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <SherivsLogo size="md" href="/" />

          <nav aria-label="Main Navigation" className="hidden lg:flex items-center gap-6 text-sm font-medium">
            <Link to="/platform" className="text-muted-foreground hover:text-foreground transition-colors">
              Platform
            </Link>
            <Link to="/solutions" className="text-muted-foreground hover:text-foreground transition-colors">
              Solutions
            </Link>
            <Link to="/security" className="text-muted-foreground hover:text-foreground transition-colors">
              Security
            </Link>
            <Link to="/enterprise" className="text-muted-foreground hover:text-foreground transition-colors">
              Enterprise
            </Link>
            <Link to="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </Link>
            <Link to="/resources" className="text-muted-foreground hover:text-foreground transition-colors">
              Resources
            </Link>
          </nav>

          <div className="flex items-center gap-3">
            <Link
              to="/auth"
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg border border-border text-foreground hover:bg-accent transition-colors"
            >
              Sign In
            </Link>
            <Link
              to="/request-demo"
              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black shadow-[0_0_15px_rgba(0,240,255,0.25)] transition-all"
            >
              Request Demo
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* 01 — Brand Introduction & Category Statement */}
        <section className="relative overflow-hidden pt-20 pb-24 border-b border-border">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(0,240,255,0.12),transparent_70%)] pointer-events-none" />
          <div className="mx-auto max-w-7xl px-4 sm:px-6 relative">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-6">
                <span className="size-1.5 rounded-full bg-cyan-400 animate-pulse" />
                {PLATFORM_TAGLINE}
              </div>
              <h1 className="font-display text-4xl sm:text-6xl font-extrabold tracking-tight text-foreground leading-[1.08]">
                The Operating Substrate for Institutional Intelligence.
              </h1>
              <p className="mt-6 text-lg sm:text-xl text-muted-foreground leading-relaxed">
                Organizations are not databases of cards and forms. {PLATFORM_NAME} unifies people, digital twins, verified events, autonomous memory, and governed AI workforces into one sovereign technological environment.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <Link
                  to="/request-demo"
                  className="px-6 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-sm shadow-[0_0_25px_rgba(0,240,255,0.3)] transition-all inline-flex items-center gap-2"
                >
                  <span>Schedule Architecture Briefing</span>
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  to="/platform"
                  className="px-6 py-3 rounded-xl border border-border bg-card/40 hover:bg-card text-foreground font-semibold text-sm transition-colors inline-flex items-center gap-2"
                >
                  <span>Explore Kernel Specification</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </div>
            </div>

            {/* Architecture Pipeline Telemetry Visual */}
            <div className="mt-14 sherivs-card p-6 border-cyan-500/20 bg-card/60 backdrop-blur-md">
              <div className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-4 flex items-center justify-between">
                <span>Unified Institutional Architecture (V1 Execution Profile)</span>
                <span className="text-cyan-400 font-mono">51-Phase Kernel Active</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-background/50 border border-border">
                  <div className="text-[11px] font-mono text-cyan-400">LAYER 1</div>
                  <div className="text-sm font-bold mt-1 text-foreground">Reality Kernel</div>
                  <p className="text-xs text-muted-foreground mt-1">Bitemporal state, entities, relationships, signed observations.</p>
                </div>
                <div className="p-4 rounded-lg bg-background/50 border border-border">
                  <div className="text-[11px] font-mono text-violet-400">LAYER 2</div>
                  <div className="text-sm font-bold mt-1 text-foreground">Autonomous Memory</div>
                  <p className="text-xs text-muted-foreground mt-1">Tier-1 & Tier-2 vector indexing, knowledge currency, zero hallucination.</p>
                </div>
                <div className="p-4 rounded-lg bg-background/50 border border-border">
                  <div className="text-[11px] font-mono text-amber-400">LAYER 3</div>
                  <div className="text-sm font-bold mt-1 text-foreground">Mission Orchestrator</div>
                  <p className="text-xs text-muted-foreground mt-1">Governed intent, lease acquisition, worker dispatch, dual-control.</p>
                </div>
                <div className="p-4 rounded-lg bg-background/50 border border-border">
                  <div className="text-[11px] font-mono text-emerald-400">LAYER 4</div>
                  <div className="text-sm font-bold mt-1 text-foreground">Evidence & Audit</div>
                  <p className="text-xs text-muted-foreground mt-1">Independent verification, immutable cryptographic provenance.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 02 — Category Explanation */}
        <section className="py-20 border-b border-border bg-[color:var(--surface-2)]/30">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400">02 · The Problem</p>
              <h2 className="mt-2 font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Why Institutions Require a Sovereign Intelligence Layer
              </h2>
              <p className="mt-4 text-sm sm:text-base text-muted-foreground leading-relaxed">
                Legacy enterprise software traps institutional knowledge in siloed relational tables and disconnected SaaS portals. LLM wrappers introduce dangerous hallucinations and security leaks. Sherivs introduces a mathematical reality layer that governs AI operations with the same rigor applied to financial ledgers.
              </p>
            </div>

            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="sherivs-card p-6">
                <div className="size-10 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mb-4">
                  <Lock className="size-5" />
                </div>
                <h3 className="font-display font-bold text-base text-foreground">Zero Client Trust</h3>
                <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  Client-side tokens and frontend role guards are never security boundaries. Every mutation is authorized by PostgreSQL Row Level Security (RLS) and server functions.
                </p>
              </div>

              <div className="sherivs-card p-6">
                <div className="size-10 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 flex items-center justify-center mb-4">
                  <Brain className="size-5" />
                </div>
                <h3 className="font-display font-bold text-base text-foreground">Canonical Truth Separation</h3>
                <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  AI inferences, predictions, and recommendations can never overwrite verified database truth. Reality facts and derived intelligence exist in strictly partitioned planes.
                </p>
              </div>

              <div className="sherivs-card p-6">
                <div className="size-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4">
                  <FileCheck className="size-5" />
                </div>
                <h3 className="font-display font-bold text-base text-foreground">Dual-Control Evidence</h3>
                <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">
                  No autonomous worker can verify its own output. Critical actions require independent, dual-control verification before being committed to production state.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 03 & 04 & 05 & 06 — Interactive Platform Engine Demo */}
        <section className="py-20 border-b border-border">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400">03–06 · Platform Substrate</p>
                <h2 className="mt-2 font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                  Coherent Technological Environment
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Explore how reality models, executive intelligence, workforce, and verification interconnect.
                </p>
              </div>

              {/* Segmented Controller */}
              <div className="inline-flex rounded-xl p-1 bg-[color:var(--surface-3)] border border-border">
                <button
                  onClick={() => setActiveTab("reality")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    activeTab === "reality" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Reality Model
                </button>
                <button
                  onClick={() => setActiveTab("intelligence")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    activeTab === "intelligence" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {EXECUTIVE_INTELLIGENCE_NAME} (AI)
                </button>
                <button
                  onClick={() => setActiveTab("missions")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    activeTab === "missions" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Missions & Workforce
                </button>
                <button
                  onClick={() => setActiveTab("governance")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                    activeTab === "governance" ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Governance Fabric
                </button>
              </div>
            </div>

            {/* Interactive Tab Panels */}
            <div className="sherivs-card p-6 md:p-8 bg-[color:var(--surface-2)]">
              {activeTab === "reality" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                  <div>
                    <span className="text-xs uppercase font-mono text-cyan-400">Canonical Reality Layer</span>
                    <h3 className="font-display text-xl font-bold text-foreground mt-2">
                      Entities, Relationships, and Signed Observations
                    </h3>
                    <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                      Every physical person, building, device, curriculum, and financial ledger entry is represented as a verified bitemporal reality object (`cg_entity`). Relationships preserve provenance, validity intervals, and confidence bounds.
                    </p>
                    <ul className="mt-6 space-y-2.5 text-xs text-foreground/90">
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                        <span>Bitemporal state tracking (system-time vs valid-time)</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                        <span>Signed observation ingestion via Hermes sensor adapters</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                        <span>Zero schema contamination: neutral platform substrate</span>
                      </li>
                    </ul>
                    <div className="mt-6">
                      <Link to="/platform/reality" className="text-xs font-semibold text-cyan-400 hover:underline inline-flex items-center gap-1">
                        <span>Read reality kernel specifications</span>
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </div>
                  </div>
                  <div className="p-4 rounded-xl sherivs-surface-0 border border-border font-mono text-xs text-muted-foreground overflow-x-auto">
                    <div className="text-cyan-400 mb-2">// Sample Canonical Reality Object</div>
                    <pre className="text-[11px] leading-relaxed text-foreground/90">
{`{
  "entity_id": "ent_01j9a8...f42",
  "tenant_id": "org_sovereign_alpha",
  "class": "physical_twin:campus_node",
  "state": "operational",
  "bitemporal": {
    "valid_from": "2026-10-01T00:00:00Z",
    "recorded_at": "2026-10-08T21:24:00Z"
  },
  "provenance": {
    "signer": "hermes:sensor_gateway_04",
    "signature": "ed25519:7b3a9e...11c"
  }
}`}
                    </pre>
                  </div>
                </div>
              )}

              {activeTab === "intelligence" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                  <div>
                    <span className="text-xs uppercase font-mono text-violet-400">Executive Intelligence</span>
                    <h3 className="font-display text-xl font-bold text-foreground mt-2">
                      {EXECUTIVE_INTELLIGENCE_NAME} — Sovereign Orchestration
                    </h3>
                    <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                      {EXECUTIVE_INTELLIGENCE_NAME} is an executive orchestrator and mission coordinator operating under strict constitutional boundaries. It inspects telemetry, summarizes multi-tenant anomalies, and proposes governed actions for human sign-off.
                    </p>
                    <div className="mt-6 space-y-2 text-xs">
                      <div className="sherivs-ai-observation">
                        <strong>[Observation]:</strong> Grounded reality facts from the live database.
                      </div>
                      <div className="sherivs-ai-inference">
                        <strong>[Inference]:</strong> Statistical trends and semantic correlation.
                      </div>
                      <div className="sherivs-ai-recommendation">
                        <strong>[Recommendation]:</strong> Proposed organizational actions.
                      </div>
                    </div>
                    <div className="mt-6">
                      <Link to="/platform/intelligence" className="text-xs font-semibold text-cyan-400 hover:underline inline-flex items-center gap-1">
                        <span>Inspect executive intelligence contract</span>
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </div>
                  </div>
                  <div className="p-4 rounded-xl sherivs-surface-0 border border-border font-mono text-xs text-muted-foreground overflow-x-auto">
                    <div className="text-violet-400 mb-2">// Jarvis Constitutional Invariants</div>
                    <pre className="text-[11px] leading-relaxed text-foreground/90">
{`Part 15 Prohibitions (Fail-Closed):
• authorization_bypass: DENIED
• secret_access: DENIED
• governance_mutation: DENIED
• state_fabrication: DENIED
• self_authority_grant: DENIED
• dual_control_override: DENIED

Result: Sovereign human supremacy preserved.`}
                    </pre>
                  </div>
                </div>
              )}

              {activeTab === "missions" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                  <div>
                    <span className="text-xs uppercase font-mono text-amber-400">Workforce & Missions</span>
                    <h3 className="font-display text-xl font-bold text-foreground mt-2">
                      {AI_WORKFORCE_NAME} Operating under Bounded Leases
                    </h3>
                    <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                      AI workers are persistent, registered actors (`cg_worker_definition`) bound to finite, revocable leases. They do not roam unrestricted; they execute explicit missions with bounded tool permissions and strict timeout horizons.
                    </p>
                    <div className="mt-6 p-3 rounded-lg bg-background/50 border border-border flex items-center justify-between text-xs font-mono">
                      <span>Intent → Lease → Execute → Evidence → Verify</span>
                    </div>
                    <div className="mt-6">
                      <Link to="/platform/ai-workforce" className="text-xs font-semibold text-cyan-400 hover:underline inline-flex items-center gap-1">
                        <span>Explore AI workforce architecture</span>
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </div>
                  </div>
                  <div className="p-4 rounded-xl sherivs-surface-0 border border-border font-mono text-xs text-muted-foreground overflow-x-auto">
                    <div className="text-amber-400 mb-2">// Governed Worker Lease Record</div>
                    <pre className="text-[11px] leading-relaxed text-foreground/90">
{`{
  "lease_id": "lease_01je9...a7",
  "worker_id": "worker_audit_agent_03",
  "mission_id": "mission_reconcile_q3",
  "granted_capabilities": ["read_reality", "verify_hash"],
  "prohibited_tools": ["write_database", "disburse_funds"],
  "lease_expiry": "2026-10-08T22:00:00Z",
  "heartbeat_interval_ms": 30000
}`}
                    </pre>
                  </div>
                </div>
              )}

              {activeTab === "governance" && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                  <div>
                    <span className="text-xs uppercase font-mono text-emerald-400">Zero-Trust Governance</span>
                    <h3 className="font-display text-xl font-bold text-foreground mt-2">
                      Layered Authorization & Row Level Security
                    </h3>
                    <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                      Security in {PLATFORM_NAME} is continuous. Every request reconciles Identity + Tenant + Role + Relationship + Resource + Action + Policy. Application code is never the only security layer.
                    </p>
                    <ul className="mt-6 space-y-2.5 text-xs text-foreground/90">
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                        <span>PostgreSQL Row Level Security on all tenant tables</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                        <span>Tenant isolation: Tenant A cannot observe Tenant B</span>
                      </li>
                      <li className="flex items-center gap-2">
                        <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                        <span>Immutable cryptographic audit logs for every state change</span>
                      </li>
                    </ul>
                    <div className="mt-6">
                      <Link to="/security" className="text-xs font-semibold text-cyan-400 hover:underline inline-flex items-center gap-1">
                        <span>Review enterprise security posture</span>
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </div>
                  </div>
                  <div className="p-4 rounded-xl sherivs-surface-0 border border-border font-mono text-xs text-muted-foreground overflow-x-auto">
                    <div className="text-emerald-400 mb-2">// Continuous Evaluation Pipeline</div>
                    <pre className="text-[11px] leading-relaxed text-foreground/90">
{`Observe
  ↓
Evaluate Context
  ↓
Policy Check (ABAC/PBAC/ReBAC)
  ↓
Row Level Security Check
  ↓
Enforce Decision: [ALLOW | DENY | DUAL_CONTROL]
  ↓
Cryptographic Audit Commit`}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 08 — Domain Runtimes: Sherivs Scholar */}
        <section className="py-20 border-b border-border bg-[color:var(--surface-2)]/30">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400">08 · Domain Runtime Architecture</p>
              <h2 className="mt-2 font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                Modular Runtimes Installed on the Sovereign Kernel
              </h2>
              <p className="mt-4 text-sm sm:text-base text-muted-foreground leading-relaxed">
                The {PLATFORM_NAME} platform remains domain-agnostic. Industry verticals are installed as governed runtimes that map specific institutional ontologies onto universal primitives.
              </p>
            </div>

            <div className="mt-12 p-8 rounded-2xl sherivs-card border-cyan-500/30 bg-gradient-to-br from-card/80 to-[color:var(--surface-2)]">
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                <div>
                  <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-cyan-500/10 text-cyan-400 text-xs font-mono font-semibold mb-3">
                    RUNTIME-001 INSTALLED
                  </div>
                  <h3 className="font-display text-2xl font-bold text-foreground">
                    {SCHOLAR_RUNTIME_NAME} — Education & Academic Runtime
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground max-w-2xl leading-relaxed">
                    A premier institutional operating system for universities, academies, and school networks. Covers admissions, digital gradebooks, multi-branch bursar reconciliation, biometrics, student tracking, and automated parent communication.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Link
                    to="/solutions/education"
                    className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs transition-colors"
                  >
                    Explore Scholar Runtime
                  </Link>
                </div>
              </div>

              <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4 pt-6 border-t border-border">
                <div>
                  <div className="text-xs font-semibold text-foreground">50+ Governed Portals</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Admin, Teacher, Student, Parent, Bursar</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-foreground">Bursar Ledger</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Automated fee splits, Paystack reconciliation</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-foreground">AI Academic Tutor</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Grounded strictly in verified syllabus</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-foreground">Offline Resilience</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Full attendance and grading offline queue</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 11 & 12 — Future Vision & Sovereign CTA */}
        <section className="py-24 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(0,240,255,0.08),transparent_60%)] pointer-events-none" />
          <div className="mx-auto max-w-4xl px-4 sm:px-6 text-center relative">
            <SherivsSymbol size={48} className="mx-auto mb-6" luminous />
            <h2 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-foreground">
              Built for Institutional Longevity.
            </h2>
            <p className="mt-6 text-base sm:text-lg text-muted-foreground leading-relaxed">
              Step into the new category of Institutional Intelligence Infrastructure. Deploy on sovereign private cloud or managed infrastructure with complete data sovereignty, mathematical verification, and governed AI.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-4">
              <Link
                to="/request-demo"
                className="px-8 py-3.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-sm shadow-[0_0_30px_rgba(0,240,255,0.35)] transition-all"
              >
                Request Sovereign Demo
              </Link>
              <Link
                to="/platform"
                className="px-8 py-3.5 rounded-xl border border-border bg-card/40 hover:bg-card text-foreground font-semibold text-sm transition-colors"
              >
                Inspect Technical Documentation
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Enterprise Footer */}
      <footer className="border-t border-border bg-[color:var(--surface-0)] text-xs text-muted-foreground py-14">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            <div className="col-span-2">
              <SherivsLogo size="sm" href="/" />
              <p className="mt-3 text-xs text-muted-foreground max-w-sm leading-relaxed">
                {PLATFORM_TAGLINE}. The unified technological operating system for sovereign institutions, enterprise networks, and governed AI workforces.
              </p>
              <div className="mt-4 flex items-center gap-2 text-[11px] font-mono text-emerald-400">
                <span className="size-2 rounded-full bg-emerald-400" />
                <span>All systems operational · sherivs.com</span>
              </div>
            </div>

            <div>
              <div className="font-semibold text-foreground uppercase tracking-wider text-[11px] mb-3">Platform</div>
              <ul className="space-y-2">
                <li><Link to="/platform" className="hover:text-foreground">Kernel Overview</Link></li>
                <li><Link to="/platform/reality" className="hover:text-foreground">Reality Models</Link></li>
                <li><Link to="/platform/memory" className="hover:text-foreground">Autonomous Memory</Link></li>
                <li><Link to="/platform/ai-workforce" className="hover:text-foreground">AI Workforce</Link></li>
                <li><Link to="/platform/missions" className="hover:text-foreground">Mission Lifecycle</Link></li>
                <li><Link to="/platform/governance" className="hover:text-foreground">Governance Fabric</Link></li>
              </ul>
            </div>

            <div>
              <div className="font-semibold text-foreground uppercase tracking-wider text-[11px] mb-3">Solutions</div>
              <ul className="space-y-2">
                <li><Link to="/solutions/organizations" className="hover:text-foreground">Organizations</Link></li>
                <li><Link to="/solutions/enterprise" className="hover:text-foreground">Enterprise</Link></li>
                <li><Link to="/solutions/education" className="hover:text-foreground">Education (Scholar)</Link></li>
                <li><Link to="/solutions/operations" className="hover:text-foreground">Operations</Link></li>
                <li><Link to="/solutions/ai-workforce" className="hover:text-foreground">AI Workforce</Link></li>
                <li><Link to="/security" className="hover:text-foreground">Security Posture</Link></li>
              </ul>
            </div>

            <div>
              <div className="font-semibold text-foreground uppercase tracking-wider text-[11px] mb-3">Resources & Legal</div>
              <ul className="space-y-2">
                <li><Link to="/resources/blog" className="hover:text-foreground">Blog & Insights</Link></li>
                <li><Link to="/resources/docs" className="hover:text-foreground">Documentation</Link></li>
                <li><Link to="/resources/case-studies" className="hover:text-foreground">Case Studies</Link></li>
                <li><Link to="/legal/privacy" className="hover:text-foreground">Privacy Policy</Link></li>
                <li><Link to="/legal/terms" className="hover:text-foreground">Terms of Service</Link></li>
                <li><Link to="/status" className="hover:text-foreground">System Status</Link></li>
              </ul>
            </div>
          </div>

          <div className="pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px]">
            <div>
              © 2026 {PLATFORM_NAME} Inc. Sovereign Institutional Operating System. All rights reserved.
            </div>
            <div className="flex items-center gap-6">
              <Link to="/legal/privacy" className="hover:text-foreground">Privacy</Link>
              <Link to="/legal/terms" className="hover:text-foreground">Terms</Link>
              <Link to="/legal/cookies" className="hover:text-foreground">Cookies</Link>
              <Link to="/legal/accessibility" className="hover:text-foreground">Accessibility (WCAG 2.2)</Link>
              <Link to="/status" className="hover:text-foreground">Status</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
