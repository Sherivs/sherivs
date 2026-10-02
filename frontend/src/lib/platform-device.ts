import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

// ─── CoreGrid Phase 22 — Mobile Platform ─────────────────────────────
// platform-device.ts — Device capability abstraction, camera, microphone,
//                      location, biometrics, file system, device trust
// ──────────────────────────────────────────────────────────────────────

// ─── U. Device Capability Abstraction ────────────────────────────────
export type DevicePlatform = "ios" | "android" | "web" | "windows" | "macos" | "linux";

export interface DeviceInfo {
  readonly platform: DevicePlatform;
  readonly osVersion: string;
  readonly deviceModel: string;
  readonly deviceId: string;
  readonly appVersion: string;
  readonly buildNumber: string;
  readonly locale: string;
  readonly timezone: string;
  readonly screenDimensions: { width: number; height: number; scale: number };
  readonly memoryInfo: { total: number; available: number };
  readonly storageInfo: { total: number; available: number };
  readonly batteryLevel: number | null;
  readonly lowPowerMode: boolean;
}

export interface DeviceCapabilities {
  readonly camera: boolean;
  readonly microphone: boolean;
  readonly location: boolean;
  readonly biometrics: boolean;
  readonly faceId: boolean;
  readonly touchId: boolean;
  readonly nfc: boolean;
  readonly bluetooth: boolean;
  readonly notifications: boolean;
  readonly backgroundProcessing: boolean;
  readonly fileSystem: boolean;
  readonly secureEnclave: boolean;
  readonly clipboard: boolean;
  readonly haptics: boolean;
}

// ─── V–W. Camera & Microphone ────────────────────────────────────────
export type MediaPermissionStatus = "granted" | "denied" | "undetermined" | "restricted";

export interface CameraConfig {
  readonly facing: "front" | "back" | "unspecified";
  readonly flashMode: "on" | "off" | "auto";
  readonly resolution: "low" | "medium" | "high" | "max";
  readonly enableScanning: boolean;
}

export interface MediaCapture {
  readonly uri: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
  readonly durationMs: number | null;
}

// ─── X. Location ──────────────────────────────────────────────────────
export type LocationPermission = "always" | "when_in_use" | "denied" | "restricted";

export interface LocationCoordinates {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy: number;
  readonly altitude: number | null;
  readonly timestamp: string;
}

export interface GeofenceRegion {
  readonly id: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radius: number;
  readonly onEntry: boolean;
  readonly onExit: boolean;
  readonly label: string | null;
}

// ─── Y. Biometrics ────────────────────────────────────────────────────
export type BiometricType = "fingerprint" | "face" | "iris" | "voice";

export interface BiometricAuthResult {
  readonly authenticated: boolean;
  readonly biometricType: BiometricType | null;
  readonly error: string | null;
  readonly timestamp: string;
}
// ─── Z. File System ───────────────────────────────────────────────────
export type FileStorageType = "cache" | "documents" | "temporary" | "secure";

export interface FileRef {
  readonly uri: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storageType: FileStorageType;
  readonly created: string;
}

export interface FileSystemStats {
  readonly freeBytes: number;
  readonly totalBytes: number;
  readonly cacheBytes: number;
  readonly documentsBytes: number;
}

// ─── AV. Device Trust ────────────────────────────────────────────────
export type DeviceTrustLevel = "trusted" | "unknown" | "compromised" | "jailbroken" | "emulator";

export interface DeviceTrustAssessment {
  readonly level: DeviceTrustLevel;
  readonly jailbreakDetected: boolean;
  readonly emulatorDetected: boolean;
  readonly debugModeDetected: boolean;
  readonly compromisedOS: boolean;
  readonly untrustedCertificate: boolean;
  readonly screenSharingDetected: boolean;
  readonly timestamp: string;
}

export interface ApplicationIntegrity {
  readonly signatureValid: boolean;
  readonly packageNameValid: boolean;
  readonly codeSignatureVerified: boolean;
  readonly runtimeIntegrityValid: boolean;
  readonly timestamp: string;
}

// ─── BQ. Networking ──────────────────────────────────────────────────
export interface NetworkInfo {
  readonly connected: boolean;
  readonly type: "wifi" | "cellular" | "ethernet" | "vpn" | "none";
  readonly cellularGeneration: "2g" | "3g" | "4g" | "5g" | null;
  readonly strength: number | null;
  readonly ipAddress: string | null;
  readonly isMetered: boolean;
  readonly isVPN: boolean;
}

// ─── Functions ────────────────────────────────────────────────────────
export function getDeviceTrustLevel(assessment: DeviceTrustAssessment): DeviceTrustLevel {
  if (assessment.jailbreakDetected || assessment.compromisedOS) return "compromised";
  if (assessment.emulatorDetected) return "emulator";
  if (assessment.debugModeDetected || assessment.screenSharingDetected) return "unknown";
  return "trusted";
}

export function checkMinimumDeviceRequirements(caps: DeviceCapabilities): {
  meets: boolean;
  missing: string[];
} {
  const missing: string[] = [];
  if (!caps.notifications) missing.push("notifications");
  if (!caps.fileSystem) missing.push("file_system");
  if (!caps.secureEnclave) missing.push("secure_enclave");
  return { meets: missing.length === 0, missing };
}

export function hasCameraPermission(permission: MediaPermissionStatus): boolean {
  return permission === "granted";
}

export function evaluateBiometricAuth(
  authenticated: boolean,
  biometricType: BiometricType | null,
  error?: string | null,
): BiometricAuthResult {
  return {
    authenticated,
    biometricType,
    error: error ?? null,
    timestamp: timeAuthority.now().at,
  };
}

export function assessDeviceTrust(params: {
  jailbreakDetected?: boolean;
  emulatorDetected?: boolean;
  debugModeDetected?: boolean;
  compromisedOS?: boolean;
  untrustedCertificate?: boolean;
  screenSharingDetected?: boolean;
}): DeviceTrustAssessment {
  const assessment = {
    jailbreakDetected: params.jailbreakDetected ?? false,
    emulatorDetected: params.emulatorDetected ?? false,
    debugModeDetected: params.debugModeDetected ?? false,
    compromisedOS: params.compromisedOS ?? false,
    untrustedCertificate: params.untrustedCertificate ?? false,
    screenSharingDetected: params.screenSharingDetected ?? false,
    timestamp: timeAuthority.now().at,
  };
  return { ...assessment, level: getDeviceTrustLevel(assessment as DeviceTrustAssessment) };
}
