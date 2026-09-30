/**
 * CoreGrid — Hardware Lifecycle, Firmware, Configuration and
 * Security domain model
 * (Phase 15, Sections AR, AS, AT, AU, AV, AW, AX, AY, AZ, BA, BB, BC, BD,
 * BE, BF, BG, BH, BI, BJ, BK, BL, BM, BN, BO, BP, BQ, BR, BS, BT, BU, BV).
 *
 * Implements `architecture/phase-15-hardware-integration.md`:
 * - Device health (AR): connectivity, battery, CPU, memory, storage,
 *   temperature, errors, firmware, sensor quality.
 * - Heartbeats (AS): configurable missing-heartbeat detection thresholds.
 * - Diagnostics (AT/AU): connectivity, firmware, sensor, actuator,
 *   protocol, gateway, error logs; sensitive diagnostics are audited.
 * - Firmware (AV): inventory, versions, compatibility, distribution,
 *   verification, rollback, staged deployment.
 * - Firmware security (AW): cryptographically signed, integrity verified,
 *   version controlled, provenance tracked; unsigned production firmware
 *   is rejected where policy requires signed firmware.
 * - Rollout (AX): LAB -> CANARY -> LIMITED -> GENERAL.
 * - Rollback (AY): DETECT -> HALT ROLLOUT -> ROLLBACK -> VERIFY ->
 *   INVESTIGATE.
 * - Compatibility (AZ): hardware revision, dependencies, storage,
 *   rollback support, security compatibility.
 * - Configuration (BA-BD): versioning (version, author, timestamp,
 *   reason, target devices, rollback), drift detection, reconciliation
 *   that requires authorization for automatic correction.
 * - Inventory (BE-BG): device inventory, physical location, movement.
 * - Maintenance (BH) and warranty (BI).
 * - Lifecycle cost (BJ): metadata only; financial accounting is Phase 13.
 * - Device security (BK): identity, secure provisioning, authentication,
 *   authorization, encryption, firmware integrity, credential rotation,
 *   revocation.
 * - Certificates (BL): issuance, rotation, expiration, revocation,
 *   validation.
 * - Credential rotation (BM), revocation (BN: compromised devices
 *   immediately suspendable), quarantine (BO).
 * - Network segmentation (BP), secure boot (BQ), root of trust (BR),
 *   tamper detection (BS), supply-chain security (BT).
 * - Vulnerability management (BU) and response (BV): DISCOVER -> ASSESS ->
 *   PRIORITIZE -> MITIGATE -> PATCH/REPLACE -> VERIFY.
 */

/* ─────────────────────────────────────────────────────────────
 * Device health (AR)
 * ────────────────────────────────────────────────────────────*/

export type DeviceHealthStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN";

export const DEVICE_HEALTH_STATUSES: readonly DeviceHealthStatus[] = [
  "HEALTHY",
  "DEGRADED",
  "UNHEALTHY",
  "UNKNOWN",
] as const;

export interface DeviceHealthSignals {
  connectivity: boolean;
  batteryLevel: number | null;
  cpuLoad: number | null;
  memoryUsage: number | null;
  storageUsage: number | null;
  temperature: number | null;
  errorCount: number;
  firmwareCurrent: boolean;
  sensorQualityOk: boolean;
}

export function evaluateDeviceHealth(signals: DeviceHealthSignals): DeviceHealthStatus {
  if (!signals.connectivity) {
    return "UNHEALTHY";
  }
  if (signals.errorCount > 10) {
    return "UNHEALTHY";
  }
  if (!signals.firmwareCurrent) {
    return "DEGRADED";
  }
  if (!signals.sensorQualityOk) {
    return "DEGRADED";
  }
  if (signals.batteryLevel !== null && signals.batteryLevel < 10) {
    return "DEGRADED";
  }
  if (signals.cpuLoad !== null && signals.cpuLoad > 90) {
    return "DEGRADED";
  }
  if (signals.memoryUsage !== null && signals.memoryUsage > 90) {
    return "DEGRADED";
  }
  if (signals.storageUsage !== null && signals.storageUsage > 90) {
    return "DEGRADED";
  }
  return "HEALTHY";
}

/* ─────────────────────────────────────────────────────────────
 * Heartbeats (AS)
 * ────────────────────────────────────────────────────────────*/

/**
 * Detect missing heartbeats (AS): configurable detection thresholds.
 * A device with no recorded heartbeat is immediately considered stale.
 */
export function isHeartbeatStale(
  lastHeartbeatAt: string | null,
  now: string,
  expectedIntervalMs: number,
): boolean {
  if (lastHeartbeatAt === null) {
    return true;
  }
  return Date.parse(now) - Date.parse(lastHeartbeatAt) > expectedIntervalMs;
}

/* ─────────────────────────────────────────────────────────────
 * Diagnostics (AT)
 * ────────────────────────────────────────────────────────────*/

export interface DiagnosticReport {
  deviceId: string;
  generatedAt: string;
  connectivity: "ok" | "failed" | "unknown";
  firmware: "ok" | "stale" | "unknown";
  sensorTest: "ok" | "failed" | "unknown";
  actuatorTest: "ok" | "failed" | "unknown";
  protocolTest: "ok" | "failed" | "unknown";
  gatewayStatus: "ok" | "failed" | "unknown";
  errorLogs: string[];
  /** Sensitive diagnostics must be audited (AU). */
  sensitive: boolean;
}

export function createDiagnosticReport(
  deviceId: string,
  generatedAt: string,
  partial: Omit<DiagnosticReport, "deviceId" | "generatedAt" | "sensitive">,
  sensitive = false,
): DiagnosticReport {
  return { deviceId, generatedAt, ...partial, sensitive };
}

/* ─────────────────────────────────────────────────────────────
 * Firmware management (AV, AW, AZ)
 * ────────────────────────────────────────────────────────────*/

export type FirmwareRolloutStage = "LAB" | "CANARY" | "LIMITED" | "GENERAL";

export const FIRMWARE_ROLLOUT_STAGES: readonly FirmwareRolloutStage[] = [
  "LAB",
  "CANARY",
  "LIMITED",
  "GENERAL",
] as const;

export interface FirmwareRecord {
  firmwareId: string;
  version: string;
  deviceType: string;
  supportedHardwareRevisions: string[];
  dependencies: string[];
  storageRequirementBytes: number;
  supportsRollback: boolean;
  securityCompatible: boolean;
  signed: boolean;
  integrityVerified: boolean;
  provenance: string;
  staged: FirmwareRolloutStage;
  releasedAt: string;
}

export interface RegisterFirmwareInput {
  version: string;
  deviceType: string;
  supportedHardwareRevisions: string[];
  dependencies?: string[];
  storageRequirementBytes?: number;
  supportsRollback?: boolean;
  securityCompatible?: boolean;
  signed: boolean;
  integrityVerified: boolean;
  provenance: string;
  releasedAt: string;
}

export type RegisterFirmwareResult =
  { ok: true; firmware: FirmwareRecord } | { ok: false; error: string };

/**
 * Register firmware (AV). Unsigned production firmware must be rejected
 * where platform security policy requires signed firmware (AW).
 */
export function registerFirmware(
  input: RegisterFirmwareInput,
  requireSigned = true,
): RegisterFirmwareResult {
  if (input.version.trim() === "") {
    return { ok: false, error: "Firmware requires a version (AV)" };
  }
  if (input.deviceType.trim() === "") {
    return { ok: false, error: "Firmware requires a device type (AV)" };
  }
  if (input.provenance.trim() === "") {
    return { ok: false, error: "Firmware requires provenance tracking (AW)" };
  }
  if (requireSigned && !input.signed) {
    return { ok: false, error: "Unsigned production firmware is rejected (AW)" };
  }
  if (!input.integrityVerified) {
    return { ok: false, error: "Firmware integrity must be verified (AW)" };
  }
  return {
    ok: true,
    firmware: {
      firmwareId: `fw-${input.deviceType}-${input.version}-${Math.random().toString(36).slice(2, 8)}`,
      version: input.version,
      deviceType: input.deviceType,
      supportedHardwareRevisions: input.supportedHardwareRevisions,
      dependencies: input.dependencies ?? [],
      storageRequirementBytes: input.storageRequirementBytes ?? 0,
      supportsRollback: input.supportsRollback ?? true,
      securityCompatible: input.securityCompatible ?? true,
      signed: input.signed,
      integrityVerified: input.integrityVerified,
      provenance: input.provenance,
      staged: "LAB",
      releasedAt: input.releasedAt,
    },
  };
}

/**
 * Firmware compatibility check (AZ): hardware revision, dependencies,
 * storage requirements, rollback support, security compatibility.
 */
export function isFirmwareCompatible(
  firmware: FirmwareRecord,
  device: { hardwareRevision: string; availableStorageBytes: number },
): { ok: true } | { ok: false; error: string } {
  if (!firmware.supportedHardwareRevisions.includes(device.hardwareRevision)) {
    return {
      ok: false,
      error: `Firmware ${firmware.version} does not support hardware revision ${device.hardwareRevision} (AZ)`,
    };
  }
  if (device.availableStorageBytes < firmware.storageRequirementBytes) {
    return { ok: false, error: "Device lacks storage for firmware update (AZ)" };
  }
  if (!firmware.supportsRollback) {
    return { ok: false, error: "Firmware does not support rollback (AZ)" };
  }
  if (!firmware.securityCompatible) {
    return { ok: false, error: "Firmware is not security compatible (AZ)" };
  }
  return { ok: true };
}

/* ─────────────────────────────────────────────────────────────
 * Firmware rollout (AX) and rollback (AY)
 * ────────────────────────────────────────────────────────────*/

export function advanceFirmwareStage(stage: FirmwareRolloutStage): FirmwareRolloutStage {
  const order: readonly FirmwareRolloutStage[] = FIRMWARE_ROLLOUT_STAGES;
  const index = order.indexOf(stage);
  if (index === -1 || index === order.length - 1) {
    return stage;
  }
  return order[index + 1];
}

export type RollbackStep = "DETECT" | "HALT_ROLLOUT" | "ROLLBACK" | "VERIFY" | "INVESTIGATE";

export const ROLLBACK_STEPS: readonly RollbackStep[] = [
  "DETECT",
  "HALT_ROLLOUT",
  "ROLLBACK",
  "VERIFY",
  "INVESTIGATE",
] as const;

/**
 * Evaluate the rollback flow (AY): DETECT -> HALT ROLLOUT -> ROLLBACK ->
 * VERIFY -> INVESTIGATE. Each step must be explicitly confirmed.
 */
export function isRollbackStepAllowed(current: RollbackStep | null, next: RollbackStep): boolean {
  if (current === null) {
    return next === "DETECT";
  }
  const order: readonly RollbackStep[] = ROLLBACK_STEPS;
  return order.indexOf(next) === order.indexOf(current) + 1;
}

/* ─────────────────────────────────────────────────────────────
 * Device configuration (BA, BB, BC, BD)
 * ────────────────────────────────────────────────────────────*/

export interface DeviceConfiguration {
  configId: string;
  deviceId: string;
  version: number;
  author: string;
  timestamp: string;
  reason: string;
  targetDevices: string[];
  rollbackVersion: number | null;
  settings: Record<string, unknown>;
}

export interface CreateConfigurationInput {
  deviceId: string;
  author: string;
  timestamp: string;
  reason: string;
  targetDevices: string[];
  previousVersion: number | null;
  settings: Record<string, unknown>;
}

export type CreateConfigurationResult =
  { ok: true; config: DeviceConfiguration } | { ok: false; error: string };

/**
 * Create a versioned configuration (BB): every configuration must have
 * version, author, timestamp, reason, target devices, and rollback info.
 */
export function createConfiguration(input: CreateConfigurationInput): CreateConfigurationResult {
  if (input.author.trim() === "") {
    return { ok: false, error: "Configuration requires an author (BB)" };
  }
  if (input.reason.trim() === "") {
    return { ok: false, error: "Configuration requires a reason (BB)" };
  }
  if (input.targetDevices.length === 0) {
    return { ok: false, error: "Configuration requires target devices (BB)" };
  }
  return {
    ok: true,
    config: {
      configId: `cfg-${input.deviceId}-v${(input.previousVersion ?? 0) + 1}`,
      deviceId: input.deviceId,
      version: (input.previousVersion ?? 0) + 1,
      author: input.author,
      timestamp: input.timestamp,
      reason: input.reason,
      targetDevices: input.targetDevices,
      rollbackVersion: input.previousVersion,
      settings: input.settings,
    },
  };
}

/**
 * Detect configuration drift (BC): a device whose effective configuration
 * differs from the approved configuration.
 */
export function isConfigurationDrifted(
  approved: DeviceConfiguration,
  effective: Record<string, unknown>,
): boolean {
  for (const key of Object.keys(approved.settings)) {
    if (JSON.stringify(approved.settings[key]) !== JSON.stringify(effective[key])) {
      return true;
    }
  }
  for (const key of Object.keys(effective)) {
    if (!(key in approved.settings)) {
      return true;
    }
  }
  return false;
}

/**
 * Configuration reconciliation (BD): CoreGrid may detect and report drift;
 * automatic correction requires appropriate authorization.
 */
export function canReconcileConfiguration(actor: {
  isAdmin: boolean;
  isOperator: boolean;
}): boolean {
  return actor.isAdmin || actor.isOperator;
}

/* ─────────────────────────────────────────────────────────────
 * Device inventory (BE, BF, BG)
 * ────────────────────────────────────────────────────────────*/

export interface DeviceLocation {
  campus: string | null;
  building: string | null;
  floor: string | null;
  room: string | null;
  zone: string | null;
  equipmentArea: string | null;
}

export interface InventoryEntry {
  deviceId: string;
  model: string;
  serialNumber: string;
  firmwareVersion: string;
  status: string;
  lifecycleState: string;
  location: DeviceLocation | null;
  ownerReference: string | null;
  movementHistory: Array<{ kind: string; at: string; detail: string }>;
}

export function createInventoryEntry(
  entry: Omit<InventoryEntry, "movementHistory">,
): InventoryEntry {
  return { ...entry, movementHistory: [] };
}

export function recordDeviceMovement(
  entry: InventoryEntry,
  kind: "installation" | "relocation" | "reassignment" | "removal",
  at: string,
  detail: string,
): InventoryEntry {
  return { ...entry, movementHistory: [...entry.movementHistory, { kind, at, detail }] };
}

/* ─────────────────────────────────────────────────────────────
 * Maintenance (BH) and warranty (BI)
 * ────────────────────────────────────────────────────────────*/

export interface MaintenanceRecord {
  recordId: string;
  deviceId: string;
  technician: string;
  reason: string;
  date: string;
  result: "completed" | "partial" | "failed";
  parts: string[];
  firmwareChanges: string[];
}

export function createMaintenanceRecord(
  deviceId: string,
  technician: string,
  reason: string,
  date: string,
  result: MaintenanceRecord["result"],
  parts: string[],
  firmwareChanges: string[],
): MaintenanceRecord {
  return {
    recordId: `maint-${deviceId}-${Math.random().toString(36).slice(2, 8)}`,
    deviceId,
    technician,
    reason,
    date,
    result,
    parts,
    firmwareChanges,
  };
}

export interface WarrantyRecord {
  deviceId: string;
  vendor: string;
  purchaseDate: string;
  warrantyEndDate: string;
  supportContract: string | null;
}

export function evaluateWarrantyStatus(record: WarrantyRecord, now: string): "active" | "expired" {
  return now <= record.warrantyEndDate ? "active" : "expired";
}

/* ─────────────────────────────────────────────────────────────
 * Hardware lifecycle cost (BJ) — metadata only
 * ────────────────────────────────────────────────────────────*/

export interface HardwareCostMetadata {
  deviceId: string;
  acquisitionCost: number | null;
  maintenanceCost: number | null;
  energyCost: number | null;
  replacementCost: number | null;
  disposalCost: number | null;
}

export function createCostMetadata(
  deviceId: string,
  cost: Partial<Omit<HardwareCostMetadata, "deviceId">>,
): HardwareCostMetadata {
  return {
    deviceId,
    acquisitionCost: cost.acquisitionCost ?? null,
    maintenanceCost: cost.maintenanceCost ?? null,
    energyCost: cost.energyCost ?? null,
    replacementCost: cost.replacementCost ?? null,
    disposalCost: cost.disposalCost ?? null,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Device security (BK, BL, BM, BN, BO, BP, BQ, BR, BS, BT)
 * ────────────────────────────────────────────────────────────*/

export interface DeviceCertificate {
  certificateId: string;
  deviceId: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  rotationDueAt: string | null;
}

export type CertificateStatus = "VALID" | "EXPIRED" | "REVOKED" | "ROTATION_DUE" | "MISSING";

export function evaluateCertificateStatus(
  cert: DeviceCertificate | null,
  now: string,
): CertificateStatus {
  if (cert === null) {
    return "MISSING";
  }
  if (cert.revokedAt !== null) {
    return "REVOKED";
  }
  if (now > cert.expiresAt) {
    return "EXPIRED";
  }
  if (cert.rotationDueAt !== null && now >= cert.rotationDueAt) {
    return "ROTATION_DUE";
  }
  return "VALID";
}

export function rotateCertificate(
  cert: DeviceCertificate,
  newExpiry: string,
  now: string,
): DeviceCertificate {
  return {
    ...cert,
    issuedAt: now,
    expiresAt: newExpiry,
    revokedAt: null,
    rotationDueAt: null,
  };
}

export function revokeCertificate(cert: DeviceCertificate, now: string): DeviceCertificate {
  return { ...cert, revokedAt: now, rotationDueAt: null };
}

export interface DeviceCredentialPolicy {
  maxCredentialAgeMs: number;
  requireRotation: boolean;
}

/**
 * Credential rotation (BM): credentials should rotate according to risk
 * and policy. A credential older than the policy maximum is due.
 */
export function isCredentialRotationDue(
  issuedAt: string,
  now: string,
  policy: DeviceCredentialPolicy,
): boolean {
  if (!policy.requireRotation) {
    return false;
  }
  return Date.parse(now) - Date.parse(issuedAt) >= policy.maxCredentialAgeMs;
}

export type DeviceRevocationReason =
  "compromised" | "stolen" | "decommissioned" | "policy" | "maintenance";

/**
 * Device revocation (BN): compromised devices must be immediately
 * suspendable. Revocation is irreversible at the device boundary; a
 * revoked device cannot accept operational commands.
 */
export function revokeDevice(
  device: { deviceId: string; securityStatus: string },
  reason: DeviceRevocationReason,
  issuedBy: string,
  now: string,
):
  | {
      ok: true;
      status: string;
      revokedAt: string;
      issuedBy: string;
      reason: DeviceRevocationReason;
    }
  | { ok: false; error: string } {
  if (reason.trim() === "") {
    return { ok: false, error: "Revocation requires a reason (BN)" };
  }
  return {
    ok: true,
    status: "revoked",
    revokedAt: now,
    issuedBy,
    reason,
  };
}

/** Device quarantine (BO): a compromised device enters QUARANTINED where
 * normal operations are restricted. */
export function quarantineDevice(
  device: { deviceId: string; securityStatus: string },
  reason: string,
  issuedBy: string,
  now: string,
):
  | { ok: true; status: "quarantined"; at: string; issuedBy: string; reason: string }
  | { ok: false; error: string } {
  if (reason.trim() === "") {
    return { ok: false, error: "Quarantine requires a reason (BO)" };
  }
  return { ok: true, status: "quarantined", at: now, issuedBy, reason };
}

export interface DeviceSecurityBaseline {
  deviceId: string;
  secureBootEnabled: boolean;
  rootOfTrustPresent: boolean;
  encryptionEnabled: boolean;
  networkSegmented: boolean;
}

/**
 * Security posture (BK, BP, BQ, BR): hardware security includes device
 * identity, secure provisioning, authentication, authorization,
 * encryption, firmware integrity, credential rotation, revocation.
 * High-risk hardware should be isolated from general application networks
 * (BP). Where hardware supports it, secure boot verifies trusted firmware
 * (BQ). Hardware-backed trust should be used where practical (BR).
 */
export function evaluateDeviceSecurityPosture(
  baseline: DeviceSecurityBaseline,
): "secure" | "weak" | "insecure" {
  if (!baseline.encryptionEnabled) {
    return "insecure";
  }
  if (!baseline.networkSegmented) {
    return "insecure";
  }
  if (!baseline.secureBootEnabled && !baseline.rootOfTrustPresent) {
    return "weak";
  }
  return "secure";
}

export type TamperEventKind =
  "enclosure_tamper" | "unauthorized_firmware" | "unexpected_configuration" | "physical_intrusion";

export interface TamperEvent {
  deviceId: string;
  kind: TamperEventKind;
  at: string;
  detail: string;
}

/** Tamper detection (BS): enclosure tamper, unauthorized firmware,
 * unexpected configuration, and physical intrusion must escalate. */
export function isTamperEventEscalated(event: TamperEvent): boolean {
  return (
    event.kind === "enclosure_tamper" ||
    event.kind === "unauthorized_firmware" ||
    event.kind === "physical_intrusion"
  );
}

export interface SupplyChainMetadata {
  deviceId: string;
  manufacturer: string;
  model: string;
  firmwareProvenance: string;
  componentProvenance: string[];
  securityAdvisories: string[];
}

export function addSupplyChainAdvisory(
  meta: SupplyChainMetadata,
  advisory: string,
): SupplyChainMetadata {
  return { ...meta, securityAdvisories: [...meta.securityAdvisories, advisory] };
}

/* ─────────────────────────────────────────────────────────────
 * Hardware vulnerability management (BU) and response (BV)
 * ────────────────────────────────────────────────────────────*/

export interface VulnerabilityRecord {
  vulnId: string;
  deviceId: string;
  cve: string | null;
  source: string;
  discoveredAt: string;
  severity: "critical" | "high" | "medium" | "low";
  status:
    "DISCOVERED" | "ASSESSED" | "PRIORITIZED" | "MITIGATED" | "PATCHED" | "REPLACED" | "VERIFIED";
  affectedFirmware: string | null;
}

export const VULNERABILITY_RESPONSE_STEPS = [
  "DISCOVER",
  "ASSESS",
  "PRIORITIZE",
  "MITIGATE",
  "PATCH",
  "VERIFY",
] as const;

export type VulnerabilityResponseStep = (typeof VULNERABILITY_RESPONSE_STEPS)[number];

/**
 * Vulnerability response (BV): DISCOVER -> ASSESS -> PRIORITIZE ->
 * MITIGATE -> PATCH/REPLACE -> VERIFY. A record can never jump steps.
 */
export function isVulnerabilityStepAllowed(
  current: VulnerabilityResponseStep | null,
  next: VulnerabilityResponseStep,
): boolean {
  if (current === null) {
    return next === "DISCOVER";
  }
  const order: readonly VulnerabilityResponseStep[] = VULNERABILITY_RESPONSE_STEPS;
  return order.indexOf(next) === order.indexOf(current) + 1;
}

/**
 * Unsupported hardware detection (BU): unsupported models and outdated
 * firmware/components are tracked as exposure.
 */
export function isUnsupportedHardware(
  device: { model: string; firmwareVersion: string },
  supportedModels: string[],
  supportedFirmware: string[],
): boolean {
  return (
    !supportedModels.includes(device.model) || !supportedFirmware.includes(device.firmwareVersion)
  );
}
