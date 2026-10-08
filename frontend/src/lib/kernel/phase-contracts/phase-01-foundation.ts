/**
 * Phase 01 — Foundation engineering contract (kernel-neutral).
 *
 * Machine-checkable form of `architecture/phase-01-foundation.md`: the twenty
 * engineering sections, the single owned kernel capability
 * (`foundation-standards-config-secrets-ci`), the boundaries the foundation
 * must never cross, and the ASI profile agents operate under while touching
 * the foundation.
 *
 * RUNTIME NEUTRALITY: this contract is consumed by every runtime on equal
 * terms. The first installed runtime (runtime-001) holds no privileged seat, and
 * health, government, commerce and every other domain consume the same contract
 * through a reserved neutral seat. No section below names a runtime-specific
 * ontology; runtime-specific bindings live only in `runtimeBindings`.
 *
 * Ownership: phase 01 owns conventions and verification, never domain state.
 */

import { PHASE_CONTRACT_SCHEMA_VERSION, type PhaseEngineeringContract } from "../phase-contract";

export const PHASE_01_FOUNDATION: PhaseEngineeringContract = {
  schemaVersion: PHASE_CONTRACT_SCHEMA_VERSION,
  id: "01",
  name: "Foundation",
  layer: "Foundations",
  stage: "S1",
  status: "implementing",
  owner: "all",
  purpose:
    "Give every Sherivs phase one set of verified foundations — repository standards, configuration, secrets discipline, migration rules, typing, API boundary rules and mechanical verification — so no phase invents its own conventions.",
  boundary: {
    statement:
      "The foundation owns conventions, verification contracts and repository hygiene. It never embeds a domain ontology, a tenant's business logic or a vendor SDK; those belong to the consuming runtime behind an adapter.",
    excludes: [
      "identity-ontology-ownership (phase 02)",
      "tenancy-model-ownership (phase 03)",
      "domain-ontology (consuming runtimes, e.g. runtime:scholar)",
      "vendor-provider-specifics (adapters own these)",
    ],
  },
  dependsOn: [],
  consumers: ["all"],
  capabilities: {
    owns: ["foundation-standards-config-secrets-ci"],
    consumes: [],
  },
  contracts: {
    provides: [
      {
        id: "npm:verify",
        kind: "command",
        description: "typecheck → unit → registry → secrets → build verification chain",
      },
      { id: "npm:verify:registry", kind: "command", description: "registry.json invariant check" },
      { id: "npm:verify:secrets", kind: "command", description: "credential material scan" },
      {
        id: "typecheck",
        kind: "command",
        description: "whole-tree strict TypeScript gate (0 errors)",
      },
    ],
    consumes: [],
  },
  sections: {
    identity: {
      status: "complete",
      summary:
        "Phase 01 owns the foundation registry identity: capability foundation-standards-config-secrets-ci plus its verification contracts.",
      artifacts: ["architecture/registry.json", "frontend/src/lib/phase-catalog.ts"],
      evidence: ["registry-validate.mjs — phases=51 capabilities=50"],
    },
    purpose: {
      status: "complete",
      summary:
        "One verified foundation prevents per-phase convention drift: every later phase consumes the same standards instead of re-inventing them.",
      artifacts: ["architecture/phase-01-foundation.md", "AGENTS.md"],
    },
    ownership: {
      status: "complete",
      summary:
        "Phase 01 is the single owner of repository standards: config, secrets discipline, migration rules, typing gates, API boundary rules and CI contracts.",
      artifacts: ["package.json", "scripts/verification/"],
      evidence: ["tests/unit/foundation.test.ts — 15 integrity tests"],
    },
    boundary: {
      status: "complete",
      summary:
        "The foundation excludes domain ontology, tenant business rules and vendor SDK specifics; consumers reach providers only through adapters.",
      artifacts: ["BOUNDARIES.md", "architecture/dependency-graph.md"],
    },
    principle: {
      status: "complete",
      summary:
        "Invariants: no secrets in the repository, no application-only security, RLS for tenant data, strict typing, real data only, no phase outside the registry.",
      artifacts: ["CONSTITUTION.md", "PRINCIPLES.md", "PROGRESS.md"],
    },
    architecture: {
      status: "complete",
      summary:
        "The foundation sits beneath every layer: domain logic stays vendor-free, application wiring consumes policy, infrastructure holds adapters, providers stay external.",
      artifacts: ["architecture-map.md", "architecture/dependency-graph.md"],
    },
    contract: {
      status: "complete",
      summary:
        "Provided contracts are verification commands and typing gates; consumed contracts are none — the foundation is the dependency root of the platform.",
      artifacts: ["package.json", "scripts/verification/registry-validate.mjs"],
    },
    dataModel: {
      status: "partial",
      summary:
        "The foundation owns no domain tables; it owns migration discipline (ordered timestamps, LF endings, additive changes) that every owned table follows.",
      artifacts: ["database/", ".gitattributes", "DEPENDENCY.md"],
    },
    event: {
      status: "declared",
      summary:
        "The foundation emits verification outcomes (registry, secrets, build) as CI evidence; domain events belong to owning phases and the P05 transport.",
      artifacts: ["scripts/verification/", "architecture/phase-05-core-application-runtime.md"],
    },
    workflow: {
      status: "complete",
      summary:
        "Every engineering task follows read constitution → inspect repository → design → implement → test → security test → review diff → document.",
      artifacts: ["AGENTS.md", "PROGRESS.md"],
    },
    security: {
      status: "complete",
      summary:
        "Security invariants: credentials never enter the repository, tenant data is protected by RLS rather than application code, and every privileged action is audited.",
      artifacts: ["scripts/verification/secret-scan.mjs", "CONSTITUTION.md"],
      evidence: ["foundation.test.ts — secret scan + MCP credential hygiene"],
    },
    tenancy: {
      status: "complete",
      summary:
        "Every request carries tenant context and every tenant-sensitive table carries RLS policy; the foundation owns the rule, phase 03 owns the model.",
      artifacts: ["architecture/phase-03-multi-tenancy.md", "database/"],
    },
    aiSafety: {
      status: "complete",
      summary:
        "Agents may propose foundation changes but never grant themselves permissions; generated code, tests and documents are untrusted until reviewed and verified.",
      artifacts: ["AGENTS.md", "frontend/src/lib/kernel/phase-contract.ts"],
      evidence: ["kernel-phase-contract.test.ts — ASI invariant enforcement"],
    },
    observability: {
      status: "complete",
      summary:
        "Foundation observability is the verification ledger: registry validation, secret scan, typecheck, unit suite and build results recorded per change. The structured logger, metrics and health primitives exist and are now proven by executable tests; no request path wires them yet, which is recorded as UNWIRED rather than counted as enforcement.",
      artifacts: [
        "PROGRESS.md",
        "package.json",
        "tests/unit/foundation-observability.test.ts",
        "frontend/src/lib/runtime-observability.ts",
      ],
      evidence: [
        "foundation-observability.test.ts — correlation, redaction, metrics percentiles, health aggregation",
      ],
    },
    testing: {
      status: "complete",
      summary:
        "The foundation ships the verification chain itself — strict typecheck, unit suite, registry invariants, credential scan and production build — as the gate every phase reuses.",
      artifacts: [
        "tests/unit/foundation.test.ts",
        "tests/unit/foundation-observability.test.ts",
        "tests/unit/foundation-error-architecture.test.ts",
        "tests/unit/foundation-limits-map.test.ts",
        "npm run verify",
      ],
      evidence: [
        "foundation.test.ts — 15 integrity tests; registry validator PASS",
        "foundation-error-architecture.test.ts — bounded capture + safe report bridge",
        "foundation-limits-map.test.ts — §59/§60 map re-derived against source",
      ],
    },
    integration: {
      status: "complete",
      summary:
        "Consumers are 'all': every phase and every runtime consumes these contracts without redefining them. The first installed runtime is a consumer among equals and never the owner.",
      artifacts: [
        "architecture/capability-ownership-graph.md",
        "scripts/verify-phase-consumption.mjs",
      ],
    },
    dependency: {
      status: "complete",
      summary:
        "The foundation depends on no phase; its external dependencies (Node, Vite, Vitest, TypeScript, Postgres, Supabase) stay behind adapters and pinned versions.",
      artifacts: ["package.json", "architecture/dependency-graph.md"],
    },
    risk: {
      status: "complete",
      summary:
        "Registered risks: convention drift across phases (mitigated by the shared verification chain), credential leakage (secret scan + env gating) and verification bypass (CI gate).",
      artifacts: ["PROGRESS.md", "AGENTS.md"],
    },
    completion: {
      status: "partial",
      summary:
        "L1–L3 are evidenced (document, migration/typing discipline, verification backend); L4–L5 advance as each phase consumes the contracts and records validation rows.",
      artifacts: ["PROGRESS.md", "architecture/engineering-section-completeness-matrix.md"],
      evidence: ["npm run verify — typecheck, unit, registry, secrets, build"],
    },
    extension: {
      status: "complete",
      summary:
        "Extension points are additive: new phases register a contract, new runtimes install a manifest, new verification gates join the chain — no kernel rewrite required.",
      artifacts: ["frontend/src/lib/kernel/domain-manifest.ts", "architecture/registry.json"],
    },
  },
  asi: {
    tier: "assistive",
    autonomy: {
      level: 1,
      requiresApprovalFor: [
        "governance-rule-change",
        "secret-rotation",
        "verification-gate-removal",
        "schema-migration-authoring",
      ],
    },
    invariants: [
      "canonical-truth-separation",
      "agent-least-privilege",
      "human-approval-for-critical",
      "ai-output-untrusted",
      "no-permission-expansion",
      "provenance-required",
      "observable-autonomy",
    ],
    selfImprovement: "proposal-only",
    canonicalTruth: {
      owners: ["repository-state", "verification-results", "migration-history"],
      derived: ["agent-proposals", "generated-contracts", "summaries"],
    },
  },
  runtimeBindings: {
    firstRuntime: "runtime:scholar",
    neutralSeats: [
      {
        domain: "healthcare",
        status: "reserved",
        manifestRef: "frontend/src/lib/kernel/domain-manifest.ts",
      },
      {
        domain: "government",
        status: "reserved",
        manifestRef: "frontend/src/lib/kernel/domain-manifest.ts",
      },
      {
        domain: "commerce",
        status: "reserved",
        manifestRef: "frontend/src/lib/kernel/domain-manifest.ts",
      },
    ],
  },
};
