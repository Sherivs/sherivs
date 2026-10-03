/**
 * H3-088 — Posture Validation Engineer (Squad H, Quality & CI hardening).
 *
 * Edge-case suite for the RLS isolation battery's posture-parsing pure
 * functions, imported READ-ONLY from scripts/verify-rls-isolation-battery.mjs
 * (module import performs no I/O, no network, no credentials, never exits).
 *
 * Coverage (mission H-088):
 *   1. merge order semantics — builtin canonical vs posture-JSON override,
 *      file application order, added tables, fallbackUsed;
 *   2. duplicate-table rejection — within one file and across files;
 *   3. invalid recipe shapes — partial/empty/ill-typed §4.4 probe recipes;
 *   4. token-replacement edge cases — exact-match placeholders ($TENANT_A,
 *      $ACTOR_A_ID, $RUN_ID, …), recursion, non-string passthrough;
 *   5. zero-policy vs policy-backed expectation mismatches (fail closed);
 *   6. unknown-field strictness — unknown fields pass through as provenance,
 *      while malformed KNOWN fields are rejected.
 *
 * The suite uses ONLY synthetic posture entries; it never reads
 * scripts/verification/rls-table-postures-*.json, so Squad D adjudications and
 * J-099's rationale merge cannot perturb it. No database, no network, no
 * secrets. All expectations are string-independent of rationale content.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error — plain-JS verification script imported into the TS unit suite (read-only module import; same pattern as tests/unit/h3-031-posture-adjudication.test.ts)
import * as batteryMjs from "../../scripts/verify-rls-isolation-battery.mjs";

interface PostureEntry {
  name?: string;
  table?: string;
  posture: string;
  source?: string;
  sourceMigration?: string;
  postureSource?: string;
  policies?: unknown[];
  forceRls?: boolean;
  tenantColumn?: string;
  privileges?: Record<string, unknown>;
  probeSeedRows?: unknown;
  probeInsertPayload?: unknown;
  probeAuxTables?: unknown;
  [key: string]: unknown;
}

interface ParsedFile {
  name: string;
  entries: PostureEntry[];
}

interface PostureRegistry {
  tables: PostureEntry[];
  files: string[];
  fallbackUsed: boolean;
  overridden: string[];
  added: string[];
}

interface BatteryModule {
  POSTURE_FILE_PATTERN: RegExp;
  TABLE_POSTURES: string[];
  BUILTIN_TABLE_POSTURES: PostureEntry[];
  validatePostureEntry: (rawEntry: unknown, fileName: string) => PostureEntry;
  parsePostureFile: (text: string, fileName: string) => PostureEntry[];
  resolvePostureRegistry: (files: ParsedFile[], fallback?: PostureEntry[]) => PostureRegistry;
  loadPostureRegistry: (dir: string) => PostureRegistry;
  resolveProbeStage: (table: { name?: string; posture?: string; probeSeedRows?: unknown; probeInsertPayload?: unknown }) => string;
  NEUTRAL_MEMBERSHIP_PROBE_TABLES: Set<string>;
  PROBE_PLACEHOLDERS: string[];
  substituteProbeValue: (value: unknown, ctx: Record<string, unknown>) => unknown;
  sqlLiteral: (value: unknown) => string;
  buildProbeSeedSql: (tableName: string, rows: Array<Record<string, unknown>>) => string;
}

const battery = batteryMjs as unknown as BatteryModule;

const FILE_A = "rls-table-postures-test-a.json";
const FILE_B = "rls-table-postures-test-b.json";

function expectInvalid(fn: () => unknown, fragment: string): void {
  expect(fn).toThrow(Error);
  try {
    fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    expect(message).toContain(fragment);
  }
}

const ZERO_POLICY = (name: string): PostureEntry => ({ name, posture: "zero-policy" });
const POLICY_BACKED = (name: string): PostureEntry => ({
  name,
  posture: "policy-backed",
  tenantColumn: "tenant_id",
  policies: [`${name}_select_own_tenant`],
});

describe("H3-088 posture validation — registry constants", () => {
  it("exposes exactly the two canonical postures", () => {
    expect(battery.TABLE_POSTURES).toEqual(["zero-policy", "policy-backed"]);
  });

  it("declares the posture-file name pattern as rls-table-postures-*.json", () => {
    expect(battery.POSTURE_FILE_PATTERN.test("rls-table-postures-kernel.json")).toBe(true);
    expect(battery.POSTURE_FILE_PATTERN.test("rls-table-postures-.json")).toBe(false);
    expect(battery.POSTURE_FILE_PATTERN.test("postures.json")).toBe(false);
    expect(battery.POSTURE_FILE_PATTERN.test("rls-table-postures-x.json.bak")).toBe(false);
  });

  it("declares the exact §4.4 probe placeholder set", () => {
    expect([...battery.PROBE_PLACEHOLDERS]).toEqual([
      "$TENANT_A",
      "$TENANT_B",
      "$ACTOR_A_ID",
      "$ACTOR_B_ID",
      "$ACTOR_C_ID",
      "$RUN_ID",
    ]);
  });
});

describe("H3-088 merge order semantics (builtin vs posture-JSON override)", () => {
  it("uses the builtin canonical posture when no files are given", () => {
    const registry = battery.resolvePostureRegistry([]);
    expect(registry.fallbackUsed).toBe(true);
    expect(registry.files).toEqual([]);
    expect(registry.overridden).toEqual([]);
    expect(registry.added).toEqual([]);
    expect(registry.tables.length).toBe(battery.BUILTIN_TABLE_POSTURES.length);
    for (const t of registry.tables) {
      expect(t.postureSource).toBe("builtin-canonical");
    }
  });

  it("lets a posture file override a builtin table while preserving builtin slot order", () => {
    const override: PostureEntry = {
      ...POLICY_BACKED("cg_workspace"),
      policies: ["cg_workspace_select_own_tenant"],
      source: "some-migration.sql",
    };
    const registry = battery.resolvePostureRegistry([{ name: FILE_A, entries: [override] }]);
    expect(registry.fallbackUsed).toBe(false);
    expect(registry.overridden).toEqual(["cg_workspace"]);
    expect(registry.added).toEqual([]);

    const names = registry.tables.map((t) => t.name);
    const builtinIndex = battery.BUILTIN_TABLE_POSTURES.findIndex((t) => t.name === "cg_workspace");
    expect(names[builtinIndex]).toBe("cg_workspace");
    const merged = registry.tables[builtinIndex];
    expect(merged.posture).toBe("policy-backed");
    expect(merged.postureSource).toBe(FILE_A);
    expect(merged.source).toBe("some-migration.sql");
    // Untouched builtin neighbors remain builtin-sourced.
    const entity = registry.tables.find((t) => t.name === "cg_entity");
    expect(entity?.postureSource).toBe("builtin-canonical");
  });

  it("adds brand-new tables after the builtin block and marks them added", () => {
    const registry = battery.resolvePostureRegistry([
      { name: FILE_A, entries: [ZERO_POLICY("cg_h3_088_new_table")] },
    ]);
    expect(registry.added).toEqual(["cg_h3_088_new_table"]);
    expect(registry.overridden).toEqual([]);
    expect(registry.tables[registry.tables.length - 1].name).toBe("cg_h3_088_new_table");
    expect(registry.tables[registry.tables.length - 1].postureSource).toBe(FILE_A);
  });

  it("applies files in the given order — overridden/add lists follow file order for DIFFERENT tables", () => {
    const registry = battery.resolvePostureRegistry([
      { name: FILE_A, entries: [POLICY_BACKED("cg_workspace")] },
      { name: FILE_B, entries: [ZERO_POLICY("cg_event")] },
    ]);
    expect(registry.overridden).toEqual(["cg_workspace", "cg_event"]);
    const workspace = registry.tables.find((t) => t.name === "cg_workspace");
    const event = registry.tables.find((t) => t.name === "cg_event");
    expect(workspace?.postureSource).toBe(FILE_A);
    expect(event?.postureSource).toBe(FILE_B);
  });

  it("treats later files as later writers for ADDED tables too (override of a just-added table would be a duplicate, so last added wins only via single declaration)", () => {
    // Two files, each adding a DIFFERENT table: both land, file order preserved.
    const registry = battery.resolvePostureRegistry([
      { name: FILE_A, entries: [ZERO_POLICY("cg_h3_088_added_first")] },
      { name: FILE_B, entries: [ZERO_POLICY("cg_h3_088_added_second")] },
    ]);
    expect(registry.added).toEqual(["cg_h3_088_added_first", "cg_h3_088_added_second"]);
    expect(registry.tables.slice(-2).map((t) => t.name)).toEqual([
      "cg_h3_088_added_first",
      "cg_h3_088_added_second",
    ]);
  });

  it("honors a custom fallback registry (dependency-injected canonical, not just builtin)", () => {
    const fallback: PostureEntry[] = [ZERO_POLICY("cg_custom_fallback_table")];
    const registry = battery.resolvePostureRegistry(
      [{ name: FILE_A, entries: [POLICY_BACKED("cg_custom_fallback_table")] }],
      fallback,
    );
    expect(registry.tables).toHaveLength(1);
    expect(registry.tables[0].posture).toBe("policy-backed");
    expect(registry.overridden).toEqual(["cg_custom_fallback_table"]);
    expect(registry.fallbackUsed).toBe(false);
  });

  it("does not mutate the builtin canonical registry when merging", () => {
    const before = JSON.parse(JSON.stringify(battery.BUILTIN_TABLE_POSTURES));
    battery.resolvePostureRegistry([
      { name: FILE_A, entries: [{ ...ZERO_POLICY("cg_entity"), extra: "x" }] },
    ]);
    expect(JSON.parse(JSON.stringify(battery.BUILTIN_TABLE_POSTURES))).toEqual(before);
  });
});

describe("H3-088 duplicate-table rejection (one source of truth per posture)", () => {
  it("rejects a table declared twice within the same file", () => {
    expectInvalid(
      () =>
        battery.resolvePostureRegistry([
          { name: FILE_A, entries: [ZERO_POLICY("cg_entity"), ZERO_POLICY("cg_entity")] },
        ]),
      "declared more than once",
    );
  });

  it("rejects a table declared across two files, citing both files", () => {
    expectInvalid(
      () =>
        battery.resolvePostureRegistry([
          { name: FILE_A, entries: [ZERO_POLICY("cg_event")] },
          { name: FILE_B, entries: [ZERO_POLICY("cg_event")] },
        ]),
      `(${FILE_A} and ${FILE_B})`,
    );
  });

  it("rejects a duplicate of an ALREADY-OVERRIDDEN builtin — override then second override is still a duplicate", () => {
    expectInvalid(
      () =>
        battery.resolvePostureRegistry([
          { name: FILE_A, entries: [ZERO_POLICY("cg_workspace")] },
          { name: FILE_B, entries: [POLICY_BACKED("cg_workspace")] },
        ]),
      "declared more than once",
    );
  });

  it("rejects an added table re-declared by a later file (no silent re-merge of adds)", () => {
    expectInvalid(
      () =>
        battery.resolvePostureRegistry([
          { name: FILE_A, entries: [ZERO_POLICY("cg_h3_088_dup_add")] },
          { name: FILE_B, entries: [ZERO_POLICY("cg_h3_088_dup_add")] },
        ]),
      "declared more than once",
    );
  });

  it("rejects duplicates even when entries differ in shape but name the same table via table/name aliases", () => {
    expectInvalid(
      () =>
        battery.resolvePostureRegistry([
          { name: FILE_A, entries: [{ table: "cg_entity", posture: "zero-policy" }] },
          { name: FILE_B, entries: [{ name: "cg_entity", posture: "zero-policy" }] },
        ]),
      "declared more than once",
    );
  });
});

describe("H3-088 parsePostureFile — file-level shapes", () => {
  it("parses a bare JSON array of entries", () => {
    const entries = battery.parsePostureFile(JSON.stringify([ZERO_POLICY("cg_entity")]), FILE_A);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("cg_entity");
    expect(entries[0].postureSource).toBe(FILE_A);
  });

  it("accepts the landed sibling object shapes: {tables: []} and {postures: []}", () => {
    const tablesShape = battery.parsePostureFile(
      JSON.stringify({ tables: [ZERO_POLICY("cg_entity")] }),
      FILE_A,
    );
    const posturesShape = battery.parsePostureFile(
      JSON.stringify({ postures: [ZERO_POLICY("cg_event")] }),
      FILE_A,
    );
    expect(tablesShape[0].name).toBe("cg_entity");
    expect(posturesShape[0].name).toBe("cg_event");
  });

  it("rejects non-JSON text with the file name in the error", () => {
    expectInvalid(() => battery.parsePostureFile("{not json", FILE_A), `invalid posture file ${FILE_A}`);
  });

  it("rejects a bare JSON scalar as a top-level shape", () => {
    expectInvalid(() => battery.parsePostureFile("42", FILE_A), "JSON array of posture entries");
    expectInvalid(() => battery.parsePostureFile('"x"', FILE_A), "JSON array of posture entries");
  });

  it("rejects an object whose tables/postures key is not an array", () => {
    expectInvalid(
      () => battery.parsePostureFile(JSON.stringify({ tables: "nope" }), FILE_A),
      "JSON array of posture entries",
    );
  });

  it("rejects an empty object (neither tables nor postures array)", () => {
    expectInvalid(() => battery.parsePostureFile("{}", FILE_A), "JSON array of posture entries");
  });

  it("validates every entry and fails closed on the first malformed one", () => {
    const text = JSON.stringify([ZERO_POLICY("cg_entity"), { name: "!!bad!!", posture: "zero-policy" }]);
    expectInvalid(() => battery.parsePostureFile(text, FILE_A), "entry must name a table");
  });

  it("rejects a top-level array containing non-object entries", () => {
    expectInvalid(
      () => battery.parsePostureFile(JSON.stringify([null]), FILE_A),
      "entry must be a JSON object",
    );
    expectInvalid(
      () => battery.parsePostureFile(JSON.stringify([["x"]]), FILE_A),
      "entry must be a JSON object",
    );
  });
});

describe("H3-088 validatePostureEntry — entry-level strictness", () => {
  it("rejects non-object entries (null, array, scalar)", () => {
    for (const bad of [null, [], "x", 1, true]) {
      expectInvalid(() => battery.validatePostureEntry(bad, FILE_A), "entry must be a JSON object");
    }
  });

  it("accepts table/name aliases and rejects conflicting aliases", () => {
    expect(battery.validatePostureEntry({ table: "cg_entity", posture: "zero-policy" }, FILE_A).name).toBe("cg_entity");
    expect(battery.validatePostureEntry({ name: "cg_entity", posture: "zero-policy" }, FILE_A).name).toBe("cg_entity");
    expect(
      battery.validatePostureEntry({ table: "cg_entity", name: "cg_entity", posture: "zero-policy" }, FILE_A).name,
    ).toBe("cg_entity");
    expectInvalid(
      () => battery.validatePostureEntry({ table: "cg_entity", name: "cg_event", posture: "zero-policy" }, FILE_A),
      "conflicting table names",
    );
  });

  it("rejects table names that are not plain SQL identifiers", () => {
    for (const bad of ["CG-ENTITY", "cg entity", "1table", "cg;drop", "", "cg_ENTITY"]) {
      expectInvalid(() => battery.validatePostureEntry({ name: bad, posture: "zero-policy" }, FILE_A), "entry must name a table");
    }
  });

  it("rejects an unknown posture value", () => {
    expectInvalid(
      () => battery.validatePostureEntry({ name: "cg_entity", posture: "unlocked" }, FILE_A),
      "posture must be one of zero-policy | policy-backed",
    );
  });

  it("rejects a missing posture value", () => {
    expectInvalid(() => battery.validatePostureEntry({ name: "cg_entity" }, FILE_A), "posture must be one of");
  });

  it("rejects malformed source provenance but accepts sourceMigration as an alias", () => {
    expectInvalid(
      () => battery.validatePostureEntry({ name: "cg_entity", posture: "zero-policy", source: "" }, FILE_A),
      "source/sourceMigration must be a non-empty string",
    );
    expectInvalid(
      () => battery.validatePostureEntry({ name: "cg_entity", posture: "zero-policy", sourceMigration: 7 }, FILE_A),
      "source/sourceMigration must be a non-empty string",
    );
    const aliased = battery.validatePostureEntry(
      { name: "cg_entity", posture: "zero-policy", sourceMigration: "mig.sql" },
      FILE_A,
    );
    expect(aliased.source).toBe("mig.sql");
  });

  it("defaults source provenance to posture-file:<name> (AGENTS §12) and stamps postureSource", () => {
    const entry = battery.validatePostureEntry({ name: "cg_entity", posture: "zero-policy" }, FILE_A);
    expect(entry.source).toBe(`posture-file:${FILE_A}`);
    expect(entry.postureSource).toBe(FILE_A);
  });

  it("rejects policies declared as a non-array", () => {
    expectInvalid(
      () => battery.validatePostureEntry({ name: "cg_entity", posture: "policy-backed", policies: "x", tenantColumn: "tenant_id" }, FILE_A),
      "policies must be an array",
    );
  });

  it("rejects empty-string and ill-typed policy entries in the array", () => {
    expectInvalid(
      () => battery.validatePostureEntry({ name: "cg_entity", posture: "policy-backed", tenantColumn: "tenant_id", policies: ["  "] }, FILE_A),
      "policy names must be non-empty strings",
    );
    expectInvalid(
      () => battery.validatePostureEntry({ name: "cg_entity", posture: "policy-backed", tenantColumn: "tenant_id", policies: [null] }, FILE_A),
      "policy-name strings or declaration objects",
    );
    expectInvalid(
      () => battery.validatePostureEntry({ name: "cg_entity", posture: "policy-backed", tenantColumn: "tenant_id", policies: [{ noName: true }] }, FILE_A),
      "policy-name strings or declaration objects",
    );
    expectInvalid(
      () => battery.validatePostureEntry({ name: "cg_entity", posture: "policy-backed", tenantColumn: "tenant_id", policies: [["x"]] }, FILE_A),
      "policy-name strings or declaration objects",
    );
  });

  it("normalizes declaration-object policies to names and preserves declarations as provenance", () => {
    const entry = battery.validatePostureEntry(
      {
        name: "cg_entity",
        posture: "policy-backed",
        tenantColumn: "tenant_id",
        policies: ["p1", { name: "p2", using: "tenant_id = current_tenant()" }],
      },
      FILE_A,
    );
    expect(entry.policies).toEqual(["p1", "p2"]);
    expect(entry.policyDeclarations).toEqual(["p1", { name: "p2", using: "tenant_id = current_tenant()" }]);
  });

  it("rejects repeated policy names within one entry", () => {
    expectInvalid(
      () =>
        battery.validatePostureEntry(
          { name: "cg_entity", posture: "policy-backed", tenantColumn: "tenant_id", policies: ["dup", "dup"] },
          FILE_A,
        ),
      "must not repeat a policy name",
    );
  });

  it("rejects a tenantColumn that is not a plain SQL identifier", () => {
    for (const bad of ["tenant id", "tenant;drop", "Tenant_ID", "tenant.id"]) {
      expectInvalid(
        () => battery.validatePostureEntry({ name: "cg_entity", posture: "zero-policy", tenantColumn: bad }, FILE_A),
        "tenantColumn must be a plain SQL identifier",
      );
    }
  });

  it("rejects a non-boolean forceRls", () => {
    expectInvalid(
      () => battery.validatePostureEntry({ name: "cg_entity", posture: "zero-policy", forceRls: "yes" }, FILE_A),
      "forceRls must be a boolean",
    );
  });

  it("defaults forceRls to true for policy-backed and false for zero-policy", () => {
    expect(POLICY_BACKED("cg_x").forceRls).toBeUndefined();
    const policyBacked = battery.validatePostureEntry(POLICY_BACKED("cg_x"), FILE_A);
    expect(policyBacked.forceRls).toBe(true);
    const zeroPolicy = battery.validatePostureEntry(ZERO_POLICY("cg_x"), FILE_A);
    expect(zeroPolicy.forceRls).toBe(false);
  });
});

describe("H3-088 zero-policy vs policy-backed expectation mismatches (fail closed)", () => {
  it("zero-policy must NOT declare policies — zero policies IS the posture", () => {
    expectInvalid(
      () =>
        battery.validatePostureEntry(
          { name: "cg_entity", posture: "zero-policy", policies: ["some_policy"] },
          FILE_A,
        ),
      "zero-policy posture must not declare policies",
    );
  });

  it("zero-policy must NOT expect FORCE RLS (force cannot strengthen a policy-less posture)", () => {
    expectInvalid(
      () => battery.validatePostureEntry({ name: "cg_entity", posture: "zero-policy", forceRls: true }, FILE_A),
      "cannot expect FORCE RLS",
    );
  });

  it("zero-policy tolerates explicit forceRls=false", () => {
    const entry = battery.validatePostureEntry({ name: "cg_entity", posture: "zero-policy", forceRls: false }, FILE_A);
    expect(entry.forceRls).toBe(false);
  });

  it("policy-backed must declare a non-empty policies array", () => {
    expectInvalid(
      () => battery.validatePostureEntry({ name: "cg_entity", posture: "policy-backed", tenantColumn: "tenant_id", policies: [] }, FILE_A),
      "must declare the exact expected policy names",
    );
    expectInvalid(
      () => battery.validatePostureEntry({ name: "cg_entity", posture: "policy-backed", tenantColumn: "tenant_id" }, FILE_A),
      "must declare the exact expected policy names",
    );
  });

  it("policy-backed must declare tenantColumn (cross-tenant probes filter by it)", () => {
    expectInvalid(
      () =>
        battery.validatePostureEntry(
          { name: "cg_entity", posture: "policy-backed", policies: ["p"] },
          FILE_A,
        ),
      "must declare tenantColumn",
    );
  });

  it("policy-backed must expect FORCE RLS (forceRls=true); explicit false is rejected", () => {
    expectInvalid(
      () =>
        battery.validatePostureEntry(
          { name: "cg_entity", posture: "policy-backed", tenantColumn: "tenant_id", policies: ["p"], forceRls: false },
          FILE_A,
        ),
      "must expect FORCE RLS",
    );
  });

  it("policy-backed privileges must be an object keyed by role with arrays of non-empty strings", () => {
    expectInvalid(
      () =>
        battery.validatePostureEntry(
          { name: "cg_entity", posture: "zero-policy", privileges: ["anon"] },
          FILE_A,
        ),
      "privileges must be an object keyed by role",
    );
    for (const role of ["anon", "authenticated", "public", "service_role"]) {
      expectInvalid(
        () =>
          battery.validatePostureEntry(
            { name: "cg_entity", posture: "zero-policy", privileges: { [role]: ["", "SELECT"] } },
            FILE_A,
          ),
        `privileges.${role} must be an array of non-empty privilege names`,
      );
      expectInvalid(
        () =>
          battery.validatePostureEntry(
            { name: "cg_entity", posture: "zero-policy", privileges: { [role]: "SELECT" } },
            FILE_A,
          ),
        `privileges.${role} must be an array of non-empty privilege names`,
      );
    }
  });

  it("policy-backed privileges.authenticated must be non-empty when declared (policies must be the operative gate)", () => {
    expectInvalid(
      () =>
        battery.validatePostureEntry(
          {
            name: "cg_entity",
            posture: "policy-backed",
            tenantColumn: "tenant_id",
            policies: ["p"],
            privileges: { authenticated: [] },
          },
          FILE_A,
        ),
        "privileges.authenticated must be non-empty",
    );
  });

  it("an empty privileges.authenticated on a ZERO-policy entry is fine (no policy gate to prove)", () => {
    const entry = battery.validatePostureEntry(
      { name: "cg_entity", posture: "zero-policy", privileges: { authenticated: [] } },
      FILE_A,
    );
    expect(entry.posture).toBe("zero-policy");
  });

  it("undeclared privilege roles are skipped, unknown extra roles pass through unvalidated", () => {
    const entry = battery.validatePostureEntry(
      { name: "cg_entity", posture: "zero-policy", privileges: { anon: ["SELECT"], custom_role: "odd-shape" } },
      FILE_A,
    );
    expect((entry.privileges as Record<string, unknown>).anon).toEqual(["SELECT"]);
    expect((entry.privileges as Record<string, unknown>).custom_role).toBe("odd-shape");
  });
});

describe("H3-088 invalid recipe shapes (§4.4 probe declarations fail closed)", () => {
  const policyBackedBase = (): PostureEntry => POLICY_BACKED("cg_probe_table");

  it("a probe recipe is only meaningful on the policy-backed posture", () => {
    expectInvalid(
      () =>
        battery.validatePostureEntry(
          {
            name: "cg_entity",
            posture: "zero-policy",
            probeSeedRows: [{ tenant_id: "$TENANT_A" }],
            probeInsertPayload: { tenant_id: "$TENANT_B" },
          },
          FILE_A,
        ),
      "probe recipe is only meaningful on the policy-backed posture",
    );
  });

  it("partial recipe declarations are rejected — BOTH probeSeedRows and probeInsertPayload", () => {
    expectInvalid(
      () =>
        battery.validatePostureEntry(
          { ...policyBackedBase(), probeSeedRows: [{ tenant_id: "$TENANT_A" }] },
          FILE_A,
        ),
      "BOTH probeSeedRows and probeInsertPayload",
    );
    expectInvalid(
      () =>
        battery.validatePostureEntry({ ...policyBackedBase(), probeInsertPayload: { tenant_id: "$TENANT_B" } }, FILE_A),
      "BOTH probeSeedRows and probeInsertPayload",
    );
  });

  it("probeSeedRows must be a non-empty array of non-empty objects", () => {
    const payload = { tenant_id: "$TENANT_B" };
    for (const badSeed of [[], [null], ["x"], [[]], [{}]]) {
      expectInvalid(
        () => battery.validatePostureEntry({ ...policyBackedBase(), probeSeedRows: badSeed, probeInsertPayload: payload }, FILE_A),
        "probeSeedRows must be a non-empty array of non-empty column->value objects",
      );
    }
  });

  it("probeInsertPayload must be a column->value object (no arrays, nulls, scalars)", () => {
    for (const badPayload of [null, ["x"], "x", 1, true]) {
      expectInvalid(
        () =>
          battery.validatePostureEntry(
            { ...policyBackedBase(), probeSeedRows: [{ tenant_id: "$TENANT_A" }], probeInsertPayload: badPayload },
            FILE_A,
          ),
        "probeInsertPayload must be a column->value object",
      );
    }
    const ok = battery.validatePostureEntry(
      { ...policyBackedBase(), probeSeedRows: [{ tenant_id: "$TENANT_A" }], probeInsertPayload: {} },
      FILE_A,
    );
    expect(ok.probeInsertPayload).toEqual({});
  });

  it("probeAuxTables requires the full policy-backed recipe, not just probeSeedRows", () => {
    expectInvalid(
      () =>
        battery.validatePostureEntry(
          {
            ...policyBackedBase(),
            probeSeedRows: [{ tenant_id: "$TENANT_A" }],
            probeAuxTables: [{ table: "cg_aux", tenantColumn: "tenant_id", seedRows: [{ x: 1 }] }],
          },
          FILE_A,
        ),
        "BOTH probeSeedRows and probeInsertPayload",
    );
  });

  it("probeAuxTables entries must be non-empty arrays of well-formed cg_-prefixed aux specs", () => {
    const base = () => ({
      ...policyBackedBase(),
      probeSeedRows: [{ tenant_id: "$TENANT_A" }],
      probeInsertPayload: { tenant_id: "$TENANT_B" },
    });
    for (const badAux of [[null], ["x"]]) {
      expectInvalid(
        () => battery.validatePostureEntry({ ...base(), probeAuxTables: badAux }, FILE_A),
        "probeAuxTables entries must be objects",
      );
    }
    expectInvalid(
      () => battery.validatePostureEntry({ ...base(), probeAuxTables: [] }, FILE_A),
      "probeAuxTables must be a non-empty array when present",
    );
    const wellFormed = { table: "cg_aux", tenantColumn: "tenant_id", seedRows: [{ x: 1 }] };
    expectInvalid(
      () => battery.validatePostureEntry({ ...base(), probeAuxTables: [{ ...wellFormed, table: "not_cg" }] }, FILE_A),
      "probeAuxTables.table must be a cg_-prefixed SQL identifier",
    );
    expectInvalid(
      () => battery.validatePostureEntry({ ...base(), probeAuxTables: [{ ...wellFormed, table: "cg aux" }] }, FILE_A),
      "probeAuxTables.table must be a cg_-prefixed SQL identifier",
    );
    expectInvalid(
      () => battery.validatePostureEntry({ ...base(), probeAuxTables: [{ ...wellFormed, tenantColumn: "tenant id" }] }, FILE_A),
      "probeAuxTables.tenantColumn must be a plain SQL identifier",
    );
    for (const badSeed of [undefined, [], [null], [{}]]) {
      expectInvalid(
        () => battery.validatePostureEntry({ ...base(), probeAuxTables: [{ ...wellFormed, seedRows: badSeed }] }, FILE_A),
        "probeAuxTables.seedRows must be a non-empty array",
      );
    }
  });

  it("a fully-formed recipe on a policy-backed entry validates and passes through untouched", () => {
    const recipe = {
      probeSeedRows: [{ tenant_id: "$TENANT_A", actor_id: "$ACTOR_A_ID" }],
      probeInsertPayload: { tenant_id: "$TENANT_B" },
    };
    const entry = battery.validatePostureEntry({ ...policyBackedBase(), ...recipe }, FILE_A);
    expect(entry.probeSeedRows).toEqual(recipe.probeSeedRows);
    expect(entry.probeInsertPayload).toEqual(recipe.probeInsertPayload);
    expect(battery.resolveProbeStage(entry)).toBe("recipe");
  });
});

describe("H3-088 unknown-field strictness (provenance pass-through, known-field rejection)", () => {
  it("unknown fields pass through untouched as provenance (rationale-like content is NOT validated)", () => {
    const entry = battery.validatePostureEntry(
      {
        name: "cg_entity",
        posture: "zero-policy",
        rationale: "arbitrary adjudication prose that J-099 may rewrite freely",
        appendOnly: true,
        absentPolicies: ["x", "y"],
        nestedUnknown: { deep: [1, 2, 3] },
      },
      FILE_A,
    );
    expect(entry.rationale).toBe("arbitrary adjudication prose that J-099 may rewrite freely");
    expect(entry.appendOnly).toBe(true);
    expect(entry.absentPolicies).toEqual(["x", "y"]);
    expect(entry.nestedUnknown).toEqual({ deep: [1, 2, 3] });
  });

  it("unknown fields on a policy-backed entry also pass through and survive registry merge", () => {
    const entry = battery.validatePostureEntry(
      { ...POLICY_BACKED("cg_workspace"), customProvenance: { note: "ok" } },
      FILE_A,
    );
    expect(entry.customProvenance).toEqual({ note: "ok" });
    const registry = battery.resolvePostureRegistry([{ name: FILE_A, entries: [entry] }]);
    const merged = registry.tables.find((t) => t.name === "cg_workspace");
    expect(merged?.customProvenance).toEqual({ note: "ok" });
  });

  it("normalization never silently drops the raw entry shape (spread passthrough)", () => {
    const raw = { ...ZERO_POLICY("cg_entity"), legacy_field: 1 };
    const entry = battery.validatePostureEntry(raw, FILE_A);
    expect(entry.legacy_field).toBe(1);
    expect(entry.name).toBe("cg_entity");
  });

  it("KNOWN fields keep their strictness regardless of how many unknown fields ride along", () => {
    expectInvalid(
      () =>
        battery.validatePostureEntry(
          { name: "cg_entity", posture: "zero-policy", anything: 1, policies: ["nope"] },
          FILE_A,
        ),
      "zero-policy posture must not declare policies",
    );
  });
});

describe("H3-088 resolveProbeStage — stage resolution edge cases", () => {
  it("zero-policy tables are not-applicable regardless of declared recipe fields", () => {
    expect(
      battery.resolveProbeStage({
        name: "cg_entity",
        posture: "zero-policy",
        probeSeedRows: [{ x: 1 }],
        probeInsertPayload: { x: 1 },
      }),
    ).toBe("not-applicable");
  });

  it("neutral-membership tables get their built-in stage with no declared recipe", () => {
    for (const name of ["cg_org_membership", "cg_role_assignment", "cg_role_grant"]) {
      expect(battery.resolveProbeStage({ name, posture: "policy-backed" })).toBe("neutral-membership");
      expect(battery.NEUTRAL_MEMBERSHIP_PROBE_TABLES.has(name)).toBe(true);
    }
  });

  it("non-neutral policy-backed tables with no recipe are undeclared (never a silent pass)", () => {
    expect(battery.resolveProbeStage({ name: "cg_other", posture: "policy-backed" })).toBe("undeclared");
  });

  it("a policy-backed table on the neutral set with a full recipe declares the recipe (explicit beats builtin)", () => {
    expect(
      battery.resolveProbeStage({
        name: "cg_org_membership",
        posture: "policy-backed",
        probeSeedRows: [{ tenant_id: "$TENANT_A" }],
        probeInsertPayload: { tenant_id: "$TENANT_B" },
      }),
    ).toBe("recipe");
  });

  it("partial recipes are undeclared even for neutral-membership tables", () => {
    expect(
      battery.resolveProbeStage({
        name: "cg_role_grant",
        posture: "policy-backed",
        probeSeedRows: [{ tenant_id: "$TENANT_A" }],
      }),
    ).toBe("undeclared");
    expect(
      battery.resolveProbeStage({
        name: "cg_role_grant",
        posture: "policy-backed",
        probeInsertPayload: { tenant_id: "$TENANT_B" },
      }),
    ).toBe("undeclared");
  });

  it("empty seed rows count as not-declared (falls back to neutral-membership/undeclared)", () => {
    expect(
      battery.resolveProbeStage({
        name: "cg_other",
        posture: "policy-backed",
        probeSeedRows: [],
        probeInsertPayload: { x: 1 },
      }),
    ).toBe("undeclared");
  });

  it("null insert payload counts as not-declared", () => {
    expect(
      battery.resolveProbeStage({
        name: "cg_other",
        posture: "policy-backed",
        probeSeedRows: [{ x: 1 }],
        probeInsertPayload: null,
      }),
    ).toBe("undeclared");
  });
});

describe("H3-088 substituteProbeValue — token-replacement edge cases", () => {
  const ctx = {
    $TENANT_A: "tenant-a-uuid",
    $TENANT_B: "tenant-b-uuid",
    $ACTOR_A_ID: "actor-a-uuid",
    $RUN_ID: "run-42",
  };

  it("replaces exact-match placeholders on string values", () => {
    expect(battery.substituteProbeValue("$TENANT_A", ctx)).toBe("tenant-a-uuid");
    expect(battery.substituteProbeValue("$RUN_ID", ctx)).toBe("run-42");
  });

  it("preserves strings that are not exact placeholders — no partial or embedded substitution", () => {
    expect(battery.substituteProbeValue("$TENANT_A-suffix", ctx)).toBe("$TENANT_A-suffix");
    expect(battery.substituteProbeValue("prefix-$TENANT_A", ctx)).toBe("prefix-$TENANT_A");
    expect(battery.substituteProbeValue("$TENANT_A$TENANT_B", ctx)).toBe("$TENANT_A$TENANT_B");
    expect(battery.substituteProbeValue("$TENANT_A ", ctx)).toBe("$TENANT_A ");
    expect(battery.substituteProbeValue("$TENANT_C", ctx)).toBe("$TENANT_C");
  });

  it("preserves case-sensitivity — placeholders are exact tokens, not patterns", () => {
    expect(battery.substituteProbeValue("$tenant_a", ctx)).toBe("$tenant_a");
    expect(battery.substituteProbeValue("$Tenant_A", ctx)).toBe("$Tenant_A");
  });

  it("leaves unknown (undeclared) placeholder-shaped strings untouched", () => {
    expect(battery.substituteProbeValue("$ACTOR_B_ID", ctx)).toBe("$ACTOR_B_ID");
    expect(battery.substituteProbeValue("$ACTOR_C_ID", ctx)).toBe("$ACTOR_C_ID");
  });

  it("substitutes recursively through objects and arrays", () => {
    const input = {
      rows: [
        { tenant_id: "$TENANT_A", tags: ["$RUN_ID", "static"] },
        { tenant_id: "$TENANT_B" },
      ],
      payload: { actor_id: "$ACTOR_A_ID", flag: true, count: 3, nothing: null },
    };
    expect(battery.substituteProbeValue(input, ctx)).toEqual({
      rows: [
        { tenant_id: "tenant-a-uuid", tags: ["run-42", "static"] },
        { tenant_id: "tenant-b-uuid" },
      ],
      payload: { actor_id: "actor-a-uuid", flag: true, count: 3, nothing: null },
    });
  });

  it("never substitutes object KEYS — only values", () => {
    expect(battery.substituteProbeValue({ $TENANT_A: "$TENANT_B" }, ctx)).toEqual({ $TENANT_A: "tenant-b-uuid" });
  });

  it("passes non-string primitives through untouched (numbers, booleans, null, undefined)", () => {
    expect(battery.substituteProbeValue(42, ctx)).toBe(42);
    expect(battery.substituteProbeValue(true, ctx)).toBe(true);
    expect(battery.substituteProbeValue(null, ctx)).toBe(null);
    expect(battery.substituteProbeValue(undefined, ctx)).toBe(undefined);
  });

  it("treats Object.prototype keys and inherited properties as NOT in context (own-property exact match)", () => {
    expect(battery.substituteProbeValue("toString", ctx)).toBe("toString");
    expect(battery.substituteProbeValue("constructor", ctx)).toBe("constructor");
    expect(battery.substituteProbeValue("hasOwnProperty", ctx)).toBe("hasOwnProperty");
  });

  it("replaces every occurrence when the context declares all placeholders", () => {
    const full = Object.fromEntries(battery.PROBE_PLACEHOLDERS.map((p) => [p, `v:${p}`]));
    const out = battery.substituteProbeValue(battery.PROBE_PLACEHOLDERS, full);
    expect(out).toEqual(battery.PROBE_PLACEHOLDERS.map((p) => `v:${p}`));
  });
});

describe("H3-088 sqlLiteral and buildProbeSeedSql — probe SQL construction edge cases", () => {
  it("renders NULL, finite numbers, booleans, and defensively-escaped strings", () => {
    expect(battery.sqlLiteral(null)).toBe("NULL");
    expect(battery.sqlLiteral(undefined)).toBe("NULL");
    expect(battery.sqlLiteral(0)).toBe("0");
    expect(battery.sqlLiteral(-1.5)).toBe("-1.5");
    expect(battery.sqlLiteral(true)).toBe("TRUE");
    expect(battery.sqlLiteral(false)).toBe("FALSE");
    expect(battery.sqlLiteral("plain")).toBe("'plain'");
    expect(battery.sqlLiteral("o'brien")).toBe("'o''brien'");
    expect(battery.sqlLiteral("')).inject;--")).toBe(`''')).inject;--'`);
  });

  it("renders non-string non-primitives as JSON text", () => {
    expect(battery.sqlLiteral({ a: 1 })).toBe(`'{"a":1}'`);
    expect(battery.sqlLiteral([1, 2])).toBe(`'[1,2]'`);
  });

  it("renders non-finite numbers as JSON-ish strings rather than raw NaN/Infinity SQL", () => {
    expect(battery.sqlLiteral(NaN)).toBe(`'null'`);
  });

  it("rejects unsafe table names and column names before building SQL", () => {
    expectInvalid(() => battery.buildProbeSeedSql("cg_table; DROP TABLE x", [{ a: 1 }]), "unsafe probe seed target table");
    expectInvalid(() => battery.buildProbeSeedSql("CG-BAD", [{ a: 1 }]), "unsafe probe seed target table");
    expectInvalid(() => battery.buildProbeSeedSql("cg_ok", [{ "col; DROP": 1 }]), "unsafe probe seed column");
    expect(battery.buildProbeSeedSql("cg_ok", [])).toBe("");
  });

  it("rejects empty seed rows at SQL-build time", () => {
    expectInvalid(() => battery.buildProbeSeedSql("cg_ok", [{}]), "is empty");
  });

  it("builds quoted-identifier-free INSERT statements from validated rows", () => {
    const sql = battery.buildProbeSeedSql("cg_probe", [
      { tenant_id: "$TENANT_A", attempts: 2 },
      { tenant_id: "t-b", active: true },
    ]);
    expect(sql).toBe(
      "INSERT INTO public.cg_probe (tenant_id, attempts) VALUES ('$TENANT_A', 2);\n" +
        "INSERT INTO public.cg_probe (tenant_id, active) VALUES ('t-b', TRUE);",
    );
  });

  it("builds a single statement for a single row with no trailing semicolon beyond the statement", () => {
    const sql = battery.buildProbeSeedSql("cg_probe", [{ x: null }]);
    expect(sql).toBe("INSERT INTO public.cg_probe (x) VALUES (NULL);");
    expect(sql.endsWith(";")).toBe(true);
    expect(sql.includes(";;")).toBe(false);
  });
});

describe("H3-088 loadPostureRegistry — offline I/O wrapper behavior", () => {
  const tmpRoots: string[] = [];

  afterAll(() => {
    for (const dir of tmpRoots) rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to the builtin canonical posture for a missing directory (offline-safe)", () => {
    const registry = battery.loadPostureRegistry(join(tmpdir(), "h3-088-does-not-exist-at-all"));
    expect(registry.fallbackUsed).toBe(true);
    expect(registry.tables.length).toBe(battery.BUILTIN_TABLE_POSTURES.length);
  });

  it("reads only rls-table-postures-*.json files, sorted by name, and merges them in that order", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-088-postures-"));
    tmpRoots.push(dir);
    writeFileSync(
      join(dir, "rls-table-postures-aaa.json"),
      JSON.stringify([{ ...POLICY_BACKED("cg_workspace"), source: "from-aaa" }]),
    );
    writeFileSync(join(dir, "ignored-other.json"), JSON.stringify([ZERO_POLICY("cg_should_be_ignored")]));
    writeFileSync(
      join(dir, "rls-table-postures-bbb.json"),
      JSON.stringify([ZERO_POLICY("cg_h3_088_loaded_add")]),
    );
    const registry = battery.loadPostureRegistry(dir);
    expect(registry.files).toEqual(["rls-table-postures-aaa.json", "rls-table-postures-bbb.json"]);
    expect(registry.fallbackUsed).toBe(false);
    expect(registry.overridden).toEqual(["cg_workspace"]);
    expect(registry.added).toEqual(["cg_h3_088_loaded_add"]);
    const workspace = registry.tables.find((t) => t.name === "cg_workspace");
    expect(workspace?.source).toBe("from-aaa");
    const ignored = registry.tables.find((t) => t.name === "cg_should_be_ignored");
    expect(ignored).toBeUndefined();
  });

  it("fails closed with the file name when a discovered posture file is malformed", () => {
    const dir = mkdtempSync(join(tmpdir(), "h3-088-postures-"));
    tmpRoots.push(dir);
    writeFileSync(join(dir, "rls-table-postures-broken.json"), "{definitely not json");
    expectInvalid(() => battery.loadPostureRegistry(dir), "rls-table-postures-broken.json");
  });
});