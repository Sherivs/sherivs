/**
 * Sherivs — kernel phase-engineering contract (domain-neutral).
 *
 * A phase contract is the machine-checkable form of a phase document: it
 * declares all twenty engineering sections, the capability the phase owns in
 * the kernel capability registry, the phases it depends on and serves, its
 * tenant/security/AI-safety obligations, and how the first installed runtime
 * consumes it while every other domain consumes the same neutral contract.
 *
 * Two governance laws are encoded here:
 *
 *  1. NO INDEPENDENT PHASES (PROGRESS §9 dependency graph, AGENTS §3 prime
 *     directive): a phase contract must declare its dependencies and its
 *     consumers, and the assembled contract graph must be a connected DAG.
 *     An orphan phase fails validation.
 *  2. NO DOMAIN ONTOLOGY IN THE KERNEL (AGENTS §24–25, Phase 33 law): a phase
 *     contract records the *first runtime binding* plus *reserved neutral
 *     seats*; it never hardcodes a domain's vocabulary as kernel behaviour.
 *
 * This module is pure: no persistence, no I/O, no state.
 */

import { PHASE_LAYERS } from "../phase-catalog";
import {
  ENGINEERING_SECTION_KEYS,
  MANDATORY_ASI_INVARIANTS,
  engineeringSectionCoverage,
  isAsiInvariant,
  missingEngineeringSections,
  type AsiInvariant,
  type EngineeringSectionCoverage,
  type EngineeringSectionKey,
} from "./engineering-sections";

export const PHASE_CONTRACT_SCHEMA_VERSION = 1;

export const PHASE_CONTRACT_STATUSES = [
  "architecture",
  "planned",
  "implementing",
  "implemented",
  "complete",
] as const;

export type PhaseContractStatus = (typeof PHASE_CONTRACT_STATUSES)[number];

export function isPhaseContractStatus(value: unknown): value is PhaseContractStatus {
  return (
    typeof value === "string" && (PHASE_CONTRACT_STATUSES as readonly string[]).includes(value)
  );
}

/* ─────────────────────────────────────────────────────────────
 * Section declarations
 * ────────────────────────────────────────────────────────────*/

export type SectionDeclarationStatus = "declared" | "partial" | "complete";

export const SECTION_DECLARATION_STATUSES: readonly SectionDeclarationStatus[] = [
  "declared",
  "partial",
  "complete",
] as const;

export interface SectionDeclaration {
  status: SectionDeclarationStatus;
  /** One-sentence answer to the section's intent (min 20 characters). */
  summary: string;
  /** Repository artifacts that carry this section (paths/commands). */
  artifacts: readonly string[];
  /** Validation evidence (test names, ledger rows) when the section is proven. */
  evidence?: readonly string[];
}

export type PhaseSections = Readonly<Record<EngineeringSectionKey, SectionDeclaration>>;

/* ─────────────────────────────────────────────────────────────
 * Contracts, connections and runtime bindings
 * ────────────────────────────────────────────────────────────*/

export const PHASE_CONTRACT_KINDS = ["command", "query", "api", "event", "ui"] as const;
export type PhaseContractKind = (typeof PHASE_CONTRACT_KINDS)[number];

export interface PhaseContractRef {
  id: string;
  kind: PhaseContractKind;
  description?: string;
}

/** A phase id, the wildcard "all", or a platform principal such as "control-plane". */
export type ConnectionRef = string;

export const NEUTRAL_SEAT_STATUSES = ["reserved", "installed", "retired"] as const;
export type NeutralSeatStatus = (typeof NEUTRAL_SEAT_STATUSES)[number];

/**
 * A reserved seat for a future domain runtime on this phase's capability.
 * One runtime may be installed first, but every seat must be declared so no
 * phase is ever built for a single runtime only.
 */
export interface NeutralDomainSeat {
  domain: string;
  status: NeutralSeatStatus;
  manifestRef: string;
}

export interface PhaseRuntimeBinding {
  /** First installed runtime consuming the phase — data, never kernel logic. */
  firstRuntime: string;
  /** Neutral seats reserved for domain runtimes other than the first. */
  neutralSeats: readonly NeutralDomainSeat[];
}

export interface PhaseBoundary {
  /** Neutrality statement: what the phase never embeds. */
  statement: string;
  /** Capabilities this phase must not re-implement. */
  excludes: readonly string[];
}

/* ─────────────────────────────────────────────────────────────
 * ASI profile
 * ────────────────────────────────────────────────────────────*/

export const ASI_TIERS = [
  "assistive",
  "supervised-autonomous",
  "governed-autonomous",
  "civilization-scale",
] as const;

export type AsiTier = (typeof ASI_TIERS)[number];

/** Highest autonomy level (1–4) permitted per tier without new governance. */
export const ASI_TIER_MAX_AUTONOMY: Readonly<Record<AsiTier, number>> = {
  assistive: 1,
  "supervised-autonomous": 2,
  "governed-autonomous": 3,
  "civilization-scale": 4,
} as const;

export const SELF_IMPROVEMENT_MODES = ["forbidden", "proposal-only", "governed"] as const;
export type SelfImprovementMode = (typeof SELF_IMPROVEMENT_MODES)[number];

export interface PhaseAsiProfile {
  tier: AsiTier;
  autonomy: {
    /** 1 = observe/advise … 4 = civilization-scale autonomous operation. */
    level: number;
    /** Actions that always require human approval at this phase. */
    requiresApprovalFor: readonly string[];
  };
  invariants: readonly AsiInvariant[];
  /** How the phase may participate in self-improvement (AGENTS §8). */
  selfImprovement: SelfImprovementMode;
  /** Canonical truth owned by this phase vs derived intelligence it produces. */
  canonicalTruth: {
    /**
     * Canonical truth this phase owns. Empty only when the phase declares
     * `ownsNoCanonicalTruth: true` — a pure derivation or composition phase.
     */
    owners: readonly string[];
    derived: readonly string[];
    /** Explicit declaration for phases that genuinely own no canonical truth. */
    ownsNoCanonicalTruth?: boolean;
  };
}

export interface PhaseEngineeringContract {
  schemaVersion: number;
  id: string;
  name: string;
  layer: string;
  stage: string;
  status: PhaseContractStatus;
  /** Accountable owner (phase id, "control-plane" or "all"). */
  owner: string;
  purpose: string;
  boundary: PhaseBoundary;
  /** Phases this contract depends on (empty only for foundation roots). */
  dependsOn: readonly ConnectionRef[];
  /** Phases/principals that consume this capability. */
  consumers: readonly ConnectionRef[];
  capabilities: {
    /** Capability ids owned by this phase in the kernel capability registry. */
    owns: readonly string[];
    /** Capability ids consumed from other phases. */
    consumes: readonly string[];
  };
  contracts: {
    provides: readonly PhaseContractRef[];
    consumes: readonly PhaseContractRef[];
  };
  sections: PhaseSections;
  asi: PhaseAsiProfile;
  runtimeBindings: PhaseRuntimeBinding;
}

/* ─────────────────────────────────────────────────────────────
 * Validation
 * ────────────────────────────────────────────────────────────*/

export interface PhaseContractValidationOptions {
  /** Registered phase ids (01…51) used to reject dangling connections. */
  knownPhaseIds?: readonly string[];
  /** Kernel capability ids used to reject invented capabilities. */
  knownCapabilityIds?: readonly string[];
  /** Capability id → owning phase id, used to enforce single ownership. */
  capabilityOwners?: Readonly<Record<string, string>>;
}

export type PhaseContractValidation =
  { ok: true; coverage: EngineeringSectionCoverage } | { ok: false; issues: string[] };

/** Connection refs that are legal without being a declared phase id. */
const PRINCIPAL_REFS = new Set(["all", "control-plane", "sherivs", "coregrid" /* former name */]);

export function isLegalConnectionRef(ref: string, knownPhaseIds?: readonly string[]): boolean {
  if (PRINCIPAL_REFS.has(ref)) return true;
  if (/^runtime[-:]/.test(ref)) return true;
  return knownPhaseIds ? knownPhaseIds.includes(ref) : true;
}

const SECTION_MIN_SUMMARY = 20;

/**
 * Validate one phase contract against the twenty-section dictionary, the
 * capability registry, the dependency/consumer law and the ASI invariants.
 */
export function validatePhaseContract(
  contract: PhaseEngineeringContract,
  options: PhaseContractValidationOptions = {},
): PhaseContractValidation {
  const issues: string[] = [];
  const { knownPhaseIds, knownCapabilityIds, capabilityOwners } = options;

  if (contract.schemaVersion !== PHASE_CONTRACT_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${PHASE_CONTRACT_SCHEMA_VERSION}`);
  }
  if (!/^\d{2}$/.test(contract.id)) {
    issues.push(`id must be a two-digit phase id (got "${contract.id}")`);
  }
  if (!contract.name?.trim()) issues.push("name is required");
  if (!PHASE_LAYERS.includes(contract.layer)) {
    issues.push(`layer "${contract.layer}" is not a registered display layer`);
  }
  if (!contract.stage?.trim()) issues.push("stage is required");
  if (!isPhaseContractStatus(contract.status)) {
    issues.push(`status "${contract.status}" is not registered`);
  }
  if (!contract.purpose || contract.purpose.trim().length < SECTION_MIN_SUMMARY) {
    issues.push(`purpose must be at least ${SECTION_MIN_SUMMARY} characters`);
  }

  /* Boundary law: a phase must state what it excludes. */
  if (!contract.boundary?.statement?.trim()) issues.push("boundary.statement is required");
  if (!contract.boundary?.excludes?.length) {
    issues.push("boundary.excludes must list at least one capability the phase does not own");
  }

  /* Connection law: no independent phases. */
  for (const dep of contract.dependsOn ?? []) {
    if (dep === contract.id) issues.push("a phase cannot depend on itself");
    else if (!isLegalConnectionRef(dep, knownPhaseIds)) {
      issues.push(`dependsOn references unregistered phase "${dep}"`);
    }
  }
  if (!contract.consumers?.length) {
    issues.push("consumers must declare at least one consumer (no orphan phases)");
  }
  for (const consumer of contract.consumers ?? []) {
    if (consumer === contract.id) issues.push("a phase cannot consume itself");
    else if (!isLegalConnectionRef(consumer, knownPhaseIds)) {
      issues.push(`consumers references unregistered phase "${consumer}"`);
    }
  }

  /* Capability law: the kernel owns the graph. */
  for (const capabilityId of contract.capabilities?.owns ?? []) {
    if (knownCapabilityIds && !knownCapabilityIds.includes(capabilityId)) {
      issues.push(`owns unknown kernel capability "${capabilityId}"`);
    }
    const declaredOwner = capabilityOwners?.[capabilityId];
    if (declaredOwner && declaredOwner !== contract.id) {
      issues.push(
        `capability "${capabilityId}" is owned by phase ${declaredOwner}, not ${contract.id}`,
      );
    }
  }
  for (const capabilityId of contract.capabilities?.consumes ?? []) {
    if (knownCapabilityIds && !knownCapabilityIds.includes(capabilityId)) {
      issues.push(`consumes unknown kernel capability "${capabilityId}"`);
    }
    if ((contract.capabilities?.owns ?? []).includes(capabilityId)) {
      issues.push(`capability "${capabilityId}" cannot be both owned and consumed`);
    }
  }

  /* Section law: all twenty engineering sections declared with substance. */
  const declared = Object.keys(contract.sections ?? {});
  const missing = missingEngineeringSections(declared);
  for (const key of missing) issues.push(`engineering section "${key}" is not declared`);
  for (const key of ENGINEERING_SECTION_KEYS) {
    const section = contract.sections?.[key];
    if (!section) continue;
    if (!["declared", "partial", "complete"].includes(section.status)) {
      issues.push(`section "${key}" has an unregistered status "${section.status}"`);
    }
    if (!section.summary || section.summary.trim().length < SECTION_MIN_SUMMARY) {
      issues.push(`section "${key}" summary must be at least ${SECTION_MIN_SUMMARY} characters`);
    }
    if (!section.artifacts?.length) {
      issues.push(`section "${key}" must reference at least one artifact`);
    }
  }
  const coverage = engineeringSectionCoverage(declared);

  /* ASI law (AGENTS §7–9, §19–21): invariants are not optional. */
  const asi = contract.asi;
  if (!asi) {
    issues.push("asi profile is required");
  } else {
    if (!(asi.tier in ASI_TIER_MAX_AUTONOMY)) {
      issues.push(`asi.tier "${asi.tier}" is not registered`);
    }
    const level = asi.autonomy?.level ?? 0;
    if (!Number.isInteger(level) || level < 1 || level > 4) {
      issues.push("asi.autonomy.level must be an integer between 1 and 4");
    } else if (asi.tier in ASI_TIER_MAX_AUTONOMY && level > ASI_TIER_MAX_AUTONOMY[asi.tier]) {
      issues.push(
        `asi.autonomy.level ${level} exceeds tier "${asi.tier}" maximum ${ASI_TIER_MAX_AUTONOMY[asi.tier]}`,
      );
    }
    if (!asi.autonomy?.requiresApprovalFor?.length) {
      issues.push("asi.autonomy.requiresApprovalFor must name at least one gated action");
    }
    for (const invariant of asi.invariants ?? []) {
      if (!isAsiInvariant(invariant)) issues.push(`asi invariant "${invariant}" is not registered`);
    }
    for (const mandatory of MANDATORY_ASI_INVARIANTS) {
      if (!(asi.invariants ?? []).includes(mandatory)) {
        issues.push(`asi invariant "${mandatory}" is mandatory and cannot be omitted`);
      }
    }
    if (!SELF_IMPROVEMENT_MODES.includes(asi.selfImprovement)) {
      issues.push(`asi.selfImprovement "${asi.selfImprovement}" is not registered`);
    } else if (asi.tier === "civilization-scale" && asi.selfImprovement !== "governed") {
      issues.push("civilization-scale autonomy requires governed self-improvement");
    }
    const ownsNoTruth = asi.canonicalTruth?.ownsNoCanonicalTruth === true;
    if (!asi.canonicalTruth?.owners?.length && !ownsNoTruth) {
      issues.push(
        "asi.canonicalTruth.owners must name the canonical truth the phase owns (or declare ownsNoCanonicalTruth)",
      );
    }
    if (asi.canonicalTruth?.owners?.length && ownsNoTruth) {
      issues.push(
        "asi.canonicalTruth cannot both own canonical truth and declare ownsNoCanonicalTruth",
      );
    }
    if (!asi.canonicalTruth?.derived?.length) {
      issues.push(
        "asi.canonicalTruth.derived must name the derived intelligence the phase produces",
      );
    }
  }

  /* Runtime binding law: one first runtime, neutral seats always reserved. */
  const bindings = contract.runtimeBindings;
  if (!bindings?.firstRuntime?.trim()) issues.push("runtimeBindings.firstRuntime is required");
  if (!bindings?.neutralSeats?.length) {
    issues.push(
      "runtimeBindings.neutralSeats must reserve at least one seat for a domain runtime other than the first",
    );
  }
  const seenSeats = new Set<string>();
  for (const seat of bindings?.neutralSeats ?? []) {
    if (!/^[a-z][a-z0-9-]*$/.test(seat.domain)) {
      issues.push(`neutral seat domain "${seat.domain}" must be a lowercase slug`);
    }
    if (seenSeats.has(seat.domain)) issues.push(`duplicate neutral seat domain "${seat.domain}"`);
    seenSeats.add(seat.domain);
    if (!["reserved", "installed", "retired"].includes(seat.status)) {
      issues.push(`neutral seat "${seat.domain}" has an unregistered status "${seat.status}"`);
    }
    if (!seat.manifestRef?.trim()) {
      issues.push(`neutral seat "${seat.domain}" must reference a runtime manifest`);
    }
  }

  return issues.length === 0 ? { ok: true, coverage } : { ok: false, issues };
}

/* ─────────────────────────────────────────────────────────────
 * Cross-phase connection graph (no independent phases)
 * ────────────────────────────────────────────────────────────*/

export interface PhaseContractEdge {
  from: string;
  to: string;
  kind: "dependency" | "consumer";
}

export interface PhaseContractGraph {
  nodes: readonly string[];
  edges: readonly PhaseContractEdge[];
  /** Phases with no dependencies — the only phases allowed to be roots. */
  roots: readonly string[];
}

export function buildPhaseContractGraph(
  contracts: readonly PhaseEngineeringContract[],
): PhaseContractGraph {
  const nodes = contracts.map((contract) => contract.id);
  const nodeSet = new Set(nodes);
  const edges: PhaseContractEdge[] = [];

  /**
   * Only edges between authored contracts are graph edges. References to
   * not-yet-authored phases are validated per contract against the full
   * 51-phase registry (`knownPhaseIds`), so waves can land phase by phase
   * without the graph reporting phantom dangling nodes.
   */
  const addEdge = (from: string, to: string, kind: PhaseContractEdge["kind"]): void => {
    if (!nodeSet.has(from) || !nodeSet.has(to)) return;
    if (PRINCIPAL_REFS.has(to) || PRINCIPAL_REFS.has(from)) return;
    if (/^runtime[-:]/.test(to) || /^runtime[-:]/.test(from)) return;
    edges.push({ from, to, kind });
  };

  for (const contract of contracts) {
    for (const dependency of contract.dependsOn ?? []) {
      addEdge(contract.id, dependency, "dependency");
    }
    for (const consumer of contract.consumers ?? []) {
      addEdge(consumer, contract.id, "consumer");
    }
  }
  const roots = contracts.filter((contract) => !(contract.dependsOn ?? []).length).map((c) => c.id);
  return { nodes, edges, roots };
}

/**
 * Validate that an assembled contract set forms one connected DAG: no phase may
 * be independent, no phase may be dangling, and no DEPENDENCY cycle is allowed.
 *
 * Capability consumption is deliberately not part of the cycle law: mutual
 * consumption is legitimate (phase 08 consumes trust signals while phase 09
 * depends on authorization), whereas build order must stay acyclic.
 */
export function validatePhaseContractGraph(graph: PhaseContractGraph): string[] {
  const issues: string[] = [];
  const nodes = new Set(graph.nodes);
  const dependencyAdjacency = new Map<string, string[]>();
  for (const node of graph.nodes) dependencyAdjacency.set(node, []);

  for (const edge of graph.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) {
      issues.push(`edge ${edge.from} → ${edge.to} references an unregistered phase`);
      continue;
    }
    if (edge.from === edge.to) issues.push(`phase ${edge.from} references itself (${edge.kind})`);
    if (edge.kind === "dependency") dependencyAdjacency.get(edge.from)!.push(edge.to);
  }

  /* Cycle detection over dependency edges only (DFS with colouring). */
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>(graph.nodes.map((node) => [node, WHITE]));
  const visit = (node: string): void => {
    colour.set(node, GREY);
    for (const next of dependencyAdjacency.get(node) ?? []) {
      const state = colour.get(next) ?? WHITE;
      if (state === GREY) issues.push(`dependency cycle detected at ${node} → ${next}`);
      else if (state === WHITE) visit(next);
    }
    colour.set(node, BLACK);
  };
  for (const node of graph.nodes) {
    if (colour.get(node) === WHITE) visit(node);
  }

  /* Orphan detection: every non-root phase must be connected in both senses. */
  const incoming = new Map<string, number>(graph.nodes.map((node) => [node, 0]));
  const outgoing = new Map<string, number>(graph.nodes.map((node) => [node, 0]));
  for (const edge of graph.edges) {
    if (incoming.has(edge.to)) incoming.set(edge.to, incoming.get(edge.to)! + 1);
    if (outgoing.has(edge.from)) outgoing.set(edge.from, outgoing.get(edge.from)! + 1);
  }
  const roots = new Set(graph.roots);
  for (const node of graph.nodes) {
    if (roots.has(node)) continue;
    if ((incoming.get(node) ?? 0) === 0 && (outgoing.get(node) ?? 0) === 0) {
      issues.push(`phase ${node} is independent: it declares no dependency and serves no consumer`);
    }
  }

  return issues;
}

export interface PhaseContractSummary {
  total: number;
  sectionsComplete: number;
  byStatus: Readonly<Record<PhaseContractStatus, number>>;
  roots: readonly string[];
}

export function summarizePhaseContracts(
  contracts: readonly PhaseEngineeringContract[],
): PhaseContractSummary {
  const byStatus = {
    architecture: 0,
    planned: 0,
    implementing: 0,
    implemented: 0,
    complete: 0,
  } as Record<PhaseContractStatus, number>;
  let sectionsComplete = 0;
  for (const contract of contracts) {
    if (isPhaseContractStatus(contract.status)) byStatus[contract.status] += 1;
    if (engineeringSectionCoverage(Object.keys(contract.sections ?? {})).complete) {
      sectionsComplete += 1;
    }
  }
  const graph = buildPhaseContractGraph(contracts);
  return { total: contracts.length, sectionsComplete, byStatus, roots: graph.roots };
}
