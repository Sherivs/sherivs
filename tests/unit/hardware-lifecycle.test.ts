/**
 * CoreGrid Scholar — Phase 15 Hardware Integration Platform unit tests
 * (hardware-lifecycle).
 *
 * Validates:
 * - Device health (AR) and heartbeats (AS).
 * - Diagnostics (AT) with sensitive-flag for auditing (AU).
 * - Firmware (AV-AZ): signed/integrity requirements, staged rollout,
 *   compatibility, ordered rollback steps.
 * - Configuration (BA-BD): versioning, drift detection, reconciliation
 *   requiring authorization.
 * - Inventory (BE-BG): location, movement history.
 * - Maintenance (BH) and warranty (BI).
 * - Device security (BK-BT): certificates, rotation, revocation,
 *   quarantine, posture, tamper escalation.
 * - Vulnerability management (BU/BV): ordered response steps,
 *   unsupported hardware detection.
 */

import { describe, expect, it } from "vitest";
import {
  evaluateDeviceHealth,
  isHeartbeatStale,
  createDiagnosticReport,
  registerFirmware,
  isFirmwareCompatible,
  advanceFirmwareStage,
  isRollbackStepAllowed,
  createConfiguration,
  isConfigurationDrifted,
  canReconcileConfiguration,
  createInventoryEntry,
  recordDeviceMovement,
  createMaintenanceRecord,
  evaluateWarrantyStatus,
  evaluateCertificateStatus,
  rotateCertificate,
  revokeCertificate,
  isCredentialRotationDue,
  revokeDevice,
  quarantineDevice,
  evaluateDeviceSecurityPosture,
  isTamperEventEscalated,
  addSupplyChainAdvisory,
  isVulnerabilityStepAllowed,
  isUnsupportedHardware,
  type DeviceCertificate,
  type FirmwareRecord,
} from "@/lib/hardware-lifecycle";

const NOW = "2026-01-01T00:00:00Z";
const LATER = "2026-06-01T00:00:00Z";

describe("Device health (AR)", () => {
  it("reports HEALTHY for a connected, current device", () => {
    const status = evaluateDeviceHealth({
      connectivity: true,
      batteryLevel: 80,
      cpuLoad: 30,
      memoryUsage: 50,
      storageUsage: 40,
      temperature: 32,
      errorCount: 0,
      firmwareCurrent: true,
      sensorQualityOk: true,
    });
    expect(status).toBe("HEALTHY");
  });

  it("reports UNHEALTHY when connectivity is lost", () => {
    const status = evaluateDeviceHealth({
      connectivity: false,
      batteryLevel: 80,
      cpuLoad: 30,
      memoryUsage: 50,
      storageUsage: 40,
      temperature: 32,
      errorCount: 0,
      firmwareCurrent: true,
      sensorQualityOk: true,
    });
    expect(status).toBe("UNHEALTHY");
  });

  it("reports UNHEALTHY on high error count", () => {
    const status = evaluateDeviceHealth({
      connectivity: true,
      batteryLevel: 80,
      cpuLoad: 30,
      memoryUsage: 50,
      storageUsage: 40,
      temperature: 32,
      errorCount: 11,
      firmwareCurrent: true,
      sensorQualityOk: true,
    });
    expect(status).toBe("UNHEALTHY");
  });

  it("reports DEGRADED on stale firmware or low battery", () => {
    const staleFirmware = evaluateDeviceHealth({
      connectivity: true,
      batteryLevel: 80,
      cpuLoad: 30,
      memoryUsage: 50,
      storageUsage: 40,
      temperature: 32,
      errorCount: 0,
      firmwareCurrent: false,
      sensorQualityOk: true,
    });
    expect(staleFirmware).toBe("DEGRADED");
    const lowBattery = evaluateDeviceHealth({
      connectivity: true,
      batteryLevel: 5,
      cpuLoad: 30,
      memoryUsage: 50,
      storageUsage: 40,
      temperature: 32,
      errorCount: 0,
      firmwareCurrent: true,
      sensorQualityOk: true,
    });
    expect(lowBattery).toBe("DEGRADED");
  });
});

describe("Heartbeats (AS)", () => {
  it("flags a device with no heartbeat as stale", () => {
    expect(isHeartbeatStale(null, NOW, 30_000)).toBe(true);
  });

  it("flags a heartbeat beyond the expected interval", () => {
    expect(isHeartbeatStale("2025-12-31T00:00:00Z", NOW, 30_000)).toBe(true);
  });

  it("accepts a heartbeat within the interval", () => {
    expect(isHeartbeatStale("2025-12-31T23:59:50Z", NOW, 30_000)).toBe(false);
  });
});

describe("Diagnostics (AT, AU)", () => {
  it("creates a diagnostic report and marks sensitive diagnostics", () => {
    const report = createDiagnosticReport(
      "device-1",
      NOW,
      {
        connectivity: "ok",
        firmware: "ok",
        sensorTest: "ok",
        actuatorTest: "ok",
        protocolTest: "ok",
        gatewayStatus: "ok",
        errorLogs: [],
      },
      true,
    );
    expect(report.deviceId).toBe("device-1");
    expect(report.sensitive).toBe(true);
  });
});

describe("Firmware (AV, AW)", () => {
  it("registers signed, integrity-verified firmware", () => {
    const result = registerFirmware({
      version: "2.0.0",
      deviceType: "temperature_sensor",
      supportedHardwareRevisions: ["rev-a"],
      signed: true,
      integrityVerified: true,
      provenance: "vendor-signed",
      releasedAt: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.firmware.staged).toBe("LAB");
    }
  });

  it("rejects unsigned production firmware where policy requires signing", () => {
    const result = registerFirmware({
      version: "2.0.0",
      deviceType: "temperature_sensor",
      supportedHardwareRevisions: ["rev-a"],
      signed: false,
      integrityVerified: true,
      provenance: "unsigned-build",
      releasedAt: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects firmware whose integrity was not verified", () => {
    const result = registerFirmware({
      version: "2.0.0",
      deviceType: "temperature_sensor",
      supportedHardwareRevisions: ["rev-a"],
      signed: true,
      integrityVerified: false,
      provenance: "vendor-signed",
      releasedAt: NOW,
    });
    expect(result.ok).toBe(false);
  });
});

describe("Firmware compatibility, rollout, rollback (AX, AY, AZ)", () => {
  function fw(overrides: Partial<FirmwareRecord> = {}): FirmwareRecord {
    return {
      firmwareId: "fw-1",
      version: "2.0.0",
      deviceType: "temperature_sensor",
      supportedHardwareRevisions: ["rev-a"],
      dependencies: [],
      storageRequirementBytes: 1024,
      supportsRollback: true,
      securityCompatible: true,
      signed: true,
      integrityVerified: true,
      provenance: "vendor",
      staged: "LAB",
      releasedAt: NOW,
      ...overrides,
    };
  }

  it("accepts a compatible firmware update", () => {
    const result = isFirmwareCompatible(fw(), {
      hardwareRevision: "rev-a",
      availableStorageBytes: 4096,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects firmware for an unsupported hardware revision", () => {
    const result = isFirmwareCompatible(fw({ supportedHardwareRevisions: ["rev-b"] }), {
      hardwareRevision: "rev-a",
      availableStorageBytes: 4096,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects firmware when storage is insufficient", () => {
    const result = isFirmwareCompatible(fw({ storageRequirementBytes: 4096 }), {
      hardwareRevision: "rev-a",
      availableStorageBytes: 1024,
    });
    expect(result.ok).toBe(false);
  });

  it("stages rollout LAB -> CANARY -> LIMITED -> GENERAL", () => {
    expect(advanceFirmwareStage("LAB")).toBe("CANARY");
    expect(advanceFirmwareStage("CANARY")).toBe("LIMITED");
    expect(advanceFirmwareStage("LIMITED")).toBe("GENERAL");
    expect(advanceFirmwareStage("GENERAL")).toBe("GENERAL");
  });

  it("requires ordered rollback steps (AY)", () => {
    expect(isRollbackStepAllowed(null, "DETECT")).toBe(true);
    expect(isRollbackStepAllowed(null, "ROLLBACK")).toBe(false);
    expect(isRollbackStepAllowed("DETECT", "HALT_ROLLOUT")).toBe(true);
    expect(isRollbackStepAllowed("HALT_ROLLOUT", "ROLLBACK")).toBe(true);
    expect(isRollbackStepAllowed("ROLLBACK", "VERIFY")).toBe(true);
    expect(isRollbackStepAllowed("VERIFY", "INVESTIGATE")).toBe(true);
    expect(isRollbackStepAllowed("DETECT", "VERIFY")).toBe(false);
  });
});

describe("Configuration (BA, BB, BC, BD)", () => {
  it("creates a versioned configuration with rollback pointer", () => {
    const result = createConfiguration({
      deviceId: "device-1",
      author: "admin-1",
      timestamp: NOW,
      reason: "raise sampling rate",
      targetDevices: ["device-1", "device-2"],
      previousVersion: 2,
      settings: { samplingHz: 60 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.version).toBe(3);
      expect(result.config.rollbackVersion).toBe(2);
    }
  });

  it("rejects a configuration without an author", () => {
    const result = createConfiguration({
      deviceId: "device-1",
      author: "",
      timestamp: NOW,
      reason: "raise sampling rate",
      targetDevices: ["device-1"],
      previousVersion: null,
      settings: {},
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a configuration without target devices", () => {
    const result = createConfiguration({
      deviceId: "device-1",
      author: "admin-1",
      timestamp: NOW,
      reason: "raise sampling rate",
      targetDevices: [],
      previousVersion: null,
      settings: {},
    });
    expect(result.ok).toBe(false);
  });

  it("detects drift when effective settings differ from approved", () => {
    const result = createConfiguration({
      deviceId: "device-1",
      author: "admin-1",
      timestamp: NOW,
      reason: "raise sampling rate",
      targetDevices: ["device-1"],
      previousVersion: null,
      settings: { samplingHz: 60, mode: "normal" },
    });
    if (!result.ok) throw new Error("fixture failed");
    expect(isConfigurationDrifted(result.config, { samplingHz: 60, mode: "normal" })).toBe(false);
    expect(isConfigurationDrifted(result.config, { samplingHz: 30, mode: "normal" })).toBe(true);
    expect(
      isConfigurationDrifted(result.config, { samplingHz: 60, mode: "normal", rogue: true }),
    ).toBe(true);
  });

  it("requires authorized actors to auto-reconcile drift", () => {
    expect(canReconcileConfiguration({ isAdmin: true, isOperator: false })).toBe(true);
    expect(canReconcileConfiguration({ isAdmin: false, isOperator: true })).toBe(true);
    expect(canReconcileConfiguration({ isAdmin: false, isOperator: false })).toBe(false);
  });
});

describe("Inventory, maintenance, warranty (BE, BH, BI)", () => {
  it("tracks device movement history", () => {
    const entry = createInventoryEntry({
      deviceId: "device-1",
      model: "Sensor X1",
      serialNumber: "SN-1",
      firmwareVersion: "1.0.0",
      status: "active",
      lifecycleState: "ACTIVE",
      location: {
        campus: "Main",
        building: "A",
        floor: "1",
        room: "101",
        zone: null,
        equipmentArea: null,
      },
      ownerReference: "dept-1",
    });
    const relocated = recordDeviceMovement(entry, "relocation", NOW, "moved to Room 201");
    expect(relocated.movementHistory).toHaveLength(1);
    expect(relocated.movementHistory[0].kind).toBe("relocation");
  });

  it("creates a maintenance record with technician and result", () => {
    const record = createMaintenanceRecord(
      "device-1",
      "tech-1",
      "battery replacement",
      NOW,
      "completed",
      ["battery"],
      [],
    );
    expect(record.technician).toBe("tech-1");
    expect(record.parts).toContain("battery");
  });

  it("evaluates warranty status against now", () => {
    const warranty = {
      deviceId: "device-1",
      vendor: "Acme",
      purchaseDate: NOW,
      warrantyEndDate: LATER,
      supportContract: null,
    };
    expect(evaluateWarrantyStatus(warranty, NOW)).toBe("active");
    expect(evaluateWarrantyStatus(warranty, "2027-01-01T00:00:00Z")).toBe("expired");
  });
});

describe("Device security (BK, BL, BM, BN, BO, BP, BQ, BR, BS, BT)", () => {
  function cert(overrides: Partial<DeviceCertificate> = {}): DeviceCertificate {
    return {
      certificateId: "cert-1",
      deviceId: "device-1",
      issuedAt: "2025-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
      revokedAt: null,
      rotationDueAt: null,
      ...overrides,
    };
  }

  it("evaluates certificate status across the lifecycle (BL)", () => {
    expect(evaluateCertificateStatus(null, NOW)).toBe("MISSING");
    expect(evaluateCertificateStatus(cert(), NOW)).toBe("VALID");
    expect(evaluateCertificateStatus(cert({ revokedAt: NOW }), NOW)).toBe("REVOKED");
    expect(evaluateCertificateStatus(cert({ expiresAt: "2025-06-01T00:00:00Z" }), NOW)).toBe(
      "EXPIRED",
    );
    expect(evaluateCertificateStatus(cert({ rotationDueAt: "2025-12-01T00:00:00Z" }), NOW)).toBe(
      "ROTATION_DUE",
    );
  });

  it("rotates and revokes certificates", () => {
    const rotated = rotateCertificate(cert(), "2028-01-01T00:00:00Z", NOW);
    expect(rotated.expiresAt).toBe("2028-01-01T00:00:00Z");
    expect(rotated.rotationDueAt).toBeNull();
    const revoked = revokeCertificate(cert(), NOW);
    expect(revoked.revokedAt).toBe(NOW);
  });

  it("flags credentials due for rotation per policy (BM)", () => {
    const policy = { maxCredentialAgeMs: 90 * 24 * 3600_000, requireRotation: true };
    expect(isCredentialRotationDue("2025-01-01T00:00:00Z", NOW, policy)).toBe(true);
    expect(isCredentialRotationDue("2025-12-01T00:00:00Z", NOW, policy)).toBe(false);
    expect(
      isCredentialRotationDue("2025-01-01T00:00:00Z", NOW, {
        maxCredentialAgeMs: 90 * 24 * 3600_000,
        requireRotation: false,
      }),
    ).toBe(false);
  });

  it("revokes a compromised device immediately (BN)", () => {
    const result = revokeDevice(
      { deviceId: "device-1", securityStatus: "trusted" },
      "compromised",
      "security-1",
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("revoked");
      expect(result.reason).toBe("compromised");
    }
  });

  it("rejects revocation without a reason", () => {
    const result = revokeDevice(
      { deviceId: "device-1", securityStatus: "trusted" },
      "" as "policy",
      "security-1",
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("quarantines a device with a reason (BO)", () => {
    const result = quarantineDevice(
      { deviceId: "device-1", securityStatus: "trusted" },
      "suspected compromise",
      "security-1",
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("quarantined");
    }
  });

  it("rejects quarantine without a reason", () => {
    const result = quarantineDevice(
      { deviceId: "device-1", securityStatus: "trusted" },
      "",
      "security-1",
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("evaluates device security posture (BK, BP, BQ, BR)", () => {
    const secure = {
      deviceId: "d",
      secureBootEnabled: true,
      rootOfTrustPresent: true,
      encryptionEnabled: true,
      networkSegmented: true,
    };
    const weak = { ...secure, secureBootEnabled: false, rootOfTrustPresent: false };
    const insecure = { ...secure, encryptionEnabled: false };
    const unsegmented = { ...secure, networkSegmented: false };
    expect(evaluateDeviceSecurityPosture(secure)).toBe("secure");
    expect(evaluateDeviceSecurityPosture(weak)).toBe("weak");
    expect(evaluateDeviceSecurityPosture(insecure)).toBe("insecure");
    expect(evaluateDeviceSecurityPosture(unsegmented)).toBe("insecure");
  });

  it("escalates physical tamper events but not mere config noise (BS)", () => {
    expect(
      isTamperEventEscalated({ deviceId: "d", kind: "enclosure_tamper", at: NOW, detail: "" }),
    ).toBe(true);
    expect(
      isTamperEventEscalated({ deviceId: "d", kind: "unauthorized_firmware", at: NOW, detail: "" }),
    ).toBe(true);
    expect(
      isTamperEventEscalated({ deviceId: "d", kind: "physical_intrusion", at: NOW, detail: "" }),
    ).toBe(true);
    expect(
      isTamperEventEscalated({
        deviceId: "d",
        kind: "unexpected_configuration",
        at: NOW,
        detail: "",
      }),
    ).toBe(false);
  });

  it("tracks supply-chain advisories (BT)", () => {
    const meta = addSupplyChainAdvisory(
      {
        deviceId: "d",
        manufacturer: "Acme",
        model: "X1",
        firmwareProvenance: "vendor",
        componentProvenance: [],
        securityAdvisories: [],
      },
      "CVE-2026-0001",
    );
    expect(meta.securityAdvisories).toContain("CVE-2026-0001");
  });
});

describe("Vulnerability management (BU, BV)", () => {
  it("requires ordered vulnerability response steps", () => {
    expect(isVulnerabilityStepAllowed(null, "DISCOVER")).toBe(true);
    expect(isVulnerabilityStepAllowed(null, "PATCH")).toBe(false);
    expect(isVulnerabilityStepAllowed("DISCOVER", "ASSESS")).toBe(true);
    expect(isVulnerabilityStepAllowed("ASSESS", "PRIORITIZE")).toBe(true);
    expect(isVulnerabilityStepAllowed("PRIORITIZE", "MITIGATE")).toBe(true);
    expect(isVulnerabilityStepAllowed("MITIGATE", "PATCH")).toBe(true);
    expect(isVulnerabilityStepAllowed("PATCH", "VERIFY")).toBe(true);
    expect(isVulnerabilityStepAllowed("DISCOVER", "VERIFY")).toBe(false);
  });

  it("detects unsupported hardware models and outdated firmware", () => {
    expect(
      isUnsupportedHardware({ model: "X1", firmwareVersion: "1.0.0" }, ["X1"], ["1.0.0"]),
    ).toBe(false);
    expect(
      isUnsupportedHardware({ model: "X2", firmwareVersion: "1.0.0" }, ["X1"], ["1.0.0"]),
    ).toBe(true);
    expect(
      isUnsupportedHardware({ model: "X1", firmwareVersion: "0.9.0" }, ["X1"], ["1.0.0"]),
    ).toBe(true);
  });
});
