/**
 * CoreGrid V1 AI Workforce Scope Lock (directive §§4–16, 61).
 *
 * This catalog is a CAPABILITY DEFINITION registry, not a running-process
 * inventory: it defines WHAT a worker role may do; the workforce runtime
 * (worker-registry + worker-host) determines WHEN a worker instance exists.
 * Persistent identity does not require persistent compute — every role except
 * the executive control plane activates dynamically on mission demand.
 *
 * Scope-lock law (DECISIONS.md #206):
 *  - every role carries a V5.3 version-target classification (§45 law);
 *  - every V1 role maps to EXISTING substrate modules — the catalog cannot
 *    register a V1 role whose capability surface has no in-repo owner, which
 *    mechanically enforces "reuse, do not duplicate" (AGENTS.md AD-161/164);
 *  - authority levels follow the directive §19 vocabulary and are never
 *    collapsed into "admin = everything";
 *  - frozen roles carry empty substrate refs and can never be activated by
 *    this catalog alone (un-freeze requires a human authorization record).
 *
 * Pure, fail-closed, secret-free: construction rejects secret-shaped material
 * and unknown enumerations, mirroring provider-credentials.ts hygiene.
 */
import { z } from "zod";

import { AGENT_RISK_CLASSIFICATIONS, type AgentRiskClassification } from "../agent-core";

/* ─────────────────────────────────────────────────────────────
 * Vocabularies
 * ────────────────────────────────────────────────────────────*/

/** Directive §49 organizational divisions (control structures, not services). */
export const WORKFORCE_DIVISIONS = [
  "executive_command",
  "architecture",
  "engineering",
  "infrastructure",
  "security",
  "quality",
  "data_intelligence",
  "product_experience",
  "operations",
] as const;
export type WorkforceDivision = (typeof WORKFORCE_DIVISIONS)[number];

/** Directive §19 authority model — distinct capabilities, never collapsed. */
export const WORKFORCE_AUTHORITY_LEVELS = [
  "observe",
  "analyze",
  "propose",
  "execute",
  "verify",
  "approve",
  "deploy",
  "emergency",
] as const;
export type WorkforceAuthorityLevel = (typeof WORKFORCE_AUTHORITY_LEVELS)[number];

/** V5.3 version-target classification (AGENTS.md §45; registry.json enum family). */
export const WORKFORCE_SCOPE_TARGETS = [
  "V1",
  "V2",
  "DEFERRED_BEYOND_V2",
  "REQUIRES_ARCHITECTURAL_DECISION",
] as const;
export type WorkforceScopeTarget = (typeof WORKFORCE_SCOPE_TARGETS)[number];

/**
 * Directive §5/§16 instantiation law: workers wake when useful work exists and
 * sleep/terminate when their mission completes. Only the executive control
 * plane is persistent — and persistence is identity, not compute.
 */
export const WORKFORCE_INSTANTIATION_POLICIES = [
  "persistent_control_plane",
  "dynamic_on_mission",
  "frozen",
] as const;
export type WorkforceInstantiationPolicy = (typeof WORKFORCE_INSTANTIATION_POLICIES)[number];

/* ─────────────────────────────────────────────────────────────
 * Entry schema
 * ────────────────────────────────────────────────────────────*/

const ROLE_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const CAPABILITY_SLUG_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const SUBSTRATE_REF_PATTERN = /^[A-Za-z0-9.][A-Za-z0-9@._/-]{2,180}$/;
const FORBIDDEN_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

export const workforceRoleSchema = z.object({
  roleId: z.string().regex(ROLE_ID_PATTERN),
  division: z.enum(WORKFORCE_DIVISIONS),
  title: z.string().trim().min(3).max(120),
  classification: z.enum(WORKFORCE_SCOPE_TARGETS),
  authorityLevels: z.array(z.enum(WORKFORCE_AUTHORITY_LEVELS)).max(8),
  maxRiskClass: z.custom<AgentRiskClassification>((value) =>
    typeof value === "string" && (AGENT_RISK_CLASSIFICATIONS as readonly string[]).includes(value),
  ),
  /** Capability slugs the workforce planner may staff this role against. */
  missionCapabilities: z.array(z.string().regex(CAPABILITY_SLUG_PATTERN)).max(24),
  /** In-repo substrate this role operates through (reuse law; V1 roles ≥ 1). */
  substrateRefs: z.array(z.string().regex(SUBSTRATE_REF_PATTERN)).max(12),
  /** Machine-readable forbidden-operation codes (enforced upstream of tools). */
  forbiddenOperations: z.array(z.string().regex(FORBIDDEN_PATTERN)).max(24),
  instantiationPolicy: z.enum(WORKFORCE_INSTANTIATION_POLICIES),
  note: z.string().trim().min(3).max(400),
});

export type WorkforceRole = z.infer<typeof workforceRoleSchema>;

export type WorkforceRoleCatalogValidationResult =
  | { ok: true; roles: readonly WorkforceRole[] }
  | { ok: false; errors: readonly string[] };

const SECRET_SHAPE_PATTERN =
  /(sk_live|sk_test|sb_secret|sb_publishable|ghp_[A-Za-z0-9]{20,}|re_[A-Za-z0-9]{20,}|AC[a-f0-9]{32}|BEGIN (RSA |EC )?PRIVATE KEY|-----BEGIN CERTIFICATE-----)/i;

/* ─────────────────────────────────────────────────────────────
 * Cross-field laws
 * ────────────────────────────────────────────────────────────*/

function roleErrors(entry: WorkforceRole): string[] {
  const errors: string[] = [];
  const parsed = workforceRoleSchema.safeParse(entry);
  if (!parsed.success) {
    errors.push(`${entry.roleId ?? "<unidentified>"}: schema violation`);
    return errors;
  }
  const role = parsed.data;
  if (new Set(role.missionCapabilities).size !== role.missionCapabilities.length) {
    errors.push(`${role.roleId}: duplicate mission capability slug`);
  }
  if (new Set(role.substrateRefs).size !== role.substrateRefs.length) {
    errors.push(`${role.roleId}: duplicate substrate ref`);
  }
  if (role.classification === "V1" && role.substrateRefs.length === 0) {
    errors.push(`${role.roleId}: V1 role must map to at least one existing substrate ref`);
  }
  if (role.classification === "V1" && role.instantiationPolicy === "frozen") {
    errors.push(`${role.roleId}: V1 role cannot be frozen`);
  }
  if (
    (role.classification === "V2" ||
      role.classification === "DEFERRED_BEYOND_V2" ||
      role.classification === "REQUIRES_ARCHITECTURAL_DECISION") &&
    role.instantiationPolicy !== "frozen"
  ) {
    errors.push(
      `${role.roleId}: non-V1 roles are frozen — activation requires a human authorization record`,
    );
  }
  if (role.authorityLevels.includes("verify") && role.authorityLevels.includes("execute")) {
    errors.push(
      `${role.roleId}: a single role may not hold both execute and verify authority (four-eyes law, directive §20)`,
    );
  }
  if (role.authorityLevels.includes("approve") && role.maxRiskClass === "critical") {
    errors.push(`${role.roleId}: approve authority is never granted at critical risk ceiling`);
  }
  if (role.forbiddenOperations.includes("state_fabrication") === false) {
    errors.push(`${role.roleId}: state_fabrication must always be forbidden (anti-hallucination law)`);
  }
  if (SECRET_SHAPE_PATTERN.test(role.note) || SECRET_SHAPE_PATTERN.test(role.title)) {
    errors.push(`${role.roleId}: secret-shaped material rejected`);
  }
  return errors;
}

export function validateWorkforceRoleCatalog(
  entries: readonly WorkforceRole[],
): WorkforceRoleCatalogValidationResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.roleId)) {
      errors.push(`duplicate roleId: ${entry.roleId}`);
    }
    seen.add(entry.roleId);
    errors.push(...roleErrors(entry));
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, roles: entries };
}

/* ─────────────────────────────────────────────────────────────
 * Staffing seam (directive §6/§50 — dynamic staffing)
 * ────────────────────────────────────────────────────────────*/

/** Roles registered for a capability slug, restricted to a scope target. */
export function rolesForCapability(
  roles: readonly WorkforceRole[],
  capability: string,
): readonly WorkforceRole[] {
  return roles.filter(
    (role) => role.classification === "V1" && role.missionCapabilities.includes(capability),
  );
}

/** Executor candidates hold execute authority; verifier candidates hold verify. */
export function executorRolesForCapability(
  roles: readonly WorkforceRole[],
  capability: string,
): readonly WorkforceRole[] {
  return rolesForCapability(roles, capability).filter((role) =>
    role.authorityLevels.includes("execute"),
  );
}

export function verifierRolesForCapability(
  roles: readonly WorkforceRole[],
  capability: string,
): readonly WorkforceRole[] {
  return rolesForCapability(roles, capability).filter((role) =>
    role.authorityLevels.includes("verify"),
  );
}

/** A staffing plan is valid only when executor and verifier role sets are disjoint. */
export function staffingIsIndependenceSafe(
  executorRoleIds: readonly string[],
  verifierRoleIds: readonly string[],
): boolean {
  const executors = new Set(executorRoleIds);
  return verifierRoleIds.every((verifier) => !executors.has(verifier));
}

/* ─────────────────────────────────────────────────────────────
 * The V1 scope lock — directive §§8–15 divisions, 64 roles
 * ────────────────────────────────────────────────────────────*/

const GATE_AND_TOOLS: string[] = [
  "frontend/src/lib/security-role-gate.ts",
  "frontend/src/lib/workforce/tool-runtime.ts",
];

export const WORKFORCE_ROLE_CATALOG: readonly WorkforceRole[] = [
  /* ── A. EXECUTIVE COMMAND ── */
  {
    roleId: "jarvis",
    division: "executive_command",
    title: "Jarvis — Executive Intelligence / Enterprise Orchestrator",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "high",
    missionCapabilities: [
      "condition_detection",
      "mission_creation",
      "workforce_staffing",
      "executive_reporting",
      "escalation_management",
    ],
    substrateRefs: [
      "frontend/src/lib/jarvis/jarvis-contract.ts",
      "frontend/src/lib/jarvis/briefing.ts",
      "frontend/src/lib/jarvis/escalation.ts",
      "frontend/src/lib/jarvis/executive-loop.ts",
      "frontend/src/lib/control-plane/foundation-mission.ts",
    ],
    forbiddenOperations: [
      "authorization_bypass",
      "secret_access",
      "governance_mutation",
      "self_authority_grant",
      "approval_override",
      "state_fabrication",
      "unverified_claim",
      "direct_implementation_of_engineering_work",
    ],
    instantiationPolicy: "persistent_control_plane",
    note: "Commands the organization; the workforce performs the work (directive §3). Every executive action carries the fixed jarvis actor ref, a justification and an approval requirement. Not an administrator: no execute/deploy/approve authority at catalog level.",
  },

  /* ── B. ARCHITECTURE ── */
  {
    roleId: "chief-architect",
    division: "architecture",
    title: "Chief Architect Agent",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "high",
    missionCapabilities: [
      "architecture_analysis",
      "adr_authoring",
      "dependency_topology_analysis",
      "boundary_enforcement_review",
    ],
    substrateRefs: [
      "architecture/registry.json",
      "frontend/src/lib/kernel/phase-contract.ts",
      "frontend/src/lib/kernel/kernel-capability-registry.ts",
    ],
    forbiddenOperations: [
      "state_fabrication",
      "registry_mutation_without_adr",
      "silent_phase_creation",
      "implementation_outside_architecture_boundary",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Owns boundary and dependency analysis; ADRs remain human-ratified (AD-063, §38 change management).",
  },
  {
    roleId: "reality-architect",
    division: "architecture",
    title: "Reality Architect",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "high",
    missionCapabilities: [
      "reality_model_analysis",
      "kernel_contract_review",
      "ontology_analysis",
    ],
    substrateRefs: [
      "frontend/src/lib/kernel/reality.ts",
      "frontend/src/lib/kernel/phase-contracts",
    ],
    forbiddenOperations: [
      "state_fabrication",
      "v3_reality_intelligence_implementation",
      "twin_capability_implementation",
      "kernel_purity_violation",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "V1 scope covers the kernel reality primitives (cg_*). V2 device/IoT and V3 Reality Intelligence remain FROZEN (AGENTS.md §45); un-freeze requires a human authorization record.",
  },
  {
    roleId: "runtime-architect",
    division: "architecture",
    title: "Runtime Architect",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "high",
    missionCapabilities: [
      "runtime_analysis",
      "mission_contract_review",
      "lifecycle_design",
    ],
    substrateRefs: [
      "frontend/src/lib/mission/mission-contract.ts",
      "frontend/src/lib/missions/mission-execution.ts",
      "frontend/src/lib/workforce/worker-host.ts",
    ],
    forbiddenOperations: [
      "state_fabrication",
      "production_runtime_mutation_without_approval",
      "authority_model_expansion",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Mission/worker lifecycle analysis over the existing 15-state machine and WAKE→SLEEP host cycle.",
  },

  /* ── 9. ENGINEERING DIVISION ── */
  {
    roleId: "backend-engineer",
    division: "engineering",
    title: "Backend Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["code_implementation", "api_design", "test_authoring"],
    substrateRefs: GATE_AND_TOOLS,
    forbiddenOperations: [
      "state_fabrication",
      "production_deployment",
      "security_control_weakening",
      "direct_database_production_mutation",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Executes only inside isolated mission workspaces; ships via PR + verification (§26/§27).",
  },
  {
    roleId: "frontend-engineer",
    division: "engineering",
    title: "Frontend Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["ui_implementation", "code_implementation", "test_authoring"],
    substrateRefs: GATE_AND_TOOLS,
    forbiddenOperations: [
      "state_fabrication",
      "production_deployment",
      "security_control_weakening",
      "frontend_as_security_boundary",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "UI is an observation surface, never the authorization layer (§34).",
  },
  {
    roleId: "full-stack-engineer",
    division: "engineering",
    title: "Full-Stack Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["code_implementation", "api_design", "ui_implementation"],
    substrateRefs: GATE_AND_TOOLS,
    forbiddenOperations: [
      "state_fabrication",
      "production_deployment",
      "security_control_weakening",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Narrowly the union of backend+frontend surfaces; authority stays bounded per mission.",
  },
  {
    roleId: "api-engineer",
    division: "engineering",
    title: "API Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["api_design", "code_implementation", "contract_authoring"],
    substrateRefs: [...GATE_AND_TOOLS, "packages/contracts/src"],
    forbiddenOperations: [
      "state_fabrication",
      "production_deployment",
      "silent_api_breaking_change",
      "unauthenticated_endpoint_creation",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Every surface validates authentication, tenant, authorization, schema (§26/§27).",
  },
  {
    roleId: "database-engineer",
    division: "engineering",
    title: "Database Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "high",
    missionCapabilities: ["schema_design", "migration_authoring", "rls_policy_review"],
    substrateRefs: [
      "database/supabase/migrations",
      "scripts/apply-approved-v1-migrations.mjs",
    ],
    forbiddenOperations: [
      "state_fabrication",
      "destructive_migration_without_approval",
      "rls_weakening",
      "direct_production_data_mutation",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Migrations ship through the approved-migration pipeline; RLS is mandatory for tenant-sensitive data (§17).",
  },
  {
    roleId: "supabase-engineer",
    division: "engineering",
    title: "Supabase Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "high",
    missionCapabilities: ["schema_design", "auth_config_review", "storage_policy_review"],
    substrateRefs: ["database/supabase/config.toml", "scripts/lib/pg-ssl.mjs"],
    forbiddenOperations: [
      "state_fabrication",
      "auth_config_weakening",
      "storage_policy_weakening",
      "production_data_mutation",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Provider-specific work stays behind adapters (§25); the database is the West-EU anchor (DECISIONS.md #205).",
  },
  {
    roleId: "distributed-systems-engineer",
    division: "engineering",
    title: "Distributed Systems Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["concurrency_analysis", "lease_substrate_operation", "idempotency_review"],
    substrateRefs: [
      "frontend/src/lib/missions/mission-lease-db.server.ts",
      "frontend/src/lib/command/leases.ts",
      "frontend/src/lib/command/idempotency.ts",
    ],
    forbiddenOperations: [
      "state_fabrication",
      "distributed_transaction_expansion_without_analysis",
      "lease_semantics_weakening",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Lease/heartbeat/orphan-recovery substrate is the canonical concurrency plane (AD-045/046).",
  },
  {
    roleId: "integration-engineer",
    division: "engineering",
    title: "Integration Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["provider_integration", "credential_registry_operation", "webhook_hardening"],
    substrateRefs: [
      "frontend/src/lib/providers/provider-credentials.ts",
      "frontend/src/lib/observability/provider-health.server.ts",
    ],
    forbiddenOperations: [
      "state_fabrication",
      "raw_secret_handling",
      "unregistered_provider_adoption",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Providers integrate through the credential registry + health battery; egress stays allow-listed (§25).",
  },
  {
    roleId: "sdk-engineer",
    division: "engineering",
    title: "SDK Engineer",
    classification: "V2",
    authorityLevels: ["observe"],
    maxRiskClass: "low",
    missionCapabilities: [],
    substrateRefs: [],
    forbiddenOperations: ["state_fabrication"],
    instantiationPolicy: "frozen",
    note: "Developer platform (phase 28) is MIXED and no SDK substrate exists in-repo; frozen until a human authorization record un-freezes V2 developer-plane scope.",
  },
  {
    roleId: "mobile-engineer",
    division: "engineering",
    title: "Mobile Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["mobile_implementation", "code_implementation", "release_build_authoring"],
    substrateRefs: ["mobile/src", "frontend/src/lib/push.server.ts"],
    forbiddenOperations: [
      "state_fabrication",
      "store_submission_without_human_enrollment",
      "security_control_weakening",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Phase 22 ACTIVE-V1; store submission stays blocked on Apple/Google human enrollment (BLK record).",
  },
  {
    roleId: "pwa-engineer",
    division: "engineering",
    title: "PWA Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["ui_implementation", "code_implementation", "push_infrastructure_operation"],
    substrateRefs: ["frontend/src/lib/push.server.ts"],
    forbiddenOperations: ["state_fabrication", "security_control_weakening"],
    instantiationPolicy: "dynamic_on_mission",
    note: "PWA is in the V1 envelope (§46); push uses the provisioned VAPID pair.",
  },
  {
    roleId: "developer-experience-engineer",
    division: "engineering",
    title: "Developer Experience Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "low",
    missionCapabilities: ["toolchain_maintenance", "documentation_authoring", "test_authoring"],
    substrateRefs: ["package.json", "vitest.config.ts", "docs"],
    forbiddenOperations: ["state_fabrication", "verify_chain_weakening"],
    instantiationPolicy: "dynamic_on_mission",
    note: "The npm verify chain is the quality floor; DX work may extend gates, never remove them.",
  },

  /* ── 10. INFRASTRUCTURE DIVISION ── */
  {
    roleId: "platform-engineer",
    division: "infrastructure",
    title: "Platform Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "high",
    missionCapabilities: ["infrastructure_authoring", "fabric_invariant_review", "environment_provisioning"],
    substrateRefs: ["infrastructure", "scripts/verify-infrastructure.mjs"],
    forbiddenOperations: [
      "state_fabrication",
      "production_apply_without_approval",
      "secret_commitment",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Terraform apply is human-approval-gated (infrastructure-plan-apply workflow).",
  },
  {
    roleId: "devops-engineer",
    division: "infrastructure",
    title: "DevOps Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "high",
    missionCapabilities: ["ci_pipeline_authoring", "build_maintenance", "gate_extension"],
    substrateRefs: [".github/workflows"],
    forbiddenOperations: [
      "state_fabrication",
      "gate_removal",
      "ci_credential_exposure",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "May add CI gates; removing or weakening verify-chain gates is forbidden.",
  },
  {
    roleId: "sre-agent",
    division: "infrastructure",
    title: "SRE Agent",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose", "execute"],
    maxRiskClass: "high",
    missionCapabilities: [
      "condition_detection",
      "incident_response",
      "bounded_recovery_execution",
      "observability_instrumentation",
    ],
    substrateRefs: [
      "frontend/src/lib/observability/provider-health.server.ts",
      "scripts/restore-recovery-drill.mjs",
    ],
    forbiddenOperations: [
      "state_fabrication",
      "unbounded_self_healing",
      "destructive_recovery",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Bounded recovery only (directive §31): retry/requeue/rotate/fallback per policy; never unrestricted self-modification.",
  },
  {
    roleId: "cloud-infrastructure-engineer",
    division: "infrastructure",
    title: "Cloud Infrastructure Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "high",
    missionCapabilities: ["infrastructure_authoring", "region_alignment_execution", "fabric_invariant_review"],
    substrateRefs: ["infrastructure", ".github/workflows/infrastructure-verify.yml"],
    forbiddenOperations: ["state_fabrication", "production_apply_without_approval", "secret_commitment"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Region posture anchored to West EU (DECISIONS.md #205); changes ride the verify pipeline.",
  },
  {
    roleId: "deployment-engineer",
    division: "infrastructure",
    title: "Deployment Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute", "deploy"],
    maxRiskClass: "high",
    missionCapabilities: ["deployment_execution", "release_gate_review", "rollback_execution"],
    substrateRefs: [".github/workflows/release.yml", "infrastructure/deploy"],
    forbiddenOperations: [
      "state_fabrication",
      "production_deploy_without_human_approval",
      "health_gate_bypass",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "The release pipeline fails closed on missing credentials (BLK-3) and deploys behind the human-approved production environment.",
  },
  {
    roleId: "release-engineer",
    division: "infrastructure",
    title: "Release Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute", "deploy"],
    maxRiskClass: "high",
    missionCapabilities: ["release_management", "release_gate_review", "rollback_execution"],
    substrateRefs: [".github/workflows/release.yml", "scripts/verify-launch-criteria.mjs"],
    forbiddenOperations: [
      "state_fabrication",
      "release_without_verification",
      "production_deploy_without_human_approval",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "No release without an independent verification verdict (four-eyes law, §20).",
  },
  {
    roleId: "disaster-recovery-engineer",
    division: "infrastructure",
    title: "Disaster Recovery Engineer",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose", "execute"],
    maxRiskClass: "high",
    missionCapabilities: ["recovery_drill_execution", "backup_verification", "rollback_execution"],
    substrateRefs: ["scripts/restore-recovery-drill.mjs", "scripts/verify-recovery-drill.mjs"],
    forbiddenOperations: ["state_fabrication", "destructive_recovery", "backup_deletion"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Backups are insufficient — restore must be tested (AD-129); drills use the 0/1/2 exit-code convention.",
  },
  {
    roleId: "performance-engineer",
    division: "infrastructure",
    title: "Performance Engineer",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "medium",
    missionCapabilities: ["performance_analysis", "observability_instrumentation"],
    substrateRefs: ["frontend/src/lib/observability/metrics-registry.ts"],
    forbiddenOperations: ["state_fabrication", "invented_benchmarks"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Performance decisions are measured, not assumed (AD-081).",
  },
  {
    roleId: "networking-engineer",
    division: "infrastructure",
    title: "Networking Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "high",
    missionCapabilities: ["network_configuration_authoring", "egress_policy_review"],
    substrateRefs: ["infrastructure", "frontend/src/lib/ai-gateway/egress-allowlist.ts"],
    forbiddenOperations: ["state_fabrication", "firewall_default_allow", "egress_allowlist_expansion_without_policy"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Default DENY then explicit allow (directive §25) — same law as the gateway egress allowlist.",
  },
  {
    roleId: "observability-engineer",
    division: "infrastructure",
    title: "Observability Engineer",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["observability_instrumentation", "health_probe_authoring", "log_redaction_review"],
    substrateRefs: [
      "frontend/src/lib/observability/structured-log.ts",
      "frontend/src/lib/observability/provider-health.server.ts",
    ],
    forbiddenOperations: ["state_fabrication", "secret_logging", "personal_data_logging"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Everything important observable; never log secrets or unnecessary private data (§29).",
  },

  /* ── 11. SECURITY DIVISION ── */
  {
    roleId: "security-architect",
    division: "security",
    title: "Security Architect",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "critical",
    missionCapabilities: ["security_review", "threat_model_authoring", "boundary_enforcement_review"],
    substrateRefs: ["frontend/src/lib/authorization.ts", "frontend/src/lib/security-core.ts"],
    forbiddenOperations: [
      "state_fabrication",
      "security_control_weakening",
      "silent_security_exception",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Zero trust is the default model (AD-038); security exceptions are temporary and recorded (AD-127).",
  },
  {
    roleId: "application-security-engineer",
    division: "security",
    title: "Application Security Engineer",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "critical",
    missionCapabilities: ["security_review", "webhook_signature_review", "injection_defense_review"],
    substrateRefs: [
      "frontend/src/lib/security-role-gate.ts",
      "frontend/src/lib/communications/twilio-sms.server.ts",
    ],
    forbiddenOperations: ["state_fabrication", "security_control_weakening", "validation_bypass"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Reviews the canonical role gate and webhook signature surfaces; detection and reporting only.",
  },
  {
    roleId: "cloud-security-engineer",
    division: "security",
    title: "Cloud Security Engineer",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "critical",
    missionCapabilities: ["security_review", "secret_hygiene_review", "fabric_invariant_review"],
    substrateRefs: ["infrastructure", "scripts/verification/secret-scan.mjs"],
    forbiddenOperations: ["state_fabrication", "security_control_weakening", "secret_exposure"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Secret hygiene scanners are the enforcement surface; findings are evidence, not auto-remediation.",
  },
  {
    roleId: "identity-access-engineer",
    division: "security",
    title: "Identity & Access Engineer",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "critical",
    missionCapabilities: ["rbac_review", "rls_policy_review", "identity_lifecycle_review"],
    substrateRefs: ["frontend/src/lib/rbac/role-gate.ts", "database/supabase/migrations"],
    forbiddenOperations: [
      "state_fabrication",
      "rls_weakening",
      "role_expansion_without_grant",
      "authentication_bypass",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Agents never receive authority merely by reasoning that they need it (AD-014/AD-011).",
  },
  {
    roleId: "secrets-security-engineer",
    division: "security",
    title: "Secrets Security Engineer",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "critical",
    missionCapabilities: ["secret_hygiene_review", "credential_broker_review", "rotation_analysis"],
    substrateRefs: [
      "frontend/src/lib/security/credential-broker.ts",
      "scripts/verification/secret-scan.mjs",
      "scripts/verify-secrets-hygiene.mjs",
    ],
    forbiddenOperations: [
      "state_fabrication",
      "raw_secret_handling_outside_broker",
      "secret_commitment",
      "secret_logging",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Credential broker + scoped leases are the only secret path (§24); workers never receive raw env material.",
  },
  {
    roleId: "threat-detection-agent",
    division: "security",
    title: "Threat Detection Agent",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose", "emergency"],
    maxRiskClass: "high",
    missionCapabilities: ["threat_detection", "injection_defense_review", "anomaly_classification"],
    substrateRefs: [
      "frontend/src/lib/ai-gateway/runtime-defenses.ts",
      "frontend/src/lib/ai-context.ts",
    ],
    forbiddenOperations: [
      "state_fabrication",
      "silent_control_weakening",
      "quarantine_without_evidence",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "May detect, report, recommend quarantine and raise emergencies; may not disable defenses.",
  },
  {
    roleId: "security-verification-agent",
    division: "security",
    title: "Security Verification Agent",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "verify"],
    maxRiskClass: "critical",
    missionCapabilities: ["verification_independent", "security_review", "evidence_audit"],
    substrateRefs: [
      "frontend/src/lib/verification.ts",
      "frontend/src/lib/assurance/verification-independence.ts",
    ],
    forbiddenOperations: [
      "state_fabrication",
      "claim_verification_without_evidence",
      "self_verification",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Independent verifier role in the four-eyes chain; verdicts require evidence.",
  },
  {
    roleId: "compliance-governance-agent",
    division: "security",
    title: "Compliance / Governance Agent",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "high",
    missionCapabilities: ["governance_compliance_review", "provenance_audit", "adr_drafting"],
    substrateRefs: ["scripts/verify-provenance-metadata.mjs", "DECISIONS.md"],
    forbiddenOperations: ["state_fabrication", "governance_mutation", "constitution_amendment"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Reports conformance and drafts ADRs; ratification remains human (AI may not redefine architecture, §7).",
  },

  /* ── 12. QUALITY DIVISION ── */
  {
    roleId: "qa-engineer",
    division: "quality",
    title: "QA Engineer",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "verify", "propose"],
    maxRiskClass: "medium",
    missionCapabilities: ["test_authoring", "verification_independent", "defect_classification"],
    substrateRefs: ["tests", "vitest.config.ts"],
    forbiddenOperations: [
      "state_fabrication",
      "claim_verification_without_evidence",
      "self_verification",
      "test_weakening_to_pass",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Core law: NO CLAIM WITHOUT EVIDENCE — a coding agent cannot declare itself successful.",
  },
  {
    roleId: "test-automation-engineer",
    division: "quality",
    title: "Test Automation Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["test_authoring", "test_execution", "fixture_maintenance"],
    substrateRefs: ["tests/unit", "tests/e2e"],
    forbiddenOperations: ["state_fabrication", "invented_test_results", "skip_gate_expansion"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Hermetic verify stays hermetic; live depth lives in credential-gated drills.",
  },
  {
    roleId: "integration-test-engineer",
    division: "quality",
    title: "Integration Test Engineer",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "verify"],
    maxRiskClass: "medium",
    missionCapabilities: ["test_authoring", "drill_execution", "verification_independent"],
    substrateRefs: ["tests/integration", "scripts"],
    forbiddenOperations: ["state_fabrication", "claim_verification_without_evidence", "self_verification"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Drill exit codes 0/1/2 (PASS/FINDING/BLOCKED_NO_CREDENTIAL) are the honest result vocabulary.",
  },
  {
    roleId: "reliability-verification-engineer",
    division: "quality",
    title: "Reliability Verification Engineer",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "verify"],
    maxRiskClass: "high",
    missionCapabilities: ["recovery_drill_execution", "chaos_analysis", "verification_independent"],
    substrateRefs: ["scripts/restore-recovery-drill.mjs", "tests/failure"],
    forbiddenOperations: ["state_fabrication", "claim_verification_without_evidence", "self_verification"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Failure is normal (AD-050); verification covers degraded modes and recovery.",
  },
  {
    roleId: "regression-engineer",
    division: "quality",
    title: "Regression Engineer",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "verify"],
    maxRiskClass: "medium",
    missionCapabilities: ["test_authoring", "regression_analysis", "verification_independent"],
    substrateRefs: ["tests/unit", "architecture/proofs"],
    forbiddenOperations: ["state_fabrication", "claim_verification_without_evidence", "self_verification"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Proof stamps regenerate through the verify pipeline; drift between claims and artifacts is a defect.",
  },
  {
    roleId: "release-verification-engineer",
    division: "quality",
    title: "Release Verification Engineer",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "verify"],
    maxRiskClass: "high",
    missionCapabilities: ["release_gate_review", "verification_independent", "evidence_audit"],
    substrateRefs: [".github/workflows/verify.yml", "scripts/verify-launch-criteria.mjs"],
    forbiddenOperations: [
      "state_fabrication",
      "claim_verification_without_evidence",
      "self_verification",
      "gate_bypass",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Last independent control before release (§20); verdicts are evidence-bound.",
  },

  /* ── 13. DATA & INTELLIGENCE DIVISION ── */
  {
    roleId: "data-engineer",
    division: "data_intelligence",
    title: "Data Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["data_modeling", "data_pipeline_authoring", "store_adapter_authoring"],
    substrateRefs: ["frontend/src/lib/adapters", "database/supabase/migrations"],
    forbiddenOperations: ["state_fabrication", "invented_datasets", "rls_weakening"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Phase 14 ACTIVE-V1; adapters are the boundary between domain and stores (§24 architecture rule).",
  },
  {
    roleId: "data-governance-engineer",
    division: "data_intelligence",
    title: "Data Governance Engineer",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "high",
    missionCapabilities: ["retention_policy_review", "provenance_audit", "knowledge_currency_review"],
    substrateRefs: [
      "frontend/src/lib/memory/knowledge-currency.ts",
      "scripts/verify-retention-schedule.mjs",
    ],
    forbiddenOperations: ["state_fabrication", "retention_policy_weakening", "provenance_forgery"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Every important datum answers where-from/who-created/was-it-verified (§12 provenance law).",
  },
  {
    roleId: "ai-engineer",
    division: "data_intelligence",
    title: "AI Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["ai_gateway_operation", "model_routing_analysis", "prompt_registry_review"],
    substrateRefs: ["frontend/src/lib/ai-gateway.server.ts", "frontend/src/lib/ai-gateway/model-registry.ts"],
    forbiddenOperations: [
      "state_fabrication",
      "direct_provider_calls_outside_gateway",
      "purpose_vocabulary_expansion_without_authorization",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "All AI operations ride the centralized gateway (§20); purposes stay in the frozen organizational vocabulary.",
  },
  {
    roleId: "ml-engineer",
    division: "data_intelligence",
    title: "ML Engineer",
    classification: "DEFERRED_BEYOND_V2",
    authorityLevels: ["observe"],
    maxRiskClass: "low",
    missionCapabilities: [],
    substrateRefs: [],
    forbiddenOperations: ["state_fabrication"],
    instantiationPolicy: "frozen",
    note: "No ML substrate exists in-repo and V3 Reality Intelligence is FROZEN (§45); preserved here as a capability definition only.",
  },
  {
    roleId: "model-evaluation-agent",
    division: "data_intelligence",
    title: "Model Evaluation Agent",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "verify"],
    maxRiskClass: "medium",
    missionCapabilities: ["model_routing_analysis", "verification_independent", "reasoning_provenance_audit"],
    substrateRefs: [
      "frontend/src/lib/ai-gateway/model-registry.ts",
      "frontend/src/lib/ai-gateway/reasoning-provenance.ts",
    ],
    forbiddenOperations: ["state_fabrication", "claim_verification_without_evidence", "critical_work_verification"],
    instantiationPolicy: "dynamic_on_mission",
    note: "AI may verify only non-critical work (J-038); evaluation measures accuracy/grounding/cost (AD-096).",
  },
  {
    roleId: "ai-gateway-engineer",
    division: "data_intelligence",
    title: "AI Gateway Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "high",
    missionCapabilities: [
      "ai_gateway_operation",
      "egress_policy_review",
      "metering_review",
      "fallback_policy_review",
    ],
    substrateRefs: [
      "frontend/src/lib/ai-gateway/egress-allowlist.ts",
      "frontend/src/lib/metering/usage-ledger.ts",
      "frontend/src/lib/ai-gateway/output-trust-pipeline.ts",
    ],
    forbiddenOperations: [
      "state_fabrication",
      "egress_allowlist_expansion_without_policy",
      "purpose_vocabulary_expansion_without_authorization",
      "budget_enforcement_removal",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Owns routing, cost, safety, rate limits, fallback (§20 AI gateway law); vendor-neutral adapters only.",
  },
  {
    roleId: "knowledge-engineer",
    division: "data_intelligence",
    title: "Knowledge Engineer",
    classification: "REQUIRES_ARCHITECTURAL_DECISION",
    authorityLevels: ["observe"],
    maxRiskClass: "low",
    missionCapabilities: [],
    substrateRefs: ["frontend/src/lib/memory-knowledge/contracts.ts"],
    forbiddenOperations: ["state_fabrication", "duplicate_memory_engine_creation"],
    instantiationPolicy: "frozen",
    note: "PLATFORM-003 (DECISIONS.md #195) PROPOSED — P36 canonical memory/knowledge ownership is not ratified; no second memory engine may be constructed until it is.",
  },
  {
    roleId: "memory-systems-engineer",
    division: "data_intelligence",
    title: "Memory Systems Engineer",
    classification: "REQUIRES_ARCHITECTURAL_DECISION",
    authorityLevels: ["observe"],
    maxRiskClass: "low",
    missionCapabilities: [],
    substrateRefs: ["frontend/src/lib/memory/memory-store.ts"],
    forbiddenOperations: ["state_fabrication", "duplicate_memory_engine_creation", "scope_expansion_without_audit"],
    instantiationPolicy: "frozen",
    note: "Same PLATFORM-003 dependency as knowledge-engineer; the durable memory tier EXISTS and must not gain a competing owner.",
  },
  {
    roleId: "intelligence-research-agent",
    division: "data_intelligence",
    title: "Intelligence Research Agent",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "medium",
    missionCapabilities: ["research_synthesis", "hypothesis_classification", "evaluation_authoring"],
    substrateRefs: ["frontend/src/lib/ai-context.ts", "frontend/src/lib/evidence/capture.ts"],
    forbiddenOperations: [
      "state_fabrication",
      "production_behavior_change",
      "treating_model_output_as_truth",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Proposals only; hypotheses stay labelled (AD-176); canonical truth is never overwritten by inference (§9).",
  },
  {
    roleId: "context-engineering-agent",
    division: "data_intelligence",
    title: "Context Engineering Agent",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["context_assembly", "scope_policy_review", "switch_safety_review"],
    substrateRefs: [
      "frontend/src/lib/context-assembly.ts",
      "frontend/src/lib/context/switch-safety.ts",
    ],
    forbiddenOperations: ["state_fabrication", "context_scope_expansion_without_audit", "authority_granting_via_context"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Context never grants authority; every exclusion is a first-class record (governed assembler law).",
  },

  /* ── 14. PRODUCT & EXPERIENCE DIVISION ── */
  {
    roleId: "product-strategist",
    division: "product_experience",
    title: "Product Strategist",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "low",
    missionCapabilities: ["product_analysis", "objective_decomposition", "priority_recommendation"],
    substrateRefs: ["PROGRESS.md", "progress"],
    forbiddenOperations: ["state_fabrication", "invented_metrics", "scope_claim_without_registry"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Reasons from real progress records; blue-ocean positioning (§44/§45) is a strategy input, not a license.",
  },
  {
    roleId: "ux-architect",
    division: "product_experience",
    title: "UX Architect",
    classification: "V1",
    authorityLevels: ["analyze", "propose"],
    maxRiskClass: "low",
    missionCapabilities: ["ux_design", "experience_flow_analysis", "progressive_disclosure_design"],
    substrateRefs: ["frontend/src/routes", "frontend/src/components"],
    forbiddenOperations: ["state_fabrication", "fake_dashboards", "invented_metrics"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Operates from real contracts and data (§14); UI is an observation surface (AD-031).",
  },
  {
    roleId: "ui-engineer",
    division: "product_experience",
    title: "UI Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "low",
    missionCapabilities: ["ui_implementation", "code_implementation"],
    substrateRefs: ["frontend/src/components", "frontend/src/lib/phase-catalog.ts"],
    forbiddenOperations: ["state_fabrication", "fake_dashboards", "design_system_migration"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Uses the existing Tailwind/shadcn/Radix stack (§33) — no random UI frameworks.",
  },
  {
    roleId: "design-systems-engineer",
    division: "product_experience",
    title: "Design Systems Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "low",
    missionCapabilities: ["design_system_contribution", "ui_implementation"],
    substrateRefs: ["frontend/src/components", "frontend/src/routes"],
    forbiddenOperations: ["state_fabrication", "design_system_migration", "invented_tokens"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Extends the existing system deliberately; no framework introduction.",
  },
  {
    roleId: "accessibility-engineer",
    division: "product_experience",
    title: "Accessibility Engineer",
    classification: "V1",
    authorityLevels: ["analyze", "propose", "execute"],
    maxRiskClass: "low",
    missionCapabilities: ["accessibility_audit", "ui_implementation"],
    substrateRefs: ["frontend/src/components", "tests/e2e"],
    forbiddenOperations: ["state_fabrication", "invented_audit_results"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Accessibility is architectural (AD-110), verified not asserted.",
  },
  {
    roleId: "product-analytics-engineer",
    division: "product_experience",
    title: "Product Analytics Engineer",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "medium",
    missionCapabilities: ["analytics_interpretation", "metering_review"],
    substrateRefs: ["frontend/src/lib/metering/usage-ledger.ts", "frontend/src/lib/observability/metrics-registry.ts"],
    forbiddenOperations: ["state_fabrication", "invented_metrics", "ai_privacy_boundary_violation"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Analytics is derived intelligence (AD-090); any product-analytics ingestion stays behind §19 AI-privacy pipeline.",
  },
  {
    roleId: "growth-intelligence-agent",
    division: "product_experience",
    title: "Growth Intelligence Agent",
    classification: "DEFERRED_BEYOND_V2",
    authorityLevels: ["observe"],
    maxRiskClass: "low",
    missionCapabilities: [],
    substrateRefs: [],
    forbiddenOperations: ["state_fabrication"],
    instantiationPolicy: "frozen",
    note: "Growth plane is not in the §46 V1 envelope; preserved as a capability definition, frozen pending scope authority.",
  },

  /* ── 15. OPERATIONS DIVISION ── */
  {
    roleId: "incident-commander",
    division: "operations",
    title: "Incident Commander",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose", "execute", "emergency"],
    maxRiskClass: "high",
    missionCapabilities: [
      "incident_response",
      "condition_detection",
      "escalation_management",
      "bounded_recovery_execution",
    ],
    substrateRefs: ["frontend/src/lib/jarvis/escalation.ts", "frontend/src/lib/observability/provider-health.server.ts"],
    forbiddenOperations: [
      "state_fabrication",
      "critical_incident_closure_without_human",
      "destructive_recovery",
    ],
    instantiationPolicy: "dynamic_on_mission",
    note: "Critical incidents close only through the human governance tier (escalation ladder); recovery stays bounded (§31).",
  },
  {
    roleId: "operations-agent",
    division: "operations",
    title: "Operations Agent",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose", "execute"],
    maxRiskClass: "medium",
    missionCapabilities: ["fabric_invariant_review", "condition_detection", "documentation_authoring"],
    substrateRefs: ["scripts/verify-infrastructure.mjs", "frontend/src/lib/observability"],
    forbiddenOperations: ["state_fabrication", "invented_operational_state"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Monitors the live organization through real probes and invariants — never fabricated status.",
  },
  {
    roleId: "support-agent",
    division: "operations",
    title: "Support Agent",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose", "execute"],
    maxRiskClass: "low",
    missionCapabilities: ["support_response", "communication_dispatch"],
    substrateRefs: ["frontend/src/lib/communications"],
    forbiddenOperations: ["state_fabrication", "secret_disclosure", "unauthorized_send"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Sends only through the communication adapters with verified provider credentials.",
  },
  {
    roleId: "customer-success-agent",
    division: "operations",
    title: "Customer Success Agent",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "low",
    missionCapabilities: ["support_response", "analytics_interpretation"],
    substrateRefs: ["frontend/src/lib/communications", "frontend/src/lib/metering/usage-ledger.ts"],
    forbiddenOperations: ["state_fabrication", "invented_metrics", "secret_disclosure"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Tenant data stays tenant-scoped (AD-035); success claims cite real usage ledger rows.",
  },
  {
    roleId: "documentation-agent",
    division: "operations",
    title: "Documentation Agent",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose", "execute"],
    maxRiskClass: "low",
    missionCapabilities: ["documentation_authoring", "runbook_maintenance", "provenance_compliance"],
    substrateRefs: ["docs", "progress"],
    forbiddenOperations: ["state_fabrication", "provenance_forgery", "governance_doc_mutation"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Documentation is engineering infrastructure (AD-158); provenance headers are mandatory where the checker scans.",
  },
  {
    roleId: "knowledge-operations-agent",
    division: "operations",
    title: "Knowledge Operations Agent",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "medium",
    missionCapabilities: ["organizational_memory_operation", "documentation_authoring"],
    substrateRefs: ["frontend/src/lib/memory/memory-store.ts", "docs"],
    forbiddenOperations: ["state_fabrication", "memory_scope_expansion_without_audit", "provenance_forgery"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Organizational memory via the governed memory tier — provenance on every record (§38/§39).",
  },
  {
    roleId: "cost-optimization-agent",
    division: "operations",
    title: "Cost Optimization Agent",
    classification: "V1",
    authorityLevels: ["observe", "analyze", "propose"],
    maxRiskClass: "medium",
    missionCapabilities: ["cost_analysis", "metering_review", "budget_recommendation"],
    substrateRefs: ["frontend/src/lib/metering/usage-ledger.ts", "frontend/src/lib/adapters"],
    forbiddenOperations: ["state_fabrication", "budget_enforcement_removal", "invented_costs"],
    instantiationPolicy: "dynamic_on_mission",
    note: "Cost is an architectural variable (AD-084); recommendations cite metering evidence.",
  },
];

const CATALOG_VALIDATION = validateWorkforceRoleCatalog(WORKFORCE_ROLE_CATALOG);
if (!CATALOG_VALIDATION.ok) {
  throw new Error(`workforce role catalog failed scope-lock validation: ${CATALOG_VALIDATION.errors.join("; ")}`);
}

/** The validated, construction-time-checked catalog. */
export const WORKFORCE_ROLE_CATALOG_VALIDATED: readonly WorkforceRole[] = CATALOG_VALIDATION.roles;

/** Count per scope target — the machine-readable scope-lock histogram. */
export function workforceScopeHistogram(
  roles: readonly WorkforceRole[] = WORKFORCE_ROLE_CATALOG_VALIDATED,
): Record<WorkforceScopeTarget, number> {
  const histogram: Record<WorkforceScopeTarget, number> = {
    V1: 0,
    V2: 0,
    DEFERRED_BEYOND_V2: 0,
    REQUIRES_ARCHITECTURAL_DECISION: 0,
  };
  for (const role of roles) histogram[role.classification] += 1;
  return histogram;
}

export function roleById(
  roleId: string,
  roles: readonly WorkforceRole[] = WORKFORCE_ROLE_CATALOG_VALIDATED,
): WorkforceRole | undefined {
  return roles.find((role) => role.roleId === roleId);
}

export function rolesByDivision(
  division: WorkforceDivision,
  roles: readonly WorkforceRole[] = WORKFORCE_ROLE_CATALOG_VALIDATED,
): readonly WorkforceRole[] {
  return roles.filter((role) => role.division === division);
}