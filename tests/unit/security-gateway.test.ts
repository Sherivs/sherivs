/**
 * CoreGrid — Live Security Gateway unit tests (Stage S1).
 *
 * Validates:
 * - classifyAuthorizationSignal fail-closed defaults (DENY unless proven).
 * - buildGatewayInput maps live signals onto the Phase 08 contract.
 * - runSecurityGateway allows school-admin/tenant-scoped calls and throws
 *   structured SecurityGatewayError (code + actor + decision) on any denial.
 * - Tenant A cannot be reached through a Tenant B actor id (actor id is never
 *   used as a tenant signal; tenant comes only from the DB assertion).
 */

import { describe, expect, it } from "vitest";
import {
  classifyAuthorizationSignal,
  buildGatewayInput,
  runSecurityGateway,
  SecurityGatewayError,
  type LiveSecuritySignals,
} from "@/lib/security-gateway.server";

function signals(overrides: Partial<LiveSecuritySignals> = {}): LiveSecuritySignals {
  return {
    actorId: "user-tenant-a",
    hasActiveSession: true,
    schoolAdmin: true,
    schoolId: "tenant-a",
    role: null,
    withinRateLimit: true,
    requestIntegrityValid: true,
    ...overrides,
  };
}

describe("classifyAuthorizationSignal", () => {
  it("ALLOWs a proven school admin", () => {
    expect(classifyAuthorizationSignal({ schoolAdmin: true, role: null })).toBe("ALLOW");
  });

  it("ALLOWs platform/super_admin roles", () => {
    expect(classifyAuthorizationSignal({ schoolAdmin: false, role: "super_admin" })).toBe("ALLOW");
    expect(classifyAuthorizationSignal({ schoolAdmin: null, role: "platform" })).toBe("ALLOW");
  });

  it("DENYs by default (fail closed)", () => {
    expect(classifyAuthorizationSignal({ schoolAdmin: false, role: null })).toBe("DENY");
    expect(classifyAuthorizationSignal({ schoolAdmin: null, role: null })).toBe("DENY");
  });
});

describe("buildGatewayInput", () => {
  it("maps a valid school-admin call to a full allow-path input", () => {
    const input = buildGatewayInput(signals());
    expect(input).toEqual({
      identityValid: true,
      tenantContextValid: true,
      sessionValid: true,
      withinRateLimit: true,
      requestIntegrityValid: true,
      authorizationDecision: "ALLOW",
    });
  });

  it("does not derive tenant context from the actor id", () => {
    const input = buildGatewayInput(signals({ actorId: "user-tenant-b", schoolId: null }));
    expect(input.tenantContextValid).toBe(false);
  });
});

describe("runSecurityGateway", () => {
  it("allows a tenant-scoped school admin and returns the resolved tenant", () => {
    const result = runSecurityGateway(signals());
    expect(result.decision).toBe("allow");
    expect(result.actorId).toBe("user-tenant-a");
    expect(result.tenantId).toBe("tenant-a");
  });

  it("denies a non-admin (FORBIDDEN)", () => {
    expect(() => runSecurityGateway(signals({ schoolAdmin: false }))).toThrowError(SecurityGatewayError);
    try {
      runSecurityGateway(signals({ schoolAdmin: false }));
    } catch (error) {
      const e = error as SecurityGatewayError;
      expect(e.code).toBe("FORBIDDEN");
      expect(e.decision).toBe("deny");
      expect(e.actorId).toBe("user-tenant-a");
    }
  });

  it("denies when tenant context is missing (TENANT_REQUIRED)", () => {
    try {
      runSecurityGateway(signals({ schoolId: null }));
    } catch (error) {
      expect((error as SecurityGatewayError).code).toBe("TENANT_REQUIRED");
    }
  });

  it("denies an unauthenticated actor (UNAUTHENTICATED)", () => {
    try {
      runSecurityGateway(signals({ actorId: "", hasActiveSession: false }));
    } catch (error) {
      expect((error as SecurityGatewayError).code).toBe("UNAUTHENTICATED");
    }
  });

  it("denies an invalid request (INVALID_REQUEST)", () => {
    try {
      runSecurityGateway(signals({ requestIntegrityValid: false }));
    } catch (error) {
      expect((error as SecurityGatewayError).code).toBe("INVALID_REQUEST");
    }
  });

  it("throttles when the rate limit is exceeded (RATE_LIMITED)", () => {
    try {
      runSecurityGateway(signals({ withinRateLimit: false }));
    } catch (error) {
      expect((error as SecurityGatewayError).code).toBe("RATE_LIMITED");
    }
  });

  it("never allows through an empty or blank school id", () => {
    expect(() => runSecurityGateway(signals({ schoolId: "   " }))).toThrowError(SecurityGatewayError);
  });
});
