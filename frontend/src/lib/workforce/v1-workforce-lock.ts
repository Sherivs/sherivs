/**
 * CoreGrid — V1 AI Workforce Registry (scope lock).
 *
 * Architecture Council lock for the Jarvis autonomous-enterprise directive.
 * This module defines WHAT a worker can do. It does NOT instantiate workers,
 * mint processes, or grant runtime authority. Persistent identity lives in
 * `worker-definition.ts`; ephemeral compute lives in
 * `agent-runtime/ephemeral-lifecycle.ts`; matching lives in
 * `capability-registry.ts`; Jarvis remains the Part 15 orchestrator
 * (`jarvis/jarvis-contract.ts`) and MUST NOT implement mission work.
 *
 * Version target: ACTIVE-V1 organizational envelope (AGENTS.md §45).
 * Frozen roles are preserved here so nothing is deleted; they cannot be staffed.
 *
 * Boundary: pure data + pure functions. No I/O, no vendor, no secrets.
 */

import { AGENT_RISK_CLASSIFICATIONS, type AgentRiskClassification } from "../agent-core";
import {
  createCapabilityRegistry,
  type CapabilityRegistry,
  type CapabilityRegistrationInput,
} from "./capability-registry";

/** Closed authority verbs — never collapse into ADMIN = EVERYTHING. */
export const AUTHORITY_VERBS = [
  "observe",
  "analyze",
  "propose",
  "execute",
  "verify",
  "approve",
  "deploy",
  "emergency",
] as const;

export type AuthorityVerb = (typeof AUTHORITY_VERBS)[number];

export const WORKFORCE_COMMANDS = [
  "executive_command",
  "architecture_council",
  "engineering_command",
  "infrastructure_command",
  "security_command",
  "quality_command",
  "data_intelligence_command",
  "product_command",
  "operations_command",
] as const;

export type WorkforceCommand = (typeof WORKFORCE_COMMANDS)[number];

export const WORKFORCE_VERSION_TARGETS = [
  "ACTIVE-V1",
  "FUTURE-V2",
  "DEFERRED-BEYOND-V2",
] as const;

export type WorkforceVersionTarget = (typeof WORKFORCE_VERSION_TARGETS)[number];

export const WORKER_RUNTIME_STATUS = "capability_defined" as const;

export type WorkerRuntimeStatus = typeof WORKER_RUNTIME_STATUS;

const RISK_SET: ReadonlySet<string> = new Set(AGENT_RISK_CLASSIFICATIONS);

export interface WorkerBudgetLimit {
  readonly tokensPerCycle: number;
  readonly note: string;
}

export interface WorkerRuntimeLimit {
  readonly timeLimitMs: number;
  readonly actionLimit: number;
}

export interface V1WorkforceWorker {
  readonly workerId: string;
  readonly workerName: string;
  readonly role: string;
  readonly specialization: string;
  readonly command: WorkforceCommand;
  readonly versionTarget: WorkforceVersionTarget;
  readonly purpose: string;
  readonly missionCapabilities: readonly string[];
  readonly authorityVerbs: readonly AuthorityVerb[];
  readonly maxRiskClass: AgentRiskClassification;
  readonly allowedTools: readonly string[];
  readonly allowedRepositories: readonly string[];
  readonly allowedEnvironments: readonly string[];
  readonly allowedOperations: readonly string[];
  readonly forbiddenOperations: readonly string[];
  readonly securityClearance: string;
  readonly dataClearance: string;
  readonly modelPreferences: readonly string[];
  readonly modelFallbacks: readonly string[];
  readonly contextPolicy: string;
  readonly memoryPolicy: string;
  readonly reasoningPolicy: string;
  readonly verificationRequirements: readonly string[];
  readonly evidenceRequirements: readonly string[];
  readonly escalationPolicy: string;
  readonly riskClass: AgentRiskClassification;
  readonly blastRadius: string;
  readonly budgetLimit: WorkerBudgetLimit;
  readonly runtimeLimit: WorkerRuntimeLimit;
  readonly lease: "ephemeral_cycle";
  readonly status: WorkerRuntimeStatus;
  readonly performanceMetrics: readonly string[];
  readonly existingImplementation: readonly string[];
  readonly phase52Action:
    | "ATTACH TO EXISTING ENGINE"
    | "CREATE WORKFORCE CAPABILITY"
    | "FREEZE V2"
    | "FREEZE BEYOND V2";
}

const UNIVERSAL_FORBIDDEN: readonly string[] = [
  "expand_own_authority",
  "access_unscoped_secrets",
  "bypass_rls",
  "invent_credentials",
  "invent_metrics",
  "treat_model_output_as_truth",
  "mutate_governance",
  "disable_security",
  "commit_secrets",
  "direct_protected_branch_write",
];

const DEFAULT_REPO = "coregrid-scholar-migration";
const DEFAULT_METRICS = [
  "mission_completion_rate",
  "verification_pass_rate",
  "rework_rate",
  "failure_rate",
  "security_violations",
] as const;

function worker(input: Omit<V1WorkforceWorker, "status" | "lease" | "forbiddenOperations"> & {
  forbiddenOperations?: readonly string[];
}): V1WorkforceWorker {
  const forbidden = [...UNIVERSAL_FORBIDDEN, ...(input.forbiddenOperations ?? [])];
  const seen = new Set<string>();
  const forbiddenOperations = forbidden.filter((item) => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
  return {
    ...input,
    forbiddenOperations,
    lease: "ephemeral_cycle",
    status: WORKER_RUNTIME_STATUS,
  };
}

function v1Engineer(
  workerId: string,
  workerName: string,
  specialization: string,
  purpose: string,
  extraForbidden: readonly string[] = [],
  existingImplementation: readonly string[] = ["frontend/src/lib/workforce/worker-definition.ts"],
): V1WorkforceWorker {
  return worker({
    workerId,
    workerName,
    role: workerId,
    specialization,
    command: "engineering_command",
    versionTarget: "ACTIVE-V1",
    purpose,
    missionCapabilities: [`v1.role.${workerId}`, "mission:execute"],
    authorityVerbs: ["observe", "analyze", "propose", "execute"],
    maxRiskClass: "high",
    allowedTools: ["isolated_workspace", "tests", "patch_pr", "ai_gateway"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["isolated_workspace"],
    allowedOperations: ["implement", "test", "open_pull_request"],
    forbiddenOperations: ["deploy", "approve", "verify_own_work", "production_mutate", ...extraForbidden],
    securityClearance: "engineering",
    dataClearance: "mission_scoped",
    modelPreferences: ["CODING", "STANDARD", "REASONING"],
    modelFallbacks: ["STANDARD", "FAST"],
    contextPolicy: "constitution>governance>architecture>domain>mission>role>task>repository",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["independent_verifier"],
    evidenceRequirements: ["tests", "diff", "provenance"],
    escalationPolicy: "security_or_human_on_high_risk",
    riskClass: "medium",
    blastRadius: "isolated_branch",
    budgetLimit: { tokensPerCycle: 250_000, note: "mission-scoped token ceiling; never unlimited" },
    runtimeLimit: { timeLimitMs: 30 * 60_000, actionLimit: 80 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation,
    phase52Action: "CREATE WORKFORCE CAPABILITY",
  });
}

function v1Infra(
  workerId: string,
  workerName: string,
  specialization: string,
  purpose: string,
  verbs: readonly AuthorityVerb[],
  extraForbidden: readonly string[],
): V1WorkforceWorker {
  return worker({
    workerId,
    workerName,
    role: workerId,
    specialization,
    command: "infrastructure_command",
    versionTarget: "ACTIVE-V1",
    purpose,
    missionCapabilities: [`v1.role.${workerId}`],
    authorityVerbs: verbs,
    maxRiskClass: "high",
    allowedTools: ["observability", "ci", "runbooks"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library", "ci"],
    allowedOperations: verbs.filter((verb) => verb !== "approve"),
    forbiddenOperations: extraForbidden,
    securityClearance: "infrastructure",
    dataClearance: "operational_redacted",
    modelPreferences: ["STANDARD", "REASONING"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>architecture>mission>role>task",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["independent_release_verification"],
    evidenceRequirements: ["health", "logs", "deploy_evidence"],
    escalationPolicy: "human_for_production_destructive",
    riskClass: "high",
    blastRadius: "declared_environment",
    budgetLimit: { tokensPerCycle: 80_000, note: "operational cycle bound" },
    runtimeLimit: { timeLimitMs: 15 * 60_000, actionLimit: 40 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["frontend/src/lib/reliability/failure-architecture.ts"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  });
}

function v1Security(
  workerId: string,
  workerName: string,
  specialization: string,
  purpose: string,
  verbs: readonly AuthorityVerb[],
): V1WorkforceWorker {
  return worker({
    workerId,
    workerName,
    role: workerId,
    specialization,
    command: "security_command",
    versionTarget: "ACTIVE-V1",
    purpose,
    missionCapabilities: [`v1.role.${workerId}`, "mission:verify"],
    authorityVerbs: verbs,
    maxRiskClass: "critical",
    allowedTools: ["policy_engine", "credential_broker_gate", "audit"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["inspect", "detect", "report", "quarantine_recommend", "block_unsafe"],
    forbiddenOperations: ["weaken_security", "disable_rls", "reveal_secrets", "execute_product_code"],
    securityClearance: "security",
    dataClearance: "minimized",
    modelPreferences: ["SECURITY", "REASONING"],
    modelFallbacks: ["STANDARD"],
    contextPolicy: "constitution>governance>security>mission>role>task",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["independent_of_implementer"],
    evidenceRequirements: ["policy_decision", "audit_record"],
    escalationPolicy: "human_for_root_of_trust",
    riskClass: "high",
    blastRadius: "deny_by_default",
    budgetLimit: { tokensPerCycle: 60_000, note: "security review bound" },
    runtimeLimit: { timeLimitMs: 15 * 60_000, actionLimit: 40 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: [
      "frontend/src/lib/authorization.ts",
      "frontend/src/lib/security/credential-broker.ts",
    ],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  });
}

function v1Quality(
  workerId: string,
  workerName: string,
  specialization: string,
  purpose: string,
): V1WorkforceWorker {
  return worker({
    workerId,
    workerName,
    role: workerId,
    specialization,
    command: "quality_command",
    versionTarget: "ACTIVE-V1",
    purpose,
    missionCapabilities: [`v1.role.${workerId}`, "mission:verify"],
    authorityVerbs: ["observe", "analyze", "verify"],
    maxRiskClass: "high",
    allowedTools: ["tests", "evidence_ports"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library", "ci"],
    allowedOperations: ["verify", "report_rework"],
    forbiddenOperations: ["implement", "deploy", "approve", "self_verify_own_implementation"],
    securityClearance: "quality",
    dataClearance: "test_evidence",
    modelPreferences: ["STANDARD", "REASONING"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>architecture>mission>role>task",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["independent_of_executor"],
    evidenceRequirements: ["test_results", "independence_check"],
    escalationPolicy: "block_unverified_claims",
    riskClass: "medium",
    blastRadius: "verification_only",
    budgetLimit: { tokensPerCycle: 80_000, note: "verification bound" },
    runtimeLimit: { timeLimitMs: 20 * 60_000, actionLimit: 40 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: [
      "frontend/src/lib/assurance/verification-independence.ts",
      "frontend/src/lib/workforce/worker-host.ts",
    ],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  });
}

function frozen(
  workerId: string,
  workerName: string,
  command: WorkforceCommand,
  specialization: string,
  purpose: string,
  versionTarget: Exclude<WorkforceVersionTarget, "ACTIVE-V1">,
  phase52Action: "FREEZE V2" | "FREEZE BEYOND V2",
): V1WorkforceWorker {
  return worker({
    workerId,
    workerName,
    role: workerId,
    specialization,
    command,
    versionTarget,
    purpose,
    missionCapabilities: [`v1.role.${workerId}`],
    authorityVerbs: ["observe", "analyze"],
    maxRiskClass: "low",
    allowedTools: [],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["none"],
    allowedOperations: ["inspect_frozen_corpus"],
    forbiddenOperations: ["execute", "deploy", "staff", "instantiate"],
    securityClearance: "frozen",
    dataClearance: "none",
    modelPreferences: [],
    modelFallbacks: [],
    contextPolicy: "constitution_only",
    memoryPolicy: "none",
    reasoningPolicy: "do_not_implement",
    verificationRequirements: ["human_unfreeze_record"],
    evidenceRequirements: ["classification_record"],
    escalationPolicy: "requires_human_unfreeze",
    riskClass: "low",
    blastRadius: "none",
    budgetLimit: { tokensPerCycle: 0, note: "frozen — no compute" },
    runtimeLimit: { timeLimitMs: 0, actionLimit: 0 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: [],
    phase52Action,
  });
}

/**
 * The locked V1 workforce. 64 capability definitions — not 64 running agents.
 * Persistent identity ≠ persistent compute.
 */
export const V1_WORKFORCE_WORKERS: readonly V1WorkforceWorker[] = [
  worker({
    workerId: "jarvis",
    workerName: "Jarvis",
    role: "executive_intelligence",
    specialization: "enterprise_orchestration",
    command: "executive_command",
    versionTarget: "ACTIVE-V1",
    purpose:
      "CEO / executive intelligence: observe, staff, coordinate, escalate, brief. Never implement, verify, deploy, or grant itself authority.",
    missionCapabilities: [
      "observe_platform_state",
      "inspect_mission_state",
      "coordinate_workers",
      "initiate_governed_mission",
      "request_approval",
      "escalate_incident",
      "summarize_events",
      "recommend_action",
    ],
    authorityVerbs: ["observe", "analyze", "propose"],
    maxRiskClass: "high",
    allowedTools: ["observation_ports", "mission_record_port", "briefing", "escalation", "staffing"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["observe", "staff", "delegate", "brief", "escalate"],
    forbiddenOperations: [
      "implement_mission_work",
      "verify_mission_work",
      "deploy",
      "approve",
      "access_secrets",
      "self_authority_grant",
    ],
    securityClearance: "executive",
    dataClearance: "redacted_operational",
    modelPreferences: ["FAST", "STANDARD", "REASONING"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>architecture>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["independent_quality_or_security_verifier"],
    evidenceRequirements: ["provenance_stamped_claims"],
    escalationPolicy: "human_for_critical",
    riskClass: "high",
    blastRadius: "coordination_only",
    budgetLimit: {
      tokensPerCycle: 0,
      note: "V1 executive loop is deterministic over observed evidence; no model required",
    },
    runtimeLimit: { timeLimitMs: 30_000, actionLimit: 20 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: [
      "frontend/src/lib/jarvis/jarvis-contract.ts",
      "frontend/src/lib/jarvis/briefing.ts",
      "frontend/src/lib/jarvis/escalation.ts",
      "frontend/src/lib/hermes/hermes-cycle.ts",
    ],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),

  worker({
    workerId: "chief_architect",
    workerName: "Chief Architect Agent",
    role: "chief_architect",
    specialization: "system_architecture",
    command: "architecture_council",
    versionTarget: "ACTIVE-V1",
    purpose: "Owns boundaries, dependency topology, ADRs, and architectural consistency.",
    missionCapabilities: ["v1.role.chief_architect"],
    authorityVerbs: ["observe", "analyze", "propose"],
    maxRiskClass: "high",
    allowedTools: ["architecture_corpus", "adr"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["propose_adr", "map_boundaries"],
    forbiddenOperations: ["execute", "deploy", "implement"],
    securityClearance: "architecture",
    dataClearance: "architecture",
    modelPreferences: ["REASONING", "DEEP_REASONING"],
    modelFallbacks: ["STANDARD"],
    contextPolicy: "constitution>governance>architecture>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["independent_runtime_or_security_review"],
    evidenceRequirements: ["adr", "boundary_map"],
    escalationPolicy: "human_for_unfreeze",
    riskClass: "high",
    blastRadius: "design_only",
    budgetLimit: { tokensPerCycle: 120_000, note: "architecture reasoning bound" },
    runtimeLimit: { timeLimitMs: 20 * 60_000, actionLimit: 30 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["architecture/registry.json", "DECISIONS.md"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
  worker({
    workerId: "reality_architect",
    workerName: "Reality Architect",
    role: "reality_architect",
    specialization: "reality_model",
    command: "architecture_council",
    versionTarget: "ACTIVE-V1",
    purpose: "Owns the V1 entity/state/event/relationship substrate — not V3 reality observation.",
    missionCapabilities: ["v1.role.reality_architect"],
    authorityVerbs: ["observe", "analyze", "propose"],
    maxRiskClass: "high",
    allowedTools: ["kernel_reality"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["model_entities", "model_events"],
    forbiddenOperations: ["execute", "deploy", "v3_reality_observation"],
    securityClearance: "architecture",
    dataClearance: "kernel",
    modelPreferences: ["REASONING"],
    modelFallbacks: ["STANDARD"],
    contextPolicy: "constitution>governance>architecture>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["independent_runtime_review"],
    evidenceRequirements: ["kernel_contract"],
    escalationPolicy: "human_for_v3_unfreeze",
    riskClass: "medium",
    blastRadius: "design_only",
    budgetLimit: { tokensPerCycle: 80_000, note: "reality-model bound" },
    runtimeLimit: { timeLimitMs: 15 * 60_000, actionLimit: 30 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["frontend/src/lib/kernel/reality.ts"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
  worker({
    workerId: "runtime_architect",
    workerName: "Runtime Architect",
    role: "runtime_architect",
    specialization: "execution_runtime",
    command: "architecture_council",
    versionTarget: "ACTIVE-V1",
    purpose: "Owns mission/worker/lifecycle orchestration contracts — not omnipotent execution.",
    missionCapabilities: ["v1.role.runtime_architect"],
    authorityVerbs: ["observe", "analyze", "propose"],
    maxRiskClass: "high",
    allowedTools: ["mission_contracts", "worker_host_contracts"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["design_runtime"],
    forbiddenOperations: ["execute", "deploy", "run_as_jarvis"],
    securityClearance: "architecture",
    dataClearance: "runtime_contracts",
    modelPreferences: ["REASONING"],
    modelFallbacks: ["STANDARD"],
    contextPolicy: "constitution>governance>architecture>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["independent_quality_review"],
    evidenceRequirements: ["runtime_contract"],
    escalationPolicy: "human_for_production_runtime_change",
    riskClass: "high",
    blastRadius: "design_only",
    budgetLimit: { tokensPerCycle: 80_000, note: "runtime design bound" },
    runtimeLimit: { timeLimitMs: 15 * 60_000, actionLimit: 30 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: [
      "frontend/src/lib/workforce/worker-host.ts",
      "frontend/src/lib/missions/mission-execution.ts",
    ],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),

  v1Engineer("backend_engineer", "Backend Engineer", "backend", "Implements server-side V1 contracts in isolated workspaces."),
  v1Engineer("frontend_engineer", "Frontend Engineer", "frontend", "Implements V1 web surfaces; UI is not security."),
  v1Engineer("full_stack_engineer", "Full-Stack Engineer", "full_stack", "Cross-layer V1 implementation with the same isolation and four-eyes rules."),
  v1Engineer("api_engineer", "API Engineer", "api", "Implements authenticated, tenant-scoped API contracts."),
  v1Engineer(
    "database_engineer",
    "Database Engineer",
    "database",
    "Authors migrations and constraints; cannot weaken RLS.",
    ["weaken_rls"],
    ["database/supabase/migrations"],
  ),
  v1Engineer(
    "supabase_engineer",
    "Supabase Engineer",
    "supabase_adapter",
    "Provider adapter work only — CoreGrid remains vendor-neutral.",
    ["embed_vendor_in_domain"],
    ["frontend/src/integrations/supabase"],
  ),
  v1Engineer("distributed_systems_engineer", "Distributed Systems Engineer", "distributed_systems", "Queues, leases, idempotency, and bounded retry — V1 mission path."),
  v1Engineer("integration_engineer", "Integration Engineer", "integration", "Provider fabric adapters with fail-closed semantics."),
  frozen(
    "sdk_engineer",
    "SDK Engineer",
    "engineering_command",
    "external_sdk",
    "External developer SDK is MIXED/frozen (phase 28). Preserved, not staffed in V1.",
    "DEFERRED-BEYOND-V2",
    "FREEZE BEYOND V2",
  ),
  v1Engineer("mobile_engineer", "Mobile Engineer", "mobile", "V1 mobile client contracts (phase 22 ACTIVE-V1).", [], ["mobile/"]),
  v1Engineer("pwa_engineer", "PWA Engineer", "pwa", "Progressive web runtime within the V1 web platform."),
  v1Engineer("developer_experience_engineer", "Developer Experience Engineer", "developer_experience", "Tooling and verification DX; no production mutation."),

  v1Infra("platform_engineer", "Platform Engineer", "platform", "Platform substrate and environment contracts.", ["observe", "analyze", "propose", "execute"], ["production_destructive_without_policy"]),
  v1Infra("devops_engineer", "DevOps Engineer", "devops", "CI/CD pipelines and governed promotion.", ["observe", "analyze", "propose", "execute"], ["direct_production_write"]),
  v1Infra("sre", "SRE Agent", "sre", "Reliability, bounded recovery, and error budgets.", ["observe", "analyze", "propose", "emergency"], ["unrestricted_self_heal"]),
  v1Infra("cloud_infrastructure_engineer", "Cloud Infrastructure Engineer", "cloud", "Declared cloud fabric within V1 — no invented providers.", ["observe", "analyze", "propose"], ["invent_infrastructure"]),
  v1Infra("deployment_engineer", "Deployment Engineer", "deployment", "Deployment only under explicit policy and independent verification.", ["observe", "propose", "deploy"], ["deploy_without_verification", "deploy_at_night_unattended_high_risk"]),
  v1Infra("release_engineer", "Release Engineer", "release", "Release coordination; cannot also be the sole verifier.", ["observe", "analyze", "propose"], ["self_verify_release"]),
  v1Infra("disaster_recovery_engineer", "Disaster Recovery Engineer", "disaster_recovery", "RTO/RPO contracts and recovery drills — not autonomous destruction.", ["observe", "analyze", "propose", "emergency"], ["unapproved_destructive_recovery"]),
  v1Infra("performance_engineer", "Performance Engineer", "performance", "Performance evidence over invented load numbers.", ["observe", "analyze", "propose"], ["invent_benchmarks"]),
  v1Infra("networking_engineer", "Networking Engineer", "networking", "Capability-scoped network policy. Device/IoT networking is V2 frozen.", ["observe", "analyze", "propose"], ["v2_device_network"]),
  v1Infra("observability_engineer", "Observability Engineer", "observability", "Logs, metrics, traces, health — never secrets.", ["observe", "analyze", "propose"], ["log_secrets"]),

  v1Security("security_architect", "Security Architect", "security_architecture", "Security boundaries and policy design.", ["observe", "analyze", "propose", "verify"]),
  v1Security("application_security_engineer", "Application Security Engineer", "application_security", "Inspects and blocks unsafe application changes.", ["observe", "analyze", "verify"]),
  v1Security("cloud_security_engineer", "Cloud Security Engineer", "cloud_security", "Cloud posture inspection — no silent control weakening.", ["observe", "analyze", "verify"]),
  v1Security("identity_access_engineer", "Identity & Access Engineer", "identity_access", "Identity, membership, and delegation contracts.", ["observe", "analyze", "propose", "verify"]),
  v1Security("secrets_security_engineer", "Secrets Security Engineer", "secrets", "Credential-broker policy. Workers receive scoped capabilities, never env dumps.", ["observe", "analyze", "verify"]),
  v1Security("threat_detection_agent", "Threat Detection Agent", "threat_detection", "Detect and report. Cannot disable security.", ["observe", "analyze"]),
  v1Security("security_verification_agent", "Security Verification Agent", "security_verification", "Independent security verification of another worker's change.", ["observe", "verify"]),
  v1Security("compliance_governance_agent", "Compliance/Governance Agent", "compliance", "Policy and audit conformance. Cannot rewrite governance.", ["observe", "analyze", "verify"]),

  v1Quality("qa_engineer", "QA Engineer", "qa", "Independent verification of implementation claims."),
  v1Quality("test_automation_engineer", "Test Automation Engineer", "test_automation", "Automated evidence; cannot declare the implementer's success."),
  v1Quality("integration_test_engineer", "Integration Test Engineer", "integration_test", "Cross-module verification with tenant isolation evidence."),
  v1Quality("reliability_verification_engineer", "Reliability Verification Engineer", "reliability_verification", "Recovery and failure-path evidence."),
  v1Quality("regression_engineer", "Regression Engineer", "regression", "Regression evidence against the existing suite."),
  v1Quality("release_verification_engineer", "Release Verification Engineer", "release_verification", "Independent release gate. Never the deploying worker."),

  worker({
    workerId: "data_engineer",
    workerName: "Data Engineer",
    role: "data_engineer",
    specialization: "data_platform",
    command: "data_intelligence_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Phase 14 data contracts (ingestion/jobs/reconciliation) — libraries today, not invented warehouses.",
    missionCapabilities: ["v1.role.data_engineer"],
    authorityVerbs: ["observe", "analyze", "propose", "execute"],
    maxRiskClass: "high",
    allowedTools: ["data_contracts", "tests"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["isolated_workspace"],
    allowedOperations: ["implement_data_contracts"],
    forbiddenOperations: ["invent_warehouse", "deploy"],
    securityClearance: "data",
    dataClearance: "classified_minimized",
    modelPreferences: ["CODING", "STANDARD"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>architecture>mission>role>task",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["independent_verifier"],
    evidenceRequirements: ["contract_tests"],
    escalationPolicy: "security_on_personal_data",
    riskClass: "medium",
    blastRadius: "isolated_branch",
    budgetLimit: { tokensPerCycle: 120_000, note: "data-contract bound" },
    runtimeLimit: { timeLimitMs: 20 * 60_000, actionLimit: 50 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: [
      "frontend/src/lib/data-ingestion.ts",
      "frontend/src/lib/data-jobs.ts",
      "frontend/src/lib/data-reconciliation.ts",
    ],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
  worker({
    workerId: "data_governance_engineer",
    workerName: "Data Governance Engineer",
    role: "data_governance_engineer",
    specialization: "data_governance",
    command: "data_intelligence_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Classification, retention declarations, and purpose limitation.",
    missionCapabilities: ["v1.role.data_governance_engineer"],
    authorityVerbs: ["observe", "analyze", "propose", "verify"],
    maxRiskClass: "high",
    allowedTools: ["data_governance"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["classify", "declare_retention"],
    forbiddenOperations: ["execute_erasure_without_policy"],
    securityClearance: "data_governance",
    dataClearance: "policy",
    modelPreferences: ["REASONING"],
    modelFallbacks: ["STANDARD"],
    contextPolicy: "constitution>governance>architecture>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["compliance_review"],
    evidenceRequirements: ["policy_record"],
    escalationPolicy: "human_for_legal",
    riskClass: "high",
    blastRadius: "policy",
    budgetLimit: { tokensPerCycle: 60_000, note: "governance bound" },
    runtimeLimit: { timeLimitMs: 15 * 60_000, actionLimit: 30 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["frontend/src/lib/data-governance.ts"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
  worker({
    workerId: "ai_engineer",
    workerName: "AI Engineer",
    role: "ai_engineer",
    specialization: "ai_platform",
    command: "data_intelligence_command",
    versionTarget: "ACTIVE-V1",
    purpose: "AI platform work through the centralized gateway only.",
    missionCapabilities: ["v1.role.ai_engineer"],
    authorityVerbs: ["observe", "analyze", "propose", "execute"],
    maxRiskClass: "high",
    allowedTools: ["ai_gateway"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["isolated_workspace"],
    allowedOperations: ["gateway_integration"],
    forbiddenOperations: ["scatter_direct_model_calls", "deploy"],
    securityClearance: "ai",
    dataClearance: "minimized_ai_context",
    modelPreferences: ["CODING", "STANDARD"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>ai_privacy>mission>role>task",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["independent_verifier"],
    evidenceRequirements: ["gateway_adoption_tests"],
    escalationPolicy: "security_on_data_exfil_risk",
    riskClass: "medium",
    blastRadius: "isolated_branch",
    budgetLimit: { tokensPerCycle: 120_000, note: "AI-engineer bound" },
    runtimeLimit: { timeLimitMs: 20 * 60_000, actionLimit: 50 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["frontend/src/lib/ai-gateway.server.ts"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
  frozen(
    "ml_engineer",
    "ML Engineer",
    "data_intelligence_command",
    "model_training",
    "Model training / civilization compute is frozen. Gateway inference remains V1 via ai_engineer.",
    "DEFERRED-BEYOND-V2",
    "FREEZE BEYOND V2",
  ),
  worker({
    workerId: "model_evaluation_engineer",
    workerName: "Model Evaluation Engineer",
    role: "model_evaluation_engineer",
    specialization: "model_evaluation",
    command: "data_intelligence_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Evaluates model output trust. Cannot promote an unauthorized provider.",
    missionCapabilities: ["v1.role.model_evaluation_engineer"],
    authorityVerbs: ["observe", "analyze", "verify"],
    maxRiskClass: "medium",
    allowedTools: ["output_trust_pipeline", "evals"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["evaluate"],
    forbiddenOperations: ["route_sensitive_data_to_unauthorized_provider"],
    securityClearance: "ai_eval",
    dataClearance: "eval_redacted",
    modelPreferences: ["STANDARD"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>ai_privacy>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["eval_evidence"],
    evidenceRequirements: ["eval_record"],
    escalationPolicy: "security_on_exfil",
    riskClass: "medium",
    blastRadius: "evaluation",
    budgetLimit: { tokensPerCycle: 40_000, note: "eval bound" },
    runtimeLimit: { timeLimitMs: 15 * 60_000, actionLimit: 20 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["frontend/src/lib/ai-gateway/output-trust-pipeline.ts"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
  worker({
    workerId: "ai_gateway_engineer",
    workerName: "AI Gateway Engineer",
    role: "ai_gateway_engineer",
    specialization: "ai_gateway",
    command: "data_intelligence_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Owns gateway routing, metering, and fail-closed provider abstraction.",
    missionCapabilities: ["v1.role.ai_gateway_engineer"],
    authorityVerbs: ["observe", "analyze", "propose", "execute"],
    maxRiskClass: "high",
    allowedTools: ["ai_gateway", "metering"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["isolated_workspace"],
    allowedOperations: ["gateway_maintenance"],
    forbiddenOperations: ["bypass_gateway", "deploy"],
    securityClearance: "ai",
    dataClearance: "minimized_ai_context",
    modelPreferences: ["CODING"],
    modelFallbacks: ["STANDARD"],
    contextPolicy: "constitution>governance>ai_privacy>mission>role>task",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["independent_verifier"],
    evidenceRequirements: ["gateway_tests"],
    escalationPolicy: "security_on_provider_change",
    riskClass: "high",
    blastRadius: "isolated_branch",
    budgetLimit: { tokensPerCycle: 80_000, note: "gateway bound" },
    runtimeLimit: { timeLimitMs: 15 * 60_000, actionLimit: 40 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: [
      "frontend/src/lib/ai-gateway.server.ts",
      "frontend/src/lib/ai-gateway/model-registry.ts",
    ],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
  frozen(
    "knowledge_engineer",
    "Knowledge Engineer",
    "data_intelligence_command",
    "knowledge_graph",
    "Deferred by prior V1 un-freeze record. Corpus preserved; not staffed.",
    "DEFERRED-BEYOND-V2",
    "FREEZE BEYOND V2",
  ),
  worker({
    workerId: "memory_systems_engineer",
    workerName: "Memory Systems Engineer",
    role: "memory_systems_engineer",
    specialization: "memory",
    command: "data_intelligence_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Canonical memory tier. No prompt-resident permanent memories.",
    missionCapabilities: ["v1.role.memory_systems_engineer"],
    authorityVerbs: ["observe", "analyze", "propose", "execute"],
    maxRiskClass: "high",
    allowedTools: ["memory_store"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["isolated_workspace"],
    allowedOperations: ["memory_contract_work"],
    forbiddenOperations: ["treat_ai_memory_as_truth", "deploy"],
    securityClearance: "memory",
    dataClearance: "authorization_gated",
    modelPreferences: ["CODING", "STANDARD"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>architecture>mission>role>task",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["independent_verifier"],
    evidenceRequirements: ["memory_authz_tests"],
    escalationPolicy: "security_on_scope_expansion",
    riskClass: "high",
    blastRadius: "isolated_branch",
    budgetLimit: { tokensPerCycle: 80_000, note: "memory bound" },
    runtimeLimit: { timeLimitMs: 15 * 60_000, actionLimit: 40 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["frontend/src/lib/memory/memory-store.ts"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
  frozen(
    "intelligence_research_agent",
    "Intelligence Research Agent",
    "data_intelligence_command",
    "research",
    "Open-ended research beyond V1 organizational envelope is frozen.",
    "DEFERRED-BEYOND-V2",
    "FREEZE BEYOND V2",
  ),
  worker({
    workerId: "context_engineering_agent",
    workerName: "Context Engineering Agent",
    role: "context_engineering_agent",
    specialization: "context_assembly",
    command: "data_intelligence_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Assembles minimized, purpose-limited context. Workers must not ingest the whole repository.",
    missionCapabilities: ["v1.role.context_engineering_agent"],
    authorityVerbs: ["observe", "analyze", "propose", "execute"],
    maxRiskClass: "medium",
    allowedTools: ["context_assembly"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["isolated_workspace"],
    allowedOperations: ["assemble_context"],
    forbiddenOperations: ["dump_full_repository", "deploy"],
    securityClearance: "context",
    dataClearance: "minimized",
    modelPreferences: ["STANDARD"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>ai_privacy>mission>role>task",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["independent_verifier"],
    evidenceRequirements: ["exclusion_ledger"],
    escalationPolicy: "security_on_oversharing",
    riskClass: "medium",
    blastRadius: "isolated_branch",
    budgetLimit: { tokensPerCycle: 60_000, note: "context bound" },
    runtimeLimit: { timeLimitMs: 10 * 60_000, actionLimit: 30 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["frontend/src/lib/context-assembly.ts"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),

  worker({
    workerId: "product_strategist",
    workerName: "Product Strategist",
    role: "product_strategist",
    specialization: "product_strategy",
    command: "product_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Outcome-oriented product proposals from real contracts — no fake dashboards.",
    missionCapabilities: ["v1.role.product_strategist"],
    authorityVerbs: ["observe", "analyze", "propose"],
    maxRiskClass: "medium",
    allowedTools: ["product_contracts"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["propose_outcomes"],
    forbiddenOperations: ["invent_metrics", "execute", "deploy"],
    securityClearance: "product",
    dataClearance: "aggregated_authorized",
    modelPreferences: ["REASONING"],
    modelFallbacks: ["STANDARD"],
    contextPolicy: "constitution>governance>architecture>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["evidence_backed_recommendations"],
    evidenceRequirements: ["observed_state"],
    escalationPolicy: "human_for_external_commitments",
    riskClass: "medium",
    blastRadius: "proposal",
    budgetLimit: { tokensPerCycle: 40_000, note: "strategy bound" },
    runtimeLimit: { timeLimitMs: 10 * 60_000, actionLimit: 20 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: [],
    phase52Action: "CREATE WORKFORCE CAPABILITY",
  }),
  worker({
    workerId: "ux_architect",
    workerName: "UX Architect",
    role: "ux_architect",
    specialization: "ux",
    command: "product_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Experience architecture within the existing design system.",
    missionCapabilities: ["v1.role.ux_architect"],
    authorityVerbs: ["observe", "analyze", "propose"],
    maxRiskClass: "medium",
    allowedTools: ["design_system"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["propose_ux"],
    forbiddenOperations: ["execute", "deploy", "introduce_random_ui_framework"],
    securityClearance: "product",
    dataClearance: "ux",
    modelPreferences: ["STANDARD"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>architecture>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["accessibility_review"],
    evidenceRequirements: ["design_contract"],
    escalationPolicy: "human_for_brand",
    riskClass: "low",
    blastRadius: "proposal",
    budgetLimit: { tokensPerCycle: 40_000, note: "ux bound" },
    runtimeLimit: { timeLimitMs: 10 * 60_000, actionLimit: 20 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["frontend/src/lib/theme.ts"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
  v1Engineer("ui_engineer", "UI Engineer", "ui", "Implements UI with Tailwind/shadcn/Radix/Lucide only."),
  worker({
    workerId: "design_systems_engineer",
    workerName: "Design Systems Engineer",
    role: "design_systems_engineer",
    specialization: "design_system",
    command: "product_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Maintains the existing design system. No new UI frameworks.",
    missionCapabilities: ["v1.role.design_systems_engineer"],
    authorityVerbs: ["observe", "analyze", "propose", "execute"],
    maxRiskClass: "medium",
    allowedTools: ["design_system", "tests"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["isolated_workspace"],
    allowedOperations: ["implement_design_tokens"],
    forbiddenOperations: ["introduce_random_ui_framework", "deploy"],
    securityClearance: "product",
    dataClearance: "design",
    modelPreferences: ["CODING"],
    modelFallbacks: ["STANDARD"],
    contextPolicy: "constitution>governance>architecture>mission>role>task",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["independent_verifier"],
    evidenceRequirements: ["component_tests"],
    escalationPolicy: "human_for_brand",
    riskClass: "low",
    blastRadius: "isolated_branch",
    budgetLimit: { tokensPerCycle: 60_000, note: "design-system bound" },
    runtimeLimit: { timeLimitMs: 15 * 60_000, actionLimit: 30 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["components.json"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
  worker({
    workerId: "accessibility_engineer",
    workerName: "Accessibility Engineer",
    role: "accessibility_engineer",
    specialization: "accessibility",
    command: "product_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Accessibility verification and remediation proposals.",
    missionCapabilities: ["v1.role.accessibility_engineer"],
    authorityVerbs: ["observe", "analyze", "propose", "verify"],
    maxRiskClass: "medium",
    allowedTools: ["a11y_evidence"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["audit_accessibility"],
    forbiddenOperations: ["deploy"],
    securityClearance: "product",
    dataClearance: "ux",
    modelPreferences: ["STANDARD"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>architecture>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["a11y_evidence"],
    evidenceRequirements: ["a11y_findings"],
    escalationPolicy: "human_for_legal_a11y",
    riskClass: "medium",
    blastRadius: "verification",
    budgetLimit: { tokensPerCycle: 40_000, note: "a11y bound" },
    runtimeLimit: { timeLimitMs: 10 * 60_000, actionLimit: 20 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: [],
    phase52Action: "CREATE WORKFORCE CAPABILITY",
  }),
  worker({
    workerId: "product_analytics_engineer",
    workerName: "Product Analytics Engineer",
    role: "product_analytics_engineer",
    specialization: "product_analytics",
    command: "product_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Analytics over observed CoreGrid data only. No static production-looking invent.",
    missionCapabilities: ["v1.role.product_analytics_engineer"],
    authorityVerbs: ["observe", "analyze", "propose"],
    maxRiskClass: "medium",
    allowedTools: ["metering", "observability"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["report_observed_metrics"],
    forbiddenOperations: ["invent_metrics", "execute", "deploy"],
    securityClearance: "analytics",
    dataClearance: "aggregated_authorized",
    modelPreferences: ["STANDARD"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>architecture>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["source_evidence"],
    evidenceRequirements: ["metering_records"],
    escalationPolicy: "human_for_external_reporting",
    riskClass: "medium",
    blastRadius: "reporting",
    budgetLimit: { tokensPerCycle: 40_000, note: "analytics bound" },
    runtimeLimit: { timeLimitMs: 10 * 60_000, actionLimit: 20 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["frontend/src/lib/metering/usage-ledger.ts"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
  frozen(
    "growth_intelligence_agent",
    "Growth Intelligence Agent",
    "product_command",
    "growth",
    "Growth hacking / invented funnel metrics are outside V1 truth rules.",
    "DEFERRED-BEYOND-V2",
    "FREEZE BEYOND V2",
  ),

  worker({
    workerId: "incident_commander",
    workerName: "Incident Commander",
    role: "incident_commander",
    specialization: "incidents",
    command: "operations_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Classifies incidents and escalates. Does not silently remediate high-risk production.",
    missionCapabilities: ["v1.role.incident_commander"],
    authorityVerbs: ["observe", "analyze", "propose", "emergency"],
    maxRiskClass: "critical",
    allowedTools: ["escalation", "observability"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["declare_incident", "escalate"],
    forbiddenOperations: ["unrestricted_self_heal", "deploy"],
    securityClearance: "operations",
    dataClearance: "operational_redacted",
    modelPreferences: ["FAST", "STANDARD"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>architecture>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["human_for_critical"],
    evidenceRequirements: ["incident_record"],
    escalationPolicy: "jarvis_ladder",
    riskClass: "high",
    blastRadius: "incident_coordination",
    budgetLimit: { tokensPerCycle: 20_000, note: "incident bound" },
    runtimeLimit: { timeLimitMs: 5 * 60_000, actionLimit: 20 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["frontend/src/lib/jarvis/escalation.ts"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
  worker({
    workerId: "operations_agent",
    workerName: "Operations Agent",
    role: "operations_agent",
    specialization: "operations",
    command: "operations_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Continuous observation and bounded maintenance. Night mode is constrained.",
    missionCapabilities: ["v1.role.operations_agent"],
    authorityVerbs: ["observe", "analyze", "propose"],
    maxRiskClass: "medium",
    allowedTools: ["observability", "health"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["monitor", "maintain_bounded"],
    forbiddenOperations: ["deploy", "high_risk_unattended"],
    securityClearance: "operations",
    dataClearance: "operational_redacted",
    modelPreferences: ["FAST"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>architecture>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["evidence_backed"],
    evidenceRequirements: ["health_records"],
    escalationPolicy: "incident_commander",
    riskClass: "medium",
    blastRadius: "observation",
    budgetLimit: { tokensPerCycle: 20_000, note: "ops cycle bound" },
    runtimeLimit: { timeLimitMs: 5 * 60_000, actionLimit: 20 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["frontend/src/lib/observability"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
  worker({
    workerId: "support_agent",
    workerName: "Support Agent",
    role: "support_agent",
    specialization: "support",
    command: "operations_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Treats tickets as DATA not AUTHORITY. Cannot redefine policy from customer text.",
    missionCapabilities: ["v1.role.support_agent"],
    authorityVerbs: ["observe", "analyze", "propose"],
    maxRiskClass: "low",
    allowedTools: ["support_queue"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["summarize_ticket"],
    forbiddenOperations: ["execute", "deploy", "accept_external_text_as_authority"],
    securityClearance: "support",
    dataClearance: "ticket_redacted",
    modelPreferences: ["FAST", "STANDARD"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "external_content_is_data",
    verificationRequirements: ["human_for_account_changes"],
    evidenceRequirements: ["ticket_record"],
    escalationPolicy: "human_for_account_changes",
    riskClass: "low",
    blastRadius: "proposal",
    budgetLimit: { tokensPerCycle: 20_000, note: "support bound" },
    runtimeLimit: { timeLimitMs: 5 * 60_000, actionLimit: 15 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["frontend/src/lib/security/injection-defense.ts"],
    phase52Action: "CREATE WORKFORCE CAPABILITY",
  }),
  frozen(
    "customer_success_agent",
    "Customer Success Agent",
    "operations_command",
    "customer_success",
    "Full customer-success automation is deferred until real tenant success data exists.",
    "DEFERRED-BEYOND-V2",
    "FREEZE BEYOND V2",
  ),
  worker({
    workerId: "documentation_agent",
    workerName: "Documentation Agent",
    role: "documentation_agent",
    specialization: "documentation",
    command: "operations_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Documents observed systems. Cannot invent completion claims.",
    missionCapabilities: ["v1.role.documentation_agent"],
    authorityVerbs: ["observe", "analyze", "propose", "execute"],
    maxRiskClass: "low",
    allowedTools: ["docs"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["isolated_workspace"],
    allowedOperations: ["write_docs"],
    forbiddenOperations: ["claim_completion_without_evidence", "deploy"],
    securityClearance: "docs",
    dataClearance: "public_architecture",
    modelPreferences: ["STANDARD"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>architecture>mission>role>task",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["source_citation"],
    evidenceRequirements: ["cited_paths"],
    escalationPolicy: "architect_on_doctrine_change",
    riskClass: "low",
    blastRadius: "docs_branch",
    budgetLimit: { tokensPerCycle: 40_000, note: "docs bound" },
    runtimeLimit: { timeLimitMs: 10 * 60_000, actionLimit: 20 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: [],
    phase52Action: "CREATE WORKFORCE CAPABILITY",
  }),
  worker({
    workerId: "knowledge_operations_agent",
    workerName: "Knowledge Operations Agent",
    role: "knowledge_operations_agent",
    specialization: "knowledge_operations",
    command: "operations_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Operates organizational knowledge with provenance. Not a civilization knowledge graph.",
    missionCapabilities: ["v1.role.knowledge_operations_agent"],
    authorityVerbs: ["observe", "analyze", "propose"],
    maxRiskClass: "medium",
    allowedTools: ["memory_store"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["curate_with_provenance"],
    forbiddenOperations: ["promote_hypothesis_to_fact", "execute", "deploy"],
    securityClearance: "knowledge",
    dataClearance: "authorization_gated",
    modelPreferences: ["STANDARD"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>architecture>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["provenance"],
    evidenceRequirements: ["memory_provenance"],
    escalationPolicy: "memory_systems_on_schema_change",
    riskClass: "medium",
    blastRadius: "knowledge",
    budgetLimit: { tokensPerCycle: 30_000, note: "knowledge-ops bound" },
    runtimeLimit: { timeLimitMs: 10 * 60_000, actionLimit: 20 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["frontend/src/lib/memory/memory-store.ts"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
  worker({
    workerId: "cost_optimization_agent",
    workerName: "Cost Optimization Agent",
    role: "cost_optimization_agent",
    specialization: "cost",
    command: "operations_command",
    versionTarget: "ACTIVE-V1",
    purpose: "Reports observed cost/usage. Cannot invent spend or silently switch providers.",
    missionCapabilities: ["v1.role.cost_optimization_agent"],
    authorityVerbs: ["observe", "analyze", "propose"],
    maxRiskClass: "medium",
    allowedTools: ["metering"],
    allowedRepositories: [DEFAULT_REPO],
    allowedEnvironments: ["library"],
    allowedOperations: ["report_cost"],
    forbiddenOperations: ["invent_cost", "switch_unauthorized_provider", "execute", "deploy"],
    securityClearance: "cost",
    dataClearance: "usage_ledger",
    modelPreferences: ["FAST"],
    modelFallbacks: ["FAST"],
    contextPolicy: "constitution>governance>architecture>mission>role",
    memoryPolicy: "canonical_tier_only",
    reasoningPolicy: "evidence_over_inference",
    verificationRequirements: ["ledger_evidence"],
    evidenceRequirements: ["usage_records"],
    escalationPolicy: "human_for_budget_policy",
    riskClass: "medium",
    blastRadius: "reporting",
    budgetLimit: { tokensPerCycle: 10_000, note: "cost-report bound" },
    runtimeLimit: { timeLimitMs: 5 * 60_000, actionLimit: 10 },
    performanceMetrics: DEFAULT_METRICS,
    existingImplementation: ["frontend/src/lib/metering/usage-ledger.ts"],
    phase52Action: "ATTACH TO EXISTING ENGINE",
  }),
];

const AUTHORITY_VERB_SET: ReadonlySet<string> = new Set(AUTHORITY_VERBS);
const COMMAND_SET: ReadonlySet<string> = new Set(WORKFORCE_COMMANDS);
const VERSION_SET: ReadonlySet<string> = new Set(WORKFORCE_VERSION_TARGETS);

export interface WorkforceLockIntegrity {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly workerCount: number;
  readonly v1Count: number;
  readonly frozenCount: number;
}

export function validateV1WorkforceLock(
  workers: readonly V1WorkforceWorker[] = V1_WORKFORCE_WORKERS,
): WorkforceLockIntegrity {
  const errors: string[] = [];
  if (workers.length !== 64) {
    errors.push(`workforce lock must contain 64 capability definitions, found ${workers.length}`);
  }
  const ids = new Set<string>();
  let v1Count = 0;
  let frozenCount = 0;
  for (const entry of workers) {
    if (!entry.workerId?.trim()) errors.push("workerId is required");
    if (ids.has(entry.workerId)) errors.push(`duplicate workerId "${entry.workerId}"`);
    ids.add(entry.workerId);
    if (!COMMAND_SET.has(entry.command)) errors.push(`${entry.workerId}: unknown command`);
    if (!VERSION_SET.has(entry.versionTarget)) errors.push(`${entry.workerId}: unknown versionTarget`);
    if (!RISK_SET.has(entry.maxRiskClass) || !RISK_SET.has(entry.riskClass)) {
      errors.push(`${entry.workerId}: risk class outside vocabulary`);
    }
    if (entry.status !== WORKER_RUNTIME_STATUS) {
      errors.push(`${entry.workerId}: status must remain capability_defined (no standing process)`);
    }
    if (entry.lease !== "ephemeral_cycle") {
      errors.push(`${entry.workerId}: lease must be ephemeral_cycle`);
    }
    for (const verb of entry.authorityVerbs) {
      if (!AUTHORITY_VERB_SET.has(verb)) errors.push(`${entry.workerId}: unknown authority verb ${verb}`);
    }
    if (entry.authorityVerbs.includes("approve") && entry.workerId === "jarvis") {
      errors.push("jarvis must not hold approve authority");
    }
    if (entry.workerId === "jarvis" && entry.authorityVerbs.some((verb) => verb === "execute" || verb === "verify" || verb === "deploy")) {
      errors.push("jarvis must not execute, verify, or deploy");
    }
    if (entry.versionTarget === "ACTIVE-V1") v1Count += 1;
    else frozenCount += 1;
    if (entry.versionTarget !== "ACTIVE-V1" && !entry.forbiddenOperations.includes("staff")) {
      errors.push(`${entry.workerId}: frozen workers must forbid staff`);
    }
  }
  return { ok: errors.length === 0, errors, workerCount: workers.length, v1Count, frozenCount };
}

export function getV1WorkforceWorker(workerId: string): V1WorkforceWorker | undefined {
  return V1_WORKFORCE_WORKERS.find((entry) => entry.workerId === workerId);
}

export function listActivatableV1Workers(): readonly V1WorkforceWorker[] {
  return V1_WORKFORCE_WORKERS.filter((entry) => entry.versionTarget === "ACTIVE-V1");
}

export function isWorkerActivatable(workerId: string): boolean {
  const entry = getV1WorkforceWorker(workerId);
  return entry?.versionTarget === "ACTIVE-V1";
}

export function roleCapabilityId(workerId: string): string {
  return `v1.role.${workerId}`;
}

/** Capability registry covering V1 role capabilities only — frozen roles are not registered for matching. */
export function buildV1RoleCapabilityRegistry(): CapabilityRegistry {
  const inputs: CapabilityRegistrationInput[] = listActivatableV1Workers().map((entry) => ({
    capabilityId: roleCapabilityId(entry.workerId),
    contract: entry.purpose,
    riskClass: entry.riskClass,
    evidenceRequirements: entry.evidenceRequirements.length > 0 ? entry.evidenceRequirements : ["evidence"],
  }));
  const extra: CapabilityRegistrationInput[] = [
    {
      capabilityId: "mission:execute",
      contract: "Execute an assigned mission under delegation",
      riskClass: "high",
      evidenceRequirements: ["execution_evidence"],
    },
    {
      capabilityId: "mission:verify",
      contract: "Independently verify another worker's execution",
      riskClass: "high",
      evidenceRequirements: ["verification_decision"],
    },
  ];
  const result = createCapabilityRegistry([...inputs, ...extra]);
  if (!result.ok) {
    throw new Error(`V1 role capability registry failed: ${result.errors.join("; ")}`);
  }
  return result.registry;
}

export interface V1WorkforceLockSnapshot {
  readonly artifact: "COREGRID_V1_AI_WORKFORCE_REGISTRY";
  readonly status: "SCOPE_LOCKED";
  readonly versionTarget: "ACTIVE-V1";
  readonly workerCount: 64;
  readonly rule: "Persistent identity does not require persistent compute.";
  readonly jarvisRule: "Jarvis commands the organization. The organization performs the work.";
  readonly fourEyes: "Implementer cannot verify, approve, or deploy the same high-risk change.";
  readonly reuse: readonly string[];
  readonly integrity: WorkforceLockIntegrity;
  readonly workers: readonly V1WorkforceWorker[];
}

export function serializeV1WorkforceLock(): V1WorkforceLockSnapshot {
  return {
    artifact: "COREGRID_V1_AI_WORKFORCE_REGISTRY",
    status: "SCOPE_LOCKED",
    versionTarget: "ACTIVE-V1",
    workerCount: 64,
    rule: "Persistent identity does not require persistent compute.",
    jarvisRule: "Jarvis commands the organization. The organization performs the work.",
    fourEyes: "Implementer cannot verify, approve, or deploy the same high-risk change.",
    reuse: [
      "frontend/src/lib/jarvis/jarvis-contract.ts",
      "frontend/src/lib/hermes/hermes-cycle.ts",
      "frontend/src/lib/workforce/worker-definition.ts",
      "frontend/src/lib/workforce/worker-host.ts",
      "frontend/src/lib/workforce/capability-registry.ts",
      "frontend/src/lib/mission/mission-contract.ts",
    ],
    integrity: validateV1WorkforceLock(),
    workers: V1_WORKFORCE_WORKERS,
  };
}

const lockIntegrity = validateV1WorkforceLock();
if (!lockIntegrity.ok) {
  throw new Error(`V1 workforce lock is invalid: ${lockIntegrity.errors.join("; ")}`);
}
