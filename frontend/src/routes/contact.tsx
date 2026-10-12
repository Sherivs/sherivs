import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PLATFORM_NAME, PLATFORM_TAGLINE, PLATFORM_DOMAIN } from "@/lib/platform";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import { ArrowLeft, Mail, Shield, Building, Globe, Send, CheckCircle2, Lock } from "lucide-react";

export const Route = createFileRoute("/contact")({
  component: ContactPage,
  head: () => ({
    meta: [
      { title: `Contact ${PLATFORM_NAME} — Institutional Intelligence Infrastructure` },
      {
        name: "description",
        content: `Connect with ${PLATFORM_NAME} institutional engineering, enterprise solutions, or security disclosure teams.`,
      },
    ],
  }),
});

function ContactPage() {
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    organization: "",
    department: "",
    subject: "enterprise",
    message: "",
  });

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
          <Link to="/request-demo" className="text-xs font-semibold text-cyan-400 hover:text-cyan-300">
            Request Demo →
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-12 sm:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left Column: Context & Global Hubs */}
          <div className="lg:col-span-5 space-y-8">
            <div>
              <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">Direct Inquiries</span>
              <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                Institutional Contact
              </h1>
              <p className="mt-4 text-base text-muted-foreground leading-relaxed">
                Connect directly with {PLATFORM_NAME} engineering leadership, institutional deployment strategists, or security response teams.
              </p>
            </div>

            <div className="space-y-4 rounded-xl border border-border bg-[color:var(--surface-2)]/60 p-5">
              <div className="flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-cyan-500/20 bg-cyan-500/10 text-cyan-400">
                  <Mail className="size-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Institutional Deployments</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Enterprise architecture & deployment design</p>
                  <a href={`mailto:enterprise@${PLATFORM_DOMAIN}`} className="text-xs font-mono text-cyan-400 hover:underline mt-1 inline-block">
                    enterprise@{PLATFORM_DOMAIN}
                  </a>
                </div>
              </div>

              <div className="border-t border-border/50 pt-4 flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                  <Shield className="size-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Security Vulnerability Response</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">PGP-encrypted coordinated disclosure</p>
                  <a href={`mailto:security@${PLATFORM_DOMAIN}`} className="text-xs font-mono text-emerald-400 hover:underline mt-1 inline-block">
                    security@{PLATFORM_DOMAIN}
                  </a>
                </div>
              </div>

              <div className="border-t border-border/50 pt-4 flex items-start gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-400">
                  <Building className="size-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Government & Research</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">Sovereign cloud & air-gapped deployments</p>
                  <a href={`mailto:gov@${PLATFORM_DOMAIN}`} className="text-xs font-mono text-violet-400 hover:underline mt-1 inline-block">
                    gov@{PLATFORM_DOMAIN}
                  </a>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-[color:var(--surface-2)]/30 p-5">
              <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">
                <Globe className="size-3.5 text-cyan-400" />
                <span>Global Deployment Hubs</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="font-semibold text-foreground">San Francisco</p>
                  <p className="text-muted-foreground">Americas Sovereign Region</p>
                </div>
                <div>
                  <p className="font-semibold text-foreground">London</p>
                  <p className="text-muted-foreground">EMEA Data Jurisdiction</p>
                </div>
                <div>
                  <p className="font-semibold text-foreground">Singapore</p>
                  <p className="text-muted-foreground">APAC Infrastructure Hub</p>
                </div>
                <div>
                  <p className="font-semibold text-foreground">Nairobi</p>
                  <p className="text-muted-foreground">African Regional Operations</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Interactive Form */}
          <div className="lg:col-span-7">
            <div className="rounded-2xl border border-border bg-[color:var(--surface-2)]/80 p-6 sm:p-8 backdrop-blur-xl">
              {submitted ? (
                <div className="py-12 text-center space-y-4">
                  <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                    <CheckCircle2 className="size-8" />
                  </div>
                  <h2 className="text-xl font-bold text-foreground">Institutional Dispatch Received</h2>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Your transmission has been logged with audit verification. A designated {PLATFORM_NAME} infrastructure officer will contact you within 4 hours.
                  </p>
                  <button
                    onClick={() => setSubmitted(false)}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-[color:var(--surface-3)] px-4 py-2 text-xs font-medium text-foreground hover:bg-[color:var(--surface-4)]"
                  >
                    Submit another inquiry
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Transmission Form</h2>
                    <p className="text-xs text-muted-foreground mt-0.5">All transmissions are encrypted and bitemporally recorded.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">Official Name</label>
                      <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="Dr. Elena Vance"
                        className="w-full rounded-lg border border-border bg-[color:var(--surface-1)] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">Institutional Email</label>
                      <input
                        type="email"
                        required
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        placeholder="elena.vance@oxford.edu"
                        className="w-full rounded-lg border border-border bg-[color:var(--surface-1)] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">Institution / Organization</label>
                      <input
                        type="text"
                        required
                        value={formData.organization}
                        onChange={(e) => setFormData({ ...formData, organization: e.target.value })}
                        placeholder="University Consortium"
                        className="w-full rounded-lg border border-border bg-[color:var(--surface-1)] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-foreground mb-1.5">Inquiry Type</label>
                      <select
                        value={formData.subject}
                        onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                        className="w-full rounded-lg border border-border bg-[color:var(--surface-1)] px-3 py-2 text-sm text-foreground focus:border-cyan-500 focus:outline-none"
                      >
                        <option value="enterprise">Multi-Campus Deployment</option>
                        <option value="scholar">Scholar Education Runtime</option>
                        <option value="sovereign">Sovereign / Air-Gapped Cloud</option>
                        <option value="security">Security & Compliance Audit</option>
                        <option value="partnership">Academic / Research Partnership</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">Institutional Brief & Requirements</label>
                    <textarea
                      rows={4}
                      required
                      value={formData.message}
                      onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                      placeholder="Outline your institutional profile, number of campuses/learners, and key governance objectives..."
                      className="w-full rounded-lg border border-border bg-[color:var(--surface-1)] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-cyan-500 focus:outline-none resize-none"
                    />
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Lock className="size-3.5 text-cyan-400" />
                    <span>Protected by end-to-end TLS 1.3 and zero-knowledge storage protocols.</span>
                  </div>

                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-400 transition-colors"
                  >
                    <Send className="size-4" />
                    <span>Transmit Institutional Request</span>
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
