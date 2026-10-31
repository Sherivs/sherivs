import { describe, expect, it } from "vitest";
import {
  INVITE_LOGIN_ERROR,
  classifySignInIdentifier,
  toPasswordSignInPayload,
} from "@/lib/auth/sign-in-identifier";
import { buildOnboardingMailto, ONBOARDING_MAILBOX, ONBOARDING_SUBJECT } from "@/lib/auth/onboarding-request";

describe("classifySignInIdentifier", () => {
  it("classifies email, phone, and username without mutating unknown values into emails", () => {
    expect(classifySignInIdentifier("  Ada@School.edu ")).toEqual({
      kind: "email",
      value: "ada@school.edu",
    });
    expect(classifySignInIdentifier("+2348012345678")).toEqual({
      kind: "phone",
      value: "+2348012345678",
    });
    expect(classifySignInIdentifier("08012345678")).toEqual({
      kind: "phone",
      value: "08012345678",
    });
    expect(classifySignInIdentifier("2348012345678")).toEqual({
      kind: "phone",
      value: "+2348012345678",
    });
    expect(classifySignInIdentifier("sheriff.yusuf")).toEqual({
      kind: "username",
      value: "sheriff.yusuf",
    });
  });

  it("sends phone to the phone field and username through email so failures share timing", () => {
    expect(toPasswordSignInPayload({ kind: "email", value: "ada@school.edu" }, "secret")).toEqual({
      email: "ada@school.edu",
      password: "secret",
    });
    expect(toPasswordSignInPayload({ kind: "phone", value: "+2348012345678" }, "secret", "tok")).toEqual({
      phone: "+2348012345678",
      password: "secret",
      options: { captchaToken: "tok" },
    });
    expect(toPasswordSignInPayload({ kind: "username", value: "sheriff.yusuf" }, "secret")).toEqual({
      email: "sheriff.yusuf",
      password: "secret",
    });
  });

  it("uses one generic invitation error", () => {
    expect(INVITE_LOGIN_ERROR.toLowerCase()).toContain("invitation");
    expect(INVITE_LOGIN_ERROR.toLowerCase()).not.toContain("does not exist");
    expect(INVITE_LOGIN_ERROR.toLowerCase()).not.toContain("username is not");
  });
});

describe("onboarding request mailto", () => {
  it("addresses the published hello mailbox and does not claim a ticket", () => {
    const { to, href } = buildOnboardingMailto({
      organization: "Northwind",
      name: "Ada",
      email: "ada@northwind.edu",
      role: "Director",
      message: "Please provision our admin.",
    });
    expect(to).toBe(ONBOARDING_MAILBOX);
    expect(to).toBe("hello@sherivs.com");
    expect(href.startsWith("mailto:hello@sherivs.com?")).toBe(true);
    expect(decodeURIComponent(href)).toContain(ONBOARDING_SUBJECT);
    expect(decodeURIComponent(href)).toContain("Northwind");
    expect(decodeURIComponent(href)).toContain("invite users by email");
  });
});
