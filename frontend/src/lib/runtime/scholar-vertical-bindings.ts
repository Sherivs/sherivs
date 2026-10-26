/**
 * Sherivs Scholar — kernel-capability ↔ Scholar-vertical binding map.
 *
 * Which Scholar vertical realizes which kernel capability, with the evidence
 * path proving the binding is authored (a live route or a runtime module). The
 * bindings point at the completed 51-phase contract chain: every bound
 * capability is owned by a contract phase, and `SCHOLAR_RUNTIME_ID` is the
 * runtime those contracts declare as `runtimeBindings.firstRuntime`.
 *
 * Boundary:
 * - This module declares CONSUMPTION. It owns no chain fact: capability
 *   ownership comes from the kernel registry, and a binding may never invent a
 *   capability or claim one Scholar does not consume.
 * - A binding is never an authorization grant. Phase 08 decides; this map only
 *   records which vertical exercises a capability and where that is visible.
 * - Domain → kernel only. The kernel never imports this module.
 */

import { KERNEL_CAPABILITIES, kernelCapabilityById } from "@/lib/kernel/kernel-capability-registry";
import { phaseContractById } from "@/lib/kernel/phase-contracts";
import {
  SCHOLAR_REGISTRY_RUNTIME_ID,
  SCHOLAR_RUNTIME_ID,
  scholarConsumedKernelCapabilities,
} from "./scholar-consumption";

/**
 * Runtime ids and the consumption declaration live in `./scholar-consumption`
 * (runtime layer, alongside this module). Re-exported so this module's public
 * import path is unchanged for every existing consumer.
 */
export { SCHOLAR_REGISTRY_RUNTIME_ID, SCHOLAR_RUNTIME_ID };

export const SCHOLAR_VERTICALS = [
  "admin",
  "teacher",
  "parent",
  "bursar",
  "driver",
  "hq",
  "runtime",
] as const;

export type ScholarVertical = (typeof SCHOLAR_VERTICALS)[number];

export interface ScholarVerticalBinding {
  vertical: ScholarVertical;
  /** Kernel capability consumed (must be registered and Scholar-consumed). */
  capability: string;
  /** Repo-relative evidence paths (routes or runtime modules) that realize it. */
  evidence: readonly string[];
}

/**
 * Bindings cite runtime/domain modules. Hardcoded portal routes were removed;
 * the suite fails if a cited evidence file vanishes.
 */
export const SCHOLAR_VERTICAL_BINDINGS: readonly ScholarVerticalBinding[] = [
  {
    vertical: "admin",
    capability: "education-reality-ontology",
    evidence: [
      "frontend/src/lib/runtime/scholar-reality.ts",
      "frontend/src/lib/education-reality-view.ts",
    ],
  },
  {
    vertical: "admin",
    capability: "communication-messaging",
    evidence: ["frontend/src/lib/communication-core.ts", "frontend/src/lib/communication-channels.ts"],
  },
  {
    vertical: "teacher",
    capability: "communication-messaging",
    evidence: ["frontend/src/lib/communication-templates.ts"],
  },
  {
    vertical: "parent",
    capability: "communication-messaging",
    evidence: ["frontend/src/lib/communication-conversation.ts"],
  },
  {
    vertical: "admin",
    capability: "academic-intelligence",
    evidence: ["frontend/src/lib/academic-intelligence-report.ts", "frontend/src/lib/academic-assessment.ts"],
  },
  {
    vertical: "teacher",
    capability: "academic-intelligence",
    evidence: ["frontend/src/lib/education-assessment.ts"],
  },
  {
    vertical: "parent",
    capability: "academic-intelligence",
    evidence: ["frontend/src/lib/academic-mastery.ts"],
  },
  {
    vertical: "admin",
    capability: "scheduling",
    evidence: ["frontend/src/lib/scheduling-core.ts", "frontend/src/lib/scheduling-conflicts.ts"],
  },
  {
    vertical: "teacher",
    capability: "scheduling",
    evidence: ["frontend/src/lib/scheduling-availability.ts"],
  },
  {
    vertical: "parent",
    capability: "scheduling",
    evidence: ["frontend/src/lib/scheduling-quality.ts"],
  },
  {
    vertical: "bursar",
    capability: "financial-ledger",
    evidence: [
      "frontend/src/lib/runtime/scholar-fee-lifecycle.ts",
      "frontend/src/lib/financial-journal.ts",
    ],
  },
  {
    vertical: "admin",
    capability: "financial-ledger",
    evidence: ["frontend/src/lib/financial-intelligence-report.ts", "frontend/src/lib/financial-core.ts"],
  },
  {
    vertical: "parent",
    capability: "financial-ledger",
    evidence: ["frontend/src/lib/financial-payments.ts"],
  },
  {
    vertical: "admin",
    capability: "hardware-device-telemetry",
    evidence: ["frontend/src/lib/hardware-telemetry.ts", "frontend/src/lib/hardware-core.ts"],
  },
  {
    vertical: "driver",
    capability: "hardware-device-telemetry",
    evidence: ["frontend/src/lib/hardware-lifecycle.ts"],
  },
  {
    vertical: "parent",
    capability: "hardware-device-telemetry",
    evidence: ["frontend/src/lib/hardware-commands.ts"],
  },
  {
    vertical: "admin",
    capability: "live-digital-twin",
    evidence: [
      "frontend/src/lib/runtime/scholar-facility-twin.ts",
      "frontend/src/lib/education-facilities.ts",
    ],
  },
  {
    vertical: "runtime",
    capability: "automation-workflow-runtime",
    evidence: [
      "frontend/src/lib/runtime/scholar-automation-policy.ts",
      "frontend/src/lib/automation-governance.ts",
    ],
  },
  {
    vertical: "admin",
    capability: "analytics-decision-intelligence",
    evidence: ["frontend/src/lib/academic-intelligence-report.ts"],
  },
  {
    vertical: "hq",
    capability: "analytics-decision-intelligence",
    evidence: ["frontend/src/lib/data-platform-report.ts"],
  },
  {
    vertical: "hq",
    capability: "government-sovereign-deployments",
    evidence: ["frontend/src/lib/government-core.ts", "frontend/src/lib/government-governance.ts"],
  },
  {
    vertical: "admin",
    capability: "onboarding-workforce-identity",
    evidence: [
      "frontend/src/lib/runtime/scholar-workforce.ts",
      "frontend/src/lib/runtime/scholar/workforce-positions.functions.ts",
    ],
  },
  {
    vertical: "runtime",
    capability: "mobile-client-platform",
    evidence: [
      "frontend/src/lib/platform-device.ts",
      "frontend/src/lib/platform/platform-targets.ts",
      "frontend/src/lib/scholar/device-context.ts",
    ],
  },
  {
    vertical: "runtime",
    capability: "web-client-platform",
    evidence: ["frontend/src/lib/web-platform.ts", "frontend/src/routes/__root.tsx"],
  },
] as const;

/* ─────────────────────────────────────────────────────────────
 * Derived rows, summary and validation
 * ────────────────────────────────────────────────────────────*/

export interface ScholarVerticalBindingRow {
  vertical: ScholarVertical;
  capability: string;
  /** Owner phase of the capability, from the kernel registry (never restated). */
  phase: string;
  /** Canonical phase name (PROGRESS §11 authority via the phase catalog). */
  phaseName: string;
  evidence: readonly string[];
}

export interface ScholarVerticalBindingSummary {
  /** Contract-chain runtime id (what the 51 contracts declare). */
  runtime: string;
  /** Ledger row id for the same runtime in architecture/registry.json. */
  registryRuntimeId: string;
  /** Verticals that actually realize a binding. */
  verticals: readonly ScholarVertical[];
  consumedCapabilities: readonly string[];
  boundCapabilities: readonly string[];
  /** Consumed capabilities with no vertical bound — must be empty. */
  unboundCapabilities: readonly string[];
  evidenceCount: number;
  byVertical: ReadonlyArray<{ vertical: ScholarVertical; capabilities: readonly string[] }>;
  rows: readonly ScholarVerticalBindingRow[];
}

export function scholarVerticalBindingRows(
  bindings: readonly ScholarVerticalBinding[] = SCHOLAR_VERTICAL_BINDINGS,
): ScholarVerticalBindingRow[] {
  return bindings.map((binding) => {
    const capability = kernelCapabilityById(binding.capability);
    const phase = capability?.ownerPhase ?? "(unowned)";
    // The name is resolved through the contract chain (never a second catalog),
    // so a phase rename cannot desynchronise this view (ADR 202).
    const contract = phaseContractById(phase);
    return {
      vertical: binding.vertical,
      capability: binding.capability,
      phase,
      phaseName: contract?.name ?? "(unauthored contract)",
      evidence: binding.evidence,
    };
  });
}

export function scholarVerticalBindingSummary(
  bindings: readonly ScholarVerticalBinding[] = SCHOLAR_VERTICAL_BINDINGS,
): ScholarVerticalBindingSummary {
  const rows = scholarVerticalBindingRows(bindings);
  const consumed = scholarConsumedKernelCapabilities().map((capability) => capability.id);
  const bound = [...new Set(rows.map((row) => row.capability))];
  return {
    runtime: SCHOLAR_RUNTIME_ID,
    registryRuntimeId: SCHOLAR_REGISTRY_RUNTIME_ID,
    verticals: SCHOLAR_VERTICALS.filter((vertical) =>
      rows.some((row) => row.vertical === vertical),
    ),
    consumedCapabilities: consumed,
    boundCapabilities: bound,
    unboundCapabilities: consumed.filter((id) => !bound.includes(id)),
    evidenceCount: rows.reduce((total, row) => total + row.evidence.length, 0),
    byVertical: SCHOLAR_VERTICALS.map((vertical) => ({
      vertical,
      capabilities: [
        ...new Set(rows.filter((row) => row.vertical === vertical).map((row) => row.capability)),
      ],
    })).filter((entry) => entry.capabilities.length > 0),
    rows,
  };
}

export interface ScholarBindingValidation {
  ok: boolean;
  issues: readonly string[];
}

/**
 * Validate the binding map against the kernel registries. Pure: evidence path
 * existence is asserted by the suite (filesystem), not here.
 */
export function validateScholarVerticalBindings(
  bindings: readonly ScholarVerticalBinding[] = SCHOLAR_VERTICAL_BINDINGS,
): ScholarBindingValidation {
  const issues: string[] = [];
  const registered = new Set(KERNEL_CAPABILITIES.map((capability) => capability.id));
  const consumed = new Set(scholarConsumedKernelCapabilities().map((capability) => capability.id));
  const verticals = new Set<string>(SCHOLAR_VERTICALS);
  const seen = new Set<string>();
  const boundCapabilities = new Set<string>();

  if (bindings.length === 0) issues.push("the binding map is empty");

  for (const binding of bindings) {
    if (!verticals.has(binding.vertical)) {
      issues.push(`unknown vertical "${binding.vertical}"`);
    }
    if (!registered.has(binding.capability)) {
      issues.push(`capability "${binding.capability}" is not registered in the kernel`);
    }
    if (!consumed.has(binding.capability)) {
      issues.push(`capability "${binding.capability}" is not consumed by Scholar`);
    }

    const pair = `${binding.vertical}:${binding.capability}`;
    if (seen.has(pair)) issues.push(`duplicate binding ${pair}`);
    seen.add(pair);
    boundCapabilities.add(binding.capability);

    if (binding.evidence.length === 0) {
      issues.push(`binding ${pair} cites no evidence`);
    }
    for (const path of binding.evidence) {
      if (!path.startsWith("frontend/src/")) {
        issues.push(`binding ${pair} cites evidence outside frontend/src: ${path}`);
      }
    }
  }

  for (const vertical of SCHOLAR_VERTICALS) {
    if (!bindings.some((binding) => binding.vertical === vertical)) {
      issues.push(`vertical "${vertical}" has no binding`);
    }
  }
  for (const capability of consumed) {
    if (!boundCapabilities.has(capability)) {
      issues.push(`consumed capability "${capability}" is bound to no vertical`);
    }
  }

  return { ok: issues.length === 0, issues };
}
