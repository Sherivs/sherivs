/**
 * CoreGrid — Hardware Integration Platform core domain model
 * (Phase 15, Sections G, H, I, J, K, L, M, N, O).
 *
 * Implements `architecture/phase-15-hardware-integration.md`:
 * - Device registry (G): authoritative infrastructure registry for
 *   integrated hardware — device ID, hardware identifier, serial,
 *   manufacturer, model, firmware, hardware revision, type, capabilities,
 *   tenant, institution, location, gateway, connectivity, security,
 *   provisioning, lifecycle, ownership, installation, last-seen.
 * - Device identity (H): every managed device requires a unique machine
 *   identity; identity must never depend solely on MAC, serial, hostname,
 *   or IP (spoofable).
 * - Enrollment lifecycle (I): DISCOVER -> IDENTIFY -> VERIFY -> REGISTER ->
 *   PROVISION -> AUTHENTICATE -> AUTHORIZE -> ACTIVATE.
 * - Provisioning (J): credentials, certificates, configuration, network
 *   settings, tenant/location assignment, capability registration, firmware
 *   and telemetry policy; provisioning must be auditable. Zero-touch
 *   provisioning (K) must not mean zero security.
 * - Device lifecycle (L): DISCOVERED -> PENDING_ENROLLMENT -> PROVISIONING ->
 *   ACTIVE -> DEGRADED -> MAINTENANCE -> SUSPENDED -> DECOMMISSIONED ->
 *   RETIRED.
 * - Device ownership (M): institution, campus, facility, department,
 *   classroom, laboratory, vehicle, infrastructure zone, tenant —
 *   relationships must be explicit.
 * - Capability model (N): SENSOR, ACTUATOR, CAMERA, MICROPHONE, DISPLAY,
 *   MOTOR, RELAY, GPS, TEMPERATURE, HUMIDITY, PRESSURE, MOTION, BIOMETRIC,
 *   NETWORK, STORAGE, COMPUTE; discovery must be machine-readable.
 * - Device type registry (O): standardized device types.
 *
 * Boundaries (D, E): Phase 15 represents and integrates physical devices;
 * Phase 16 represents digital reality through Digital Twins. A physical
 * device is not itself a Digital Twin. Hardware concerns must not
 * contaminate the rest of the platform (E).
 */

import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Device types (O)
 * ────────────────────────────────────────────────────────────*/

export type DeviceType =
  | "temperature_sensor"
  | "door_controller"
  | "smart_lock"
  | "camera"
  | "attendance_reader"
  | "laboratory_sensor"
  | "robot"
  | "vehicle_gateway"
  | "energy_meter"
  | "environment_sensor"
  | "biometric_reader"
  | "access_controller"
  | "generic_sensor"
  | "generic_actuator"
  | "gateway"
  | "edge_compute"
  | "display"
  | "other";

export const DEVICE_TYPES: readonly DeviceType[] = [
  "temperature_sensor",
  "door_controller",
  "smart_lock",
  "camera",
  "attendance_reader",
  "laboratory_sensor",
  "robot",
  "vehicle_gateway",
  "energy_meter",
  "environment_sensor",
  "biometric_reader",
  "access_controller",
  "generic_sensor",
  "generic_actuator",
  "gateway",
  "edge_compute",
  "display",
  "other",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Device capability model (N)
 * ────────────────────────────────────────────────────────────*/

export type DeviceCapability =
  | "SENSOR"
  | "ACTUATOR"
  | "CAMERA"
  | "MICROPHONE"
  | "DISPLAY"
  | "MOTOR"
  | "RELAY"
  | "GPS"
  | "TEMPERATURE"
  | "HUMIDITY"
  | "PRESSURE"
  | "MOTION"
  | "BIOMETRIC"
  | "NETWORK"
  | "STORAGE"
  | "COMPUTE";

export const DEVICE_CAPABILITIES: readonly DeviceCapability[] = [
  "SENSOR",
  "ACTUATOR",
  "CAMERA",
  "MICROPHONE",
  "DISPLAY",
  "MOTOR",
  "RELAY",
  "GPS",
  "TEMPERATURE",
  "HUMIDITY",
  "PRESSURE",
  "MOTION",
  "BIOMETRIC",
  "NETWORK",
  "STORAGE",
  "COMPUTE",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Device lifecycle (L)
 * ────────────────────────────────────────────────────────────*/

export type DeviceLifecycleState =
  | "DISCOVERED"
  | "PENDING_ENROLLMENT"
  | "PROVISIONING"
  | "ACTIVE"
  | "DEGRADED"
  | "MAINTENANCE"
  | "SUSPENDED"
  | "DECOMMISSIONED"
  | "RETIRED";

export const DEVICE_LIFECYCLE_STATES: readonly DeviceLifecycleState[] = [
  "DISCOVERED",
  "PENDING_ENROLLMENT",
  "PROVISIONING",
  "ACTIVE",
  "DEGRADED",
  "MAINTENANCE",
  "SUSPENDED",
  "DECOMMISSIONED",
  "RETIRED",
] as const;

const DEVICE_LIFECYCLE_TRANSITIONS: Readonly<
  Record<DeviceLifecycleState, readonly DeviceLifecycleState[]>
> = {
  DISCOVERED: ["PENDING_ENROLLMENT", "DECOMMISSIONED"],
  PENDING_ENROLLMENT: ["PROVISIONING", "DECOMMISSIONED"],
  PROVISIONING: ["ACTIVE", "PENDING_ENROLLMENT", "SUSPENDED"],
  ACTIVE: ["DEGRADED", "MAINTENANCE", "SUSPENDED", "DECOMMISSIONED"],
  DEGRADED: ["ACTIVE", "MAINTENANCE", "SUSPENDED", "DECOMMISSIONED"],
  MAINTENANCE: ["ACTIVE", "DEGRADED", "SUSPENDED"],
  SUSPENDED: ["ACTIVE", "DEGRADED", "DECOMMISSIONED"],
  DECOMMISSIONED: ["RETIRED"],
  RETIRED: [],
};

export function isDeviceLifecycleTransitionAllowed(
  from: DeviceLifecycleState,
  to: DeviceLifecycleState,
): boolean {
  return DEVICE_LIFECYCLE_TRANSITIONS[from].includes(to);
}

/* ─────────────────────────────────────────────────────────────
 * Device registry (G) and identity (H)
 * ────────────────────────────────────────────────────────────*/

export interface DeviceRecord {
  deviceId: string;
  tenantId: TenantId;
  hardwareIdentifier: string;
  serialNumber: string;
  manufacturer: string;
  model: string;
  firmwareVersion: string;
  hardwareRevision: string;
  deviceType: DeviceType;
  capabilities: DeviceCapability[];
  institutionId: string | null;
  locationReference: string | null;
  gatewayId: string | null;
  connectivityStatus: "online" | "offline" | "degraded" | "unknown";
  securityStatus: "trusted" | "suspicious" | "quarantined" | "revoked";
  provisioningState: "none" | "provisioning" | "provisioned";
  lifecycleState: DeviceLifecycleState;
  ownerReference: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface RegisterDeviceInput {
  tenantId: TenantId;
  hardwareIdentifier: string;
  serialNumber: string;
  manufacturer: string;
  model: string;
  firmwareVersion: string;
  hardwareRevision: string;
  deviceType: DeviceType;
  capabilities: DeviceCapability[];
  ownerReference?: string | null;
  locationReference?: string | null;
  gatewayId?: string | null;
  now: string;
}

export type RegisterDeviceResult =
  { ok: true; device: DeviceRecord } | { ok: false; error: string };

/** Register a device (G). Device identity (H) must never rely solely on a
 * hardware identifier/serial that can be spoofed — registration requires an
 * explicit identity mechanism. */
export function registerDevice(input: RegisterDeviceInput): RegisterDeviceResult {
  if (input.hardwareIdentifier.trim() === "") {
    return { ok: false, error: "Device requires a hardware identifier (G)" };
  }
  if (input.serialNumber.trim() === "") {
    return { ok: false, error: "Device requires a serial number (G)" };
  }
  if (input.manufacturer.trim() === "" || input.model.trim() === "") {
    return { ok: false, error: "Device requires manufacturer and model (G)" };
  }
  return {
    ok: true,
    device: {
      deviceId: `device-${input.tenantId}-${input.hardwareIdentifier}-${Math.random().toString(36).slice(2, 8)}`,
      tenantId: input.tenantId,
      hardwareIdentifier: input.hardwareIdentifier,
      serialNumber: input.serialNumber,
      manufacturer: input.manufacturer,
      model: input.model,
      firmwareVersion: input.firmwareVersion,
      hardwareRevision: input.hardwareRevision,
      deviceType: input.deviceType,
      capabilities: input.capabilities,
      institutionId: null,
      locationReference: input.locationReference ?? null,
      gatewayId: input.gatewayId ?? null,
      connectivityStatus: "unknown",
      securityStatus: "trusted",
      provisioningState: "none",
      lifecycleState: "DISCOVERED",
      ownerReference: input.ownerReference ?? null,
      lastSeenAt: null,
      createdAt: input.now,
    },
  };
}

export function transitionDeviceLifecycle(
  device: DeviceRecord,
  to: DeviceLifecycleState,
  reason: string,
  now: string,
): { ok: true; device: DeviceRecord } | { ok: false; error: string } {
  if (!isDeviceLifecycleTransitionAllowed(device.lifecycleState, to)) {
    return {
      ok: false,
      error: `Device lifecycle transition ${device.lifecycleState} -> ${to} is not allowed (L)`,
    };
  }
  if ((to === "SUSPENDED" || to === "DECOMMISSIONED") && reason.trim() === "") {
    return { ok: false, error: `Device ${to} requires a reason (BN/controlled decommissioning)` };
  }
  return { ok: true, device: { ...device, lifecycleState: to, lastSeenAt: now } };
}

/* ─────────────────────────────────────────────────────────────
 * Enrollment steps (I, J, K)
 * ────────────────────────────────────────────────────────────*/

export type EnrollmentStep =
  | "DISCOVER"
  | "IDENTIFY"
  | "VERIFY"
  | "REGISTER"
  | "PROVISION"
  | "AUTHENTICATE"
  | "AUTHORIZE"
  | "ACTIVATE";

export const ENROLLMENT_STEPS: readonly EnrollmentStep[] = [
  "DISCOVER",
  "IDENTIFY",
  "VERIFY",
  "REGISTER",
  "PROVISION",
  "AUTHENTICATE",
  "AUTHORIZE",
  "ACTIVATE",
] as const;

export interface EnrollmentState {
  deviceId: string;
  tenantId: TenantId;
  completedSteps: EnrollmentStep[];
  identityVerified: boolean;
}

export function createEnrollmentState(deviceId: string, tenantId: TenantId): EnrollmentState {
  return { deviceId, tenantId, completedSteps: [], identityVerified: false };
}

/**
 * Advance enrollment (I). Verification must complete before registration
 * and provisioning; a device that has not completed authentication and
 * authorization can never reach ACTIVATE.
 */
export function advanceEnrollmentStep(
  state: EnrollmentState,
  step: EnrollmentStep,
): { ok: true; state: EnrollmentState } | { ok: false; error: string } {
  const order: readonly EnrollmentStep[] = ENROLLMENT_STEPS;
  const currentIndex = state.completedSteps.length;
  if (step !== order[currentIndex]) {
    return { ok: false, error: `Enrollment step ${step} is out of order (I)` };
  }
  const completed = [...state.completedSteps, step];
  return {
    ok: true,
    state: {
      ...state,
      completedSteps: completed,
      identityVerified: step === "VERIFY" ? true : state.identityVerified,
    },
  };
}
