/**
 * CoreGrid Future Evolution — capability registry, evolution lifecycle,
 * core principles, scope protection, and architectural change protocol.
 *
 * Implements `architecture/phase-32-future-evolution.md`:
 * - Subsystem identity (A): the controlled evolutionary layer through which
 *   future capabilities are researched, introduced, evaluated, graduated,
 *   deprecated, migrated, or rejected — never a second automation engine, AI
 *   layer, or security system.
 * - Core evolution principles (E): no silent mutation, experiment before
 *   graduation, evidence before expansion, compatibility before convenience,
 *   reversible before irreversible, explicit before implicit, tenant safety,
 *   human governance, security is continuous, architecture remains
 *   composable.
 * - Future capability registry (F) with full metadata (owner, lifecycle,
 *   maturity, dependencies, risks, security classification, data/AI/
 *   infrastructure requirements, expected value/cost, compatibility impact,
 *   migration requirements, rollback strategy, validation/approval/release/
 *   deprecation status).
 * - Evolution lifecycle (G): Idea → Candidate → Research → Architecture
 *   Proposal → Sandbox → Experimental → Internal Pilot → Controlled Tenant
 *   Pilot → Limited Production → General Availability → Mature →
 *   Maintenance → Deprecated → Migration → Sunset → Archived; no capability
 *   jumps from idea to unrestricted production unless explicitly classified
 *   as low-risk configuration or documentation.
 * - Scope protection (DC): a future proposal must identify its proper phase;
 *   Phase 32 does not absorb capabilities that belong to earlier phases.
 * - Architectural change protocol (DD): Idea → Classification → Impact
 *   Analysis → Architecture Proposal → Security Review → Dependency Review →
 *   Experiment → Validation → Approval → Controlled Rollout → Observation →
 *   Graduation or Rejection.
 * - Future capability discovery (DF) sources and user-driven evolution (DH).
 *
 * Phase 32 proposes changes; it never silently modifies production behavior
 * owned by earlier phases (AGENTS.md 63).
 */

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type CapabilityId = string & { readonly __brand: "CapabilityId" };
export type EvolutionRecordId = string & { readonly __brand: "EvolutionRecordId" };

export function capabilityId(raw: string): CapabilityId {
  return raw as CapabilityId;
}
export function evolutionRecordId(raw: string): EvolutionRecordId {
  return raw as EvolutionRecordId;
}

/* ─────────────────────────────────────────────────────────────
 * Core evolution principles (Section E)
 * ────────────────────────────────────────────────────────────*/

export const EVOLUTION_PRINCIPLES: readonly string[] = [
  "no_silent_mutation",
  "experiment_before_graduation",
  "evidence_before_expansion",
  "compatibility_before_convenience",
  "reversible_before_irreversible",
  "explicit_before_implicit",
  "tenant_safety",
  "human_governance",
  "security_is_continuous",
  "architecture_remains_composable",
] as const;

export function isEvolutionPrinciple(principle: string): boolean {
  return EVOLUTION_PRINCIPLES.includes(principle);
}

/* ─────────────────────────────────────────────────────────────
 * Capability registry (Section F)
 * ────────────────────────────────────────────────────────────*/

export interface FutureCapability {
  id: CapabilityId;
  name: string;
  description: string;
  originatingPhase: string;
  owner: string;
  lifecycleState: string;
  maturityLevel: number;
  dependencies: string[];
  risks: string[];
  securityClassification: string;
  expectedValue: string;
  expectedCost: string;
  compatibilityImpact: string;
  migrationRequirements: string;
  rollbackStrategy: string;
  validationStatus: string;
  approvalStatus: "pending" | "approved" | "rejected";
}

export function createFutureCapability(input: {
  id: CapabilityId;
  name: string;
  description: string;
  originatingPhase: string;
  owner: string;
  maturityLevel?: number;
  dependencies?: string[];
  risks?: string[];
  securityClassification?: string;
  expectedValue?: string;
  expectedCost?: string;
  compatibilityImpact?: string;
  migrationRequirements?: string;
  rollbackStrategy?: string;
}): { ok: true; capability: FutureCapability } | { ok: false; error: string } {
  if (!input.name.trim()) return { ok: false, error: "Capability name is required (Section F)" };
  if (!input.originatingPhase.trim())
    return { ok: false, error: "Originating phase is required (Section F)" };
  if (!input.owner.trim()) return { ok: false, error: "Proposed owner is required (Section F)" };
  if (input.maturityLevel !== undefined && (input.maturityLevel < 0 || input.maturityLevel > 5)) {
    return { ok: false, error: "Maturity level must be between 0 and 5 (Section F)" };
  }
  return {
    ok: true,
    capability: {
      id: input.id,
      name: input.name,
      description: input.description,
      originatingPhase: input.originatingPhase,
      owner: input.owner,
      lifecycleState: "idea",
      maturityLevel: input.maturityLevel ?? 0,
      dependencies: input.dependencies ?? [],
      risks: input.risks ?? [],
      securityClassification: input.securityClassification ?? "TENANT_INTERNAL",
      expectedValue: input.expectedValue ?? "",
      expectedCost: input.expectedCost ?? "",
      compatibilityImpact: input.compatibilityImpact ?? "",
      migrationRequirements: input.migrationRequirements ?? "",
      rollbackStrategy: input.rollbackStrategy ?? "",
      validationStatus: "not_validated",
      approvalStatus: "pending",
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Evolution lifecycle (Section G)
 * ────────────────────────────────────────────────────────────*/

export type EvolutionLifecycleState =
  | "idea"
  | "candidate"
  | "research"
  | "architecture_proposal"
  | "sandbox"
  | "experimental"
  | "internal_pilot"
  | "controlled_tenant_pilot"
  | "limited_production"
  | "general_availability"
  | "mature"
  | "maintenance"
  | "deprecated"
  | "migration"
  | "sunset"
  | "archived";

export const EVOLUTION_LIFECYCLE: readonly EvolutionLifecycleState[] = [
  "idea",
  "candidate",
  "research",
  "architecture_proposal",
  "sandbox",
  "experimental",
  "internal_pilot",
  "controlled_tenant_pilot",
  "limited_production",
  "general_availability",
  "mature",
  "maintenance",
  "deprecated",
  "migration",
  "sunset",
  "archived",
] as const;

export const EVOLUTION_LIFECYCLE_RANK: Record<EvolutionLifecycleState, number> = {
  idea: 0,
  candidate: 1,
  research: 2,
  architecture_proposal: 3,
  sandbox: 4,
  experimental: 5,
  internal_pilot: 6,
  controlled_tenant_pilot: 7,
  limited_production: 8,
  general_availability: 9,
  mature: 10,
  maintenance: 11,
  deprecated: 12,
  migration: 13,
  sunset: 14,
  archived: 15,
};

// Section G: capabilities move through controlled states — no jumping from
// idea to unrestricted production unless explicitly classified as low-risk
// configuration or documentation.
export function canTransitionLifecycle(
  current: EvolutionLifecycleState,
  next: EvolutionLifecycleState,
  lowRisk = false,
): boolean {
  if (lowRisk) return true;
  return EVOLUTION_LIFECYCLE_RANK[next] === EVOLUTION_LIFECYCLE_RANK[current] + 1;
}

export function isGraduationState(state: EvolutionLifecycleState): boolean {
  return state === "general_availability" || state === "mature";
}

/* ─────────────────────────────────────────────────────────────
 * Scope protection (Section DC)
 * ────────────────────────────────────────────────────────────*/

// A future proposal must identify its proper phase; Phase 32 only owns what
// does not clearly belong to an earlier phase.
export const SCOPE_PHASE_MAP: Record<string, string> = {
  identity: "02",
  multi_tenancy: "03",
  education_reality: "04",
  runtime: "05",
  workspace: "06",
  agents: "07",
  security: "08",
  trust: "09",
  communication: "10",
  academic_learning: "11",
  scheduling: "12",
  financial: "13",
  data: "14",
  hardware: "15",
  digital_twin: "16",
  automation: "17",
  analytics: "18",
  command_centre: "19",
  government_cloud: "20",
  global_cloud: "21",
  mobile: "22",
  web: "23",
  ai_intelligence: "24",
  marketplace: "25",
  developer_platform: "26",
  integration: "27",
  globalization: "28",
  enterprise_scale: "29",
};

export function resolveProposalPhase(domain: string): string {
  return SCOPE_PHASE_MAP[domain] ?? "32";
}

export function isFutureEvolutionOwned(domain: string): boolean {
  return SCOPE_PHASE_MAP[domain] === undefined;
}

/* ─────────────────────────────────────────────────────────────
 * Architectural change protocol (Section DD)
 * ────────────────────────────────────────────────────────────*/

export const CHANGE_PROTOCOL_STEPS: readonly string[] = [
  "idea",
  "classification",
  "impact_analysis",
  "architecture_proposal",
  "security_review",
  "dependency_review",
  "experiment",
  "validation",
  "approval",
  "controlled_rollout",
  "observation",
  "graduation_or_rejection",
] as const;

export function isChangeProtocolStep(step: string): boolean {
  return CHANGE_PROTOCOL_STEPS.includes(step);
}

export function isChangeProtocolOrdered(steps: readonly string[]): boolean {
  const expected = CHANGE_PROTOCOL_STEPS;
  if (steps.length !== expected.length) return false;
  return steps.every((step, index) => step === expected[index]);
}

/* ─────────────────────────────────────────────────────────────
 * Capability discovery (Section DF)
 * ────────────────────────────────────────────────────────────*/

export const DISCOVERY_SOURCES: readonly string[] = [
  "user",
  "institution",
  "administrator",
  "teacher",
  "student",
  "parent",
  "government",
  "developer",
  "support",
  "security",
  "ai_research",
  "engineering",
  "market_intelligence",
  "operational_telemetry",
] as const;

export interface CapabilityDiscovery {
  id: EvolutionRecordId;
  source: string;
  request: string;
  institutionRef?: string;
}

export function createCapabilityDiscovery(input: {
  id: EvolutionRecordId;
  source: string;
  request: string;
  institutionRef?: string;
}): { ok: true; discovery: CapabilityDiscovery } | { ok: false; error: string } {
  if (!DISCOVERY_SOURCES.includes(input.source)) {
    return { ok: false, error: "Unknown capability discovery source (Section DF)" };
  }
  if (!input.request.trim())
    return { ok: false, error: "Capability request is required (Section DF)" };
  return {
    ok: true,
    discovery: {
      id: input.id,
      source: input.source,
      request: input.request,
      institutionRef: input.institutionRef,
    },
  };
}
