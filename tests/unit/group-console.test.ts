import { describe, expect, it } from "vitest";
import { canManage, groupConsoleHost, groupLabelFromHost, validGroupLabel } from "@/lib/group/console";

describe("SHERIVS-B06 group console host", () => {
  it("parses console.<label>.sherivs.com only", () => {
    expect(groupLabelFromHost("console.greenfield.sherivs.com")).toBe("greenfield");
    expect(groupLabelFromHost("CONSOLE.Greenfield.sherivs.com:443")).toBe("greenfield");
    expect(groupLabelFromHost("console.sherivs.com")).toBeNull();
    expect(groupLabelFromHost("console.greenfield.sherivs.com.evil.io")).toBeNull();
    expect(groupLabelFromHost("console.gov.sherivs.com")).toBeNull();
    expect(groupLabelFromHost("a.b.console.x.sherivs.com")).toBeNull();
    expect(groupLabelFromHost(null)).toBeNull();
  });
  it("mirrors the label rule and roles", () => {
    expect(validGroupLabel("greenfield-group")).toBe(true);
    expect(validGroupLabel("a")).toBe(false);
    expect(validGroupLabel("admin")).toBe(false);
    expect(groupConsoleHost("x1y")).toBe("console.x1y.sherivs.com");
    expect(canManage("owner")).toBe(true);
    expect(canManage("viewer")).toBe(false);
  });
});
