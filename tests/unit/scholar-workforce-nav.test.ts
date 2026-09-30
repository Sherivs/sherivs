/**
 * CoreGrid — Scholar workforce-kind → chrome resolution invariants (R-3).
 *
 * Pins the SHRINK-ONLY safety contract: a staff member's real post can drive
 * their own chrome/labels but can never escalate capability beyond the coarse
 * membership set, and can never lock a member out.
 */
import { describe, expect, it } from "vitest";
import { SCHOLAR_WORKFORCE_KINDS } from "../../frontend/src/lib/runtime/scholar-workforce";
import {
  scholarCapabilitiesForPrimaryPosition,
  scholarCapabilitiesForWorkforceKindCode,
  scholarChromeKindForAuthorityGroup,
  scholarChromeKindForWorkforceKindCode,
  scholarWorkspaceLabelForMember,
} from "../../frontend/src/lib/runtime/scholar-workforce-nav";
import { scholarCapabilitiesForKind, scholarCapabilitiesForRole } from "@/lib/runtime/nav-registry";
import type { AppRole } from "../../frontend/src/lib/roles";

describe("authority group → chrome kind mapping (R-001 data)", () => {
  it("maps only groups with dedicated R-001 chrome", () => {
    expect(scholarChromeKindForAuthorityGroup("org_admin")).toBe("org_admin");
    expect(scholarChromeKindForAuthorityGroup("teaching_leadership")).toBe("teacher");
    expect(scholarChromeKindForAuthorityGroup("teaching_staff")).toBe("teacher");
    expect(scholarChromeKindForAuthorityGroup("finance_officer")).toBe("bursar");
    expect(scholarChromeKindForAuthorityGroup("transport")).toBe("driver");
    expect(scholarChromeKindForAuthorityGroup("governance")).toBeNull();
    expect(scholarChromeKindForAuthorityGroup("learner_welfare")).toBeNull();
    expect(scholarChromeKindForAuthorityGroup("administration")).toBeNull();
    expect(scholarChromeKindForAuthorityGroup("security")).toBeNull();
  });

  it("resolves real staff kinds and rejects unknown codes", () => {
    expect(scholarChromeKindForWorkforceKindCode("head_of_school")).toBe("org_admin");
    expect(scholarChromeKindForWorkforceKindCode("subject_teacher")).toBe("teacher");
    expect(scholarChromeKindForWorkforceKindCode("examination_officer")).toBe("teacher");
    expect(scholarChromeKindForWorkforceKindCode("bursar")).toBe("bursar");
    expect(scholarChromeKindForWorkforceKindCode("driver")).toBe("driver");
    expect(scholarChromeKindForWorkforceKindCode("laboratory_technician")).toBeNull();
    expect(scholarChromeKindForWorkforceKindCode("records_officer")).toBeNull();
    expect(scholarChromeKindForWorkforceKindCode("registrar")).toBeNull();
    expect(scholarChromeKindForWorkforceKindCode("school_nurse")).toBeNull();
    expect(scholarChromeKindForWorkforceKindCode("not_a_kind")).toBeNull();
  });
});

describe("shrink-only capability resolution (no escalation, no lockout)", () => {
  it("never returns capabilities outside the coarse membership set", () => {
    for (const kind of SCHOLAR_WORKFORCE_KINDS) {
      const chrome = scholarChromeKindForWorkforceKindCode(kind.kindCode);
      if (!chrome) continue;
      const derived = scholarCapabilitiesForWorkforceKindCode(kind.kindCode);
      const coarse = scholarCapabilitiesForKind(chrome);
      expect(derived).not.toBeNull();
      for (const capability of derived ?? []) {
        expect(coarse.has(capability)).toBe(true);
      }
    }
  });

  it("never expands any coarse membership set for ANY staff kind", () => {
    const coarseRoles: AppRole[] = [
      "admin",
      "principal",
      "teacher",
      "bursar",
      "driver",
      "hq",
      "super_admin",
    ];
    for (const role of coarseRoles) {
      const base = scholarCapabilitiesForRole(role);
      for (const kind of SCHOLAR_WORKFORCE_KINDS) {
        const resolved = scholarCapabilitiesForPrimaryPosition(kind.kindCode, base);
        expect(resolved.size).toBeLessThanOrEqual(base.size);
        for (const capability of resolved) {
          expect(base.has(capability)).toBe(true);
        }
      }
    }
  });

  it("keeps membership unchanged when position chrome does not intersect", () => {
    // Mis-assigned driver position on an org-admin membership: never locks
    // the admin out and never grants driver chrome over admin.
    const adminCaps = scholarCapabilitiesForRole("admin" as AppRole);
    expect(scholarCapabilitiesForPrimaryPosition("driver", adminCaps)).toBe(adminCaps);
  });

  it("keeps membership unchanged for posts with no dedicated chrome", () => {
    const teacherCaps = scholarCapabilitiesForRole("teacher" as AppRole);
    expect(scholarCapabilitiesForPrimaryPosition("laboratory_technician", teacherCaps)).toBe(
      teacherCaps,
    );
    expect(scholarCapabilitiesForPrimaryPosition("records_officer", teacherCaps)).toBe(teacherCaps);
  });

  it("is unchanged when membership already matches the position chrome", () => {
    const teacherCaps = scholarCapabilitiesForRole("teacher" as AppRole);
    const resolved = scholarCapabilitiesForPrimaryPosition("subject_teacher", teacherCaps);
    expect(resolved.size).toBe(teacherCaps.size);
    expect([...resolved].every((c) => teacherCaps.has(c))).toBe(true);
  });
});

describe("member workspace label", () => {
  it("prefers the real post title when a primary position exists", () => {
    expect(scholarWorkspaceLabelForMember("subject_teacher", "Educator")).toBe(
      "Subject and Class Teacher",
    );
    expect(scholarWorkspaceLabelForMember("head_of_school", "Organization administrator")).toBe(
      "Head Teacher",
    );
  });

  it("falls back to the membership label without a position or on unknown codes", () => {
    expect(scholarWorkspaceLabelForMember(null, "Educator")).toBe("Educator");
    expect(scholarWorkspaceLabelForMember("not_a_kind", "Educator")).toBe("Educator");
  });
});
