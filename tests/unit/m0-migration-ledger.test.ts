import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { compareLedger, readRepoState } from "../../scripts/verify-migration-ledger.mjs";
import {
  checkMigrationsFolder,
  tablesWithoutGrant,
  // @ts-expect-error plain .mjs script without types
} from "../../scripts/verify-migration-grants.mjs";

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

  it("matches a migration applied under an apply-time version by its unique bare name", () => {
    const report = compareLedger({
      ledger: [{ version: "20261110095926", name: "sherivs_comms01_at_number_binding" }],
      fileStems: ["20261104032000_sherivs_comms01_at_number_binding"],
      outOfFolder: [],
    });
    expect(report.status).toBe("PASS");
    expect(report.matchedByBareName).toEqual([
      "20261110095926:sherivs_comms01_at_number_binding -> 20261104032000_sherivs_comms01_at_number_binding",
    ]);
  });

  it("does not guess when two files share a bare name", () => {
    const report = compareLedger({
      ledger: [{ version: "20261110095926", name: "twice" }],
      fileStems: ["20261104032000_twice", "20261104033000_twice"],
      outOfFolder: [],
    });
    expect(report.status).toBe("FAIL");
    expect(report.ledgerWithoutFile).toEqual(["20261110095926:twice"]);
  });

  it("warns about a migration recorded more than once", () => {
    const report = compareLedger({
      ledger: [
        { version: "20261103181438", name: "20261103140000_sec01" },
        { version: "20261103181444", name: "20261103140000_sec01" },
      ],
      fileStems: ["20261103140000_sec01"],
      outOfFolder: [],
    });
    expect(report.status).toBe("PASS");
    expect(report.duplicateLedgerNames).toEqual(["sec01"]);
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

  it("the register names real files and the migrations kept out of the folder", () => {
    const repo = readRepoState(process.cwd());
    expect(repo.missingSql).toEqual([]);
    expect(repo.outOfFolder.map((e: { ledgerName: string }) => e.ledgerName)).toEqual([
      "20261110000400_sherivs_engine20_org_agent_addons_events_reports",
      "20261110000500_sherivs_engine22_org_agent_role_holders",
      "20261117000300_sherivs_sec_m0_privilege_consolidation",
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

  it("is recorded as applied, with a rollback and a behaviour test", () => {
    expect(sql.startsWith("-- APPLIED TO PRODUCTION 2026-11-17")).toBe(true);
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
    expect(body).not.toMatch(/REVOKE [^;]*SELECT[^;]*ON TABLE %s FROM anon', *\n? *CASE/);
    expect(grants.sort()).toEqual(
      ["EXECUTE %s", "INSERT TABLE", "SELECT TABLE", "USAGE SEQUENCE"].sort(),
    );
    expect(body).not.toMatch(/GRANT ALL/);
    expect(body).not.toMatch(/TO PUBLIC/);
  });

  it("keeps the public surface to 16 read tables, one insert table, one column-read table and 14 signatures", () => {
    const list = (name: string) =>
      [
        ...(
          body.match(new RegExp(`${name} constant text\\[\\] := ARRAY\\[([^\\]]+)\\]`))?.[1] ?? ""
        ).matchAll(/'([^']+)'/g),
      ].map((m) => m[1]);
    expect(list("public_read")).toHaveLength(16);
    expect(list("public_insert")).toEqual(["admission_applications"]);
    expect(list("column_read")).toEqual(["schools"]);
    expect(list("public_exec")).toHaveLength(14);
    for (const signature of list("public_exec")) expect(signature).toMatch(/^[a-z_]+\([a-z, ]*\)$/);
    for (const sensitive of [
      "students",
      "subscriptions",
      "staff_payroll",
      "clinic_visits",
      "users",
    ]) {
      expect(list("public_read")).not.toContain(sensitive);
      expect(list("column_read")).not.toContain(sensitive);
    }
  });

  it("takes a snapshot the rollback restores from, and the rollback grants nothing wholesale", () => {
    expect(body).toContain("ops_private.sec_m0_acl_snapshot");
    expect(body).toContain("REVOKE ALL ON SCHEMA ops_private FROM PUBLIC, anon, authenticated");
    const rollback = readFileSync(
      "database/proposals/SEC-M0_privilege_consolidation.rollback.sql",
      "utf8",
    ).replace(/^--.*$/gm, "");
    expect(rollback).toContain("ops_private.sec_m0_acl_snapshot");
    expect(rollback).toContain("no ACL snapshot found");
    expect(rollback).not.toMatch(/ON ALL (TABLES|SEQUENCES|FUNCTIONS|ROUTINES) IN SCHEMA/);
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

describe("M0 migration grant check (private by default needs explicit grants)", () => {
  it("flags a new public table that no GRANT or REVOKE names", () => {
    expect(
      tablesWithoutGrant(
        "CREATE TABLE IF NOT EXISTS public.cg_thing (id uuid);\nCREATE POLICY p ON public.cg_thing FOR SELECT TO authenticated USING (true);",
      ),
    ).toEqual(["cg_thing"]);
  });

  it("accepts an explicit grant, a multi-table grant, or an explicit revoke", () => {
    expect(
      tablesWithoutGrant(
        "CREATE TABLE public.a (id int); CREATE TABLE public.b (id int); CREATE TABLE public.c (id int);\n" +
          "GRANT SELECT ON TABLE public.a, public.b TO authenticated;\n" +
          "REVOKE ALL ON TABLE public.c FROM PUBLIC, anon, authenticated;",
      ),
    ).toEqual([]);
  });

  it("ignores a grant that only appears in a comment", () => {
    expect(
      tablesWithoutGrant(
        "CREATE TABLE public.a (id int);\n-- GRANT SELECT ON public.a TO authenticated;",
      ),
    ).toEqual(["a"]);
  });

  it("passes on the repository's migrations folder", () => {
    expect(checkMigrationsFolder("database/supabase/migrations")).toEqual([]);
  });
});
