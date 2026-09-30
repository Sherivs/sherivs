/**
 * CoreGrid Scholar — Phase 15 Hardware Integration Platform unit tests
 * (hardware-core).
 *
 * Validates:
 * - Device registry (G): registration requires identity material and
 *   standard fields.
 * - Device lifecycle (L): legal and illegal state transitions, mandatory
 *   reason for suspension/decommissioning.
 * - Enrollment (I): strict step ordering — VERIFY before REGISTER/PROVISION,
 *   AUTHENTICATE/AUTHORIZE before ACTIVATE.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  registerDevice,
  transitionDeviceLifecycle,
  advanceEnrollmentStep,
  createEnrollmentState,
  isDeviceLifecycleTransitionAllowed,
  ENROLLMENT_STEPS,
  type DeviceRecord,
} from "@/lib/hardware-core";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";

function device(overrides: Partial<DeviceRecord> = {}): DeviceRecord {
  return {
    deviceId: "device-1",
    tenantId: TENANT_A,
    hardwareIdentifier: "hw-001",
    serialNumber: "SN-001",
    manufacturer: "Acme",
    model: "Sensor X1",
    firmwareVersion: "1.0.0",
    hardwareRevision: "rev-a",
    deviceType: "temperature_sensor",
    capabilities: ["SENSOR", "TEMPERATURE"],
    institutionId: null,
    locationReference: "Building A / Room 101",
    gatewayId: null,
    connectivityStatus: "online",
    securityStatus: "trusted",
    provisioningState: "provisioned",
    lifecycleState: "ACTIVE",
    ownerReference: "user-1",
    lastSeenAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

describe("Device registry (G)", () => {
  it("registers a device with full identity material", () => {
    const result = registerDevice({
      tenantId: TENANT_A,
      hardwareIdentifier: "hw-042",
      serialNumber: "SN-042",
      manufacturer: "Acme",
      model: "Sensor X1",
      firmwareVersion: "1.0.0",
      hardwareRevision: "rev-a",
      deviceType: "temperature_sensor",
      capabilities: ["SENSOR", "TEMPERATURE"],
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.device.tenantId).toBe(TENANT_A);
      expect(result.device.lifecycleState).toBe("DISCOVERED");
      expect(result.device.provisioningState).toBe("none");
      expect(result.device.securityStatus).toBe("trusted");
    }
  });

  it("rejects a device without a hardware identifier", () => {
    const result = registerDevice({
      tenantId: TENANT_A,
      hardwareIdentifier: "  ",
      serialNumber: "SN-1",
      manufacturer: "Acme",
      model: "Sensor",
      firmwareVersion: "1.0.0",
      hardwareRevision: "rev-a",
      deviceType: "generic_sensor",
      capabilities: ["SENSOR"],
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a device without a serial number", () => {
    const result = registerDevice({
      tenantId: TENANT_A,
      hardwareIdentifier: "hw-1",
      serialNumber: "",
      manufacturer: "Acme",
      model: "Sensor",
      firmwareVersion: "1.0.0",
      hardwareRevision: "rev-a",
      deviceType: "generic_sensor",
      capabilities: ["SENSOR"],
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a device without manufacturer/model", () => {
    const result = registerDevice({
      tenantId: TENANT_A,
      hardwareIdentifier: "hw-1",
      serialNumber: "SN-1",
      manufacturer: "",
      model: "Sensor",
      firmwareVersion: "1.0.0",
      hardwareRevision: "rev-a",
      deviceType: "generic_sensor",
      capabilities: ["SENSOR"],
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });
});

describe("Device lifecycle (L)", () => {
  it("allows a legal DISCOVERED -> PENDING_ENROLLMENT transition", () => {
    expect(isDeviceLifecycleTransitionAllowed("DISCOVERED", "PENDING_ENROLLMENT")).toBe(true);
    const result = transitionDeviceLifecycle(
      device({ lifecycleState: "DISCOVERED" }),
      "PENDING_ENROLLMENT",
      "enrolling",
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.device.lifecycleState).toBe("PENDING_ENROLLMENT");
    }
  });

  it("blocks an illegal ACTIVE -> DISCOVERED jump", () => {
    expect(isDeviceLifecycleTransitionAllowed("ACTIVE", "DISCOVERED")).toBe(false);
    const result = transitionDeviceLifecycle(device(), "DISCOVERED", "downgrade", NOW);
    expect(result.ok).toBe(false);
  });

  it("requires a reason for suspension and decommissioning", () => {
    const suspended = transitionDeviceLifecycle(device(), "SUSPENDED", "", NOW);
    expect(suspended.ok).toBe(false);
    const decommissioned = transitionDeviceLifecycle(device(), "DECOMMISSIONED", "", NOW);
    expect(decommissioned.ok).toBe(false);
  });

  it("allows DECOMMISSIONED -> RETIRED and then no further moves", () => {
    const decommissioned = transitionDeviceLifecycle(
      device(),
      "DECOMMISSIONED",
      "end of life",
      NOW,
    );
    if (!decommissioned.ok) throw new Error("fixture failed");
    const retired = transitionDeviceLifecycle(decommissioned.device, "RETIRED", "end of life", NOW);
    expect(retired.ok).toBe(true);
    if (retired.ok) {
      expect(isDeviceLifecycleTransitionAllowed("RETIRED", "ACTIVE")).toBe(false);
    }
  });
});

describe("Enrollment (I)", () => {
  it("walks the full enrollment pipeline in order", () => {
    let state = createEnrollmentState("device-1", TENANT_A);
    for (const step of ENROLLMENT_STEPS) {
      const next = advanceEnrollmentStep(state, step);
      expect(next.ok).toBe(true);
      if (!next.ok) throw new Error("enrollment failed");
      state = next.state;
    }
    expect(state.completedSteps).toEqual(ENROLLMENT_STEPS);
    expect(state.identityVerified).toBe(true);
  });

  it("rejects out-of-order enrollment — VERIFY cannot be skipped", () => {
    const state = createEnrollmentState("device-1", TENANT_A);
    const result = advanceEnrollmentStep(state, "REGISTER");
    expect(result.ok).toBe(false);
  });

  it("rejects a duplicate step", () => {
    let state = createEnrollmentState("device-1", TENANT_A);
    const first = advanceEnrollmentStep(state, "DISCOVER");
    if (!first.ok) throw new Error("fixture failed");
    state = first.state;
    const duplicate = advanceEnrollmentStep(state, "DISCOVER");
    expect(duplicate.ok).toBe(false);
  });

  it("never sets identityVerified before VERIFY", () => {
    let state = createEnrollmentState("device-1", TENANT_A);
    for (const step of ["DISCOVER", "IDENTIFY"] as const) {
      const next = advanceEnrollmentStep(state, step);
      if (!next.ok) throw new Error("fixture failed");
      state = next.state;
    }
    expect(state.identityVerified).toBe(false);
  });
});
