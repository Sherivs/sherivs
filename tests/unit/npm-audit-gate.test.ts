import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluateAudit, validateExceptions } from "../../scripts/lib/npm-audit-gate.mjs";

const EXCEPTED = "GHSA-fc5q-39xc-vjpf";
const config = JSON.parse(readFileSync("config/npm-audit-exceptions.json", "utf8"));
const before = new Date("2026-11-18T12:00:00Z");

function report(...advisories: { name: string; severity: string; id: string }[]) {
  const vulnerabilities: Record<string, unknown> = {};
  for (const a of advisories) {
    vulnerabilities[a.name] = {
      name: a.name,
      severity: a.severity,
      via: [{ name: a.name, severity: a.severity, url: `https://github.com/advisories/${a.id}` }],
    };
  }
  vulnerabilities["vite"] = { name: "vite", severity: "high", via: ["picomatch"] };
  return {
    vulnerabilities,
    metadata: { vulnerabilities: { high: advisories.length + 1, critical: 0 } },
  };
}

describe("npm audit gate", () => {
  it("has exactly one exception, for the approved picomatch advisory, expiring 2026-12-17", () => {
    expect(validateExceptions(config).problems).toEqual([]);
    expect(config.exceptions).toHaveLength(1);
    expect(config.exceptions[0].id).toBe(EXCEPTED);
    expect(config.exceptions[0].expires).toBe("2026-12-17");
    expect(config.exceptions[0].approval).toMatch(/t215u/);
  });

  it("passes when the only high advisory is the excepted one", () => {
    const r = evaluateAudit(
      report({ name: "picomatch", severity: "high", id: EXCEPTED }),
      config,
      before,
    );
    expect(r).toMatchObject({ ok: true, blocking: [], excepted: [EXCEPTED] });
  });

  it("still fails on any other high advisory", () => {
    const r = evaluateAudit(
      report(
        { name: "picomatch", severity: "high", id: EXCEPTED },
        { name: "other-lib", severity: "high", id: "GHSA-2222-3333-4444" },
      ),
      config,
      before,
    );
    expect(r.ok).toBe(false);
    expect(r.blocking.join(" ")).toContain("GHSA-2222-3333-4444");
  });

  it("still fails on a critical advisory", () => {
    const r = evaluateAudit(
      report({ name: "x", severity: "critical", id: "GHSA-4444-5555-6666" }),
      config,
      before,
    );
    expect(r.ok).toBe(false);
  });

  it("ignores moderate and low advisories, as --audit-level=high did", () => {
    const r = evaluateAudit(
      report({ name: "x", severity: "moderate", id: "GHSA-4444-5555-6666" }),
      config,
      before,
    );
    expect(r.blocking).toEqual([]);
  });

  it("fails again by itself after the expiry date", () => {
    const r = evaluateAudit(
      report({ name: "picomatch", severity: "high", id: EXCEPTED }),
      config,
      new Date("2026-12-18T00:00:01Z"),
    );
    expect(r.ok).toBe(false);
    expect(r.blocking.join(" ")).toContain(EXCEPTED);
    expect(r.problems.join(" ")).toContain("expired");
  });

  it("is still valid on the expiry date itself", () => {
    const r = evaluateAudit(
      report({ name: "picomatch", severity: "high", id: EXCEPTED }),
      config,
      new Date("2026-12-17T23:00:00Z"),
    );
    expect(r.ok).toBe(true);
  });

  it("fails closed when the audit report is unreadable", () => {
    expect(evaluateAudit(null, config, before).ok).toBe(false);
    expect(evaluateAudit({}, config, before).ok).toBe(false);
  });

  it("rejects exceptions without expiry, reason, evidence or approval", () => {
    const bad = { exceptions: [{ id: "GHSA-2222-3333-4444" }] };
    expect(validateExceptions(bad).problems.length).toBeGreaterThanOrEqual(4);
    const r = evaluateAudit(
      report({ name: "x", severity: "high", id: "GHSA-2222-3333-4444" }),
      bad,
      before,
    );
    expect(r.ok).toBe(false);
  });
});
