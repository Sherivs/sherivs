/**
 * CoreGrid Scholar — Phase 15 Hardware Integration Platform unit tests
 * (hardware-commands).
 *
 * Validates:
 * - Command model (AH) and lifecycle (AI): strict state transitions.
 * - Command authorization (AJ): capability, role, impact checks.
 * - High-risk commands (AK): approval required for destructive impact.
 * - Safety boundary (AL/AM): safety stop preempts normal command policy.
 * - Idempotency (AN), expiry (AO), verification (AP).
 * - Device operational state (AQ): commands only in OPERATIONAL/DEGRADED.
 */

import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  issueCommand,
  transitionCommandState,
  authorizeCommand,
  issueSafetyStop,
  releaseSafetyStop,
  isCommandBlockedBySafetyStop,
  isDuplicateCommand,
  isCommandExpired,
  canAcceptCommands,
  isCommandTransitionAllowed,
  type HardwareCommand,
} from "@/lib/hardware-commands";

const TENANT_A = tenantId("tenant-a");
const NOW = "2026-01-01T00:00:00Z";
const LATER = "2026-01-01T00:05:00Z";

function command(overrides: Partial<HardwareCommand> = {}): HardwareCommand {
  return {
    commandId: "cmd-1",
    deviceId: "device-1",
    tenantId: TENANT_A,
    type: "unlock",
    impact: "REVERSIBLE",
    payload: {},
    status: "QUEUED",
    requester: "user-1",
    requestedAt: NOW,
    expiresAt: LATER,
    idempotencyKey: "idem-1",
    approvalRequired: false,
    approvedBy: null,
    verification: null,
    failureReason: null,
    ...overrides,
  };
}

describe("Command model and issue (AH)", () => {
  it("issues a command in QUEUED state with full metadata", () => {
    const result = issueCommand({
      deviceId: "device-1",
      tenantId: TENANT_A,
      type: "lock",
      impact: "REVERSIBLE",
      payload: { reason: "test" },
      requester: "user-1",
      requestedAt: NOW,
      expiresAt: LATER,
      idempotencyKey: "idem-1",
      approvalRequired: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.status).toBe("QUEUED");
      expect(result.command.approvalRequired).toBe(false);
      expect(result.command.verification).toBeNull();
    }
  });

  it("rejects a command without an idempotency key", () => {
    const result = issueCommand({
      deviceId: "device-1",
      tenantId: TENANT_A,
      type: "lock",
      impact: "REVERSIBLE",
      payload: {},
      requester: "user-1",
      requestedAt: NOW,
      expiresAt: LATER,
      idempotencyKey: "",
      approvalRequired: false,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a command whose expiry is not after request time", () => {
    const result = issueCommand({
      deviceId: "device-1",
      tenantId: TENANT_A,
      type: "lock",
      impact: "REVERSIBLE",
      payload: {},
      requester: "user-1",
      requestedAt: NOW,
      expiresAt: NOW,
      idempotencyKey: "idem-1",
      approvalRequired: false,
    });
    expect(result.ok).toBe(false);
  });
});

describe("Command lifecycle (AI)", () => {
  it("walks the happy path QUEUED -> ... -> VERIFIED", () => {
    let c = command();
    for (const next of [
      "VALIDATED",
      "AUTHORIZED",
      "TRANSMITTED",
      "ACKNOWLEDGED",
      "EXECUTED",
      "VERIFIED",
    ] as const) {
      const r = transitionCommandState(c, next);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error("transition failed");
      c = r.command;
    }
    expect(c.status).toBe("VERIFIED");
  });

  it("blocks an illegal QUEUED -> EXECUTED jump", () => {
    expect(isCommandTransitionAllowed("QUEUED", "EXECUTED")).toBe(false);
    const result = transitionCommandState(command(), "EXECUTED");
    expect(result.ok).toBe(false);
  });

  it("sets verification to UNVERIFIED on EXECUTED", () => {
    const r = transitionCommandState(command({ status: "ACKNOWLEDGED" }), "EXECUTED");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command.verification).toBe("UNVERIFIED");
    }
  });

  it("records a failure reason when a command fails", () => {
    const r = transitionCommandState(command({ status: "TRANSMITTED" }), "FAILED", {
      failureReason: "timeout",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command.failureReason).toBe("timeout");
    }
  });

  it("detects an expired command (AO)", () => {
    const expired = command({ expiresAt: "2025-01-01T00:00:00Z" });
    expect(isCommandExpired(expired, NOW)).toBe(true);
    expect(isCommandExpired(command(), NOW)).toBe(false);
  });
});

describe("High-risk command approval (AK)", () => {
  it("requires an approving identity to authorize a destructive command", () => {
    const c = command({
      status: "VALIDATED",
      impact: "DESTRUCTIVE",
      approvalRequired: true,
    });
    const unauthorized = transitionCommandState(c, "AUTHORIZED", {});
    expect(unauthorized.ok).toBe(false);
    const authorized = transitionCommandState(c, "AUTHORIZED", { approvedBy: "admin-1" });
    expect(authorized.ok).toBe(true);
    if (authorized.ok) {
      expect(authorized.command.approvedBy).toBe("admin-1");
    }
  });

  describe("Command authorization (AJ)", () => {
    it("authorizes a validated reversible command for an admin", () => {
      const result = authorizeCommand({
        command: command({ status: "VALIDATED", impact: "REVERSIBLE" }),
        requiredCapability: null,
        isAdmin: true,
        isOwner: false,
      });
      expect(result.ok).toBe(true);
    });

    it("rejects a command that is not yet validated", () => {
      const result = authorizeCommand({
        command: command({ status: "QUEUED" }),
        requiredCapability: null,
        isAdmin: true,
        isOwner: false,
      });
      expect(result.ok).toBe(false);
    });

    it("rejects a requester who is neither admin nor owner", () => {
      const result = authorizeCommand({
        command: command({ status: "VALIDATED", impact: "REVERSIBLE" }),
        requiredCapability: null,
        isAdmin: false,
        isOwner: false,
      });
      expect(result.ok).toBe(false);
    });

    it("rejects destructive commands from non-admins", () => {
      const result = authorizeCommand({
        command: command({ status: "VALIDATED", impact: "DESTRUCTIVE" }),
        requiredCapability: null,
        isAdmin: false,
        isOwner: true,
      });
      expect(result.ok).toBe(false);
    });

    it("rejects physical-safety commands from non-admins", () => {
      const result = authorizeCommand({
        command: command({ status: "VALIDATED", impact: "PHYSICAL_SAFETY" }),
        requiredCapability: null,
        isAdmin: false,
        isOwner: true,
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("Safety boundary (AL, AM)", () => {
    it("blocks normal commands while a safety stop is active", () => {
      const stop = issueSafetyStop("device-1", "safety-officer", "fire drill", NOW);
      const blocked = isCommandBlockedBySafetyStop(
        command({ type: "unlock", impact: "REVERSIBLE" }),
        [stop],
      );
      expect(blocked).toBe(true);
    });

    it("allows a stop command even while a safety stop is active", () => {
      const stop = issueSafetyStop("device-1", "safety-officer", "fire drill", NOW);
      const allowed = isCommandBlockedBySafetyStop(
        command({ type: "stop", impact: "DISRUPTIVE" }),
        [stop],
      );
      expect(allowed).toBe(false);
    });

    it("allows physical-safety impact commands during a safety stop", () => {
      const stop = issueSafetyStop("device-1", "safety-officer", "fire drill", NOW);
      const allowed = isCommandBlockedBySafetyStop(
        command({ type: "set", impact: "PHYSICAL_SAFETY" }),
        [stop],
      );
      expect(allowed).toBe(false);
    });

    it("releases a safety stop explicitly", () => {
      const stop = issueSafetyStop("device-1", "safety-officer", "fire drill", NOW);
      const released = releaseSafetyStop(stop, LATER);
      expect(released.active).toBe(false);
      const blocked = isCommandBlockedBySafetyStop(
        command({ type: "unlock", impact: "REVERSIBLE" }),
        [released],
      );
      expect(blocked).toBe(false);
    });
  });

  describe("Idempotency and device state (AN, AQ)", () => {
    it("detects a duplicate transmission by idempotency key", () => {
      const existing = command({ idempotencyKey: "idem-1" });
      expect(isDuplicateCommand(existing, "idem-1")).toBe(true);
      expect(isDuplicateCommand(existing, "idem-2")).toBe(false);
      expect(isDuplicateCommand(null, "idem-1")).toBe(false);
    });

    it("only accepts commands in OPERATIONAL or DEGRADED state", () => {
      expect(canAcceptCommands("OPERATIONAL")).toBe(true);
      expect(canAcceptCommands("DEGRADED")).toBe(true);
      expect(canAcceptCommands("OFFLINE")).toBe(false);
      expect(canAcceptCommands("MAINTENANCE")).toBe(false);
      expect(canAcceptCommands("QUARANTINED")).toBe(false);
    });
  });

  it("cannot transmit an approval-required command before approval", () => {
    const c = command({ status: "AUTHORIZED", approvalRequired: true, approvedBy: null });
    const result = transitionCommandState(c, "TRANSMITTED");
    expect(result.ok).toBe(false);
  });
});
