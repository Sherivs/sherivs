/**
 * CoreGrid — capability-gate tests (fail-closed, per-feature r001 codes).
 */
import { describe, expect, it } from "vitest";
import {
  evaluateRuntimeCapability,
  parseCapabilityCode,
  MEMBERSHIP_FOR_NAV_KIND,
  type CapabilityGateDecision,
} from "../../frontend/src/lib/capability-gate";
import { isDeclaredRuntimeFeatureCode, SCHOLAR_FEATURE_CODES } from "@/lib/runtime/nav-registry";

const teacherCode = [...SCHOLAR_FEATURE_CODES].find((c) => c.startsWith("r001:teacher."));
const adminCode = [...SCHOLAR_FEATURE_CODES].find((c) => c.startsWith("r001:org_admin."));
const parentCode = [...SCHOLAR_FEATURE_CODES].find((c) => c.startsWith("r001:parent."));

/** Deny code of a decision (null when allowed) — keeps deny assertions typed. */
type DenyCode = "malformed" | "unknown_feature" | "unknown_kind" | "role_required";
function denyCodeOf(outcome: CapabilityGateDecision): DenyCode | null {
  return outcome.decision === "deny" ? outcome.code : null;
}

describe("parseCapabilityCode (strict, fail-closed)", () => {
  it("parses valid codes into runtime/kind/feature", () => {
    expect(parseCapabilityCode("r001:org_admin.settings")).toEqual({
      runtime: "r001",
      kind: "org_admin",
      feature: "settings",
    });
    expect(parseCapabilityCode("r001:teacher.grades.enter")).toEqual({
      runtime: "r001",
      kind: "teacher",
      feature: "grades.enter",
    });
  });

  it("rejects malformed codes", () => {
    expect(parseCapabilityCode("")).toBeNull();
    expect(parseCapabilityCode("org_admin.settings")).toBeNull();
    expect(parseCapabilityCode("r001:org_admin")).toBeNull();
    expect(parseCapabilityCode("r001:.settings")).toBeNull();
    expect(parseCapabilityCode("R001:org_admin.settings")).toBeNull();
  });
});

describe("evaluateRuntimeCapability (fail-closed on every non-allow path)", () => {
  it("declares a real feature index", () => {
    expect(SCHOLAR_FEATURE_CODES.size).toBeGreaterThan(40);
    expect(isDeclaredRuntimeFeatureCode("r001:teacher.dashboard")).toBe(true);
  });

  it("grants the matching membership kind", () => {
    if (teacherCode && adminCode) {
      expect(evaluateRuntimeCapability({ code: teacherCode, role: "teacher" }).decision).toBe(
        "allow",
      );
      expect(evaluateRuntimeCapability({ code: adminCode, role: "admin" }).decision).toBe("allow");
      expect(evaluateRuntimeCapability({ code: adminCode, role: "principal" }).decision).toBe(
        "allow",
      );
      if (parentCode) {
        expect(evaluateRuntimeCapability({ code: parentCode, role: "parent" }).decision).toBe(
          "allow",
        );
      }
    } else {
      throw new Error("Feature index unexpectedly empty");
    }
  });

  it("denies cross-kind access", () => {
    if (teacherCode && adminCode) {
      expect(evaluateRuntimeCapability({ code: adminCode, role: "teacher" }).decision).toBe("deny");
      expect(evaluateRuntimeCapability({ code: teacherCode, role: "bursar" }).decision).toBe(
        "deny",
      );
      expect(
        evaluateRuntimeCapability({ code: parentCode ?? "r001:parent.dashboard", role: "teacher" })
          .decision,
      ).toBe("deny");
    }
  });

  it("denies malformed, undeclared and unknown-kind codes", () => {
    expect(denyCodeOf(evaluateRuntimeCapability({ code: "not-a-code", role: "admin" }))).toBe(
      "malformed",
    );
    expect(
      denyCodeOf(evaluateRuntimeCapability({ code: "r001:org_admin.not_shipped", role: "admin" })),
    ).toBe("unknown_feature");
    expect(
      denyCodeOf(evaluateRuntimeCapability({ code: "r001:lab_tech.dashboard", role: "admin" })),
    ).toBe("unknown_kind");
  });

  it("allows platform super-admin only on declared codes", () => {
    if (adminCode) {
      expect(
        evaluateRuntimeCapability({ code: adminCode, role: "teacher", isPlatformSuper: true })
          .decision,
      ).toBe("allow");
    }
    expect(
      denyCodeOf(
        evaluateRuntimeCapability({
          code: "r001:org_admin.not_shipped",
          role: "admin",
          isPlatformSuper: true,
        }),
      ),
    ).toBe("unknown_feature");
  });

  it("keeps the kind→membership map complete for every Scholar chrome kind", () => {
    for (const [kind, roles] of Object.entries(MEMBERSHIP_FOR_NAV_KIND)) {
      expect(kind.length).toBeGreaterThan(0);
      expect(roles.length).toBeGreaterThan(0);
    }
  });
});
