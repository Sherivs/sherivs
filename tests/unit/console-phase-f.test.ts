import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  authorizedConsoleMetrics,
  authorizedMetricContracts,
  CONSOLE_METRIC_CONTRACTS,
} from "@/lib/internal-console/metrics";
import {
  CONSOLE_HEALTH_LABELS,
  CONSOLE_HEALTH_STATES,
  mapProcessHealth,
  overallFromCards,
} from "@/lib/internal-console/status";
import { writeAuditRecord, type WriteAuditClient } from "@/lib/server/write-audit";

describe("console metric authorization", () => {
  it("fails closed for metric values and contract metadata without the named capability", () => {
    const capabilities = new Set(["platform.engineering.read"]);
    const metrics = [
      { key: "uptime", value: "30" },
      { key: "subscription-ledger", value: "2" },
      { key: "unregistered-metric", value: "9" },
    ];

    expect(authorizedConsoleMetrics(metrics, capabilities)).toEqual([metrics[0]]);
    expect(authorizedMetricContracts(capabilities).map((contract) => contract.key)).toContain(
      "uptime",
    );
    expect(authorizedMetricContracts(capabilities).map((contract) => contract.key)).not.toContain(
      "subscription-ledger",
    );
    expect(authorizedMetricContracts(new Set())).toEqual([]);
  });

  it("defines source, calculation, range, units, freshness, and authorization for each metric", () => {
    for (const contract of CONSOLE_METRIC_CONTRACTS) {
      expect(contract.definition).toBeTruthy();
      expect(contract.source).toBeTruthy();
      expect(contract.calculation).toBeTruthy();
      expect(contract.window).toBeTruthy();
      expect(contract.unit).toBeTruthy();
      expect(contract.freshness).toBeTruthy();
      expect(contract.authorization).toBeTruthy();
    }

    const activeUsers = CONSOLE_METRIC_CONTRACTS.find(
      (contract) => contract.key === "active-users-30d",
    );
    expect(activeUsers?.source).toContain("last_sign_in_at");
    expect(activeUsers?.definition).toContain("Account creation alone is not activity");
  });

  it("applies the same metric authorization to every synthetic workspace persona", async () => {
    const { buildConsoleVisualFixtureOverview, CONSOLE_FIXTURE_PERSONAS } =
      await import("@/lib/internal-console/visual-fixture");
    for (const persona of CONSOLE_FIXTURE_PERSONAS) {
      const overview = buildConsoleVisualFixtureOverview(persona);
      const authorizedKeys = new Set(
        authorizedMetricContracts(new Set(overview.viewer.capabilities)).map(
          (contract) => contract.key,
        ),
      );
      expect(overview.metrics.every((metric) => authorizedKeys.has(metric.key))).toBe(true);
    }
  });
});

describe("console health vocabulary", () => {
  it("uses only the five declared health states and preserves unknown signals", () => {
    expect(CONSOLE_HEALTH_STATES).toEqual([
      "healthy",
      "degraded",
      "unavailable",
      "unknown",
      "not-configured",
    ]);
    expect(CONSOLE_HEALTH_LABELS["not-configured"]).toBe("Not configured");
    expect(mapProcessHealth("ok")).toBe("healthy");
    expect(mapProcessHealth("degraded")).toBe("degraded");
    expect(mapProcessHealth("failing")).toBe("unavailable");
    expect(mapProcessHealth(undefined)).toBe("unknown");
    expect(overallFromCards(["unknown", "not-configured"])).toBe("unknown");
    expect(overallFromCards(["healthy", "not-configured"])).toBe("degraded");
  });
});

describe("shared append-only audit contract", () => {
  it("persists actor kind, correlation id, and explicit before/after values", async () => {
    const captured: { payload?: Record<string, unknown> } = {};
    const client: WriteAuditClient = {
      from(table) {
        expect(table).toBe("audit_logs");
        return {
          insert: async (payload) => {
            captured.payload = payload;
            return { error: null };
          },
        };
      },
    };

    await writeAuditRecord(client, {
      action: "agent.proposal.created",
      gate: "governed-tool:proposal.create",
      tenantId: null,
      actorId: null,
      actorKind: "agent",
      actorRef: "workspace-agent:operations",
      table: "platform_organization",
      recordId: "00000000-0000-4000-8000-000000000001",
      outcome: "succeeded",
      correlationId: "phase-f-correlation-1",
      before: { lifecycle_state: "under_review" },
      after: { proposed_lifecycle_state: "active", requires_human_approval: true },
    });

    expect(captured.payload?.old_value).toEqual({ lifecycle_state: "under_review" });
    expect(captured.payload?.new_value).toEqual(
      expect.objectContaining({
        actor_kind: "agent",
        actor_ref: "workspace-agent:operations",
        correlation_id: "phase-f-correlation-1",
        outcome: "succeeded",
        after: { proposed_lifecycle_state: "active", requires_human_approval: true },
      }),
    );
  });

  it("keeps the existing audit table append-only and includes behavioral UPDATE/DELETE proofs", () => {
    const migration = readFileSync(
      "database/supabase/migrations/20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql",
      "utf8",
    );
    const sqlTest = readFileSync("tests/sql/console-audit-append-only.sql", "utf8");

    expect(migration).toMatch(
      /CREATE TRIGGER trg_audit_logs_append_only BEFORE UPDATE OR DELETE ON public\.audit_logs/,
    );
    expect(migration).toContain("REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs");
    expect(sqlTest).toContain("UPDATE public.audit_logs");
    expect(sqlTest).toContain("DELETE FROM public.audit_logs");
    expect(sqlTest.match(/EXCEPTION WHEN insufficient_privilege/g)).toHaveLength(2);
  });
});
