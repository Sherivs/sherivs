// ─── Phase 22 — Mobile Platform: platform-device ─────────────────────
import { describe, it, expect } from "vitest";
import {
  getDeviceTrustLevel,
  checkMinimumDeviceRequirements,
  hasCameraPermission,
  evaluateBiometricAuth,
  assessDeviceTrust,
} from "@/lib/platform-device";
import type { DeviceTrustAssessment } from "@/lib/platform-device";

describe("platform-device — Device Trust", () => {
  it("returns trusted for clean device", () => {
    const a: DeviceTrustAssessment = {
      level: "trusted",
      jailbreakDetected: false,
      emulatorDetected: false,
      debugModeDetected: false,
      compromisedOS: false,
      untrustedCertificate: false,
      screenSharingDetected: false,
      timestamp: "",
    };
    expect(getDeviceTrustLevel(a)).toBe("trusted");
  });

  it("returns compromised for jailbroken device", () => {
    const a: DeviceTrustAssessment = {
      level: "trusted",
      jailbreakDetected: true,
      emulatorDetected: false,
      debugModeDetected: false,
      compromisedOS: false,
      untrustedCertificate: false,
      screenSharingDetected: false,
      timestamp: "",
    };
    expect(getDeviceTrustLevel(a)).toBe("compromised");
  });

  it("returns emulator for emulator device", () => {
    const a: DeviceTrustAssessment = {
      level: "trusted",
      jailbreakDetected: false,
      emulatorDetected: true,
      debugModeDetected: false,
      compromisedOS: false,
      untrustedCertificate: false,
      screenSharingDetected: false,
      timestamp: "",
    };
    expect(getDeviceTrustLevel(a)).toBe("emulator");
  });
});

describe("platform-device — Minimum Requirements", () => {
  it("passes when all requirements met", () => {
    const caps = {
      camera: true,
      microphone: true,
      location: true,
      biometrics: true,
      faceId: true,
      touchId: false,
      nfc: true,
      bluetooth: true,
      notifications: true,
      backgroundProcessing: true,
      fileSystem: true,
      secureEnclave: true,
      clipboard: true,
      haptics: true,
    };
    const r = checkMinimumDeviceRequirements(caps);
    expect(r.meets).toBe(true);
  });

  it("fails when notifications missing", () => {
    const caps = {
      camera: true,
      microphone: true,
      location: true,
      biometrics: true,
      faceId: true,
      touchId: false,
      nfc: true,
      bluetooth: true,
      notifications: false,
      backgroundProcessing: true,
      fileSystem: true,
      secureEnclave: true,
      clipboard: true,
      haptics: true,
    };
    const r = checkMinimumDeviceRequirements(caps);
    expect(r.meets).toBe(false);
    expect(r.missing).toContain("notifications");
  });
});

describe("platform-device — Camera Permission", () => {
  it("grants access when permitted", () => {
    expect(hasCameraPermission("granted")).toBe(true);
  });
  it("denies access when not permitted", () => {
    expect(hasCameraPermission("denied")).toBe(false);
  });
});

describe("platform-device — Biometric Auth", () => {
  it("returns successful auth", () => {
    const r = evaluateBiometricAuth(true, "face");
    expect(r.authenticated).toBe(true);
    expect(r.biometricType).toBe("face");
  });

  it("returns failed auth", () => {
    const r = evaluateBiometricAuth(false, null, "User cancelled");
    expect(r.authenticated).toBe(false);
    expect(r.error).toBe("User cancelled");
  });
});

describe("platform-device — Assess Device Trust", () => {
  it("returns trusted for clean params", () => {
    const r = assessDeviceTrust({});
    expect(r.level).toBe("trusted");
  });

  it("returns compromised when jailbreak detected", () => {
    const r = assessDeviceTrust({ jailbreakDetected: true });
    expect(r.level).toBe("compromised");
  });

  it("returns unknown when debug mode detected", () => {
    const r = assessDeviceTrust({ debugModeDetected: true });
    expect(r.level).toBe("unknown");
  });
});
