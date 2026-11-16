import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { compareLedger, readRepoState } from "../../scripts/verify-migration-ledger.mjs";

const register = [{ ledgerName: "20260101000300_kept_elsewhere" }];

describe("M0 migration ledger drift check", () => {
  it("passes when every applied migration has a file or a register entry", () => {
    const report = compareLedger({
      ledger: [
        { version: "20260101000100", name: "20260101000100_alpha" },
        { version: "20260102090000", name: "20260101000200_beta" },
        { version: "20260101000250", name: "gamma" },
        { version: "20260103000000", name: "20260101000300_kept_elsewhere" },
      ],
      fileStems: ["20260101000100_alpha", "20260101000200_beta", "20260101000250_gamma"],
      outOfFolder: register,
    });
    expect(report.status).toBe("PASS");
    expect(report.counts.matched).toBe(3);
    expect(report.registeredOutOfFolder).toEqual(["20260101000300_kept_elsewhere"]);
  });

  it("fails when production holds a migration the repo does not", () => {
    const report = compareLedger({
      ledger: [{ version: "20260101000900", name: "20260101000900_applied_by_hand" }],
      fileStems: [],
      outOfFolder: [],
    });
    expect(report.status).toBe("FAIL");
    expect(report.ledgerWithoutFile).toEqual(["20260101000900:20260101000900_applied_by_hand"]);
  });

  it("fails when the repo holds a migration that was never applied", () => {
    const report = compareLedger({
      ledger: [],
      fileStems: ["20260101000100_alpha"],
      outOfFolder: [],
    });
    expect(report.status).toBe("FAIL");
    expect(report.filesNotInLedger).toEqual(["20260101000100_alpha"]);
  });

  it("fails on a register entry the ledger does not contain", () => {
    const report = compareLedger({ ledger: [], fileStems: [], outOfFolder: register });
    expect(report.status).toBe("FAIL");
    expect(report.staleRegister).toEqual(["20260101000300_kept_elsewhere"]);
  });

  it("reports legacy rows named by a bare UUID without failing", () => {
    const report = compareLedger({
      ledger: [{ version: "20260620122048", name: "50e590c2-5911-4c98-8931-fb46a4b509f3" }],
      fileStems: [],
      outOfFolder: [],
    });
    expect(report.status).toBe("PASS");
    expect(report.legacyUnnamed).toHaveLength(1);
  });

  it("the register names real files and the two ENGINE migrations kept out of the folder", () => {
    const repo = readRepoState(process.cwd());
    expect(repo.missingSql).toEqual([]);
    expect(repo.outOfFolder.map((e: { ledgerName: string }) => e.ledgerName)).toEqual([
      "20261110000400_sherivs_engine20_org_agent_addons_events_reports",
      "20261110000500_sherivs_engine22_org_agent_role_holders",
    ]);
    for (const e of repo.outOfFolder) expect(repo.fileStems).not.toContain(e.ledgerName);
  });

  it("reports BLOCKED, not a pass, when it has no ledger to read", () => {
    const run = spawnSync("node", ["scripts/verify-migration-ledger.mjs"], {
      encoding: "utf8",
      env: { ...process.env, MIGRATION_LEDGER_DB_URL: "" },
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("STATUS=BLOCKED");
    expect(run.stdout).not.toContain("STATUS=PASS");
  });
});

describe("M0 SEC-M0 privilege proposal", () => {
  const sql = readFileSync("database/proposals/SEC-M0_privilege_consolidation.sql", "utf8");
  const body = sql.replace(/^--.*$/gm, "");

  it("is a proposal with a rollback and a behaviour test", () => {
    expect(sql.startsWith("-- PROPOSAL ONLY. NOT APPLIED.")).toBe(true);
    expect(
      readFileSync("database/proposals/SEC-M0_privilege_consolidation.rollback.sql", "utf8"),
    ).toContain("tenant_all_subscriptions");
    expect(readFileSync("tests/sql/sec-m0-privileges.sql", "utf8")).toContain(
      "SEC-M0 PRIVILEGE TESTS PASSED",
    );
  });

  it("grants anon nothing except SELECT, INSERT, sequence USAGE and EXECUTE on the allowlists", () => {
    const grants = [...body.matchAll(/GRANT ([A-Z, ]+?) ON ([A-Z%s ]+?) %s TO anon/g)].map(
      (m) => `${m[1]} ${m[2].trim()}`,
    );
    expect(grants.sort()).toEqual(
      ["EXECUTE %s", "INSERT TABLE", "SELECT TABLE", "USAGE SEQUENCE"].sort(),
    );
    expect(body).not.toMatch(/GRANT ALL/);
    expect(body).not.toMatch(/TO PUBLIC/);
  });

  it("keeps the public surface to the 16 read tables, one insert table and 14 functions", () => {
    const list = (name: string) =>
      [
        ...(
          body.match(new RegExp(`${name} constant text\\[\\] := ARRAY\\[([^\\]]+)\\]`))?.[1] ?? ""
        ).matchAll(/'([a-z_]+)'/g),
      ].map((m) => m[1]);
    expect(list("public_read")).toHaveLength(16);
    expect(list("public_insert")).toEqual(["admission_applications"]);
    expect(list("public_exec")).toHaveLength(14);
    for (const sensitive of ["students", "subscriptions", "staff_payroll", "clinic_visits"]) {
      expect(list("public_read")).not.toContain(sensitive);
    }
  });

  it("makes subscriptions read-only for tenants and never widens a policy", () => {
    expect(body).toContain(
      "REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.subscriptions FROM authenticated, anon",
    );
    expect(body.match(/CREATE POLICY/g)).toHaveLength(1);
    expect(body).toMatch(
      /CREATE POLICY tenant_read_subscriptions[\s\S]+?FOR SELECT TO authenticated/,
    );
    expect(body).not.toMatch(/DISABLE ROW LEVEL SECURITY|NO FORCE/);
  });
});
