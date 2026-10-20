/**
 * CoreGrid — R39 role-assignment substrate proof tests.
 *
 * The R37 migration is authored, not applied (no database runner in this
 * environment). These tests make the claim verifiable anyway:
 *
 *  - the verifier runs cleanly and re-emits the proof artifact;
 *  - the artifact is bound to the exact migration bytes (digest), so a proof can
 *    never drift away from the SQL it proves;
 *  - the invariants we rely on at runtime (deny-by-default, tenant re-derived
 *    from the actor, grantor captured from auth.uid(), server-function lockstep)
 *    are asserted by id, not by prose;
 *  - the single-migration runner is executable today (`--dry-run`) so the apply
 *    step is a procedure, not an intention.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION_REF =
  "database/supabase/migrations/20260907000800_coregrid_role_assignment_substrate.sql";
const PROOF_REF = "architecture/proofs/role-assignment-substrate.proof.json";

interface ProofCheck {
  id: string;
  ok: boolean;
  detail: string;
}
interface SubstrateProof {
  artifact: string;
  wave: string;
  mode: "static" | "live";
  generatedAt: string;
  migration: string;
  migrationDigest: string;
  serverSurface: string;
  tables: readonly string[];
  rpcs: readonly string[];
  checks: readonly ProofCheck[];
  ok: boolean;
  liveProcedure: readonly string[];
  limitations: readonly string[];
}

function readNormalised(ref: string): string {
  return readFileSync(join(ROOT, ref), "utf8").replace(/\r\n/g, "\n");
}

const proof = JSON.parse(readFileSync(join(ROOT, PROOF_REF), "utf8")) as SubstrateProof;
const migration = readNormalised(MIGRATION_REF);
const digest = `sha256:${createHash("sha256").update(migration).digest("hex")}`;

describe("R39 — role-assignment substrate is proven, not asserted", () => {
  it("runs the verifier cleanly and reports the invariant count", () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    delete env.DEVELOPMENT_DATABASE_URL;
    delete env.STAGING_DATABASE_URL;
    delete env.SHERIVS_RLS_STAGING_URL;
    delete env.PRODUCTION_DATABASE_URL;
    const output = execFileSync("node", ["scripts/verify-role-assignment-substrate.mjs"], {
      encoding: "utf8",
      cwd: ROOT,
      env,
    });
    expect(output).toMatch(/substrate invariants hold \(mode: static\)/);
    expect(output).toContain("Proof written:");
    expect(output).not.toContain("FAIL");
  });

  it("binds the proof to the exact migration bytes", () => {
    expect(proof.migration).toBe(MIGRATION_REF);
    expect(proof.migrationDigest).toBe(digest);
  });

  it("records static mode when no target-specific database URL is provided", () => {
    const latest = JSON.parse(readFileSync(join(ROOT, PROOF_REF), "utf8")) as SubstrateProof;
    expect(latest.mode).toBe("static");
  });

  it("passes every recorded invariant and declares the governed surface", () => {
    expect(proof.artifact).toBe("role-assignment-substrate");
    expect(proof.wave).toBe("R39");
    expect(proof.ok).toBe(true);
    expect(proof.checks.length).toBeGreaterThanOrEqual(30);
    for (const entry of proof.checks) {
      expect(entry.ok, `${entry.id}: ${entry.detail}`).toBe(true);
    }
    expect(proof.tables).toEqual(["cg_role_assignment", "cg_role_grant"]);
    expect(proof.rpcs).toHaveLength(6);
    expect(proof.liveProcedure.length).toBeGreaterThan(0);
    expect(proof.limitations.join(" ")).toMatch(/not applied|static mode/i);
  });

  it("proves the laws the runtime actually depends on", () => {
    const ids = new Set(proof.checks.map((entry) => entry.id));
    for (const id of [
      "static:deny-by-default",
      "static:revoked-from-clients",
      "static:granted-to-service-role",
      "static:security-definer",
      "static:tenant-re-derived-from-actor",
      "static:grantor-captured-from-auth",
      "static:self-scope-has-no-client-tenant",
      "static:history-preserved",
    ]) {
      expect(ids.has(id), `missing invariant ${id}`).toBe(true);
    }
    for (const rpc of proof.rpcs) {
      expect(ids.has(`static:server-lockstep:${rpc}`), `missing lockstep for ${rpc}`).toBe(true);
    }
  });

  it("keeps the migration's declared application status honest", () => {
    expect(migration).toMatch(/Status:\s*(AUTHORED|APPLIED)/);
    expect(migration).toContain("node scripts/verify-role-assignment-substrate.mjs");
  });

  it("keeps the single-migration runner executable today (--dry-run)", () => {
    const output = execFileSync(
      "node",
      ["scripts/db-apply-one.mjs", "20260907000800", "--dry-run"],
      { encoding: "utf8", cwd: ROOT },
    );
    expect(output).toContain("DRY RUN");
    expect(output).toContain("20260907000800_coregrid_role_assignment_substrate.sql");
    expect(output).toContain("no statement was executed");
  });
});
