import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain .js module shared with k6, without types
import { checkTarget } from "../load/target-guard.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("M23 k6 load test target guard", () => {
  it("allows localhost and 127.0.0.1 and keeps only the origin", () => {
    expect(checkTarget("http://localhost:8080")).toMatchObject({
      ok: true,
      origin: "http://localhost:8080",
    });
    expect(checkTarget("http://127.0.0.1:8080/some/path?x=1")).toMatchObject({
      ok: true,
      origin: "http://127.0.0.1:8080",
    });
    expect(checkTarget("HTTP://LOCALHOST")).toMatchObject({ ok: true, host: "localhost" });
  });

  it("refuses any other host without an override naming it exactly", () => {
    expect(checkTarget("https://staging.example.org").ok).toBe(false);
    expect(checkTarget("https://staging.example.org", "other.example.org").ok).toBe(false);
    expect(checkTarget("https://staging.example.org", "staging.example.org").ok).toBe(true);
    // A look-alike that only starts with localhost is not local.
    expect(checkTarget("http://localhost.evil.example").ok).toBe(false);
  });

  it("always refuses sherivs.com, app.sherivs.com, other sherivs.com hosts and supabase.co, even with the override", () => {
    for (const host of [
      "sherivs.com",
      "app.sherivs.com",
      "www.sherivs.com",
      "sherivs.com.",
      "abc.supabase.co",
    ]) {
      expect(checkTarget(`https://${host}`, host).ok).toBe(false);
      expect(checkTarget(`https://${host.toUpperCase()}/health.json`, host).ok).toBe(false);
    }
    expect(checkTarget("https://app.sherivs.com", "app.sherivs.com").reason).toContain(
      "production",
    );
  });

  it("refuses credentials, other schemes and garbage", () => {
    expect(checkTarget("http://user:pw@localhost:8080").ok).toBe(false);
    expect(checkTarget("ftp://localhost").ok).toBe(false);
    expect(checkTarget("").ok).toBe(false);
    expect(checkTarget(undefined).ok).toBe(false);
    expect(checkTarget("localhost:8080").ok).toBe(false);
  });

  it("the k6 script uses the guard before any request and covers the three scenarios", () => {
    const script = readFileSync(join(ROOT, "tests/load/smoke.k6.js"), "utf8");
    expect(script).toContain('import { checkTarget } from "./target-guard.js"');
    const guardAt = script.indexOf("checkTarget(");
    expect(guardAt).toBeGreaterThan(0);
    expect(script.indexOf("http.get(")).toBeGreaterThan(guardAt);
    for (const path of ["${BASE}/`", "${BASE}/health.json`", "${BASE}/auth`"])
      expect(script).toContain(path);
    expect(script).not.toMatch(/https?:\/\/(app\.)?sherivs\.com/);
  });
});
