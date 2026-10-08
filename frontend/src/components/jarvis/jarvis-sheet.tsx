import React, { useState } from "react";
import {
  Sparkles,
  ShieldCheck,
  Brain,
  AlertTriangle,
  CheckCircle2,
  Lock,
  ArrowRight,
  Terminal,
  Activity,
  History,
  X,
} from "lucide-react";
import {
  EXECUTIVE_INTELLIGENCE_NAME,
  PLATFORM_NAME,
} from "@/lib/platform";
import { Button } from "@/components/ui/button";

export const OPEN_JARVIS_EVENT = "open-jarvis-console";

export function openJarvisConsole() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(OPEN_JARVIS_EVENT));
  }
}

interface JarvisActionProposal {
  id: string;
  category: "Observation" | "Inference" | "Recommendation" | "Action";
  title: string;
  description: string;
  confidence: number;
  evidenceHash: string;
  requiredApproval: boolean;
  status: "proposed" | "approved" | "verified" | "executing";
}

export function JarvisSheet() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"briefing" | "missions" | "telemetry">("briefing");

  React.useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener(OPEN_JARVIS_EVENT, handler);
    return () => window.removeEventListener(OPEN_JARVIS_EVENT, handler);
  }, []);

  if (!isOpen) return null;

  const mockProposals: JarvisActionProposal[] = [
    {
      id: "prop-01",
      category: "Observation",
      title: "Kernel Invariant Verification",
      description: "51-phase governance boundaries verified clean. Zero RLS drift observed across all tenant tables.",
      confidence: 1.0,
      evidenceHash: "0x8f2a...c4e9",
      requiredApproval: false,
      status: "verified",
    },
    {
      id: "prop-02",
      category: "Inference",
      title: "Predictive Resource Allocation",
      description: "Mid-day telemetry suggests 18% spike in compute demand for academic grading batch queues.",
      confidence: 0.94,
      evidenceHash: "0x3e1d...91ba",
      requiredApproval: false,
      status: "proposed",
    },
    {
      id: "prop-03",
      category: "Recommendation",
      title: "Autonomous Memory Pruning",
      description: "Index tier 2 vectors with HNSW graph compression to save 32% storage footprint.",
      confidence: 0.98,
      evidenceHash: "0x77c2...104f",
      requiredApproval: true,
      status: "proposed",
    },
    {
      id: "prop-04",
      category: "Action",
      title: "Dispatch Worker Lease [W-804]",
      description: "Lease worker 'Sherivs-Auditor-09' to perform dual-control verification on pending transactions.",
      confidence: 0.99,
      evidenceHash: "0xbb44...8821",
      requiredApproval: true,
      status: "executing",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-xl h-full sherivs-surface-2 border-l border-border flex flex-col shadow-2xl animate-in slide-in-from-right duration-300"
        role="dialog"
        aria-modal="true"
        aria-labelledby="jarvis-title"
      >
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Brain className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="jarvis-title" className="font-display font-bold text-base text-foreground">
                  {EXECUTIVE_INTELLIGENCE_NAME}
                </h2>
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold">
                  Executive Intelligence
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sovereign Orchestration & Decision Support · {PLATFORM_NAME}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label="Close Jarvis Console"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center px-4 border-b border-border bg-background/50">
          <button
            onClick={() => setActiveTab("briefing")}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "briefing"
                ? "border-cyan-400 text-cyan-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Executive Briefing
          </button>
          <button
            onClick={() => setActiveTab("missions")}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "missions"
                ? "border-cyan-400 text-cyan-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Mission Coordination
          </button>
          <button
            onClick={() => setActiveTab("telemetry")}
            className={`py-3 px-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "telemetry"
                ? "border-cyan-400 text-cyan-400"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Platform Telemetry
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === "briefing" && (
            <>
              {/* Sovereign Guard Summary */}
              <div className="p-3.5 rounded-xl sherivs-card bg-cyan-950/20 border-cyan-500/20">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="size-5 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                      Sovereignty & Governance Boundary Active
                    </h3>
                    <p className="text-xs text-foreground/80 mt-1 leading-relaxed">
                      Jarvis operates under strict human dual-control policy. Critical mutations require cryptographic authorization. All proposals are verified against canonical truth.
                    </p>
                  </div>
                </div>
              </div>

              {/* Categorized Output Streams */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Reasoning & Action Stream
                </h4>
                {mockProposals.map((prop) => (
                  <div
                    key={prop.id}
                    className={`rounded-xl border border-border p-3.5 text-xs transition-all ${
                      prop.category === "Observation"
                        ? "sherivs-ai-observation"
                        : prop.category === "Inference"
                        ? "sherivs-ai-inference"
                        : prop.category === "Recommendation"
                        ? "sherivs-ai-recommendation"
                        : "sherivs-ai-action"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold uppercase tracking-wider text-[10px]">
                          [{prop.category}]
                        </span>
                        <span className="font-semibold text-foreground text-sm">{prop.title}</span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-background/50 border border-border text-muted-foreground">
                        {Math.round(prop.confidence * 100)}% Confidence
                      </span>
                    </div>

                    <p className="text-foreground/80 leading-relaxed mb-3">
                      {prop.description}
                    </p>

                    <div className="flex items-center justify-between pt-2 border-t border-border/50 text-[10px]">
                      <div className="flex items-center gap-2 font-mono text-muted-foreground">
                        <span>Proof:</span>
                        <span className="text-foreground/90">{prop.evidenceHash}</span>
                      </div>
                      {prop.requiredApproval ? (
                        <div className="flex items-center gap-1.5 text-amber-400 font-medium">
                          <Lock className="size-3" />
                          <span>Requires Human Approval</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                          <CheckCircle2 className="size-3" />
                          <span>Verified Reality Fact</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === "missions" && (
            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-xl border border-border sherivs-surface-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-foreground">Mission MS-2026-09</span>
                  <span className="sherivs-badge-verified px-2 py-0.5 rounded text-[10px]">Executing</span>
                </div>
                <p className="text-muted-foreground mb-3">
                  Reconcile end-of-quarter billing splits across 12 distributed campus nodes.
                </p>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>Assigned: Worker-Alpha-03</span>
                  <span>Lease expires in 42m</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === "telemetry" && (
            <div className="space-y-3 text-xs">
              <div className="p-3.5 rounded-xl border border-border sherivs-surface-3 font-mono">
                <div className="text-muted-foreground mb-2"># Live Telemetry Snapshot</div>
                <div className="space-y-1 text-foreground/90">
                  <div>RLS Policies: 100% ENFORCED</div>
                  <div>Active AI Worker Leases: 4</div>
                  <div>Evidence Integrity: VALIDATED</div>
                  <div>Platform Latency: 14ms</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Prompt */}
        <div className="p-3 border-t border-border bg-background/50 flex items-center gap-2">
          <input
            type="text"
            placeholder={`Instruct ${EXECUTIVE_INTELLIGENCE_NAME} (e.g. "Brief me on campus telemetry")...`}
            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
          <Button size="sm" className="bg-cyan-500 hover:bg-cyan-600 text-black font-semibold text-xs">
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
