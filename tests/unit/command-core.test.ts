/**
 * CoreGrid Scholar — Phase 19 Institutional Command Centre unit tests
 * (command-core).
 *
 * Validates:
 * - Institutional state (I): UNKNOWN remains distinct from healthy.
 * - Command context (L) completeness and multi-tenant isolation (M).
 * - Dashboard system (P, Q): versioned presentation surfaces, component
 *   authorization.
 * - Live view and stale data (V, W, X): never make old data appear live.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  isInstitutionalStateHealthy,
  isCommandStateStale,
  isCommandAccessWithinTenant,
  isCommandContextComplete,
  createDashboard,
  isDashboardComponentAuthorized,
  gradeLiveViewStatus,
  type CommandContext,
} from "@/lib/command-core";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");
const NOW = "2026-01-01T00:00:00Z";

function context(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    tenantId: TENANT_A,
    institutionId: "inst-1",
    userId: "user-1",
    role: "principal",
    permissions: ["view-alerts", "approve-decisions"],
    selectedCampus: null,
    selectedPeriod: "term-1",
    selectedOperationalScope: null,
    ...overrides,
  };
}

describe("Institutional state (I)", () => {
  it("treats UNKNOWN as never healthy", () => {
    expect(
      isInstitutionalStateHealthy({
        institutionId: "inst-1",
        tenantId: TENANT_A,
        status: "HEALTHY",
        asOf: NOW,
        freshness: 60_000,
        source: "twin",
      }),
    ).toBe(true);
    expect(
      isInstitutionalStateHealthy({
        institutionId: "inst-1",
        tenantId: TENANT_A,
        status: "UNKNOWN",
        asOf: NOW,
        freshness: 60_000,
        source: "twin",
      }),
    ).toBe(false);
  });

  it("marks stale state when freshness is exceeded", () => {
    expect(isCommandStateStale({ asOf: "2025-01-01T00:00:00Z", freshness: 60_000 }, NOW)).toBe(
      true,
    );
    expect(isCommandStateStale({ asOf: "2025-12-31T23:59:50Z", freshness: 60_000 }, NOW)).toBe(
      false,
    );
  });
});

describe("Command context and tenant isolation (L, M)", () => {
  it("requires a complete command context", () => {
    expect(isCommandContextComplete(context())).toBe(true);
    expect(isCommandContextComplete(context({ permissions: [] }))).toBe(false);
    expect(isCommandContextComplete(context({ role: "" }))).toBe(false);
  });

  it("denies cross-tenant command access without an explicit grant (M, DW)", () => {
    expect(isCommandAccessWithinTenant(context(), TENANT_A, false).allowed).toBe(true);
    expect(isCommandAccessWithinTenant(context(), TENANT_B, false).allowed).toBe(false);
    expect(isCommandAccessWithinTenant(context(), TENANT_B, true).allowed).toBe(true);
  });
});

describe("Dashboard system (P, Q)", () => {
  it("creates a versioned dashboard with components", () => {
    const result = createDashboard({
      dashboardId: "dash-1",
      name: "Executive",
      template: "executive",
      tenantId: TENANT_A,
      components: [
        {
          componentId: "kpi-cards",
          source: "analytics",
          dataContract: "kpi-v1",
          permissions: ["view-kpis"],
          refreshPolicyMs: 30_000,
          renderingConfig: {},
          version: 1,
        },
      ],
      layout: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dashboard.version).toBe(1);
    }
  });

  it("rejects a dashboard without components", () => {
    expect(
      createDashboard({
        dashboardId: "dash-1",
        name: "Empty",
        template: "executive",
        tenantId: TENANT_A,
        components: [],
        layout: {},
      }).ok,
    ).toBe(false);
  });

  it("authorizes components against the user's permissions", () => {
    const component = {
      componentId: "c1",
      source: "s",
      dataContract: "d",
      permissions: ["view-kpis"],
      refreshPolicyMs: null,
      renderingConfig: {},
      version: 1,
    };
    expect(isDashboardComponentAuthorized(component, ["view-kpis", "view-alerts"])).toBe(true);
    expect(isDashboardComponentAuthorized(component, ["view-alerts"])).toBe(false);
  });
});

describe("Live view and stale data (V, W, X)", () => {
  it("grades live, stale and unknown views", () => {
    expect(
      gradeLiveViewStatus(
        { lastUpdate: "2025-12-31T23:59:50Z", freshness: 60_000, source: "twin", confidence: 0.9 },
        NOW,
      ),
    ).toBe("live");
    expect(
      gradeLiveViewStatus(
        { lastUpdate: "2025-01-01T00:00:00Z", freshness: 60_000, source: "twin", confidence: 0.9 },
        NOW,
      ),
    ).toBe("stale");
    expect(
      gradeLiveViewStatus(
        { lastUpdate: "", freshness: null, source: "twin", confidence: null },
        NOW,
      ),
    ).toBe("unknown");
  });
});
