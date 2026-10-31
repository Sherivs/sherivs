import { describe, expect, it } from "vitest";
import {
  pickIdentifierMatch,
  resolveSignInIdentifier,
} from "../../frontend/src/lib/auth/resolve-sign-in-identifier";
import { organizationAccessDecision } from "../../frontend/src/lib/auth/organization-access";
import { hostnameFromOriginHeader } from "../../frontend/src/lib/auth/resolve-sign-in-identifier";

const ada = {
  schoolId: "school-a",
  userId: "user-a",
  email: "ada@school.edu",
  active: true,
};
const beau = {
  schoolId: "school-b",
  userId: "user-b",
  email: "beau@school.edu",
  active: true,
};

describe("organization ID resolution", () => {
  it("keeps email and phone on the direct GoTrue path", () => {
    expect(resolveSignInIdentifier({ raw: "Ada@School.edu", schoolId: null, matches: [] })).toEqual(
      {
        status: "direct",
        identifier: { kind: "email", value: "ada@school.edu" },
      },
    );
    expect(resolveSignInIdentifier({ raw: "+2348012345678", schoolId: null, matches: [] })).toEqual(
      {
        status: "direct",
        identifier: { kind: "phone", value: "+2348012345678" },
      },
    );
  });

  it("resolves a unique admission number inside the current school", () => {
    expect(pickIdentifierMatch({ matches: [ada, beau], schoolId: "school-a" })).toEqual({
      status: "resolved",
      identifier: { kind: "email", value: "ada@school.edu" },
    });
  });

  it("does not pick an arbitrary account when the ID is used in several schools", () => {
    expect(pickIdentifierMatch({ matches: [ada, beau], schoolId: null })).toEqual({
      status: "ambiguous",
    });
  });

  it("does not disclose a missing identifier", () => {
    expect(pickIdentifierMatch({ matches: [], schoolId: "school-a" })).toEqual({ status: "none" });
  });

  it("ignores inactive memberships", () => {
    expect(
      pickIdentifierMatch({
        matches: [{ ...ada, active: false }],
        schoolId: "school-a",
      }),
    ).toEqual({ status: "none" });
  });
});

describe("organization access decision", () => {
  it("allows only an active member of an active organization in the requested tenant", () => {
    expect(
      organizationAccessDecision({
        hasActiveMembership: true,
        organizationActive: true,
        schoolIdMatchesTenant: true,
      }),
    ).toBe("allow");
    expect(
      organizationAccessDecision({
        hasActiveMembership: false,
        organizationActive: true,
        schoolIdMatchesTenant: true,
      }),
    ).toBe("deny");
    expect(
      organizationAccessDecision({
        hasActiveMembership: true,
        organizationActive: false,
        schoolIdMatchesTenant: true,
      }),
    ).toBe("deny");
    expect(
      organizationAccessDecision({
        hasActiveMembership: true,
        organizationActive: true,
        schoolIdMatchesTenant: false,
      }),
    ).toBe("deny");
  });
});

describe("origin hostname parsing", () => {
  it("reads the Origin header and ignores a bare Host value", () => {
    expect(hostnameFromOriginHeader("https://lincoln.sherivs.com")).toBe("lincoln.sherivs.com");
    expect(hostnameFromOriginHeader("not-a-url")).toBeNull();
    expect(hostnameFromOriginHeader(null)).toBeNull();
  });
});
