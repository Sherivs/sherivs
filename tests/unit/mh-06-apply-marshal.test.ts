/**
 * CoreGrid — MH-06 canonical apply-path rehearsal tests (Database Operations
 * Marshal). These tests prove that scripts/apply-canonical-hardening.mjs is
 * rehearsal-ready and CI-portable WITHOUT touching any database:
 *
 *  - `--manifest` builds the full apply plan (order, sha256 per migration,
 *    rollback checksums, declared signature objects) fully offline — no
 *    SUPABASE_ACCESS_TOKEN, no network, no Supabase contact;
 *  - the artifacts directory is derived from COREGRID_ARTIFACTS_DIR with
 *    /opt/cursor/artifacts as the default, so CI runners can redirect
 *    evidence without editing the script;
 *  - the plan's checksum bookkeeping is honest: every manifest checksum must
 *    equal the sha256 of the exact on-disk migration/rollback bytes;
 *  - `--verify-only` is credential-gated before any catalog probe, so it can
 *    never partially run without authorization.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = "scripts/apply-canonical-hardening.mjs";
const MIGRATIONS_DIR = join(ROOT, "database", "supabase", "migrations");
const ROLLBACKS_DIR = join(ROOT, "database", "supabase", "rollbacks");
const MANIFEST_ARTIFACT = "canonical-apply-hardening.manifest.json";

const EXPECTED_MIGRATIONS = [
  "20261002000005_coregrid_v1_reconciliation.sql",
  "20261002000006_coregrid_v1_event_security.sql",
  "20261002000007_coregrid_v1_event_routing.sql",
  "20261002000008_coregrid_v1_evidence_lifecycle.sql",
  "20261002000009_coregrid_v1_reasoning_provenance.sql",
  "20261002000010_coregrid_v1_cost_attribution.sql",
  "20261002000011_coregrid_v1_knowledge_currency.sql",
  "20261002000012_coregrid_v1_tool_runtime.sql",
  "20261002000013_coregrid_v1_neutral_membership_policies.sql",
  "20261002000014_coregrid_v2_transport_buses_rls.sql",
  "20261002000015_coregrid_v1_substrate_policies.sql",
  // H3-wave (2026-10-03): H3-027 file substrate, H3-028 idempotency substrate,
  // and the battery-finding privilege correction for the latter.
  "20261003000016_coregrid_v1_file_substrate.sql",
  "20261003000017_coregrid_v1_idempotency_substrate.sql",
  "20261003000018_coregrid_v1_idempotency_privilege_revoke.sql",
  // V1-wave (2026-10-03): V1-003 mission lease + worker governance substrate.
  "20261003000019_coregrid_v1_mission_lease.sql",
  // V1-wave follow-up (2026-10-03): is_super_admin() SECURITY DEFINER alignment
  // — completes the 20260620151525 RLS recursion fix for the one helper left
  // SECURITY INVOKER (unbounded self-recursion once a platform-admin row exists).
  "20261003000020_coregrid_is_super_admin_definer.sql",
];

interface ManifestMigration {
  order: number;
  file: string;
  mission: string;
  filePresent: boolean;
  checksum: string | null;
  rollbackChecksum: string | null;
  declaredObjectCount: number;
  declared: {
    tables: string[];
    indexes: string[];
    functions: string[];
    triggers: string[];
    policies?: string[];
    zeroPolicyTables?: string[];
    privilegePostures?: Array<{ table: string }>;
  };
}
interface Manifest {
  mode: string;
  artifactsDir: string;
  databaseContact: boolean;
  migrations: ManifestMigration[];
  totalDeclaredObjects: number;
  findings: number;
}

function offlineEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.SUPABASE_ACCESS_TOKEN;
  delete env.COREGRID_ARTIFACTS_DIR;
  return { ...env, ...extra };
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(args: string[], env: NodeJS.ProcessEnv): RunResult {
  const result = spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    cwd: ROOT,
    env,
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const sha256File = (path: string) =>
  createHash("sha256").update(readFileSync(path, "utf8")).digest("hex");

let artifactsTmp: string;
let manifest: Manifest;
let manifestRun: RunResult;

beforeAll(() => {
  artifactsTmp = join(tmpdir(), `mh-06-apply-marshal-${process.pid}-${Date.now()}`);
  mkdirSync(artifactsTmp, { recursive: true });
  // Single canonical manifest run reused across the suite; artifact writes are
  // redirected into the temp dir via COREGRID_ARTIFACTS_DIR.
  manifestRun = runScript(["--manifest"], offlineEnv({ COREGRID_ARTIFACTS_DIR: artifactsTmp }));
  const artifactPath = join(artifactsTmp, MANIFEST_ARTIFACT);
  manifest = JSON.parse(readFileSync(artifactPath, "utf8")) as Manifest;
});

afterAll(() => {
  rmSync(artifactsTmp, { recursive: true, force: true });
});

describe("MH-06 — canonical apply path is rehearsal-ready and CI-portable", () => {
  it("manifest mode runs fully offline without credentials and without database contact", () => {
    expect(manifestRun.status).toBe(0);
    expect(manifestRun.stdout).toContain("MANIFEST");
    expect(manifestRun.stdout).toContain("no database is contacted");
    expect(manifestRun.stdout).not.toContain("STATUS=PASS — migrations applied");
    expect(manifestRun.stderr).not.toContain("BLOCKED_NO_CREDENTIAL");
    expect(manifest.databaseContact).toBe(false);
    expect(manifest.mode).toBe("manifest");
  });

  it("manifest prints the declared migrations in dependency order (20261002000005–20 present today)", () => {
    expect(manifest.migrations.map((m) => m.file)).toEqual(EXPECTED_MIGRATIONS);
    manifest.migrations.forEach((m, i) => expect(m.order).toBe(i + 1));
    expect(manifestRun.stdout).toContain("20261002000005_coregrid_v1_reconciliation.sql");
    expect(manifestRun.stdout).toContain("20261002000013_coregrid_v1_neutral_membership_policies.sql");
    expect(manifestRun.stdout).toContain("20261002000014_coregrid_v2_transport_buses_rls.sql");
    expect(manifestRun.stdout).toContain("20261002000015_coregrid_v1_substrate_policies.sql");
    expect(manifestRun.stdout).toContain("20261003000016_coregrid_v1_file_substrate.sql");
    expect(manifestRun.stdout).toContain("20261003000017_coregrid_v1_idempotency_substrate.sql");
    expect(manifestRun.stdout).toContain("20261003000018_coregrid_v1_idempotency_privilege_revoke.sql");
    expect(manifest.migrations.every((m) => m.filePresent)).toBe(true);
  });

  it("binds every manifest checksum to the exact on-disk migration bytes", () => {
    for (const m of manifest.migrations) {
      expect(m.checksum, `${m.file} must carry a sha256 checksum`).toMatch(/^[0-9a-f]{64}$/);
      expect(m.checksum).toBe(sha256File(join(MIGRATIONS_DIR, m.file)));
    }
  });

  it("binds every manifest rollback checksum to the exact on-disk rollback bytes", () => {
    for (const m of manifest.migrations) {
      expect(m.rollbackChecksum, `${m.file} must carry a rollback checksum`).toMatch(/^[0-9a-f]{64}$/);
      expect(m.rollbackChecksum).toBe(sha256File(join(ROLLBACKS_DIR, m.file)));
    }
  });

  it("enumerates every declared signature object and keeps the declared count honest", () => {
    for (const m of manifest.migrations) {
      const declared = m.declared;
      const counted =
        declared.tables.length +
        declared.indexes.length +
        declared.functions.length +
        declared.triggers.length +
        (declared.policies?.length ?? 0) +
        (declared.zeroPolicyTables?.length ?? 0) +
        (declared.privilegePostures?.length ?? 0);
      expect(m.declaredObjectCount).toBe(counted);
      expect(m.declaredObjectCount).toBeGreaterThan(0);
      for (const t of declared.tables) {
        expect(manifestRun.stdout).toContain(`  table:${t}`);
      }
      for (const idx of declared.indexes) {
        expect(manifestRun.stdout).toContain(`  index:${idx}`);
      }
      for (const zt of declared.zeroPolicyTables ?? []) {
        expect(manifestRun.stdout).toContain(`  zero-policy:${zt}`);
      }
    }
    expect(manifest.totalDeclaredObjects).toBe(
      manifest.migrations.reduce((n, m) => n + m.declaredObjectCount, 0),
    );
  });

  it("declares the Stage-2 neutral membership policies as plan objects", () => {
    const stage2 = manifest.migrations.find((m) => m.file.startsWith("20261002000013"));
    expect(stage2).toBeDefined();
    expect(stage2?.declared.policies).toHaveLength(9);
    expect(stage2?.declared.policies).toContain("cg_role_assignment.role_assignment_select_own_tenant");
    expect(stage2?.declared.policies).toContain("cg_org_membership.org_membership_update_tenant_admin");
  });

  it("declares the H2-03 transport normalization by its zero-policy signature (absence, not presence)", () => {
    const transport = manifest.migrations.find((m) => m.file.startsWith("20261002000014"));
    expect(transport).toBeDefined();
    expect(transport?.declared.tables).toHaveLength(0);
    expect(transport?.declared.zeroPolicyTables).toEqual(["transport_buses"]);
    expect(manifestRun.stdout).toContain("  zero-policy:transport_buses");
  });

  it("declares the H2-04 substrate policy layer as exactly eight neutral-primitive policies", () => {
    const substrate = manifest.migrations.find((m) => m.file.startsWith("20261002000015"));
    expect(substrate).toBeDefined();
    expect(substrate?.declared.policies).toHaveLength(8);
    expect(substrate?.declared.policies).toContain("cg_reconciliation_input.reconciliation_input_select_own_tenant");
    expect(substrate?.declared.policies).toContain("cg_usage_attribution_bucket.usage_attribution_bucket_insert_tenant_admin");
  });

  it("writes the manifest artifact into COREGRID_ARTIFACTS_DIR (CI-portable redirection)", () => {
    expect(existsSync(join(artifactsTmp, MANIFEST_ARTIFACT))).toBe(true);
    expect(manifest.artifactsDir).toBe(artifactsTmp);
    expect(manifestRun.stdout).toContain(`artifactsDir=${artifactsTmp}`);
    expect(manifest.findings).toBe(0);
  });

  it("defaults the artifacts directory to /opt/cursor/artifacts when COREGRID_ARTIFACTS_DIR is unset", () => {
    const run = runScript(["--manifest"], offlineEnv());
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("artifactsDir=/opt/cursor/artifacts");
  });

  it("rejects unknown flags instead of silently mis-parsing the plan", () => {
    const run = runScript(["--unknown-flag"], offlineEnv());
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_USAGE");
    expect(run.stderr).toContain("--unknown-flag");
  });

  it("credentials-gates --verify-only before any catalog probe (offline refusal)", () => {
    const run = runScript(["--verify-only"], offlineEnv());
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_NO_CREDENTIAL");
    expect(run.stdout).not.toContain("STATUS=VERIFY_PASS");
    expect(run.stdout).not.toContain("STATUS=VERIFY_FINDINGS");
  });
});