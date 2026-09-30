/**
 * CoreGrid Scholar — Phase 15 Hardware Integration Platform unit tests
 * (hardware-telemetry).
 *
 * Validates:
 * - Telemetry contract (Z) with event vs ingestion time (AB).
 * - Sensor data validation (AE): finite value, unit, physical range,
 *   timestamp integrity, clock drift.
 * - Anomaly detection (AF): impossible values, sudden spikes, stuck
 *   sensors, missing data, unusual frequency — raw telemetry preserved.
 * - Calibration (AD) and quality grading (AC): STALE / INVALID /
 *   CALIBRATION_REQUIRED never silently upgraded.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  validateTelemetry,
  detectTelemetryAnomalies,
  evaluateCalibrationStatus,
  gradeTelemetry,
  type RawTelemetry,
} from "@/lib/hardware-telemetry";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

function telemetry(
  overrides: Partial<Omit<RawTelemetry, "quality">> = {},
): Omit<RawTelemetry, "quality"> {
  return {
    deviceId: "device-1",
    tenantId: TENANT_A,
    type: "temperature",
    value: 22.5,
    unit: "celsius",
    eventTime: "2025-12-31T23:59:00Z",
    ingestionTime: NOW,
    firmwareVersion: "1.0.0",
    gatewayId: "gw-1",
    locationReference: "Room 101",
    raw: overrides.raw ?? 22.5,
    ...overrides,
  };
}

describe("Telemetry validation (AE)", () => {
  it("accepts a plausible sample within its physical range", () => {
    const result = validateTelemetry({
      telemetry: telemetry(),
      expectedUnit: "celsius",
      range: { min: -40, max: 85 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.telemetry.quality).toBe("VALID");
      // Raw value preserved verbatim.
      expect(result.telemetry.raw).toBe(22.5);
    }
  });

  it("rejects a non-finite value", () => {
    const result = validateTelemetry({ telemetry: telemetry({ value: Number.NaN }) });
    expect(result.ok).toBe(false);
  });

  it("rejects a value whose unit mismatches the device expectation", () => {
    const result = validateTelemetry({
      telemetry: telemetry({ unit: "fahrenheit" }),
      expectedUnit: "celsius",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a value outside the physical range", () => {
    const result = validateTelemetry({
      telemetry: telemetry({ value: 300 }),
      range: { min: -40, max: 85 },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an event timestamp in the future (clock drift / AB)", () => {
    const result = validateTelemetry({
      telemetry: telemetry({ eventTime: "2026-02-01T00:00:00Z" }),
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an unparseable event timestamp", () => {
    const result = validateTelemetry({ telemetry: telemetry({ eventTime: "not-a-date" }) });
    expect(result.ok).toBe(false);
  });
});

describe("Anomaly detection (AF)", () => {
  it("flags an impossible value outside the physical range", () => {
    const anomalies = detectTelemetryAnomalies({
      value: 900,
      previousValue: 22,
      range: { min: -40, max: 85 },
      spikeThreshold: 3,
      stuckThreshold: 4,
      recentValues: [22, 23, 21],
      expectedSamples: 3,
    });
    expect(anomalies.some((a) => a.type === "impossible_value")).toBe(true);
  });

  it("flags a sudden spike beyond the tolerance", () => {
    const anomalies = detectTelemetryAnomalies({
      value: 200,
      previousValue: 22,
      range: { min: -40, max: 85 },
      spikeThreshold: 3,
      stuckThreshold: 4,
      recentValues: [22, 23, 21],
      expectedSamples: 3,
    });
    expect(anomalies.some((a) => a.type === "sudden_spike")).toBe(true);
  });

  it("does not flag a normal variation", () => {
    const anomalies = detectTelemetryAnomalies({
      value: 23,
      previousValue: 22,
      range: { min: -40, max: 85 },
      spikeThreshold: 3,
      stuckThreshold: 4,
      recentValues: [22, 23, 21],
      expectedSamples: 3,
    });
    expect(anomalies).toHaveLength(0);
  });

  it("flags a stuck sensor returning the same value repeatedly", () => {
    const anomalies = detectTelemetryAnomalies({
      value: 22,
      previousValue: 22,
      range: { min: -40, max: 85 },
      spikeThreshold: 3,
      stuckThreshold: 4,
      recentValues: [22, 22, 22, 22],
      expectedSamples: 4,
    });
    expect(anomalies.some((a) => a.type === "stuck_sensor")).toBe(true);
  });

  it("flags missing data when the window is short", () => {
    const anomalies = detectTelemetryAnomalies({
      value: 22,
      previousValue: null,
      range: { min: -40, max: 85 },
      spikeThreshold: 3,
      stuckThreshold: 4,
      recentValues: [22],
      expectedSamples: 10,
    });
    expect(anomalies.some((a) => a.type === "missing_data")).toBe(true);
  });

  it("flags unusual frequency when samples exceed expectations by 2x", () => {
    const anomalies = detectTelemetryAnomalies({
      value: 22,
      previousValue: 21,
      range: { min: -40, max: 85 },
      spikeThreshold: 3,
      stuckThreshold: 4,
      recentValues: [22, 22, 22, 22, 22, 22, 22],
      expectedSamples: 3,
    });
    expect(anomalies.some((a) => a.type === "unusual_frequency")).toBe(true);
  });
});

describe("Calibration (AD)", () => {
  it("marks a calibration without an expiry as REQUIRED", () => {
    const result = evaluateCalibrationStatus(
      {
        sensorId: "sensor-1",
        calibrationDate: "2025-01-01T00:00:00Z",
        calibrationSource: "vendor",
        calibrationVersion: "v1",
        calibrationExpiry: null,
      },
      NOW,
    );
    expect(result.calibrationStatus).toBe("REQUIRED");
  });

  it("marks an expired calibration as EXPIRED", () => {
    const result = evaluateCalibrationStatus(
      {
        sensorId: "sensor-1",
        calibrationDate: "2025-01-01T00:00:00Z",
        calibrationSource: "vendor",
        calibrationVersion: "v1",
        calibrationExpiry: "2025-06-01T00:00:00Z",
      },
      NOW,
    );
    expect(result.calibrationStatus).toBe("EXPIRED");
  });

  it("marks a current calibration as OK", () => {
    const result = evaluateCalibrationStatus(
      {
        sensorId: "sensor-1",
        calibrationDate: "2025-01-01T00:00:00Z",
        calibrationSource: "vendor",
        calibrationVersion: "v1",
        calibrationExpiry: "2026-12-01T00:00:00Z",
      },
      NOW,
    );
    expect(result.calibrationStatus).toBe("OK");
  });

  it("marks a calibration approaching expiry as DUE", () => {
    const result = evaluateCalibrationStatus(
      {
        sensorId: "sensor-1",
        calibrationDate: "2025-01-01T00:00:00Z",
        calibrationSource: "vendor",
        calibrationVersion: "v1",
        calibrationExpiry: "2026-01-02T00:00:00Z",
      },
      NOW,
    );
    expect(result.calibrationStatus).toBe("DUE");
  });
});

describe("Telemetry quality grading (AC)", () => {
  it("grades a fresh sample with valid calibration as VALID", () => {
    const t = gradeTelemetry({
      telemetry: telemetry(),
      now: NOW,
      maxEventAgeMs: 60_000,
      calibrationStatus: "OK",
    });
    expect(t.quality).toBe("VALID");
  });

  it("grades a stale event as STALE — never silently trusted", () => {
    const t = gradeTelemetry({
      telemetry: telemetry({ eventTime: "2020-01-01T00:00:00Z" }),
      now: NOW,
      maxEventAgeMs: 60_000,
      calibrationStatus: "OK",
    });
    expect(t.quality).toBe("STALE");
  });

  it("grades a missing event timestamp as STALE (AB: missing timestamps accounted for)", () => {
    const t = gradeTelemetry({
      telemetry: telemetry({ eventTime: null }),
      now: NOW,
      maxEventAgeMs: 60_000,
      calibrationStatus: "OK",
    });
    expect(t.quality).toBe("STALE");
  });

  it("grades telemetry from an expired calibration as CALIBRATION_REQUIRED", () => {
    const t = gradeTelemetry({
      telemetry: telemetry(),
      now: NOW,
      maxEventAgeMs: 60_000,
      calibrationStatus: "EXPIRED",
    });
    expect(t.quality).toBe("CALIBRATION_REQUIRED");
  });
});
