import { describe, expect, it } from "vitest";
import {
  JARVIS_DENIED,
  JARVIS_PERMISSIONS,
  JARVIS_SERVICE_ACTOR,
  JARVIS_SERVICE_CODE,
  authorizeService,
  jarvisServiceIdentity,
  registryRowIsValid,
  type ServiceRegistryRow,
} from "../../frontend/src/lib/jarvis-bridge/service-identity";

const row = (over: Partial<ServiceRegistryRow> = {}): ServiceRegistryRow => ({
  code: JARVIS_SERVICE_CODE,
  status: "active",
  permissions: [...JARVIS_PERMISSIONS],
  ...over,
});

describe("JARVIS service identity", () => {
  it("is named svc:jarvis and uses short-lived credentials only", () => {
    expect(JARVIS_SERVICE_ACTOR).toBe("svc:jarvis");
    const id = jarvisServiceIdentity("owner-1", "2026-11-16T00:00:00.000Z");
    expect(id.credentialPolicy).toBe("short_lived");
    expect(id.environment).toEqual(["production"]);
  });

  it("allows exactly the granted permissions while active", () => {
    for (const p of JARVIS_PERMISSIONS)
      expect(authorizeService(row(), p)).toEqual({ allowed: true });
    expect(authorizeService(row({ permissions: ["signals.read"] }), "owner_alert.write")).toEqual({
      allowed: false,
      reason: "not_granted",
    });
  });

  it("allows nothing when missing, suspended or revoked", () => {
    expect(authorizeService(null, "signals.read")).toEqual({
      allowed: false,
      reason: "not_registered",
    });
    expect(authorizeService(row({ code: "someone-else" }), "signals.read")).toEqual({
      allowed: false,
      reason: "not_registered",
    });
    for (const status of ["suspended", "revoked"] as const)
      expect(authorizeService(row({ status }), "signals.read")).toEqual({
        allowed: false,
        reason: "not_active",
      });
  });

  it("can never decide an approval, read secrets or move money, even if a row lists them", () => {
    const greedy = row({ permissions: [...JARVIS_PERMISSIONS, ...JARVIS_DENIED] });
    for (const p of JARVIS_DENIED)
      expect(authorizeService(greedy, p)).toEqual({ allowed: false, reason: "denied_permission" });
    expect(registryRowIsValid(greedy)).toBe(false);
    expect(registryRowIsValid(row())).toBe(true);
    expect(JARVIS_PERMISSIONS.some((p) => (JARVIS_DENIED as readonly string[]).includes(p))).toBe(
      false,
    );
  });

  it("refuses a permission nobody defined", () => {
    expect(authorizeService(row({ permissions: ["anything.goes"] }), "anything.goes")).toEqual({
      allowed: false,
      reason: "not_granted",
    });
  });
});
