import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

// ─── CoreGrid Phase 24 — Experience & Design Intelligence ────────────
// experience-governance.ts — Design governance, experimentation, UX
//                            telemetry, SLOs, release gates, QA
// ──────────────────────────────────────────────────────────────────────
// Sections: CH, CI, CJ, CK, CL, CM, CN, CO, CP, CQ, CR, CS, CT, CU,
//           CV, CW, CX, CY, CZ, DA, DB, DC, DD, DE, EX, EY, EZ, FA,
//           FB, FC, FD, FE

export interface UXTelemetryEvent {
  readonly id: string;
  readonly eventType:
    "impression" | "click" | "hover" | "scroll" | "input" | "navigation" | "error" | "custom";
  readonly component: string;
  readonly metadata: Record<string, string | number | boolean>;
  readonly timestamp: string;
  readonly sessionId: string;
  readonly anonymized: boolean;
}

export interface ExperimentConfig {
  readonly id: string;
  readonly name: string;
  readonly variants: { name: string; weight: number; config: Record<string, unknown> }[];
  readonly targetingRules: { attribute: string; operator: string; value: string }[];
  readonly status: "draft" | "running" | "analyzing" | "completed" | "rolled_back";
  readonly startDate: string;
  readonly endDate: string | null;
}

export interface DesignVersion {
  readonly id: string;
  readonly version: string;
  readonly changelog: string;
  readonly tokens: DesignTokenSummary[];
  readonly components: string[];
  readonly publishedAt: string;
  readonly status: "draft" | "review" | "published" | "deprecated";
}

export interface DesignTokenSummary {
  readonly name: string;
  readonly oldValue: string | null;
  readonly newValue: string;
  readonly breaking: boolean;
}

export interface ExperienceSLO {
  readonly metric: string;
  readonly target: number;
  readonly current: number | null;
  readonly measurementPeriod: string;
  readonly breaches: number;
  readonly status: "healthy" | "warning" | "breached";
}

export interface ReleaseGate {
  readonly name: string;
  readonly checks: { name: string; passed: boolean; required: boolean }[];
  readonly overallStatus: "passed" | "blocked" | "pending";
  readonly evaluatedAt: string | null;
}

export interface VisualQA {
  readonly component: string;
  readonly checks: { name: string; passed: boolean; severity: "blocker" | "major" | "minor" }[];
  readonly screenshot: string | null;
  readonly status: "pass" | "fail" | "review";
}

export interface UXQA {
  readonly journey: string;
  readonly scores: {
    discoverability: number;
    learnability: number;
    efficiency: number;
    errorRecovery: number;
    consistency: number;
    cognitiveLoad: number;
  };
  readonly overall: number;
  readonly issues: { severity: string; description: string }[];
}

export interface DeviceQA {
  readonly device: string;
  readonly os: string;
  readonly browser: string;
  readonly screenSize: string;
  readonly status: "pass" | "fail" | "untested";
  readonly issues: string[];
}

// ─── Functions ────────────────────────────────────────────────────────
export function createUXTelemetryEvent(params: {
  eventType: UXTelemetryEvent["eventType"];
  component: string;
  metadata?: Record<string, string | number | boolean>;
  anonymized?: boolean;
}): UXTelemetryEvent {
  return {
    id: `ux-${timeAuthority.now().atMs}-${Math.random().toString(36).slice(2, 8)}`,
    eventType: params.eventType,
    component: params.component,
    metadata: params.metadata ?? {},
    timestamp: timeAuthority.now().at,
    sessionId: "",
    anonymized: params.anonymized ?? true,
  };
}

export function createExperiment(params: {
  id: string;
  name: string;
  variants: ExperimentConfig["variants"];
  targetingRules?: ExperimentConfig["targetingRules"];
  startDate?: string;
  endDate?: string;
}): ExperimentConfig {
  const totalWeight = params.variants.reduce((s, v) => s + v.weight, 0);
  if (totalWeight !== 100) throw new Error("Variant weights must sum to 100");
  return {
    id: params.id,
    name: params.name,
    variants: params.variants,
    targetingRules: params.targetingRules ?? [],
    status: "draft",
    startDate: params.startDate ?? timeAuthority.now().at,
    endDate: params.endDate ?? null,
  };
}

export function evaluateExperienceSLO(
  metric: string,
  target: number,
  current: number,
): ExperienceSLO {
  const ratio = target / current;
  const status = ratio >= 1 ? "healthy" : ratio >= 0.9 ? "warning" : "breached";
  return {
    metric,
    target,
    current,
    measurementPeriod: "30d",
    breaches: status === "breached" ? 1 : 0,
    status: status as "healthy" | "warning" | "breached",
  };
}

export function evaluateReleaseGate(
  checks: { name: string; passed: boolean; required: boolean }[],
): ReleaseGate {
  const blocked = checks.some((c) => c.required && !c.passed);
  return {
    name: "Release Gate",
    checks,
    overallStatus: blocked ? "blocked" : checks.every((c) => c.passed) ? "passed" : "pending",
    evaluatedAt: timeAuthority.now().at,
  };
}

export function computeUXQAScore(scores: UXQA["scores"]): number {
  const values = Object.values(scores);
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

export function createDesignVersion(params: {
  version: string;
  changelog: string;
  tokens: DesignTokenSummary[];
  components: string[];
}): DesignVersion {
  return {
    id: `dv-${timeAuthority.now().atMs}`,
    version: params.version,
    changelog: params.changelog,
    tokens: params.tokens,
    components: params.components,
    publishedAt: timeAuthority.now().at,
    status: "draft",
  };
}

export function evaluateVisualQA(
  component: string,
  checks: { name: string; passed: boolean; severity: "blocker" | "major" | "minor" }[],
): VisualQA {
  const hasBlocker = checks.some((c) => !c.passed && c.severity === "blocker");
  return {
    component,
    checks,
    screenshot: null,
    status: hasBlocker ? "fail" : checks.every((c) => c.passed) ? "pass" : "review",
  };
}
