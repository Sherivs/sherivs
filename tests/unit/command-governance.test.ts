/**
 * CoreGrid Scholar — Phase 19 Institutional Command Centre unit tests
 * (command-governance).
 *
 * Validates:
 * - Event normalization/provenance (DB, DC), ordering (DD) and
 *   deduplication (DE).
 * - Read-model freshness (DI) and cache invalidation (DK).
 * - Command security (DO-DW): minimum necessary view, break-glass access.
 * - AI-assisted briefing (ED-EF): grounded output, confidence bounds.
 * - Action verification (EM) and rollback display (EN).
 * - Degraded/read-only modes, recovery reconciliation (FD, FE, FJ).
 * - Command audit (DN): high-impact events flagged.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  isCommandEventSequenceInOrder,
  isDuplicateCommandEvent,
  correlateCommandEvents,
  isReadModelFresh,
  isCommandCacheValid,
  authorizeCommandView,
  isBreakGlassAccessValid,
  createAIBriefing,
  verifyCommandActionResult,
  isRollbackDisplayable,
  isCommandReconciled,
  isCommandReadOnly,
  isHighImpactAudit,
  type CommandEvent,
} from "@/lib/command-governance";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");
const NOW = "2026-01-01T00:00:00Z";

function event(overrides: Partial<CommandEvent> = {}): CommandEvent {
  return {
    eventId: "evt-1",
    tenantId: TENANT_A,
    type: "incident.detected",
    schemaVersion: "1",
    timestamp: NOW,
    source: "command",
    sourceId: "inc-1",
    correlationId: "corr-1",
    causationId: null,
    sequence: 1,
    payload: {},
    ...overrides,
  };
}

describe("Command events (DB, DC, DD, DE)", () => {
  it("preserves ordering by sequence number (DD)", () => {
    expect(
      isCommandEventSequenceInOrder([
        event({ sequence: 1 }),
        event({ eventId: "e2", sequence: 2 }),
        event({ eventId: "e3", sequence: 3 }),
      ]),
    ).toBe(true);
    expect(
      isCommandEventSequenceInOrder([
        event({ sequence: 3 }),
        event({ eventId: "e2", sequence: 1 }),
      ]),
    ).toBe(false);
  });

  it("deduplicates duplicate events (DE)", () => {
    expect(isDuplicateCommandEvent(new Set(["evt-1"]), event())).toBe(true);
    expect(isDuplicateCommandEvent(new Set(["evt-1"]), event({ eventId: "evt-2" }))).toBe(false);
  });

  it("correlates events by correlation ID (DF)", () => {
    const groups = correlateCommandEvents([event(), event({ eventId: "e2", sequence: 2 })]);
    expect(groups.get("corr-1")?.length).toBe(2);
  });
});

describe("Read models and cache (DI, DK)", () => {
  it("exposes read-model freshness (DI)", () => {
    expect(
      isReadModelFresh(
        {
          readModelId: "rm-1",
          tenantId: TENANT_A,
          view: "alerts",
          asOf: "2025-12-31T23:59:50Z",
          freshness: 60_000,
        },
        NOW,
      ),
    ).toBe(true);
    expect(
      isReadModelFresh(
        {
          readModelId: "rm-1",
          tenantId: TENANT_A,
          view: "alerts",
          asOf: "2025-01-01T00:00:00Z",
          freshness: 60_000,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("invalidates caches by key and TTL (DK)", () => {
    const entry = {
      key: "dash-1",
      value: {},
      version: 1,
      cachedAt: "2025-12-31T23:59:50Z",
      ttlMs: 60_000,
    };
    expect(isCommandCacheValid(entry, NOW, new Set())).toBe(true);
    expect(isCommandCacheValid(entry, NOW, new Set(["dash-1"]))).toBe(false);
    expect(
      isCommandCacheValid({ ...entry, cachedAt: "2025-01-01T00:00:00Z" }, NOW, new Set()),
    ).toBe(false);
  });
});

describe("Command security (DO, DW, DY)", () => {
  it("enforces minimum necessary view with tenant isolation (DW, DY)", () => {
    const context = {
      tenantId: TENANT_A,
      role: "principal",
      permissions: ["view-incidents"],
      privilegedSession: false,
      emergencyGranted: false,
    };
    expect(
      authorizeCommandView(context, TENANT_A, "view-incidents", ["principal", "admin"]).allowed,
    ).toBe(true);
    expect(authorizeCommandView(context, TENANT_B, "view-incidents", ["principal"]).allowed).toBe(
      false,
    );
    expect(authorizeCommandView(context, TENANT_A, "view-payroll", ["principal"]).allowed).toBe(
      false,
    );
    expect(
      authorizeCommandView({ ...context, role: "teacher" }, TENANT_A, "view-incidents", [
        "principal",
      ]).allowed,
    ).toBe(false);
  });

  it("validates break-glass access — justified, time-boxed (DU)", () => {
    const grant = {
      grantId: "g1",
      actor: "ops-1",
      tenantId: TENANT_A,
      grantedAt: NOW,
      expiresAt: "2026-01-02T00:00:00Z",
      justification: "payroll system down",
      reviewed: false,
    };
    expect(isBreakGlassAccessValid(grant, NOW)).toBe(true);
    expect(isBreakGlassAccessValid({ ...grant, justification: "" }, NOW)).toBe(false);
    expect(isBreakGlassAccessValid({ ...grant, expiresAt: "2025-01-01T00:00:00Z" }, NOW)).toBe(
      false,
    );
  });
});

describe("AI-assisted briefing (ED, EE, EF)", () => {
  it("requires grounded source evidence — hallucination control (EF)", () => {
    expect(
      createAIBriefing({
        briefingId: "b1",
        tenantId: TENANT_A,
        summary: "attendance down",
        evidenceRefs: [],
        confidence: 0.8,
        generatedAt: NOW,
      }).ok,
    ).toBe(false);
    expect(
      createAIBriefing({
        briefingId: "b1",
        tenantId: TENANT_A,
        summary: "attendance down",
        evidenceRefs: ["attendance-report"],
        confidence: 0.8,
        generatedAt: NOW,
      }).ok,
    ).toBe(true);
  });

  it("bounds AI confidence (EE)", () => {
    expect(
      createAIBriefing({
        briefingId: "b1",
        tenantId: TENANT_A,
        summary: "x",
        evidenceRefs: ["e"],
        confidence: 1.2,
        generatedAt: NOW,
      }).ok,
    ).toBe(false);
  });
});

describe("Action verification and rollback (EM, EN)", () => {
  it("never presents unverified actions as success (EM)", () => {
    const result = verifyCommandActionResult({
      actionId: "act-1",
      verified: false,
      detail: "twin still open",
    });
    expect(result.detail).toContain("UNVERIFIED");
  });

  it("displays rollback options only for failed/unknown states (EN)", () => {
    expect(isRollbackDisplayable("FAILED")).toBe(true);
    expect(isRollbackDisplayable("UNKNOWN")).toBe(true);
    expect(isRollbackDisplayable("SUCCEEDED")).toBe(false);
  });
});

describe("Degraded mode and recovery (FD, FE, FJ)", () => {
  it("supports read-only mode", () => {
    expect(isCommandReadOnly("read_only")).toBe(true);
    expect(isCommandReadOnly("normal")).toBe(false);
  });

  it("reconciles only when both source and command state are available (FJ)", () => {
    expect(
      isCommandReconciled({
        mode: "normal",
        sourceStateAvailable: true,
        commandStateAvailable: true,
        pendingActions: [],
      }),
    ).toBe(true);
    expect(
      isCommandReconciled({
        mode: "degraded",
        sourceStateAvailable: false,
        commandStateAvailable: true,
        pendingActions: ["act-1"],
      }),
    ).toBe(false);
  });
});

describe("Command audit (DN)", () => {
  it("flags high-impact audit records for enhanced treatment", () => {
    const base = {
      auditId: "a1",
      tenantId: TENANT_A,
      actor: "ops-1",
      at: NOW,
      correlationId: "c1",
      causationId: null,
      detail: "",
    };
    expect(isHighImpactAudit({ ...base, kind: "emergency_action" as const })).toBe(true);
    expect(isHighImpactAudit({ ...base, kind: "sensitive_view" as const })).toBe(false);
  });
});
