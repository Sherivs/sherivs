import { describe, expect, it } from "vitest";
import { govLabel, govLabelFromHost, isGovHost } from "@/lib/gov/host";
import { tenantSlugFromHostname } from "@/lib/tenant";

describe("SHERIVS-B02 gov console host", () => {
  it("maps <label>.gov.sherivs.com to a jurisdiction label", () => {
    expect(govLabelFromHost("borno.gov.sherivs.com")).toBe("borno");
    expect(govLabelFromHost("BORNO.gov.sherivs.com.")).toBe("borno");
    expect(govLabelFromHost("gov.sherivs.com")).toBeNull();
    expect(govLabelFromHost("console.gov.sherivs.com")).toBeNull();
    expect(govLabelFromHost("a.b.gov.sherivs.com")).toBeNull();
    expect(govLabelFromHost("borno.gov.sherivs.com.evil.ng")).toBeNull();
    expect(govLabelFromHost("borno.sherivs.com")).toBeNull();
  });
  it("treats the gov root and state hosts as gov, never as school tenants", () => {
    expect(isGovHost("gov.sherivs.com")).toBe(true);
    expect(isGovHost("borno.gov.sherivs.com")).toBe(true);
    expect(isGovHost("app.sherivs.com")).toBe(false);
    expect(tenantSlugFromHostname("borno.gov.sherivs.com")).toBeNull();
  });
  it("only honours ?gov= on localhost and previews", () => {
    expect(govLabel({ hostname: "localhost", search: "?gov=borno" })).toBe("borno");
    expect(govLabel({ hostname: "x.vercel.app", search: "?gov=borno" })).toBe("borno");
    expect(govLabel({ hostname: "app.sherivs.com", search: "?gov=borno" })).toBeNull();
    expect(govLabel({ hostname: "localhost", search: "?gov=../x" })).toBeNull();
  });
});
