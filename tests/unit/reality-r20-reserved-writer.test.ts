import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION =
  "database/supabase/migrations/20261105000300_sv1_reality_r20_reserved_profile_writer.sql";
const ROLLBACK =
  "database/supabase/rollbacks/20261105000300_sv1_reality_r20_reserved_profile_writer.sql";
const SERVER = "frontend/src/lib/runtime/scholar/reality-interview.functions.ts";
const HARNESS = "tests/integration/sv1-reality-r20.local.sql";

const strip = (s: string) => s.replace(/--[^\n]*/g, "");

describe("SV1-REALITY R20 reserved reality.* profile writer", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const code = strip(sql);

  it("is marked not applied and names its rollback and ADR", () => {
    expect(sql).toContain("NOT APPLIED");
    expect(sql).toContain("ADR-074");
    expect(strip(readFileSync(ROLLBACK, "utf8"))).toMatch(
      /DROP TRIGGER IF EXISTS trg_cg_org_profile_reserved_guard/,
    );
  });

  it("guards insert, update and delete of reality.* rows with a transaction-local flag", () => {
    expect(code).toMatch(/BEFORE INSERT OR UPDATE OR DELETE ON public\.cg_org_profile/);
    expect(code).toMatch(/left\(coalesce\(v_new, ''\), 8\) = 'reality\.'/);
    expect(code).toMatch(/left\(coalesce\(v_old, ''\), 8\) = 'reality\.'/);
    expect(code).toMatch(/current_setting\('coregrid\.reality_writer', true\)/);
    expect(code).toMatch(/set_config\('coregrid\.reality_writer', 'on', true\)/);
    expect(code).not.toMatch(/set_config\('coregrid\.reality_writer', 'on', false\)/);
  });

  it("makes the writer service-role only and never grants it to clients", () => {
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.upsert_reality_profile[^;]*FROM PUBLIC, anon, authenticated/,
    );
    expect(code).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.upsert_reality_profile[^;]*TO service_role/,
    );
    expect(code).not.toMatch(
      /GRANT[^;]*upsert_reality_profile[^;]*\b(authenticated|anon|PUBLIC)\b/,
    );
  });

  it("re-checks the actor, the key namespace, the payload bound and the revision", () => {
    expect(code).toMatch(/role:administrator/);
    expect(code).toMatch(/left\(p_profile_key, 8\) <> 'reality\.'/);
    expect(code).toMatch(/pg_column_size\(p_payload\) > 262144/);
    expect(code).toMatch(/FOR UPDATE/);
    expect(code).toMatch(/ERRCODE = '40001'/);
  });

  it("does not touch the generic RPCs, the table grants or any row", () => {
    expect(code).not.toMatch(/CREATE OR REPLACE FUNCTION public\.(get|upsert)_org_profile/);
    expect(code).not.toMatch(/\b(GRANT|REVOKE)[^;]*cg_org_profile/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it("the server writes interview state only through the reality writer", () => {
    const server = strip(readFileSync(SERVER, "utf8"));
    expect(server).toMatch(/rpc\("upsert_reality_profile"/);
    expect(server).not.toMatch(/rpc\("upsert_org_profile"/);
    expect(server).toMatch(/p_actor: actorId/);
    expect(server).toMatch(/p_expected_revision: expectedRevision/);
    // every handler passes the verified actor and the revision it loaded
    const calls =
      server.match(/await save\(schoolId, result\.state, context\.userId, state\.revision\)/g) ??
      [];
    expect(calls).toHaveLength(3);
    // the actor never comes from the client input
    expect(server).not.toMatch(/data\.(actor|userId|approver)/);
  });

  it("surfaces a lost-update as a revision conflict instead of overwriting", () => {
    const server = strip(readFileSync(SERVER, "utf8"));
    expect(server).toMatch(/error\.code === "40001"/);
    expect(server).toMatch(/code: "revision_conflict"/);
  });

  it("has a disposable-database harness covering the forgery path, the writer and the race", () => {
    const h = readFileSync(HARNESS, "utf8");
    expect(h).toContain("R20 ALL PASS");
    expect(h).toContain("reality_r20_test");
    expect(h.trim().endsWith("ROLLBACK;")).toBe(true);
    for (const label of [
      "admin cannot forge an interview through the generic RPC",
      "a stale expected revision is refused",
      "an administrator of another tenant is refused",
      "the writer flag does not leak out of a successful call",
      "renaming an ordinary key into the reserved namespace is refused",
    ]) {
      expect(h).toContain(label);
    }
  });
});
