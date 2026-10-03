/**
 * CoreGrid — dependency health inventory contract (H3 wave, mission F-049).
 *
 * WHAT: a declarative map of the dependency checks a deployment declares —
 * for each one: its name, its criticality tier, and a reference to the check
 * contract that owns it — plus a pure aggregator that resolves the map
 * against observed check results (the `DependencyCheckResult[]` produced by
 * `./health`, the contract behind the /health.json endpoint) into an overall
 * posture `ok | degraded | failing`.
 *
 * This module composes READ-ONLY with `./health`: it never modifies the
 * health report builder, only consumes its exported types, its
 * `normalizeCheckResult` normalizer, and its `aggregateStatus` aggregator.
 * The map is the inventory plane; `./health` is the execution plane.
 *
 * Laws of this module:
 * - Fail-closed on the unknown and the dead:
 *     • a DECLARED dependency with NO observed result is a dead check and
 *       forces posture `failing` — silence is never health;
 *     • an OBSERVED result for a dependency NOT declared in the map is an
 *       unknown check and forces posture `failing` — undeclared signals are
 *       never absorbed;
 *     • a result that cannot be parsed into a named check is an invalid
 *       result and forces posture `failing`;
 *     • duplicate results for the same declared name force posture
 *       `failing` — ambiguous telemetry is never averaged away.
 * - Tiered escalation: a `degraded` result on a `critical`-tier dependency
 *   escalates the overall posture to `failing`; on `major`/`minor` tiers it
 *   stays `degraded`. `failing` anywhere is `failing` overall.
 * - Bounded declarations: every entry carries provenance (who declared it,
 *   under which authority, when — AGENTS §12), a neutral lowercase name and
 *   contract reference, and one of exactly three criticality tiers. The map
 *   must declare at least one dependency: an empty inventory cannot claim a
 *   healthy posture.
 * - Duplicate names are a parse failure, never a silent override.
 *
 * Pure in-process contract: no I/O, no persistence, no vendors, no secrets.
 * Human-safe `detail` fields are the caller's responsibility under the
 * `./health` contract; this module only carries them through and never
 * emits new ones.
 */

import { z } from "zod";
import {
  aggregateStatus,
  buildHealthReport,
  normalizeCheckResult,
  type DependencyCheckResult,
  type HealthReport,
  type HealthStatus,
  type MinimalProcess,
  type NamedDependencyCheck,
  type ProcessSnapshot,
} from "./health";

/* ─────────────────────────────────────────────────────────────
 * Criticality tiers
 * ────────────────────────────────────────────────────────────*/

/** Exactly three tiers; no open-ended ladder. */
export const CRITICALITY_TIERS = ["critical", "major", "minor"] as const;
export type CriticalityTier = (typeof CRITICALITY_TIERS)[number];

export const criticalityTierSchema = z.enum(CRITICALITY_TIERS);

/** The tier that escalates a `degraded` result to an overall `failing`. */
export const CRITICAL_TIER: CriticalityTier = "critical";

/* ─────────────────────────────────────────────────────────────
 * Bounded identifiers and provenance
 * ────────────────────────────────────────────────────────────*/

const REF_PATTERN = /^[a-z][a-z0-9_.:/#-]{0,127}$/;

function refSchema(label: string) {
  return z
    .string()
    .regex(
      REF_PATTERN,
      `${label} must be a lowercase identifier (letters, digits, _ . : / # -; starts with a letter; at most 128 characters)`,
    );
}

export const healthMapProvenanceSchema = z.strictObject({
  /** Who declared the entry (role or principal reference, not a secret). */
  declaredBy: z.string().min(1).max(128),
  /** Under which authority the declaration was made (e.g. a mission or ADR). */
  authority: z.string().min(1).max(200),
  /** When it was declared (ISO-8601 UTC instant). */
  declaredAt: z.string().datetime(),
});
export type HealthMapProvenance = z.infer<typeof healthMapProvenanceSchema>;

/* ─────────────────────────────────────────────────────────────
 * Inventory entries and the map
 * ────────────────────────────────────────────────────────────*/

export const dependencyHealthEntrySchema = z.strictObject({
  /** Check name — must match the `name` a check reports via `./health`. */
  name: refSchema("dependency name"),
  criticalityTier: criticalityTierSchema,
  /** Reference to the check contract that owns this probe. */
  checkContractRef: refSchema("check contract reference"),
  provenance: healthMapProvenanceSchema,
});
export type DependencyHealthEntry = z.infer<typeof dependencyHealthEntrySchema>;

export const dependencyHealthInventorySchema = z
  .strictObject({
    /** At least one declared dependency: an empty map cannot be healthy. */
    entries: z.array(dependencyHealthEntrySchema).min(1),
  })
  .refine(
    (inventory) => {
      const names = inventory.entries.map((entry) => entry.name);
      return new Set(names).size === names.length;
    },
    { message: "duplicate dependency name in health map" },
  );
export type DependencyHealthInventory = z.infer<typeof dependencyHealthInventorySchema>;

/** Fail-closed parse of externally supplied inventory data. */
export function parseDependencyHealthMap(raw: unknown): DependencyHealthInventory {
  return dependencyHealthInventorySchema.parse(raw);
}

/* ─────────────────────────────────────────────────────────────
 * Posture evaluation (fail-closed)
 * ────────────────────────────────────────────────────────────*/

export type HealthMapFindingKind =
  | "observed"
  | "dead_check"
  | "unknown_check"
  | "invalid_result"
  | "duplicate_result";

export interface HealthMapFinding {
  readonly kind: HealthMapFindingKind;
  readonly name: string;
  /** Tier of the declared entry; `null` when no declared entry applies. */
  readonly criticalityTier: CriticalityTier | null;
  /** Effective status this finding contributes to the posture. */
  readonly status: HealthStatus;
}

export interface HealthMapPosture {
  readonly status: HealthStatus;
  readonly findings: readonly HealthMapFinding[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function severity(status: HealthStatus): 0 | 1 | 2 {
  if (status === "failing") return 2;
  if (status === "degraded") return 1;
  return 0;
}

/** Tier escalation: a degraded critical dependency is failing overall. */
function effectiveStatus(status: HealthStatus, tier: CriticalityTier | null): HealthStatus {
  if (status === "degraded" && tier === CRITICAL_TIER) return "failing";
  return status;
}

/**
 * Resolve the declared inventory against observed results (any shape — the
 * caller may pass untrusted data; every rule degrades fail-closed).
 */
export function evaluateHealthMapPosture(
  inventory: DependencyHealthInventory,
  rawResults: readonly unknown[],
): HealthMapPosture {
  const findings: HealthMapFinding[] = [];

  // Pass 1: index observed results by name, fail-closed on unnameable ones.
  const observed = new Map<string, { status: HealthStatus; occurrences: number }>();
  for (const raw of rawResults) {
    let name: string | null = null;
    if (typeof raw === "object" && raw !== null && isNonEmptyString((raw as Record<string, unknown>).name)) {
      name = ((raw as Record<string, unknown>).name as string).trim();
    }
    if (name === null) {
      findings.push({
        kind: "invalid_result",
        name: "<unnameable>",
        criticalityTier: null,
        status: "failing",
      });
      continue;
    }
    const prior = observed.get(name);
    const occurrences = (prior?.occurrences ?? 0) + 1;
    // Re-normalize through `./health` so an out-of-contract status value
    // (or a malformed body under a declared name) degrades to `failing`.
    const status = normalizeCheckResult(raw, name).status;
    observed.set(name, { status, occurrences });
    if (prior !== undefined) {
      findings.push({
        kind: "duplicate_result",
        name,
        criticalityTier: null,
        status: "failing",
      });
    }
  }

  // Pass 2: unknown checks — observed names the inventory does not declare.
  for (const [name] of observed) {
    const declared = inventory.entries.some((entry) => entry.name === name);
    if (!declared) {
      findings.push({
        kind: "unknown_check",
        name,
        criticalityTier: null,
        status: "failing",
      });
    }
  }

  // Pass 3: every declared dependency must be observed — silence is dead.
  for (const entry of inventory.entries) {
    const seen = observed.get(entry.name);
    if (!seen) {
      findings.push({
        kind: "dead_check",
        name: entry.name,
        criticalityTier: entry.criticalityTier,
        status: "failing",
      });
      continue;
    }
    findings.push({
      kind: "observed",
      name: entry.name,
      criticalityTier: entry.criticalityTier,
      status: effectiveStatus(seen.status, entry.criticalityTier),
    });
  }

  return {
    status: aggregateStatus(findings.map((finding) => finding.status)),
    findings,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Composition with the /health.json contract (read-only)
 * ────────────────────────────────────────────────────────────*/

export interface BuildMapHealthReportInput {
  /** The declared dependency inventory (fail-closed parsed first). */
  inventory: DependencyHealthInventory;
  /** The executable dependency checks, exactly as `./health` consumes them. */
  dependencyChecks?: readonly NamedDependencyCheck[];
  snapshot?: ProcessSnapshot;
  version?: string | null;
  /** Injectable clock (ISO string) so the builder stays testable. */
  now?: () => string;
}

export interface HealthMapReport {
  /** The full `./health` report, unchanged in shape. */
  report: HealthReport;
  /** The map-level posture; when it exceeds `report.status` in severity,
   *  this posture is authoritative (fail-closed supersedes). */
  posture: HealthMapPosture;
}

/**
 * Build the health report through `./health` (read-only composition) and
 * resolve it against the declared inventory. A check declared but not
 * registered as executable is a dead check; a check registered but not
 * declared is an unknown check; both force posture `failing`.
 */
export async function buildMapHealthReport(
  input: BuildMapHealthReportInput,
  proc: MinimalProcess = process,
): Promise<HealthMapReport> {
  const report = await buildHealthReport({
    snapshot: input.snapshot,
    version: input.version,
    dependencyChecks: input.dependencyChecks,
    now: input.now,
  });
  const posture = evaluateHealthMapPosture(input.inventory, report.checks);
  return { report, posture };
}