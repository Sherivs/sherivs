/**
 * CoreGrid Scholar — Phase 12 Scheduling & Timetable Intelligence unit tests
 * (scheduling-availability).
 *
 * Validates:
 * - Availability window creation (L, M).
 * - Availability resolution: mandatory > unavailable > preferred > allowed.
 * - External availability is not automatically authoritative (M).
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  createAvailabilityWindow,
  resolveAvailability,
  isExternalAvailabilityAuthoritative,
  type AvailabilityWindow,
} from "@/lib/scheduling-availability";
import type { TimeInterval } from "@/lib/scheduling-core";

const TENANT_A = tenantId("tenant-a");

const INTERVAL_A: TimeInterval = {
  start: "2026-01-01T08:00:00Z",
  end: "2026-01-01T09:00:00Z",
  timezone: "UTC",
};
const INTERVAL_B: TimeInterval = {
  start: "2026-01-01T08:30:00Z",
  end: "2026-01-01T09:30:00Z",
  timezone: "UTC",
};
const INTERVAL_C: TimeInterval = {
  start: "2026-01-01T10:00:00Z",
  end: "2026-01-01T11:00:00Z",
  timezone: "UTC",
};

function makeWindow(overrides: Partial<AvailabilityWindow> = {}): AvailabilityWindow {
  const created = createAvailabilityWindow({
    entityId: "teacher-1",
    tenantId: TENANT_A,
    entityType: "instructor",
    state: "allowed",
    interval: INTERVAL_A,
    source: "configuration",
  });
  if (!created.ok) throw new Error("fixture failed");
  return { ...created.window, ...overrides };
}

describe("createAvailabilityWindow (L, M)", () => {
  it("creates an availability window with provenance", () => {
    const window = makeWindow({ state: "preferred" });
    expect(window.state).toBe("preferred");
    expect(window.source).toBe("configuration");
  });

  it("rejects an empty entity or source", () => {
    expect(
      createAvailabilityWindow({
        entityId: "",
        tenantId: TENANT_A,
        entityType: "instructor",
        state: "allowed",
        interval: INTERVAL_A,
        source: "configuration",
      }).ok,
    ).toBe(false);

    expect(
      createAvailabilityWindow({
        entityId: "teacher-1",
        tenantId: TENANT_A,
        entityType: "instructor",
        state: "allowed",
        interval: INTERVAL_A,
        source: "",
      }).ok,
    ).toBe(false);
  });
});

describe("resolveAvailability (L)", () => {
  it("reports unavailable when no window covers the interval", () => {
    const verdict = resolveAvailability([makeWindow()], "teacher-1", TENANT_A, INTERVAL_C);
    expect(verdict.verdict).toBe("unavailable");
  });

  it("allows an allowed window", () => {
    const verdict = resolveAvailability(
      [makeWindow({ state: "allowed" })],
      "teacher-1",
      TENANT_A,
      INTERVAL_B,
    );
    expect(verdict.verdict).toBe("available");
    if (verdict.verdict === "available") {
      expect(verdict.state).toBe("allowed");
    }
  });

  it("blocks an unavailable window regardless of allowed windows", () => {
    const windows = [
      makeWindow({ state: "allowed", interval: INTERVAL_A }),
      makeWindow({ state: "unavailable", interval: INTERVAL_B, source: "maintenance" }),
    ];
    const verdict = resolveAvailability(windows, "teacher-1", TENANT_A, INTERVAL_B);
    expect(verdict.verdict).toBe("unavailable");
  });

  it("a mandatory window overrides an unavailable window", () => {
    const windows = [
      makeWindow({ state: "unavailable", interval: INTERVAL_B, source: "leave" }),
      makeWindow({ state: "mandatory", interval: INTERVAL_A, source: "academic" }),
    ];
    const verdict = resolveAvailability(windows, "teacher-1", TENANT_A, INTERVAL_B);
    expect(verdict.verdict).toBe("available");
    if (verdict.verdict === "available") {
      expect(verdict.state).toBe("mandatory");
    }
  });
});

describe("isExternalAvailabilityAuthoritative (M)", () => {
  it("treats external availability as non-authoritative until verified", () => {
    const external = makeWindow({ source: "external" });
    expect(isExternalAvailabilityAuthoritative(external, false)).toBe(false);
    expect(isExternalAvailabilityAuthoritative(external, true)).toBe(true);
  });

  it("treats internal sources as authoritative", () => {
    const internal = makeWindow({ source: "institutional policy" });
    expect(isExternalAvailabilityAuthoritative(internal, false)).toBe(true);
  });
});
