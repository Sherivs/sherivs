import { describe, expect, it } from "vitest";
import {
  consoleSignInSearch,
  decideHostRoute,
  effectiveExperienceHostKind,
  isConsoleOperator,
  isConsolePath,
  isConsoleSurfacePath,
  parseHostKindOverride,
  postSignInPath,
  sanitizeConsoleNextPath,
} from "@/lib/experience/console-host-routing";

const operator = { signedIn: true, isConsoleOperator: true };

describe("console host routing", () => {
  it("classifies console hosts and ignores the override on production hosts", () => {
    expect(effectiveExperienceHostKind("console.sherivs.com")).toBe("internal");
    expect(effectiveExperienceHostKind("internal.sherivs.com")).toBe("internal");
    expect(effectiveExperienceHostKind("app.sherivs.com", "internal")).toBe("app");
    expect(effectiveExperienceHostKind("console.sherivs.com", "app")).toBe("internal");
    expect(effectiveExperienceHostKind("www.sherivs.com", "internal")).toBe("public_platform");
  });

  it("honours the override only on local and preview hosts", () => {
    expect(effectiveExperienceHostKind("localhost", "internal")).toBe("internal");
    expect(effectiveExperienceHostKind("x-git-y.vercel.app", "app")).toBe("app");
    expect(effectiveExperienceHostKind("localhost", "bogus")).toBe("local");
    expect(effectiveExperienceHostKind("localhost", undefined)).toBe("local");
    expect(parseHostKindOverride(" INTERNAL ")).toBe("internal");
    expect(parseHostKindOverride("")).toBeNull();
  });

  it("matches console paths exactly", () => {
    for (const p of ["/console", "/console/", "/console/team", "/console_/access-review"])
      expect(isConsolePath(p)).toBe(true);
    for (const p of ["/", "/internal", "/admin", "/super-admin/staff"])
      expect(isConsolePath(p)).toBe(false);
  });

  it("keeps console-linked surfaces on the console host", () => {
    for (const p of ["/mfa", "/console", "/console/team"])
      expect(isConsoleSurfacePath(p)).toBe(true);
    for (const p of ["/admin", "/super-admin/staff", "/command-centre", "/welcome", "/mfa-x"])
      expect(isConsoleSurfacePath(p)).toBe(false);
    expect(decideHostRoute({ hostKind: "internal", pathname: "/mfa", ...operator }).kind).toBe(
      "allow",
    );
    expect(
      decideHostRoute({ hostKind: "app", pathname: "/super-admin/tenants", ...operator }).kind,
    ).toBe("allow");
  });

  it("on the console host sends operators to /console and blocks non-staff", () => {
    expect(decideHostRoute({ hostKind: "internal", pathname: "/admin", ...operator })).toEqual({
      kind: "redirect",
      to: "/console",
    });
    expect(
      decideHostRoute({ hostKind: "internal", pathname: "/console/team", ...operator }),
    ).toEqual({ kind: "allow" });
    expect(
      decideHostRoute({
        hostKind: "internal",
        pathname: "/console",
        signedIn: true,
        isConsoleOperator: false,
      }),
    ).toEqual({ kind: "not_authorised" });
    expect(
      decideHostRoute({
        hostKind: "internal",
        pathname: "/auth",
        signedIn: false,
        isConsoleOperator: false,
      }),
    ).toEqual({ kind: "allow" });
    expect(
      decideHostRoute({
        hostKind: "internal",
        pathname: "/x",
        signedIn: false,
        isConsoleOperator: false,
      }),
    ).toEqual({ kind: "redirect", to: "/auth" });
  });

  it("does not serve /console on app, public or tenant hosts", () => {
    for (const hostKind of ["app", "public_platform", "tenant"] as const) {
      expect(decideHostRoute({ hostKind, pathname: "/console", ...operator }).kind).toBe(
        "console_elsewhere",
      );
      expect(decideHostRoute({ hostKind, pathname: "/admin", ...operator }).kind).toBe("allow");
    }
    expect(decideHostRoute({ hostKind: "local", pathname: "/console", ...operator }).kind).toBe(
      "allow",
    );
  });

  it("treats super admins and platform staff as operators", () => {
    expect(isConsoleOperator({ superAdmin: { id: "a" } })).toBe(true);
    expect(isConsoleOperator({ platformStaff: { id: "b" } })).toBe(true);
    expect(isConsoleOperator({ superAdmin: null, platformStaff: null })).toBe(false);
  });

  it("sanitizes post-auth next paths to console surfaces only", () => {
    expect(sanitizeConsoleNextPath("/console")).toBe("/console");
    expect(sanitizeConsoleNextPath("/console/team")).toBe("/console/team");
    expect(sanitizeConsoleNextPath("/mfa")).toBe("/mfa");
    expect(sanitizeConsoleNextPath("/console/?x=1")).toBe("/console");
    expect(sanitizeConsoleNextPath("/home")).toBeNull();
    expect(sanitizeConsoleNextPath("/auth")).toBeNull();
    expect(sanitizeConsoleNextPath("//evil.example")).toBeNull();
    expect(sanitizeConsoleNextPath("https://evil.example/console")).toBeNull();
    expect(consoleSignInSearch("/")).toEqual({ next: "/console" });
    expect(consoleSignInSearch("/console/team")).toEqual({ next: "/console/team" });
  });

  it("returns staff to the Internal Console after sign-in", () => {
    expect(
      postSignInPath({
        hostKind: "internal",
        identityDestination: "/console",
        next: "/console/team",
      }),
    ).toBe("/console/team");
    expect(
      postSignInPath({
        hostKind: "internal",
        identityDestination: "/home",
        next: "/home",
      }),
    ).toBe("/console");
    expect(
      postSignInPath({
        hostKind: "local",
        identityDestination: "/console",
        next: "/console/organizations",
      }),
    ).toBe("/console/organizations");
    expect(
      postSignInPath({
        hostKind: "app",
        identityDestination: "/home",
        next: "/console",
      }),
    ).toBe("/home");
    expect(
      postSignInPath({
        hostKind: "local",
        identityDestination: "/console",
      }),
    ).toBe("/console");
  });
});
