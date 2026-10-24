/** SHERIVS-029: DNS instructions, TXT verification and the Vercel stub (no network, no token). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { dnsInstructions, isApexHost, VERCEL_APEX_A, VERCEL_CNAME_TARGET } from "@/lib/domains/school-domains";
import { addDomainToVercel } from "@/lib/domains/vercel-domains.server";
import { txtRecordMatches } from "@/lib/domains/school-domains.functions";

describe("isApexHost", () => {
  it("treats the registrable .sch.ng / .edu.ng / .com name as apex", () => {
    expect(isApexHost("kingsschool.sch.ng")).toBe(true);
    expect(isApexHost("unimaid.edu.ng")).toBe(true);
    expect(isApexHost("kingsschool.com")).toBe(true);
  });
  it("treats subdomains as non-apex", () => {
    expect(isApexHost("portal.kingsschool.sch.ng")).toBe(false);
    expect(isApexHost("portal.kingsschool.com")).toBe(false);
  });
});

describe("dnsInstructions", () => {
  it("CNAME for a subdomain, A for an apex, TXT always", () => {
    const sub = dnsInstructions({ hostname: "portal.k.sch.ng", verification_token: "abc" });
    expect(sub.cname).toEqual({ name: "portal.k.sch.ng", target: VERCEL_CNAME_TARGET });
    expect(sub.txt).toEqual({ name: "_sherivs-verify.portal.k.sch.ng", value: "sherivs-verify=abc" });
    expect(dnsInstructions({ hostname: "k.sch.ng", verification_token: "x" }).cname.target).toBe(VERCEL_APEX_A);
  });
});

describe("txtRecordMatches", () => {
  it("matches split TXT chunks and fails closed on lookup errors", async () => {
    const ok = vi.fn(async () => [["sherivs-verify=", "abc"]]);
    expect(await txtRecordMatches("p.k.sch.ng", "sherivs-verify=abc", ok)).toBe(true);
    expect(ok).toHaveBeenCalledWith("_sherivs-verify.p.k.sch.ng");
    expect(await txtRecordMatches("p.k.sch.ng", "sherivs-verify=abc", async () => [["sherivs-verify=zzz"]])).toBe(false);
    expect(await txtRecordMatches("p.k.sch.ng", "x", async () => { throw new Error("ENOTFOUND"); })).toBe(false);
  });
});

describe("addDomainToVercel", () => {
  afterEach(() => { delete process.env.VERCEL_TOKEN; delete process.env.VERCEL_PROJECT_ID; });
  it("is stubbed and makes no call without a token", async () => {
    const f = vi.fn();
    expect((await addDomainToVercel("p.k.sch.ng", f as unknown as typeof fetch)).status).toBe("stubbed");
    expect(f).not.toHaveBeenCalled();
  });
  it("posts to the project domains API when configured", async () => {
    process.env.VERCEL_TOKEN = "test-token-not-real"; process.env.VERCEL_PROJECT_ID = "prj_test";
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    expect((await addDomainToVercel("p.k.sch.ng", f as unknown as typeof fetch)).status).toBe("added");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.vercel.com/v10/projects/prj_test/domains");
    expect(JSON.parse(String(init.body))).toEqual({ name: "p.k.sch.ng" });
  });
});
