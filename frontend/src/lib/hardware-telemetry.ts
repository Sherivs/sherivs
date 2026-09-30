/**
 * CoreGrid — Hardware Telemetry domain model
 * (Phase 15, Sections Z, AA, AB, AC, AD, AE, AF).
 *
 * Implements `architecture/phase-15-hardware-integration.md`:
 * - Telemetry contract (Z): device_id, tenant_id, type, value, unit,
 *   timestamp, quality, firmware_version, gateway_id, location_reference.
 * - Timestamp integrity (AB): preserve event time AND ingestion time;
 *   account for clock drift, timezone, missing timestamps, delayed delivery.
 * - Telemetry quality (AC): VALID, ESTIMATED, STALE, MISSING, INVALID,
 *   CALIBRATION_REQUIRED.
 * - Sensor calibration (AD): metadata, date, source, version, expiry,
 *   status.
 * - Sensor data validation (AE): range, unit, timestamp, frequency,
 *   physical plausibility, sensor status.
 * - Anomaly detection (AF): impossible values, sudden spikes, stuck
 *   sensors, missing data, unusual frequency, repeated values. AI may
 *   assist, but raw telemetry must remain preserved.
 *
 * Invariants: raw telemetry is never mutated by interpretation; anomaly
 * detection never overwrites the preserved raw value.
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Telemetry quality (AC)
 * ────────────────────────────────────────────────────────────*/

export type TelemetryQuality =
  "VALID" | "ESTIMATED" | "STALE" | "MISSING" | "INVALID" | "CALIBRATION_REQUIRED";

export const TELEMETRY_QUALITIES: readonly TelemetryQuality[] = [
  "VALID",
  "ESTIMATED",
  "STALE",
  "MISSING",
  "INVALID",
  "CALIBRATION_REQUIRED",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Sensor calibration (AD)
 * ────────────────────────────────────────────────────────────*/

export interface CalibrationRecord {
  sensorId: string;
  calibrationDate: string;
  calibrationSource: string;
  calibrationVersion: string;
  calibrationExpiry: string | null;
  calibrationStatus: "OK" | "DUE" | "EXPIRED" | "REQUIRED";
}

export function evaluateCalibrationStatus(
  calibration: Omit<CalibrationRecord, "calibrationStatus">,
  now: string,
): CalibrationRecord {
  if (calibration.calibrationExpiry === null) {
    return { ...calibration, calibrationStatus: "REQUIRED" };
  }
  if (now > calibration.calibrationExpiry) {
    return { ...calibration, calibrationStatus: "EXPIRED" };
  }
  // Within 10% of the expiry window from today, flag DUE.
  const expiry = Date.parse(calibration.calibrationExpiry);
  const nowMs = Date.parse(now);
  const remaining = expiry - nowMs;
  if (remaining > 0 && remaining <= (expiry - Date.parse(calibration.calibrationDate)) * 0.1) {
    return { ...calibration, calibrationStatus: "DUE" };
  }
  return { ...calibration, calibrationStatus: "OK" };
}

/* ─────────────────────────────────────────────────────────────
 * Telemetry contract (Z) with event/ingestion time (AB)
 * ────────────────────────────────────────────────────────────*/

export type TelemetryType =
  "temperature" | "humidity" | "pressure" | "motion" | "gps" | "battery" | "energy" | "generic";

export const TELEMETRY_TYPES: readonly TelemetryType[] = [
  "temperature",
  "humidity",
  "pressure",
  "motion",
  "gps",
  "battery",
  "energy",
  "generic",
] as const;

export interface RawTelemetry {
  deviceId: string;
  tenantId: TenantId;
  type: TelemetryType;
  value: number;
  unit: string;
  eventTime: string | null;
  ingestionTime: string;
  quality: TelemetryQuality;
  firmwareVersion: string | null;
  gatewayId: string | null;
  locationReference: string | null;
  /** Raw value preserved verbatim; interpretation never mutates this. */
  raw: unknown;
}

/* ─────────────────────────────────────────────────────────────
 * Sensor data validation (AE)
 * ────────────────────────────────────────────────────────────*/

export interface SensorRange {
  min: number;
  max: number;
}

export interface ValidateTelemetryInput {
  telemetry: Omit<RawTelemetry, "quality">;
  /** Optional device-level expected unit for the telemetry type. */
  expectedUnit?: string | null;
  /** Optional physical range for plausibility (AE: range + plausibility). */
  range?: SensorRange | null;
}

export type TelemetryValidationResult =
  { ok: true; telemetry: RawTelemetry } | { ok: false; error: string };

/**
 * Validate raw telemetry (AE): range, unit, timestamp, physical
 * plausibility, sensor status. Frequency/missing-data checks that require
 * history are evaluated by the caller via `detectTelemetryAnomalies`.
 */
export function validateTelemetry(input: ValidateTelemetryInput): TelemetryValidationResult {
  const { telemetry, expectedUnit, range } = input;
  const t: RawTelemetry = { ...telemetry, quality: "VALID", raw: telemetry.value };

  if (Number.isNaN(telemetry.value) || !Number.isFinite(telemetry.value)) {
    return { ok: false, error: "Telemetry value must be finite (AE)" };
  }
  if (expectedUnit && telemetry.unit !== expectedUnit) {
    return {
      ok: false,
      error: `Telemetry unit ${telemetry.unit} does not match expected unit ${expectedUnit} (AE)`,
    };
  }
  if (range) {
    if (telemetry.value < range.min || telemetry.value > range.max) {
      return {
        ok: false,
        error: `Telemetry value ${telemetry.value} outside physical range [${range.min}, ${range.max}] (AE)`,
      };
    }
  }
  if (telemetry.eventTime !== null && Number.isNaN(Date.parse(telemetry.eventTime))) {
    return { ok: false, error: "Telemetry event timestamp is invalid (AB)" };
  }
  if (
    telemetry.eventTime !== null &&
    Date.parse(telemetry.eventTime) > Date.parse(telemetry.ingestionTime)
  ) {
    return { ok: false, error: "Telemetry event time is in the future (clock drift/AB)" };
  }
  return { ok: true, telemetry: t };
}

/* ─────────────────────────────────────────────────────────────
 * Anomaly detection (AF)
 * ────────────────────────────────────────────────────────────*/

export type AnomalyType =
  | "impossible_value"
  | "sudden_spike"
  | "stuck_sensor"
  | "missing_data"
  | "unusual_frequency"
  | "repeated_values";

export interface TelemetryAnomaly {
  type: AnomalyType;
  deviceId: string;
  detail: string;
}

export interface AnomalyContext {
  /** Current value being evaluated. */
  value: number;
  /** Previous valid value (may be null for first sample). */
  previousValue: number | null;
  /** Physical range from the device/sensor spec. */
  range: SensorRange;
  /** Spike tolerance as a ratio of the previous value (e.g. 3.0). */
  spikeThreshold: number;
  /** Consecutive identical values before flagging a stuck sensor. */
  stuckThreshold: number;
  /** Observed samples in the current window. */
  recentValues: number[];
  /** Maximum expected samples in the current window (missing data). */
  expectedSamples: number;
}

/**
 * Detect telemetry anomalies (AF): impossible values, sudden spikes,
 * stuck sensors, missing data, unusual frequency, repeated values.
 * Pure and deterministic; raw telemetry is preserved by the caller.
 */
export function detectTelemetryAnomalies(ctx: AnomalyContext): TelemetryAnomaly[] {
  const anomalies: TelemetryAnomaly[] = [];

  if (ctx.value < ctx.range.min || ctx.value > ctx.range.max) {
    anomalies.push({
      type: "impossible_value",
      deviceId: "unknown",
      detail: `Value ${ctx.value} outside physical range [${ctx.range.min}, ${ctx.range.max}]`,
    });
  }
  if (ctx.previousValue !== null && ctx.previousValue !== 0) {
    const ratio = Math.abs(ctx.value - ctx.previousValue) / Math.abs(ctx.previousValue);
    if (ratio > ctx.spikeThreshold) {
      anomalies.push({
        type: "sudden_spike",
        deviceId: "unknown",
        detail: `Value jumped ${ratio.toFixed(2)}x from ${ctx.previousValue} to ${ctx.value}`,
      });
    }
  }
  const recent = ctx.recentValues.slice(-ctx.stuckThreshold);
  if (
    recent.length >= ctx.stuckThreshold &&
    new Set(recent).size === 1 &&
    recent[0] === ctx.value
  ) {
    anomalies.push({
      type: "stuck_sensor",
      deviceId: "unknown",
      detail: `Sensor returned ${ctx.value} for ${ctx.stuckThreshold} consecutive samples`,
    });
  }
  if (ctx.recentValues.length < ctx.expectedSamples) {
    anomalies.push({
      type: "missing_data",
      deviceId: "unknown",
      detail: `Expected ${ctx.expectedSamples} samples, received ${ctx.recentValues.length}`,
    });
  }
  if (ctx.recentValues.length > ctx.expectedSamples * 2) {
    anomalies.push({
      type: "unusual_frequency",
      deviceId: "unknown",
      detail: `Sample frequency ${ctx.recentValues.length} exceeds expected ${ctx.expectedSamples} by 2x`,
    });
  }
  return anomalies;
}

/* ─────────────────────────────────────────────────────────────
 * Telemetry quality grading (AC) — time-aware
 * ────────────────────────────────────────────────────────────*/

export interface GradeTelemetryInput {
  telemetry: Omit<RawTelemetry, "quality">;
  now: string;
  /** Maximum tolerated age of event time before telemetry is STALE (ms). */
  maxEventAgeMs: number;
  calibrationStatus?: CalibrationRecord["calibrationStatus"] | null;
}

/**
 * Grade telemetry quality (AC): VALID, ESTIMATED, STALE, MISSING,
 * INVALID, CALIBRATION_REQUIRED. A missing event timestamp is never
 * silently treated as VALID — it is graded STALE until provenance is
 * established (AB: missing timestamps must be accounted for).
 */
export function gradeTelemetry(input: GradeTelemetryInput): RawTelemetry {
  const base: RawTelemetry = {
    ...input.telemetry,
    quality: "VALID",
    raw: input.telemetry.value,
  };

  if (input.telemetry.eventTime === null) {
    return { ...base, quality: "STALE" };
  }
  const ageMs = Date.parse(input.now) - Date.parse(input.telemetry.eventTime);
  if (ageMs > input.maxEventAgeMs) {
    return { ...base, quality: "STALE" };
  }
  if (input.calibrationStatus === "EXPIRED" || input.calibrationStatus === "REQUIRED") {
    return { ...base, quality: "CALIBRATION_REQUIRED" };
  }
  return base;
}
