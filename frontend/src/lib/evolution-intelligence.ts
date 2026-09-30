/**
 * CoreGrid Evolution Intelligence — technology radar, horizon scanning,
 * technology evaluation, technical debt, dependency intelligence, evolution
 * ADRs, risk register, evolution metrics, synthetic data, and engineering
 * memory.
 *
 * Implements `architecture/phase-32-future-evolution.md`:
 * - Technology horizon scanning (H) and technology radar (DW): continuously
 *   monitor AI, multimodal AI, agents, reasoning, robotics, edge/cloud/
 *   confidential computing, distributed systems, databases, networking,
 *   cybersecurity, cryptography, biometrics, spatial/AR/VR/MR, wearables,
 *   IoT, sensors, smart buildings, autonomous transport, satellite, digital
 *   identity, payments, communications, edtech, learning science, HCI,
 *   developer infrastructure, data engineering, quantum computing, advanced
 *   hardware, energy, emerging architectures — only integrate what materially
 *   improves CoreGrid.
 * - Technology evaluation (I): strategic relevance, user/institutional
 *   value, technical/security maturity, privacy, regulatory, integration and
 *   operational complexity, infrastructure cost, vendor dependency,
 *   ecosystem maturity, scalability, reliability, maintainability,
 *   observability, reversibility, accessibility, African-market suitability,
 *   offline suitability, connectivity, energy, localization.
 * - Technical debt evolution (AL): architectural/code/infrastructure/schema/
 *   API/dependency/security/documentation/operational/observability debt —
 *   measurable and prioritized.
 * - Dependency intelligence (AM): libraries, frameworks, runtimes, cloud
 *   services, APIs, models, hardware SDKs, databases, OS — monitor end-of-life,
 *   vulnerabilities, licensing, compatibility, maintenance.
 * - Evolution ADRs (BF) and risk register (BG) with 12 risk categories.
 * - Evolution metrics (AK): innovation velocity, migration success, rollback
 *   frequency, compatibility rate, technical debt, deprecated count,
 *   experimental success, regression rate, platform stability, adoption,
 *   utilization, infrastructure efficiency, AI improvement, user
 *   satisfaction, institutional outcomes.
 * - Synthetic data (CB): for testing/simulation/agent evaluation/load/
 *   security/education — never confused with real institutional evidence.
 * - Knowledge preservation (CK) and engineering memory (CL): why decisions
 *   were made, what was rejected, what failed, what succeeded, migration
 *   history, deprecated capabilities.
 */

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type TechnologyAssessmentId = string & { readonly __brand: "TechnologyAssessmentId" };
export type DebtItemId = string & { readonly __brand: "DebtItemId" };
export type DependencyId = string & { readonly __brand: "DependencyId" };
export type EvolutionRiskId = string & { readonly __brand: "EvolutionRiskId" };
export type AdrId = string & { readonly __brand: "AdrId" };
export type EvolutionMemoryId = string & { readonly __brand: "EvolutionMemoryId" };

export function technologyAssessmentId(raw: string): TechnologyAssessmentId {
  return raw as TechnologyAssessmentId;
}
export function debtItemId(raw: string): DebtItemId {
  return raw as DebtItemId;
}
export function dependencyId(raw: string): DependencyId {
  return raw as DependencyId;
}
export function evolutionRiskId(raw: string): EvolutionRiskId {
  return raw as EvolutionRiskId;
}
export function adrId(raw: string): AdrId {
  return raw as AdrId;
}
export function evolutionMemoryId(raw: string): EvolutionMemoryId {
  return raw as EvolutionMemoryId;
}

/* ─────────────────────────────────────────────────────────────
 * Technology radar + horizon scanning (Sections H, DW)
 * ────────────────────────────────────────────────────────────*/

export type RadarStage = "adopt" | "trial" | "assess" | "hold";

export interface TechnologyRadarItem {
  id: TechnologyAssessmentId;
  technology: string;
  domain: string;
  stage: RadarStage;
}

export function createTechnologyRadarItem(input: {
  id: TechnologyAssessmentId;
  technology: string;
  domain: string;
  stage: RadarStage;
}): { ok: true; item: TechnologyRadarItem } | { ok: false; error: string } {
  if (!input.technology.trim() || !input.domain.trim()) {
    return {
      ok: false,
      error: "Technology radar item requires a technology and domain (Section H)",
    };
  }
  return {
    ok: true,
    item: { id: input.id, technology: input.technology, domain: input.domain, stage: input.stage },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Technology evaluation (Section I)
 * ────────────────────────────────────────────────────────────*/

export const TECHNOLOGY_EVALUATION_CRITERIA: readonly string[] = [
  "strategic_relevance",
  "user_value",
  "institutional_value",
  "technical_maturity",
  "security_maturity",
  "privacy",
  "regulatory",
  "integration_complexity",
  "operational_complexity",
  "infrastructure_cost",
  "vendor_dependency",
  "ecosystem_maturity",
  "scalability",
  "reliability",
  "maintainability",
  "observability",
  "reversibility",
  "accessibility",
  "african_market_suitability",
  "offline_suitability",
  "connectivity",
  "energy",
  "localization",
] as const;

export interface TechnologyAssessment {
  id: TechnologyAssessmentId;
  technology: string;
  scores: Record<string, number>;
}

export function createTechnologyAssessment(input: {
  id: TechnologyAssessmentId;
  technology: string;
  scores: Record<string, number>;
}): { ok: true; assessment: TechnologyAssessment } | { ok: false; error: string } {
  if (!input.technology.trim()) return { ok: false, error: "Technology is required (Section I)" };
  for (const criterion of TECHNOLOGY_EVALUATION_CRITERIA) {
    const score = input.scores[criterion];
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      return {
        ok: false,
        error: `Evaluation score for "${criterion}" must be between 0 and 1 (Section I)`,
      };
    }
  }
  return {
    ok: true,
    assessment: { id: input.id, technology: input.technology, scores: input.scores },
  };
}

export function scoreTechnologyAssessment(assessment: TechnologyAssessment): number {
  const values = Object.values(assessment.scores);
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Section H: integrate only technologies that materially improve CoreGrid.
export function isTechnologyRecommended(
  assessment: TechnologyAssessment,
  threshold: number,
): boolean {
  return scoreTechnologyAssessment(assessment) >= threshold;
}

/* ─────────────────────────────────────────────────────────────
 * Technical debt registry (Section AL)
 * ────────────────────────────────────────────────────────────*/

export type TechDebtType =
  | "architectural"
  | "code"
  | "infrastructure"
  | "schema"
  | "api"
  | "dependency"
  | "security"
  | "documentation"
  | "operational"
  | "observability";

export const TECH_DEBT_TYPES: readonly TechDebtType[] = [
  "architectural",
  "code",
  "infrastructure",
  "schema",
  "api",
  "dependency",
  "security",
  "documentation",
  "operational",
  "observability",
] as const;

export interface TechDebtItem {
  id: DebtItemId;
  system: string;
  type: TechDebtType;
  description: string;
  severity: number;
  priority: number;
}

export function registerTechDebt(input: {
  id: DebtItemId;
  system: string;
  type: TechDebtType;
  description: string;
  severity: number;
  priority: number;
}): { ok: true; item: TechDebtItem } | { ok: false; error: string } {
  if (!input.system.trim() || !input.description.trim()) {
    return { ok: false, error: "Technical debt requires a system and description (Section AL)" };
  }
  if (!TECH_DEBT_TYPES.includes(input.type)) {
    return { ok: false, error: "Unknown technical debt type (Section AL)" };
  }
  if (input.severity < 0 || input.severity > 10 || input.priority < 0 || input.priority > 10) {
    return { ok: false, error: "Debt severity and priority must be between 0 and 10 (Section AL)" };
  }
  return {
    ok: true,
    item: {
      id: input.id,
      system: input.system,
      type: input.type,
      description: input.description,
      severity: input.severity,
      priority: input.priority,
    },
  };
}

// Section AL: technical debt must be measurable and prioritized.
export function prioritizeTechDebt(
  items: readonly TechDebtItem[],
): { id: DebtItemId; system: string; score: number }[] {
  return items
    .map((item) => ({ id: item.id, system: item.system, score: item.severity + item.priority }))
    .sort((a, b) => b.score - a.score);
}

/* ─────────────────────────────────────────────────────────────
 * Dependency intelligence (Section AM)
 * ────────────────────────────────────────────────────────────*/

export interface DependencyRecord {
  id: DependencyId;
  name: string;
  kind: string;
  endOfLife: boolean;
  criticalVulnerability: boolean;
  licensingApproved: boolean;
  maintained: boolean;
}

export function createDependencyRecord(input: {
  id: DependencyId;
  name: string;
  kind: string;
  endOfLife?: boolean;
  criticalVulnerability?: boolean;
  licensingApproved?: boolean;
  maintained?: boolean;
}): { ok: true; record: DependencyRecord } | { ok: false; error: string } {
  if (!input.name.trim() || !input.kind.trim()) {
    return { ok: false, error: "Dependency record requires a name and kind (Section AM)" };
  }
  return {
    ok: true,
    record: {
      id: input.id,
      name: input.name,
      kind: input.kind,
      endOfLife: input.endOfLife ?? false,
      criticalVulnerability: input.criticalVulnerability ?? false,
      licensingApproved: input.licensingApproved ?? false,
      maintained: input.maintained ?? false,
    },
  };
}

export function isDependencyHealthy(record: DependencyRecord): boolean {
  return (
    !record.endOfLife &&
    !record.criticalVulnerability &&
    record.licensingApproved &&
    record.maintained
  );
}

/* ─────────────────────────────────────────────────────────────
 * Evolution ADR (Section BF)
 * ────────────────────────────────────────────────────────────*/

export interface EvolutionAdr {
  id: AdrId;
  title: string;
  problem: string;
  context: string;
  alternatives: string[];
  selectedSolution: string;
  rejectedAlternatives: string[];
  consequences: string;
  affectedPhases: string[];
  migrationRequirements: string;
  rollbackStrategy: string;
}

export function createEvolutionAdr(input: {
  id: AdrId;
  title: string;
  problem: string;
  context: string;
  alternatives: string[];
  selectedSolution: string;
  rejectedAlternatives?: string[];
  consequences: string;
  affectedPhases: string[];
  migrationRequirements: string;
  rollbackStrategy: string;
}): { ok: true; adr: EvolutionAdr } | { ok: false; error: string } {
  if (!input.title.trim() || !input.problem.trim()) {
    return { ok: false, error: "ADR requires a title and problem (Section BF)" };
  }
  if (input.alternatives.length === 0 || !input.selectedSolution.trim()) {
    return { ok: false, error: "ADR requires alternatives and a selected solution (Section BF)" };
  }
  return {
    ok: true,
    adr: {
      id: input.id,
      title: input.title,
      problem: input.problem,
      context: input.context,
      alternatives: input.alternatives,
      selectedSolution: input.selectedSolution,
      rejectedAlternatives: input.rejectedAlternatives ?? [],
      consequences: input.consequences,
      affectedPhases: input.affectedPhases,
      migrationRequirements: input.migrationRequirements,
      rollbackStrategy: input.rollbackStrategy,
    },
  };
}

export function isAdrComplete(adr: EvolutionAdr): boolean {
  return (
    adr.problem.trim().length > 0 &&
    adr.context.trim().length > 0 &&
    adr.alternatives.length > 0 &&
    adr.selectedSolution.trim().length > 0 &&
    adr.consequences.trim().length > 0 &&
    adr.affectedPhases.length > 0 &&
    adr.rollbackStrategy.trim().length > 0
  );
}

/* ─────────────────────────────────────────────────────────────
 * Evolution risk register (Section BG)
 * ────────────────────────────────────────────────────────────*/

export type EvolutionRiskCategory =
  | "technical"
  | "operational"
  | "security"
  | "privacy"
  | "regulatory"
  | "financial"
  | "educational"
  | "adoption"
  | "vendor"
  | "dependency"
  | "ai"
  | "infrastructure";

export const EVOLUTION_RISK_CATEGORIES: readonly EvolutionRiskCategory[] = [
  "technical",
  "operational",
  "security",
  "privacy",
  "regulatory",
  "financial",
  "educational",
  "adoption",
  "vendor",
  "dependency",
  "ai",
  "infrastructure",
] as const;

export interface EvolutionRiskItem {
  id: EvolutionRiskId;
  category: EvolutionRiskCategory;
  description: string;
  likelihood: number;
  impact: number;
}

export function createEvolutionRiskItem(input: {
  id: EvolutionRiskId;
  category: EvolutionRiskCategory;
  description: string;
  likelihood: number;
  impact: number;
}): { ok: true; risk: EvolutionRiskItem } | { ok: false; error: string } {
  if (!input.description.trim())
    return { ok: false, error: "Risk description is required (Section BG)" };
  if (!EVOLUTION_RISK_CATEGORIES.includes(input.category)) {
    return { ok: false, error: "Unknown evolution risk category (Section BG)" };
  }
  if (input.likelihood < 1 || input.likelihood > 5 || input.impact < 1 || input.impact > 5) {
    return { ok: false, error: "Risk likelihood and impact must be between 1 and 5 (Section BG)" };
  }
  return {
    ok: true,
    risk: {
      id: input.id,
      category: input.category,
      description: input.description,
      likelihood: input.likelihood,
      impact: input.impact,
    },
  };
}

export function scoreEvolutionRisk(risk: EvolutionRiskItem): number {
  return risk.likelihood * risk.impact;
}

export function prioritizeEvolutionRisks(
  items: readonly EvolutionRiskItem[],
): { id: EvolutionRiskId; category: EvolutionRiskCategory; score: number }[] {
  return items
    .map((risk) => ({ id: risk.id, category: risk.category, score: scoreEvolutionRisk(risk) }))
    .sort((a, b) => b.score - a.score);
}

/* ─────────────────────────────────────────────────────────────
 * Evolution metrics (Section AK)
 * ────────────────────────────────────────────────────────────*/

export const EVOLUTION_METRICS: readonly string[] = [
  "innovation_velocity",
  "migration_success",
  "rollback_frequency",
  "compatibility_rate",
  "technical_debt",
  "deprecated_capability_count",
  "experimental_success_rate",
  "production_regression_rate",
  "platform_stability",
  "adoption_rate",
  "capability_utilization",
  "infrastructure_efficiency",
  "ai_improvement",
  "user_satisfaction",
  "institutional_outcomes",
] as const;

export interface EvolutionMetric {
  id: string;
  name: string;
  value: number;
  period: string;
}

export function recordEvolutionMetric(input: {
  id: string;
  name: string;
  value: number;
  period: string;
}): { ok: true; metric: EvolutionMetric } | { ok: false; error: string } {
  if (!EVOLUTION_METRICS.includes(input.name)) {
    return { ok: false, error: `Unknown evolution metric "${input.name}" (Section AK)` };
  }
  if (!Number.isFinite(input.value))
    return { ok: false, error: "Evolution metric value must be finite (Section AK)" };
  if (!input.period.trim())
    return { ok: false, error: "Evolution metric period is required (Section AK)" };
  return {
    ok: true,
    metric: { id: input.id, name: input.name, value: input.value, period: input.period },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Synthetic data + engineering memory (Sections CB, CK, CL)
 * ────────────────────────────────────────────────────────────*/

export interface SyntheticDataPolicy {
  id: string;
  purpose: string;
  isolatedFromInstitutionalEvidence: boolean;
}

export function createSyntheticDataPolicy(input: {
  id: string;
  purpose: string;
  isolatedFromInstitutionalEvidence?: boolean;
}): { ok: true; policy: SyntheticDataPolicy } | { ok: false; error: string } {
  if (!input.purpose.trim())
    return { ok: false, error: "Synthetic data purpose is required (Section CB)" };
  return {
    ok: true,
    policy: {
      id: input.id,
      purpose: input.purpose,
      isolatedFromInstitutionalEvidence: input.isolatedFromInstitutionalEvidence ?? false,
    },
  };
}

// Section CB: synthetic data must never be confused with real institutional
// evidence.
export function isSyntheticDataIsolated(policy: SyntheticDataPolicy): boolean {
  return policy.isolatedFromInstitutionalEvidence;
}

export type EvolutionMemoryKind =
  | "decision"
  | "experiment"
  | "result"
  | "adr"
  | "incident"
  | "migration"
  | "deprecation"
  | "reversal";

export interface EvolutionMemoryEntry {
  id: EvolutionMemoryId;
  kind: EvolutionMemoryKind;
  summary: string;
  preserved: boolean;
}

export function createEvolutionMemoryEntry(input: {
  id: EvolutionMemoryId;
  kind: EvolutionMemoryKind;
  summary: string;
}): { ok: true; entry: EvolutionMemoryEntry } | { ok: false; error: string } {
  if (!input.summary.trim())
    return { ok: false, error: "Evolution memory summary is required (Section CL)" };
  if (
    ![
      "decision",
      "experiment",
      "result",
      "adr",
      "incident",
      "migration",
      "deprecation",
      "reversal",
    ].includes(input.kind)
  ) {
    return { ok: false, error: "Unknown evolution memory kind (Section CL)" };
  }
  return {
    ok: true,
    entry: { id: input.id, kind: input.kind, summary: input.summary, preserved: true },
  };
}

// Section CK: engineering memory prevents future teams from repeating
// historical mistakes.
export function isKnowledgePreserved(entry: EvolutionMemoryEntry): boolean {
  return entry.preserved;
}
