/**
 * Phase 29 — CoreGrid Integration contract (seeded authoring).
 *
 * Adapters and interoperability: register external systems, transform between
 * their shape and ours, run connections and govern what may be exchanged.
 */

import { definePhaseContractFromSeed } from "./define-phase";

export const PHASE_29_INTEGRATION = definePhaseContractFromSeed({
  id: "29",
  name: "CoreGrid Integration",
  phaseDoc: "architecture/phase-29-coregrid-integration.md",
  layer: "Runtime",
  stage: "S7",
  status: "implementing",
  owner: "29",
  capability: "integration-adapters",
  consumes: [
    "foundation-standards-config-secrets-ci",
    "tenancy-isolation-rls",
    "runtime-primitives",
    "data-platform",
    "security-enforcement",
  ],
  purpose:
    "Own interoperability: declare external systems, transform payloads between their model and Sherivs contracts, operate connections with retry and backoff, and govern exchange.",
  ownership:
    "Single owner of adapter registrations, transformation maps, connection records and integration operations policy.",
  boundaryStatement:
    "Integration owns exchange mechanics, never domain truth: an external system never writes canonical records directly, and adapters never leak one tenant's data to another exchange.",
  excludes: [
    "domain-record-ownership (owning phases)",
    "universal-interface-connectivity (phase 43)",
    "provider-sdks-outside-adapters",
  ],
  principle:
    "Every exchange is declared and reversible: adapters are versioned, transformations are testable, and an unknown payload is rejected rather than guessed.",
  dependsOn: ["01", "02", "03", "05", "14"],
  consumers: ["43"],
  substrates: ["adapter registrations", "transformation maps", "connection records"],
  tests: ["tests/unit/integration.test.ts"],
  provides: [
    { id: "integration:register-adapter", kind: "command", description: "register an adapter" },
    { id: "integration:transform", kind: "api", description: "transform a payload" },
    { id: "integration:connection-state", kind: "query", description: "read connection state" },
  ],
  consumesContracts: [
    { id: "runtime:record-event", kind: "event" },
    { id: "data:classify", kind: "api" },
  ],
  canonicalTruth: {
    owners: ["adapter registrations", "transformation maps", "connection records"],
    derived: ["sync projections", "integration health scores"],
  },
  requiresApprovalFor: ["adapter-activation", "credential-binding", "cross-tenant-exchange"],
  sections: {
    security:
      "Adapter credentials live in the adapter boundary and never in payloads or logs; exchanges are tenant-scoped, and inbound payloads are validated before any record is written.",
  },
});
