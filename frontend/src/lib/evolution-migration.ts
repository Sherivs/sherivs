/**
 * CoreGrid Evolution Migration — deprecation, sunset, migration,
 * compatibility, schema/API/protocol/model evolution, cryptographic agility,
 * generation transitions, and vendor exit.
 *
 * Implements `architecture/phase-32-future-evolution.md`:
 * - Deprecation engine (AB): capability identification, usage analysis,
 *   impact analysis, replacement identification, communication, migration
 *   tooling, transition period, monitoring, final shutdown, archival.
 * - Sunset management (AC): identify users, dependencies, data, integrations,
 *   APIs, workflows, agents, devices, reports, and regulatory obligations —
 *   no critical capability disappears without dependency verification.
 * - Migration engine (AD): dry runs, simulation, incremental migration,
 *   tenant-by-tenant, cohort, rollback, checkpoints, reconciliation,
 *   validation, audit trails.
 * - Compatibility engine (AE): compatibility across APIs, schemas, clients,
 *   devices, agents, models, integrations, infrastructure, workflows —
 *   measured rather than assumed.
 * - API evolution (P): semantic versioning, compatibility policies,
 *   deprecation periods, migration guides, compatibility adapters, schema
 *   versioning, contract tests, changelogs, client compatibility testing;
 *   breaking changes require explicit architectural approval.
 * - Data/schema evolution (Q): additive changes, field deprecation,
 *   backward-compatible readers, versioned writers, schema registry,
 *   migration validation, historical preservation; observable, resumable,
 *   auditable, reversible.
 * - Protocol evolution (R): version negotiation, capability discovery,
 *   graceful fallback, compatibility layers, protocol adapters, deprecation
 *   windows.
 * - Model migration (M): accuracy, reasoning quality, hallucination,
 *   latency, cost, safety, privacy, multilingual, African educational
 *   context, tool reliability, structured output, agent behavior, regression
 *   behavior — production migration requires measurable evidence.
 * - Cryptographic agility (AA): algorithm agility, key rotation, certificate
 *   migration, post-quantum readiness, cryptographic inventory, deprecation,
 *   secure migration — algorithms are never permanently hard-coded.
 * - Vendor exit strategy (AN): abstraction layers, alternative providers,
 *   migration paths, export mechanisms, contract documentation.
 * - Future generation architecture (BB) and generational migration (BC):
 *   continuity of data, identity, security, tenant isolation, critical
 *   workflows, auditability, and contractual compatibility.
 */

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type DeprecationId = string & { readonly __brand: "DeprecationId" };
export type MigrationId = string & { readonly __brand: "MigrationId" };
export type CompatibilityId = string & { readonly __brand: "CompatibilityId" };

export function deprecationId(raw: string): DeprecationId {
  return raw as DeprecationId;
}
export function migrationId(raw: string): MigrationId {
  return raw as MigrationId;
}
export function compatibilityId(raw: string): CompatibilityId {
  return raw as CompatibilityId;
}

/* ─────────────────────────────────────────────────────────────
 * Deprecation engine (Section AB)
 * ────────────────────────────────────────────────────────────*/

export const DEPRECATION_STEPS: readonly string[] = [
  "capability_identification",
  "usage_analysis",
  "impact_analysis",
  "replacement_identification",
  "communication",
  "migration_tooling",
  "transition_period",
  "monitoring",
  "final_shutdown",
  "archival",
] as const;

export interface DeprecationPlan {
  id: DeprecationId;
  capability: string;
  completedSteps: string[];
}

export function createDeprecationPlan(input: {
  id: DeprecationId;
  capability: string;
}): { ok: true; plan: DeprecationPlan } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Deprecation capability is required (Section AB)" };
  return { ok: true, plan: { id: input.id, capability: input.capability, completedSteps: [] } };
}

export function completeDeprecationStep(
  plan: DeprecationPlan,
  step: string,
): { ok: true; plan: DeprecationPlan } | { ok: false; error: string } {
  if (!DEPRECATION_STEPS.includes(step)) {
    return { ok: false, error: `Unknown deprecation step "${step}" (Section AB)` };
  }
  if (plan.completedSteps.includes(step)) {
    return { ok: false, error: `Deprecation step "${step}" already completed (Section AB)` };
  }
  return { ok: true, plan: { ...plan, completedSteps: [...plan.completedSteps, step] } };
}

export function isDeprecationComplete(plan: DeprecationPlan): boolean {
  return DEPRECATION_STEPS.every((step) => plan.completedSteps.includes(step));
}

/* ─────────────────────────────────────────────────────────────
 * Sunset management (Section AC)
 * ────────────────────────────────────────────────────────────*/

export const SUNSET_VERIFICATION_AREAS: readonly string[] = [
  "users",
  "dependencies",
  "data",
  "integrations",
  "apis",
  "workflows",
  "agents",
  "devices",
  "reports",
  "regulatory_obligations",
] as const;

export interface SunsetAnalysis {
  id: DeprecationId;
  capability: string;
  verified: string[];
}

export function createSunsetAnalysis(input: {
  id: DeprecationId;
  capability: string;
}): { ok: true; analysis: SunsetAnalysis } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Sunset capability is required (Section AC)" };
  return { ok: true, analysis: { id: input.id, capability: input.capability, verified: [] } };
}

export function verifySunsetArea(
  analysis: SunsetAnalysis,
  area: string,
): { ok: true; analysis: SunsetAnalysis } | { ok: false; error: string } {
  if (!SUNSET_VERIFICATION_AREAS.includes(area)) {
    return { ok: false, error: `Unknown sunset area "${area}" (Section AC)` };
  }
  return {
    ok: true,
    analysis: { ...analysis, verified: [...new Set([...analysis.verified, area])] },
  };
}

// Section AC: no critical capability disappears without dependency verification.
export function isSunsetVerified(analysis: SunsetAnalysis): boolean {
  return SUNSET_VERIFICATION_AREAS.every((area) => analysis.verified.includes(area));
}

/* ─────────────────────────────────────────────────────────────
 * Migration engine (Section AD)
 * ────────────────────────────────────────────────────────────*/

export interface MigrationPlan {
  id: MigrationId;
  capability: string;
  dryRun: boolean;
  incremental: boolean;
  rollbackAvailable: boolean;
  validationAvailable: boolean;
  auditTrailAvailable: boolean;
}

export function createMigrationPlan(input: {
  id: MigrationId;
  capability: string;
  dryRun?: boolean;
  incremental?: boolean;
  rollbackAvailable?: boolean;
  validationAvailable?: boolean;
  auditTrailAvailable?: boolean;
}): { ok: true; plan: MigrationPlan } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Migration capability is required (Section AD)" };
  return {
    ok: true,
    plan: {
      id: input.id,
      capability: input.capability,
      dryRun: input.dryRun ?? false,
      incremental: input.incremental ?? false,
      rollbackAvailable: input.rollbackAvailable ?? false,
      validationAvailable: input.validationAvailable ?? false,
      auditTrailAvailable: input.auditTrailAvailable ?? false,
    },
  };
}

// Section AD: migration requires dry runs, rollback, validation, and audit.
export function canExecuteMigration(plan: MigrationPlan): boolean {
  return (
    plan.dryRun && plan.rollbackAvailable && plan.validationAvailable && plan.auditTrailAvailable
  );
}

/* ─────────────────────────────────────────────────────────────
 * Compatibility engine (Section AE)
 * ────────────────────────────────────────────────────────────*/

export const COMPATIBILITY_SURFACES: readonly string[] = [
  "apis",
  "schemas",
  "clients",
  "devices",
  "agents",
  "models",
  "integrations",
  "infrastructure",
  "workflows",
] as const;

export interface CompatibilityContract {
  id: CompatibilityId;
  capability: string;
  testedSurfaces: string[];
}

export function createCompatibilityContract(input: {
  id: CompatibilityId;
  capability: string;
}): { ok: true; contract: CompatibilityContract } | { ok: false; error: string } {
  if (!input.capability.trim())
    return { ok: false, error: "Compatibility capability is required (Section AE)" };
  return { ok: true, contract: { id: input.id, capability: input.capability, testedSurfaces: [] } };
}

export function verifyCompatibilitySurface(
  contract: CompatibilityContract,
  surface: string,
): { ok: true; contract: CompatibilityContract } | { ok: false; error: string } {
  if (!COMPATIBILITY_SURFACES.includes(surface)) {
    return { ok: false, error: `Unknown compatibility surface "${surface}" (Section AE)` };
  }
  return {
    ok: true,
    contract: { ...contract, testedSurfaces: [...new Set([...contract.testedSurfaces, surface])] },
  };
}

// Section AE: compatibility is measured rather than assumed.
export function isCompatibilityMeasured(contract: CompatibilityContract): boolean {
  return COMPATIBILITY_SURFACES.every((surface) => contract.testedSurfaces.includes(surface));
}

/* ─────────────────────────────────────────────────────────────
 * Schema evolution (Section Q)
 * ────────────────────────────────────────────────────────────*/

export interface SchemaEvolutionPlan {
  id: MigrationId;
  schema: string;
  additiveOnly: boolean;
  fieldDeprecationDefined: boolean;
  backwardCompatibleReaders: boolean;
  schemaRegistry: boolean;
  migrationValidation: boolean;
  historicalPreservation: boolean;
}

export function createSchemaEvolutionPlan(input: {
  id: MigrationId;
  schema: string;
  additiveOnly?: boolean;
  fieldDeprecationDefined?: boolean;
  backwardCompatibleReaders?: boolean;
  schemaRegistry?: boolean;
  migrationValidation?: boolean;
  historicalPreservation?: boolean;
}): { ok: true; plan: SchemaEvolutionPlan } | { ok: false; error: string } {
  if (!input.schema.trim()) return { ok: false, error: "Schema is required (Section Q)" };
  return {
    ok: true,
    plan: {
      id: input.id,
      schema: input.schema,
      additiveOnly: input.additiveOnly ?? false,
      fieldDeprecationDefined: input.fieldDeprecationDefined ?? false,
      backwardCompatibleReaders: input.backwardCompatibleReaders ?? false,
      schemaRegistry: input.schemaRegistry ?? false,
      migrationValidation: input.migrationValidation ?? false,
      historicalPreservation: input.historicalPreservation ?? false,
    },
  };
}

// Section Q: data migrations must be observable, resumable, auditable, and
// reversible where possible — additive or backward-compatible only.
export function isSchemaEvolutionSafe(plan: SchemaEvolutionPlan): boolean {
  return plan.additiveOnly || (plan.backwardCompatibleReaders && plan.fieldDeprecationDefined);
}

/* ─────────────────────────────────────────────────────────────
 * API evolution (Section P)
 * ────────────────────────────────────────────────────────────*/

export interface ApiEvolutionPlan {
  id: CompatibilityId;
  api: string;
  semanticVersioning: boolean;
  deprecationPeriod: number;
  migrationGuide: boolean;
  compatibilityAdapters: boolean;
  contractTests: boolean;
  breakingChange: boolean;
  architecturalApproval: boolean;
}

export function createApiEvolutionPlan(input: {
  id: CompatibilityId;
  api: string;
  semanticVersioning?: boolean;
  deprecationPeriod?: number;
  migrationGuide?: boolean;
  compatibilityAdapters?: boolean;
  contractTests?: boolean;
  breakingChange?: boolean;
  architecturalApproval?: boolean;
}): { ok: true; plan: ApiEvolutionPlan } | { ok: false; error: string } {
  if (!input.api.trim()) return { ok: false, error: "API is required (Section P)" };
  if (input.deprecationPeriod !== undefined && input.deprecationPeriod < 0) {
    return { ok: false, error: "Deprecation period must be non-negative (Section P)" };
  }
  return {
    ok: true,
    plan: {
      id: input.id,
      api: input.api,
      semanticVersioning: input.semanticVersioning ?? false,
      deprecationPeriod: input.deprecationPeriod ?? 90,
      migrationGuide: input.migrationGuide ?? false,
      compatibilityAdapters: input.compatibilityAdapters ?? false,
      contractTests: input.contractTests ?? false,
      breakingChange: input.breakingChange ?? false,
      architecturalApproval: input.architecturalApproval ?? false,
    },
  };
}

// Section P: breaking changes require explicit architectural approval.
export function isBreakingChangeApproved(plan: ApiEvolutionPlan): boolean {
  if (!plan.breakingChange) return true;
  return plan.architecturalApproval && plan.migrationGuide && plan.contractTests;
}

/* ─────────────────────────────────────────────────────────────
 * Protocol evolution (Section R)
 * ────────────────────────────────────────────────────────────*/

export interface ProtocolEvolutionPlan {
  id: CompatibilityId;
  protocol: string;
  versionNegotiation: boolean;
  capabilityDiscovery: boolean;
  gracefulFallback: boolean;
  compatibilityLayers: boolean;
  protocolAdapters: boolean;
  deprecationWindow: boolean;
}

export function createProtocolEvolutionPlan(input: {
  id: CompatibilityId;
  protocol: string;
  versionNegotiation?: boolean;
  capabilityDiscovery?: boolean;
  gracefulFallback?: boolean;
  compatibilityLayers?: boolean;
  protocolAdapters?: boolean;
  deprecationWindow?: boolean;
}): { ok: true; plan: ProtocolEvolutionPlan } | { ok: false; error: string } {
  if (!input.protocol.trim()) return { ok: false, error: "Protocol is required (Section R)" };
  return {
    ok: true,
    plan: {
      id: input.id,
      protocol: input.protocol,
      versionNegotiation: input.versionNegotiation ?? false,
      capabilityDiscovery: input.capabilityDiscovery ?? false,
      gracefulFallback: input.gracefulFallback ?? false,
      compatibilityLayers: input.compatibilityLayers ?? false,
      protocolAdapters: input.protocolAdapters ?? false,
      deprecationWindow: input.deprecationWindow ?? false,
    },
  };
}

export function isProtocolEvolutionComplete(plan: ProtocolEvolutionPlan): boolean {
  return (
    plan.versionNegotiation &&
    plan.capabilityDiscovery &&
    plan.gracefulFallback &&
    plan.compatibilityLayers &&
    plan.protocolAdapters &&
    plan.deprecationWindow
  );
}

/* ─────────────────────────────────────────────────────────────
 * Model migration (Section M)
 * ────────────────────────────────────────────────────────────*/

export const MODEL_MIGRATION_DIMENSIONS: readonly string[] = [
  "accuracy",
  "reasoning_quality",
  "hallucination_behavior",
  "latency",
  "cost",
  "safety",
  "privacy",
  "multilingual",
  "african_educational_context",
  "tool_reliability",
  "structured_output",
  "agent_behavior",
  "regression_behavior",
] as const;

export interface ModelMigrationPlan {
  id: MigrationId;
  fromModel: string;
  toModel: string;
  measuredDimensions: string[];
}

export function createModelMigrationPlan(input: {
  id: MigrationId;
  fromModel: string;
  toModel: string;
}): { ok: true; plan: ModelMigrationPlan } | { ok: false; error: string } {
  if (!input.fromModel.trim() || !input.toModel.trim()) {
    return { ok: false, error: "Model migration requires source and target models (Section M)" };
  }
  return {
    ok: true,
    plan: {
      id: input.id,
      fromModel: input.fromModel,
      toModel: input.toModel,
      measuredDimensions: [],
    },
  };
}

export function addModelMigrationMeasurement(
  plan: ModelMigrationPlan,
  dimension: string,
): { ok: true; plan: ModelMigrationPlan } | { ok: false; error: string } {
  if (!MODEL_MIGRATION_DIMENSIONS.includes(dimension)) {
    return { ok: false, error: `Unknown model migration dimension "${dimension}" (Section M)` };
  }
  return {
    ok: true,
    plan: { ...plan, measuredDimensions: [...new Set([...plan.measuredDimensions, dimension])] },
  };
}

// Section M: production migration requires measurable evidence.
export function isModelMigrationEvidenceSufficient(plan: ModelMigrationPlan): boolean {
  return MODEL_MIGRATION_DIMENSIONS.every((dimension) =>
    plan.measuredDimensions.includes(dimension),
  );
}

/* ─────────────────────────────────────────────────────────────
 * Cryptographic agility (Section AA)
 * ────────────────────────────────────────────────────────────*/

export interface CryptoAgilityPlan {
  id: CompatibilityId;
  algorithmAgility: boolean;
  keyRotation: boolean;
  certificateMigration: boolean;
  postQuantumReadiness: boolean;
  cryptographicInventory: boolean;
  cryptographicDeprecation: boolean;
  secureMigration: boolean;
}

export function createCryptoAgilityPlan(input: {
  id: CompatibilityId;
  algorithmAgility?: boolean;
  keyRotation?: boolean;
  certificateMigration?: boolean;
  postQuantumReadiness?: boolean;
  cryptographicInventory?: boolean;
  cryptographicDeprecation?: boolean;
  secureMigration?: boolean;
}): { ok: true; plan: CryptoAgilityPlan } | { ok: false; error: string } {
  return {
    ok: true,
    plan: {
      id: input.id,
      algorithmAgility: input.algorithmAgility ?? false,
      keyRotation: input.keyRotation ?? false,
      certificateMigration: input.certificateMigration ?? false,
      postQuantumReadiness: input.postQuantumReadiness ?? false,
      cryptographicInventory: input.cryptographicInventory ?? false,
      cryptographicDeprecation: input.cryptographicDeprecation ?? false,
      secureMigration: input.secureMigration ?? false,
    },
  };
}

// Section AA: cryptographic algorithms must never become permanently
// hard-coded into the architecture.
export function isCryptoAgile(plan: CryptoAgilityPlan): boolean {
  return (
    plan.algorithmAgility &&
    plan.keyRotation &&
    plan.certificateMigration &&
    plan.postQuantumReadiness &&
    plan.cryptographicInventory &&
    plan.cryptographicDeprecation &&
    plan.secureMigration
  );
}

/* ─────────────────────────────────────────────────────────────
 * Generational migration (Sections BB, BC)
 * ────────────────────────────────────────────────────────────*/

export const GENERATION_MIGRATION_STEPS: readonly string[] = [
  "architectural_assessment",
  "compatibility_analysis",
  "migration_architecture",
  "data_strategy",
  "identity_strategy",
  "security_strategy",
  "tenant_migration",
  "api_migration",
  "infrastructure_migration",
  "user_migration",
  "operational_migration",
  "validation",
  "rollback_planning",
  "final_transition",
] as const;

export interface GenerationalMigrationPlan {
  id: MigrationId;
  fromGeneration: string;
  toGeneration: string;
  completedSteps: string[];
}

export function createGenerationalMigrationPlan(input: {
  id: MigrationId;
  fromGeneration: string;
  toGeneration: string;
}): { ok: true; plan: GenerationalMigrationPlan } | { ok: false; error: string } {
  if (!input.fromGeneration.trim() || !input.toGeneration.trim()) {
    return {
      ok: false,
      error: "Generation migration requires source and target generations (Section BC)",
    };
  }
  return {
    ok: true,
    plan: {
      id: input.id,
      fromGeneration: input.fromGeneration,
      toGeneration: input.toGeneration,
      completedSteps: [],
    },
  };
}

export function completeGenerationStep(
  plan: GenerationalMigrationPlan,
  step: string,
): { ok: true; plan: GenerationalMigrationPlan } | { ok: false; error: string } {
  if (!GENERATION_MIGRATION_STEPS.includes(step)) {
    return { ok: false, error: `Unknown generation migration step "${step}" (Section BC)` };
  }
  return {
    ok: true,
    plan: { ...plan, completedSteps: [...new Set([...plan.completedSteps, step])] },
  };
}

export function isGenerationalMigrationComplete(plan: GenerationalMigrationPlan): boolean {
  return GENERATION_MIGRATION_STEPS.every((step) => plan.completedSteps.includes(step));
}

export const GENERATION_CONTINUITY_AREAS: readonly string[] = [
  "institutional_data_continuity",
  "identity_continuity",
  "security_continuity",
  "tenant_isolation",
  "critical_workflows",
  "auditability",
  "contractual_compatibility",
] as const;

export interface GenerationContinuity {
  id: MigrationId;
  preserved: string[];
}

export function createGenerationContinuity(input: {
  id: MigrationId;
  preserved?: string[];
}): { ok: true; continuity: GenerationContinuity } | { ok: false; error: string } {
  for (const area of input.preserved ?? []) {
    if (!GENERATION_CONTINUITY_AREAS.includes(area)) {
      return { ok: false, error: `Unknown continuity area "${area}" (Section BB)` };
    }
  }
  return { ok: true, continuity: { id: input.id, preserved: input.preserved ?? [] } };
}

// Section BB: a new generation must preserve data, identity, security, tenant
// isolation, critical workflows, auditability, and contractual compatibility.
export function isGenerationContinuityPreserved(continuity: GenerationContinuity): boolean {
  return GENERATION_CONTINUITY_AREAS.every((area) => continuity.preserved.includes(area));
}

/* ─────────────────────────────────────────────────────────────
 * Vendor exit strategy (Section AN)
 * ────────────────────────────────────────────────────────────*/

export interface VendorExitPlan {
  id: CompatibilityId;
  dependency: string;
  abstractionLayer: boolean;
  alternativeProviders: boolean;
  migrationPaths: boolean;
  exportMechanisms: boolean;
  contractDocumentation: boolean;
}

export function createVendorExitPlan(input: {
  id: CompatibilityId;
  dependency: string;
  abstractionLayer?: boolean;
  alternativeProviders?: boolean;
  migrationPaths?: boolean;
  exportMechanisms?: boolean;
  contractDocumentation?: boolean;
}): { ok: true; plan: VendorExitPlan } | { ok: false; error: string } {
  if (!input.dependency.trim()) return { ok: false, error: "Dependency is required (Section AN)" };
  return {
    ok: true,
    plan: {
      id: input.id,
      dependency: input.dependency,
      abstractionLayer: input.abstractionLayer ?? false,
      alternativeProviders: input.alternativeProviders ?? false,
      migrationPaths: input.migrationPaths ?? false,
      exportMechanisms: input.exportMechanisms ?? false,
      contractDocumentation: input.contractDocumentation ?? false,
    },
  };
}

// Section AN: CoreGrid must avoid irreversible dependency on a single vendor.
export function isVendorIndependenceSatisfied(plan: VendorExitPlan): boolean {
  return (
    plan.abstractionLayer &&
    plan.alternativeProviders &&
    plan.migrationPaths &&
    plan.exportMechanisms &&
    plan.contractDocumentation
  );
}
