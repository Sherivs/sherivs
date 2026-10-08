import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE } from "@/lib/platform";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import { ArrowLeft, Check, Sparkles, Building2, ShieldCheck, Zap, Users, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/request-demo")({
  component: RequestDemoPage,
  head: () => ({
    meta: [
      { title: `Request Interactive Demonstration — ${PLATFORM_NAME}` },
      {
        name: "description",
        content: `Schedule an institutional architecture walkthrough and live simulation of ${PLATFORM_NAME} and the Scholar runtime.`,
      },
    ],
  }),
});

function RequestDemoPage() {
  const [submitted, setSubmitted] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [demoConfig, setDemoConfig] = useState({
    institutionType: "higher-ed",
    studentCount: "10000-50000",
    deploymentModel: "dedicated",
    primaryRuntimes: ["scholar"],
    fullName: "",
    workEmail: "",
    orgName: "",
    role: "provost-cio",
    timeframe: "immediate",
  });

  const toggleRuntime = (id: string) => {
    setDemoConfig((prev) => ({
      ...prev,
      primaryRuntimes: prev.primaryRuntimes.includes(id)
        ? prev.primaryRuntimes.filter((r) => r !== id)
        : [...prev.primaryRuntimes, id],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen bg-[color:var(--surface-1)] text-foreground">
      <header className="border-b border-border bg-[color:var(--surface-1)]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" />
            <span>Home</span>
          </Link>
          <SherivsLogo size="sm" showTagline={false} />
          <Link to="/contact" className="text-xs font-semibold text-muted-foreground hover:text-foreground">
            Direct Contact →
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
          {/* Left Context: Architecture Walkthrough Highlights */}
          <div className="lg:col-span-5 space-y-8">
            <div>
              <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Institutional Simulation</span>
              <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                Experience {PLATFORM_NAME} in Action
              </h1>
              <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                Schedule a 45-minute live technical demonstration tailored to your institution’s governance policies, security perimeter, and academic scale.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-start gap-3.5 rounded-xl border border-border bg-[color:var(--surface-2)]/60 p-4">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
                  <Building2 className="size-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Live Reality Ingestion</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Observe how multi-campus telemetry, schedules, SIS feeds, and physical IoT streams converge into a unified temporal graph.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5 rounded-xl border border-border bg-[color:var(--surface-2)]/60 p-4">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                  <ShieldCheck className="size-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Dual-Control Policy Sandbox</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Test the ReBAC engine: simulate permission boundaries, airlocks, and cryptographic verification of autonomous AI actions.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3.5 rounded-xl border border-border bg-[color:var(--surface-2)]/60 p-4">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
                  <Sparkles className="size-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Jarvis Executive Briefing</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Interact with Jarvis as it synthesizes cross-departmental operations into structured evidence, observations, and recommendations.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-xs text-muted-foreground flex items-center gap-3">
              <Zap className="size-5 shrink-0 text-cyan-400" />
              <span>Includes sandbox credentials for your IT architecture and security evaluation committee.</span>
            </div>
          </div>

          {/* Right Column: Multi-Step Interactive Sizing & Booking */}
          <div className="lg:col-span-7">
            <div className="rounded-2xl border border-border bg-[color:var(--surface-2)]/90 p-6 sm:p-8 backdrop-blur-xl">
              {submitted ? (
                <div className="py-12 text-center space-y-4">
                  <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-400">
                    <Check className="size-8" />
                  </div>
                  <h2 className="text-xl font-bold text-foreground">Demonstration Environment Reserved</h2>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    We have provisioned an architecture briefing slot for <span className="text-foreground font-semibold">{demoConfig.workEmail || "your institution"}</span>. An invite with secure session credentials and sandbox access has been dispatched.
                  </p>
                  <div className="pt-4">
                    <Link
                      to="/"
                      className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-5 py-2.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition-colors"
                    >
                      Return to Platform Overview
                    </Link>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Step indicators */}
                  <div className="flex items-center justify-between border-b border-border/60 pb-4">
                    <div>
                      <span className="text-xs font-mono uppercase tracking-wider text-cyan-400">Step {step} of 2</span>
                      <h2 className="text-lg font-bold text-foreground">
                        {step === 1 ? "Institutional Profile & Scale" : "Officer Identity & Verification"}
                      </h2>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`size-2.5 rounded-full ${step >= 1 ? "bg-cyan-400" : "bg-muted"}`} />
                      <span className={`size-2.5 rounded-full ${step >= 2 ? "bg-cyan-400" : "bg-muted"}`} />
                    </div>
                  </div>

                  {step === 1 && (
                    <div className="space-y-5">
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-2">Institutional Sector</label>
                        <div className="grid grid-cols-2 gap-2.5 text-xs">
                          {[
                            { id: "higher-ed", label: "Collegiate & University Network" },
                            { id: "k12", label: "K-12 School District / Trust" },
                            { id: "research", label: "Research Institute / Laboratory" },
                            { id: "enterprise", label: "Enterprise Multi-Campus Complex" },
                          ].map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => setDemoConfig({ ...demoConfig, institutionType: t.id })}
                              className={`rounded-lg border p-3 text-left transition-all ${
                                demoConfig.institutionType === t.id
                                  ? "border-cyan-500 bg-cyan-500/10 text-foreground font-medium"
                                  : "border-border bg-[color:var(--surface-1)] text-muted-foreground hover:border-border/80"
                              }`}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-foreground mb-2">Population Scale (Students / Stakeholders)</label>
                        <select
                          value={demoConfig.studentCount}
                          onChange={(e) => setDemoConfig({ ...demoConfig, studentCount: e.target.value })}
                          className="w-full rounded-lg border border-border bg-[color:var(--surface-1)] px-3 py-2 text-sm text-foreground focus:border-cyan-500 focus:outline-none"
                        >
                          <option value="under-2500">Under 2,500 students / users</option>
                          <option value="2500-10000">2,500 – 10,000 students / users</option>
                          <option value="10000-50000">10,000 – 50,000 students / users</option>
                          <option value="50000-plus">50,000+ multi-campus consortium</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-foreground mb-2">Target Runtimes of Interest</label>
                        <div className="grid grid-cols-2 gap-2.5 text-xs">
                          {[
                            { id: "scholar", label: "Sherivs Scholar (Academic & Campus)" },
                            { id: "ai-workforce", label: "Autonomous AI Workforce" },
                            { id: "jarvis", label: "Jarvis Executive Intelligence" },
                            { id: "reality-mesh", label: "Bitemporal Reality Mesh" },
                          ].map((r) => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => toggleRuntime(r.id)}
                              className={`flex items-center gap-2 rounded-lg border p-2.5 text-left transition-all ${
                                demoConfig.primaryRuntimes.includes(r.id)
                                  ? "border-cyan-500 bg-cyan-500/10 text-foreground"
                                  : "border-border bg-[color:var(--surface-1)] text-muted-foreground"
                              }`}
                            >
                              <div
                                className={`size-3.5 rounded flex items-center justify-center border text-[9px] ${
                                  demoConfig.primaryRuntimes.includes(r.id)
                                    ? "border-cyan-500 bg-cyan-500 text-slate-950 font-bold"
                                    : "border-border"
                                }`}
                              >
                                {demoConfig.primaryRuntimes.includes(r.id) && "✓"}
                              </div>
                              <span>{r.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={() => setStep(2)}
                          className="w-full flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 transition-colors"
                        >
                          <span>Proceed to Participant Details</span>
                          <ArrowRight className="size-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {step === 2 && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-foreground mb-1.5">Official Name</label>
                          <input
                            type="text"
                            required
                            value={demoConfig.fullName}
                            onChange={(e) => setDemoConfig({ ...demoConfig, fullName: e.target.value })}
                            placeholder="Prof. Kenneth Thorne"
                            className="w-full rounded-lg border border-border bg-[color:var(--surface-1)] px-3 py-2 text-sm text-foreground focus:border-cyan-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-foreground mb-1.5">Institutional Email</label>
                          <input
                            type="email"
                            required
                            value={demoConfig.workEmail}
                            onChange={(e) => setDemoConfig({ ...demoConfig, workEmail: e.target.value })}
                            placeholder="kthorne@institution.edu"
                            className="w-full rounded-lg border border-border bg-[color:var(--surface-1)] px-3 py-2 text-sm text-foreground focus:border-cyan-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-foreground mb-1.5">Institution Name</label>
                          <input
                            type="text"
                            required
                            value={demoConfig.orgName}
                            onChange={(e) => setDemoConfig({ ...demoConfig, orgName: e.target.value })}
                            placeholder="Polytechnic University"
                            className="w-full rounded-lg border border-border bg-[color:var(--surface-1)] px-3 py-2 text-sm text-foreground focus:border-cyan-500 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-foreground mb-1.5">Role / Office</label>
                          <select
                            value={demoConfig.role}
                            onChange={(e) => setDemoConfig({ ...demoConfig, role: e.target.value })}
                            className="w-full rounded-lg border border-border bg-[color:var(--surface-1)] px-3 py-2 text-sm text-foreground focus:border-cyan-500 focus:outline-none"
                          >
                            <option value="provost-cio">CIO / Provost / Chancellor</option>
                            <option value="dean-principal">Dean / Principal / Head of School</option>
                            <option value="director-it">Director of Enterprise IT</option>
                            <option value="security-ciso">Chief Information Security Officer</option>
                            <option value="operations">Director of Campus Operations</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-4">
                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          ← Back to Scale
                        </button>
                        <button
                          type="submit"
                          className="flex items-center gap-2 rounded-lg bg-cyan-500 px-6 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 transition-colors"
                        >
                          <Sparkles className="size-4" />
                          <span>Schedule Technical Walkthrough</span>
                        </button>
                      </div>
                    </div>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
