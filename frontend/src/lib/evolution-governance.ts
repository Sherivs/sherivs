/**
 * CoreGrid Evolution Governance — evolution review, reversibility, autonomy
 * evolution, agent evolution and governance, capability scorecards,
 * graduation validation, ethics, evolution security, supply-chain security,
 * and evolution incident/recovery contracts.
 *
 * Implements `architecture/phase-32-future-evolution.md`:
 * - Evolution governance (BE): review against business value, educational
 *   value, technical value, security, privacy, compliance, operational
 *   impact, financial impact, user impact, architectural compatibility.
 * - Reversibility (DE): rollback, feature disablement, migration reversal,
 *   compatibility fallback, emergency controls — high-risk changes require
 *   all five.
 * - Autonomy evolution (AS): human-only → assisted → supervised → controlled
 *   autonomous → highly autonomous; autonomy increases only with evidence.
 *   Autonomy boundaries (AT): allowed/prohibited actions, approval
 *   requirements, spending/data limits, tenant boundaries, escalation,
 *   emergency shutdown.
 * - Agent evolution (AQ): identity, permissions, capabilities, version,
 *   memory policy, tools, evaluation, audit history, owner, lifecycle state —
 *   upgrades preserve safety boundaries. Agent compatibility (AR) migration
 *   preserves memory/permissions and revalidates tools/evaluations/outputs.
 * - Agent governance (CN): evolution agents must not independently modify
 *   production architecture, bypass security, migrate critical data, change
 *   institutional policy, deploy high-risk capabilities, or disable safety
 *   controls without authorization; agent evaluation (CO).
 * - Capability scorecard (CX): strategic value, user value, technical
 *   feasibility, security, privacy, scalability, reliability, cost,
 *   compatibility, reversibility, operational complexity, educational impact,
 *   African-context suitability. Definition of done (CW): requirements,
 *   architecture, security, dependencies, compatibility, performance, user
 *   impact, rollback, monitoring, documentation, ownership, lifecycle.
 * - Ethical evolution (BI): fairness, accessibility, transparency, human
 *   agency, child safety, privacy, discrimination risk, unintended
 *   consequences.
 * - Evolution security (CS): privileged change approval, immutable audit
 *   trails, experimental isolation, capability signing, deployment/migration
 *   authorization, model provenance, artifact integrity, supply-chain
 *   verification, secrets protection, environment isolation. Supply-chain
 *   security (CT): provenance, licensing, vulnerabilities, maintenance,
 *   integrity, ownership, update history.
 * - Evolution incident response (CG) and recovery (CH).
 */

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type ReviewId = string & { readonly __brand: "ReviewId" };
export type AutonomyEvolutionId = string & { readonly __brand: "AutonomyEvolutionId" };
export type AgentEvolutionId = string & { readonly __brand: "AgentEvolutionId" };
export type ScorecardId = string & { readonly __brand: "ScorecardId" };

export function reviewId(raw: string): ReviewId {
  return raw as ReviewId;
}
export function autonomyEvolutionId(raw: string): AutonomyEvolutionId {
  return raw as AutonomyEvolutionId;
}
export function agentEvolutionId(raw: string): AgentEvolutionId {
  return raw as AgentEvolutionId;
}
export function scorecardId(raw: string): ScorecardId {
  return raw as ScorecardId;
}

/* ─────────────────────────────────────────────────────────────
 * Evolution review board (Section BE)
 * ────────────────────────────────────────────────────────────*/

export const EVOLUTION_REVIEW_DIMENSIONS: readonly string[] = [
  "business_value",
  "educational_value",
  "technical_value",
  "security",
  "privacy",
  "compliance",
  "operational_impact",
  "financial_impact",
  "user_impact",
  "architectural_compatibility",
] as const;

export interface EvolutionReview {
  id: ReviewId;
  capability: string;
  verdicts: Record<string, boolean>;
}

export function createEvolutionReview(input: {
  id: ReviewId;
  capability: string;
  verdicts: Record<string, boolean>;
}): { ok: true; review: EvolutionReview } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Review capability is required (Section BE)" };
  for (const dimension of EVOLUTION_REVIEW_DIMENSIONS) {
    if (input.verdicts[dimension] === undefined) {
      return { ok: false, error: `Review dimension "${dimension}" is missing (Section BE)` };
    }
  }
  return {
    ok: true,
    review: { id: input.id, capability: input.capability, verdicts: input.verdicts },
  };
}

export function isReviewApproved(review: EvolutionReview): boolean {
  return EVOLUTION_REVIEW_DIMENSIONS.every((dimension) => review.verdicts[dimension] === true);
}

/* ─────────────────────────────────────────────────────────────
 * Reversibility (Section DE)
 * ────────────────────────────────────────────────────────────*/

export const REVERSIBILITY_MECHANISMS: readonly string[] = [
  "rollback",
  "feature_disablement",
  "migration_reversal",
  "compatibility_fallback",
  "emergency_controls",
] as const;

export interface ReversibilityContract {
  id: string;
  capability: string;
  available: string[];
}

export function createReversibilityContract(input: {
  id: string;
  capability: string;
  available?: string[];
}): { ok: true; contract: ReversibilityContract } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Reversibility capability is required (Section DE)" };
  for (const mechanism of input.available ?? []) {
    if (!REVERSIBILITY_MECHANISMS.includes(mechanism)) {
      return { ok: false, error: `Unknown reversibility mechanism "${mechanism}" (Section DE)` };
    }
  }
  return {
    ok: true,
    contract: { id: input.id, capability: input.capability, available: input.available ?? [] },
  };
}

// Section DE: high-risk changes require all five reversibility mechanisms.
export function isReversibilitySatisfied(
  contract: ReversibilityContract,
  highRisk: boolean,
): boolean {
  if (!highRisk) return contract.available.length > 0;
  return REVERSIBILITY_MECHANISMS.every((mechanism) => contract.available.includes(mechanism));
}

/* ─────────────────────────────────────────────────────────────
 * Autonomy evolution (Sections AS, AT)
 * ────────────────────────────────────────────────────────────*/

export type AutonomyEvolutionLevel =
  "human_only" | "assisted" | "supervised" | "controlled_autonomous" | "highly_autonomous";

export const AUTONOMY_EVOLUTION_ORDER: readonly AutonomyEvolutionLevel[] = [
  "human_only",
  "assisted",
  "supervised",
  "controlled_autonomous",
  "highly_autonomous",
] as const;

export interface AutonomyEvolutionContract {
  id: AutonomyEvolutionId;
  capability: string;
  level: AutonomyEvolutionLevel;
  allowedActions: string[];
  prohibitedActions: string[];
  approvalRequired: boolean;
  spendingLimit: number;
  dataLimit: number;
  tenantBounded: boolean;
  escalationDefined: boolean;
  emergencyShutdown: boolean;
}

export function createAutonomyEvolutionContract(input: {
  id: AutonomyEvolutionId;
  capability: string;
  level: AutonomyEvolutionLevel;
  allowedActions: string[];
  prohibitedActions: string[];
  approvalRequired?: boolean;
  spendingLimit?: number;
  dataLimit?: number;
  tenantBounded?: boolean;
  escalationDefined?: boolean;
  emergencyShutdown?: boolean;
}): { ok: true; contract: AutonomyEvolutionContract } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Autonomy capability is required (Section AS)" };
  if (!AUTONOMY_EVOLUTION_ORDER.includes(input.level)) {
    return { ok: false, error: "Unknown autonomy evolution level (Section AS)" };
  }
  if (input.allowedActions.length === 0)
    return { ok: false, error: "Allowed actions are required (Section AT)" };
  // Section AT: every autonomous capability must define its boundaries.
  if (input.level !== "human_only") {
    if (
      input.approvalRequired === false ||
      input.escalationDefined === false ||
      input.emergencyShutdown === false ||
      input.tenantBounded === false
    ) {
      return {
        ok: false,
        error:
          "Autonomous capabilities require approval, escalation, emergency shutdown, and tenant boundaries (Section AT)",
      };
    }
  }
  return {
    ok: true,
    contract: {
      id: input.id,
      capability: input.capability,
      level: input.level,
      allowedActions: input.allowedActions,
      prohibitedActions: input.prohibitedActions,
      approvalRequired: input.approvalRequired ?? false,
      spendingLimit: input.spendingLimit ?? 0,
      dataLimit: input.dataLimit ?? 0,
      tenantBounded: input.tenantBounded ?? false,
      escalationDefined: input.escalationDefined ?? false,
      emergencyShutdown: input.emergencyShutdown ?? false,
    },
  };
}

// Section AS: autonomy increases only when evidence supports it.
export function canIncreaseAutonomy(
  current: AutonomyEvolutionLevel,
  target: AutonomyEvolutionLevel,
  evidence: boolean,
): boolean {
  const from = AUTONOMY_EVOLUTION_ORDER.indexOf(current);
  const to = AUTONOMY_EVOLUTION_ORDER.indexOf(target);
  if (from < 0 || to !== from + 1) return false;
  return evidence;
}

export function isAutonomyBounded(contract: AutonomyEvolutionContract): boolean {
  return (
    contract.approvalRequired &&
    contract.spendingLimit > 0 &&
    contract.dataLimit > 0 &&
    contract.tenantBounded &&
    contract.escalationDefined &&
    contract.emergencyShutdown
  );
}

/* ─────────────────────────────────────────────────────────────
 * Agent evolution + migration (Sections AQ, AR)
 * ────────────────────────────────────────────────────────────*/

export interface AgentEvolutionContract {
  id: AgentEvolutionId;
  agentRef: string;
  version: string;
  identityDefined: boolean;
  permissionsDefined: boolean;
  capabilitiesDefined: boolean;
  memoryPolicyDefined: boolean;
  toolsDefined: boolean;
  evaluationDefined: boolean;
  auditHistory: boolean;
  ownerDefined: boolean;
  lifecycleState: string;
}

export function createAgentEvolutionContract(input: {
  id: AgentEvolutionId;
  agentRef: string;
  version: string;
  identityDefined?: boolean;
  permissionsDefined?: boolean;
  capabilitiesDefined?: boolean;
  memoryPolicyDefined?: boolean;
  toolsDefined?: boolean;
  evaluationDefined?: boolean;
  auditHistory?: boolean;
  ownerDefined?: boolean;
  lifecycleState?: string;
}): { ok: true; contract: AgentEvolutionContract } | { ok: false; error: string } {
  if (!input.agentRef.trim() || !input.version.trim()) {
    return {
      ok: false,
      error: "Agent evolution contract requires an agent reference and version (Section AQ)",
    };
  }
  return {
    ok: true,
    contract: {
      id: input.id,
      agentRef: input.agentRef,
      version: input.version,
      identityDefined: input.identityDefined ?? false,
      permissionsDefined: input.permissionsDefined ?? false,
      capabilitiesDefined: input.capabilitiesDefined ?? false,
      memoryPolicyDefined: input.memoryPolicyDefined ?? false,
      toolsDefined: input.toolsDefined ?? false,
      evaluationDefined: input.evaluationDefined ?? false,
      auditHistory: input.auditHistory ?? false,
      ownerDefined: input.ownerDefined ?? false,
      lifecycleState: input.lifecycleState ?? "proposed",
    },
  };
}

// Section AQ: agent upgrades must preserve safety boundaries.
export function isAgentEvolutionComplete(contract: AgentEvolutionContract): boolean {
  return (
    contract.identityDefined &&
    contract.permissionsDefined &&
    contract.capabilitiesDefined &&
    contract.memoryPolicyDefined &&
    contract.toolsDefined &&
    contract.evaluationDefined &&
    contract.auditHistory &&
    contract.ownerDefined
  );
}

export interface AgentMigrationPlan {
  id: AgentEvolutionId;
  fromVersion: string;
  toVersion: string;
  preserveMemory: boolean;
  preservePermissions: boolean;
  revalidateTools: boolean;
  reRunEvaluations: boolean;
  compareBehavior: boolean;
  validateOutputs: boolean;
  verifySafety: boolean;
}

export function createAgentMigrationPlan(input: {
  id: AgentEvolutionId;
  fromVersion: string;
  toVersion: string;
  preserveMemory?: boolean;
  preservePermissions?: boolean;
  revalidateTools?: boolean;
  reRunEvaluations?: boolean;
  compareBehavior?: boolean;
  validateOutputs?: boolean;
  verifySafety?: boolean;
}): { ok: true; plan: AgentMigrationPlan } | { ok: false; error: string } {
  if (!input.fromVersion.trim() || !input.toVersion.trim()) {
    return {
      ok: false,
      error: "Agent migration plan requires source and target versions (Section AR)",
    };
  }
  return {
    ok: true,
    plan: {
      id: input.id,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      preserveMemory: input.preserveMemory ?? false,
      preservePermissions: input.preservePermissions ?? false,
      revalidateTools: input.revalidateTools ?? false,
      reRunEvaluations: input.reRunEvaluations ?? false,
      compareBehavior: input.compareBehavior ?? false,
      validateOutputs: input.validateOutputs ?? false,
      verifySafety: input.verifySafety ?? false,
    },
  };
}

// Section AR: replacing an agent preserves memory/permissions and revalidates
// tools, evaluations, outputs, and safety.
export function isAgentMigrationSafe(plan: AgentMigrationPlan): boolean {
  return (
    plan.preserveMemory &&
    plan.preservePermissions &&
    plan.revalidateTools &&
    plan.reRunEvaluations &&
    plan.compareBehavior &&
    plan.validateOutputs &&
    plan.verifySafety
  );
}

/* ─────────────────────────────────────────────────────────────
 * Agent governance (Section CN)
 * ────────────────────────────────────────────────────────────*/

export interface EvolutionAgentPermission {
  id: string;
  agentRef: string;
  modifyProductionArchitecture: boolean;
  bypassSecurity: boolean;
  migrateCriticalData: boolean;
  changeInstitutionalPolicy: boolean;
  deployHighRiskCapabilities: boolean;
  disableSafetyControls: boolean;
}

export function createEvolutionAgentPermission(input: {
  id: string;
  agentRef: string;
  modifyProductionArchitecture?: boolean;
  bypassSecurity?: boolean;
  migrateCriticalData?: boolean;
  changeInstitutionalPolicy?: boolean;
  deployHighRiskCapabilities?: boolean;
  disableSafetyControls?: boolean;
}): { ok: true; permission: EvolutionAgentPermission } | { ok: false; error: string } {
  if (!input.agentRef.trim())
    return { ok: false, error: "Agent reference is required (Section CN)" };
  if (
    input.modifyProductionArchitecture === true ||
    input.bypassSecurity === true ||
    input.migrateCriticalData === true ||
    input.changeInstitutionalPolicy === true ||
    input.deployHighRiskCapabilities === true ||
    input.disableSafetyControls === true
  ) {
    return {
      ok: false,
      error:
        "Evolution agents may not independently perform prohibited actions without authorization (Section CN)",
    };
  }
  return {
    ok: true,
    permission: {
      id: input.id,
      agentRef: input.agentRef,
      modifyProductionArchitecture: false,
      bypassSecurity: false,
      migrateCriticalData: false,
      changeInstitutionalPolicy: false,
      deployHighRiskCapabilities: false,
      disableSafetyControls: false,
    },
  };
}

// Section CN: evolution agents must not act independently on high-risk
// capabilities.
export function canAgentActIndependently(permission: EvolutionAgentPermission): boolean {
  return (
    !permission.modifyProductionArchitecture &&
    !permission.bypassSecurity &&
    !permission.migrateCriticalData &&
    !permission.changeInstitutionalPolicy &&
    !permission.deployHighRiskCapabilities &&
    !permission.disableSafetyControls
  );
}

/* ─────────────────────────────────────────────────────────────
 * Capability scorecard (Section CX)
 * ────────────────────────────────────────────────────────────*/

export const SCORECARD_DIMENSIONS: readonly string[] = [
  "strategic_value",
  "user_value",
  "technical_feasibility",
  "security",
  "privacy",
  "scalability",
  "reliability",
  "cost",
  "compatibility",
  "reversibility",
  "operational_complexity",
  "educational_impact",
  "african_context_suitability",
] as const;

export interface CapabilityScorecard {
  id: ScorecardId;
  capability: string;
  scores: Record<string, number>;
}

export function createCapabilityScorecard(input: {
  id: ScorecardId;
  capability: string;
  scores: Record<string, number>;
}): { ok: true; scorecard: CapabilityScorecard } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Scorecard capability is required (Section CX)" };
  for (const dimension of SCORECARD_DIMENSIONS) {
    const score = input.scores[dimension];
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      return {
        ok: false,
        error: `Scorecard dimension "${dimension}" must be between 0 and 1 (Section CX)`,
      };
    }
  }
  return {
    ok: true,
    scorecard: { id: input.id, capability: input.capability, scores: input.scores },
  };
}

export function scoreCapability(scorecard: CapabilityScorecard): number {
  const values = Object.values(scorecard.scores);
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/* ─────────────────────────────────────────────────────────────
 * Graduation validation — definition of done (Section CW)
 * ────────────────────────────────────────────────────────────*/

export const GRADUATION_READINESS_ITEMS: readonly string[] = [
  "requirements_defined",
  "architecture_reviewed",
  "security_reviewed",
  "dependencies_understood",
  "compatibility_tested",
  "performance_measured",
  "user_impact_understood",
  "rollback_available",
  "operational_monitoring_exists",
  "documentation_exists",
  "ownership_exists",
  "lifecycle_state_defined",
] as const;

export interface GraduationValidation {
  id: ScorecardId;
  capability: string;
  readiness: Record<string, boolean>;
}

export function createGraduationValidation(input: {
  id: ScorecardId;
  capability: string;
  readiness: Record<string, boolean>;
}): { ok: true; validation: GraduationValidation } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Graduation capability is required (Section CW)" };
  for (const item of GRADUATION_READINESS_ITEMS) {
    if (input.readiness[item] === undefined) {
      return { ok: false, error: `Graduation readiness item "${item}" is missing (Section CW)` };
    }
  }
  return {
    ok: true,
    validation: { id: input.id, capability: input.capability, readiness: input.readiness },
  };
}

export function isGraduationReady(
  validation: GraduationValidation,
  scorecard: CapabilityScorecard,
  minScore: number,
): boolean {
  const allReadiness = GRADUATION_READINESS_ITEMS.every(
    (item) => validation.readiness[item] === true,
  );
  return allReadiness && scoreCapability(scorecard) >= minScore;
}

/* ─────────────────────────────────────────────────────────────
 * Ethical evolution (Section BI)
 * ────────────────────────────────────────────────────────────*/

export const ETHICAL_DIMENSIONS: readonly string[] = [
  "fairness",
  "accessibility",
  "transparency",
  "human_agency",
  "child_safety",
  "privacy",
  "discrimination_risk",
  "unintended_consequences",
] as const;

export interface EthicalEvaluation {
  id: ReviewId;
  capability: string;
  assessments: Record<string, boolean>;
}

export function createEthicalEvaluation(input: {
  id: ReviewId;
  capability: string;
  assessments: Record<string, boolean>;
}): { ok: true; evaluation: EthicalEvaluation } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Ethical evaluation capability is required (Section BI)" };
  for (const dimension of ETHICAL_DIMENSIONS) {
    if (input.assessments[dimension] === undefined) {
      return { ok: false, error: `Ethical dimension "${dimension}" is missing (Section BI)` };
    }
  }
  return {
    ok: true,
    evaluation: { id: input.id, capability: input.capability, assessments: input.assessments },
  };
}

export function isEthicallyAcceptable(evaluation: EthicalEvaluation): boolean {
  return ETHICAL_DIMENSIONS.every((dimension) => evaluation.assessments[dimension] === true);
}

/* ─────────────────────────────────────────────────────────────
 * Evolution security + supply-chain (Sections CS, CT)
 * ────────────────────────────────────────────────────────────*/

export const EVOLUTION_SECURITY_CONTROLS: readonly string[] = [
  "privileged_change_approval",
  "immutable_audit_trails",
  "experimental_isolation",
  "capability_signing",
  "deployment_authorization",
  "migration_authorization",
  "model_provenance",
  "artifact_integrity",
  "supply_chain_verification",
  "secrets_protection",
  "environment_isolation",
] as const;

export interface EvolutionSecurityContract {
  id: string;
  capability: string;
  controls: string[];
}

export function createEvolutionSecurityContract(input: {
  id: string;
  capability: string;
  controls?: string[];
}): { ok: true; contract: EvolutionSecurityContract } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Security contract capability is required (Section CS)" };
  for (const control of input.controls ?? []) {
    if (!EVOLUTION_SECURITY_CONTROLS.includes(control)) {
      return { ok: false, error: `Unknown evolution security control "${control}" (Section CS)` };
    }
  }
  return {
    ok: true,
    contract: { id: input.id, capability: input.capability, controls: input.controls ?? [] },
  };
}

// Section CS: Phase 32 inherits Phase 08/09 security and adds its own controls.
export function isEvolutionSecuritySatisfied(contract: EvolutionSecurityContract): boolean {
  return EVOLUTION_SECURITY_CONTROLS.every((control) => contract.controls.includes(control));
}

export const SUPPLY_CHAIN_DIMENSIONS: readonly string[] = [
  "provenance",
  "licensing",
  "vulnerability_status",
  "maintenance",
  "integrity",
  "ownership",
  "update_history",
] as const;

export interface SupplyChainEvaluation {
  id: string;
  dependency: string;
  checks: Record<string, boolean>;
}

export function createSupplyChainEvaluation(input: {
  id: string;
  dependency: string;
  checks: Record<string, boolean>;
}): { ok: true; evaluation: SupplyChainEvaluation } | { ok: false; error: string } {
  if (!input.dependency.trim())
    return { ok: false, error: "Supply-chain dependency is required (Section CT)" };
  for (const dimension of SUPPLY_CHAIN_DIMENSIONS) {
    if (input.checks[dimension] === undefined) {
      return { ok: false, error: `Supply-chain dimension "${dimension}" is missing (Section CT)` };
    }
  }
  return {
    ok: true,
    evaluation: { id: input.id, dependency: input.dependency, checks: input.checks },
  };
}

export function isSupplyChainSafe(evaluation: SupplyChainEvaluation): boolean {
  return SUPPLY_CHAIN_DIMENSIONS.every((dimension) => evaluation.checks[dimension] === true);
}

/* ─────────────────────────────────────────────────────────────
 * Evolution incident response + recovery (Sections CG, CH)
 * ────────────────────────────────────────────────────────────*/

export const INCIDENT_RESPONSE_STEPS: readonly string[] = [
  "detect",
  "classify",
  "contain",
  "disable_or_rollback",
  "investigate",
  "preserve_evidence",
  "notify",
  "correct",
  "validate",
  "document",
  "determine_rerelease",
] as const;

export interface EvolutionIncidentResponse {
  id: string;
  capability: string;
  completedSteps: string[];
}

export function createEvolutionIncidentResponse(input: {
  id: string;
  capability: string;
}): { ok: true; response: EvolutionIncidentResponse } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Incident response capability is required (Section CG)" };
  return { ok: true, response: { id: input.id, capability: input.capability, completedSteps: [] } };
}

export function completeIncidentStep(
  response: EvolutionIncidentResponse,
  step: string,
): { ok: true; response: EvolutionIncidentResponse } | { ok: false; error: string } {
  if (!INCIDENT_RESPONSE_STEPS.includes(step)) {
    return { ok: false, error: `Unknown incident response step "${step}" (Section CG)` };
  }
  return {
    ok: true,
    response: { ...response, completedSteps: [...new Set([...response.completedSteps, step])] },
  };
}

export function isIncidentResponseComplete(response: EvolutionIncidentResponse): boolean {
  return INCIDENT_RESPONSE_STEPS.every((step) => response.completedSteps.includes(step));
}

export const RECOVERY_MECHANISMS: readonly string[] = [
  "rollback",
  "version_restoration",
  "database_restoration",
  "configuration_restoration",
  "capability_disabling",
  "feature_isolation",
  "tenant_level_recovery",
] as const;

export interface EvolutionRecoveryContract {
  id: string;
  capability: string;
  available: string[];
}

export function createEvolutionRecoveryContract(input: {
  id: string;
  capability: string;
  available?: string[];
}): { ok: true; contract: EvolutionRecoveryContract } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Recovery contract capability is required (Section CH)" };
  for (const mechanism of input.available ?? []) {
    if (!RECOVERY_MECHANISMS.includes(mechanism)) {
      return { ok: false, error: `Unknown recovery mechanism "${mechanism}" (Section CH)` };
    }
  }
  return {
    ok: true,
    contract: { id: input.id, capability: input.capability, available: input.available ?? [] },
  };
}

export function isRecoveryComplete(contract: EvolutionRecoveryContract): boolean {
  return RECOVERY_MECHANISMS.every((mechanism) => contract.available.includes(mechanism));
}
