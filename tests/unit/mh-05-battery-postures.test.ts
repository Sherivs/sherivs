import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error — plain-JS verification script imported into the TS unit suite (H2-05 file ownership permits no scripts/lib/*.d.mts)
import * as batteryMjs from "../../scripts/verify-rls-isolation-battery.mjs";

interface PostureEntry {
  name: string;
  posture: string;
  source: string;
  forceRls: boolean;
  postureSource: string;
  tenantColumn?: string;
  policies?: string[];
  privileges?: Record<string, string[]>;
  probeSeedRows?: Record<string, unknown>[];
  probeInsertPayload?: Record<string, unknown>;
  [key: string]: unknown;
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
  validatePostureEntry: (entry: unknown, fileName: string) => PostureEntry;
  parsePostureFile: (text: string, fileName: string) => PostureEntry[];
  resolvePostureRegistry: (
    files: { name: string; entries: unknown[] }[],
    fallback?: PostureEntry[],
  ) => PostureRegistry;
  loadPostureRegistry: (dir: string) => PostureRegistry;
  NEUTRAL_MEMBERSHIP_PROBE_TABLES: Set<string>;
  resolveProbeStage: (table: PostureEntry) => string;
  PROBE_PLACEHOLDERS: string[];
  substituteProbeValue: (value: unknown, ctx: Record<string, string>) => unknown;
  sqlLiteral: (value: unknown) => string;
  buildProbeSeedSql: (tableName: string, rows: Record<string, unknown>[]) => string;
}

const battery = batteryMjs as unknown as BatteryModule;

const CANONICAL_POLICY_BACKED = [
  {
    name: "cg_org_membership",
    tenantColumn: "tenant_id",
    policies: [
      "org_membership_select_own_tenant",
      "org_membership_insert_tenant_admin",
      "org_membership_update_tenant_admin",
    ],
  },
  {
    name: "cg_role_assignment",
    tenantColumn: "tenant_ref",
    policies: [
      "role_assignment_select_own_tenant",
      "role_assignment_insert_tenant_admin",
      "role_assignment_update_tenant_admin",
    ],
  },
  {
    name: "cg_role_grant",
    tenantColumn: "tenant_ref",
    policies: [
      "role_grant_select_own_tenant",
      "role_grant_insert_tenant_admin",
      "role_grant_update_tenant_admin",
    ],
  },
];

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mh05-postures-"));
  tempDirs.push(dir);
  return dir;
}

function writePostureFile(dir: string, fileName: string, content: string): void {
  writeFileSync(join(dir, fileName), content, "utf8");
}

// Representative of the LANDED sibling shape (rls-table-postures-substrate.json):
// object wrapper with metadata + "tables" array, "name" field, policy
// declaration objects, declared privileges, force expectation.
const SUBSTRATE_LIKE = JSON.stringify({
  artifact: "rls-table-postures-substrate",
  mission: "H2-04 — substrate policy layer (representative fixture)",
  status: "AUTHORED, NOT APPLIED",
  tables: [
    {
      name: "cg_reconciliation_input",
      source: "20261002000005_coregrid_v1_reconciliation.sql",
      posture: "policy-backed",
      tenantColumn: "tenant_id",
      appendOnly: true,
      forceRls: true,
      privileges: { authenticated: ["SELECT", "INSERT"], anon: [], service_role: ["ALL"] },
      policies: [
        { name: "reconciliation_input_select_own_tenant", command: "SELECT", predicate: "tenant_id = public.get_my_tenant_id()" },
        { name: "reconciliation_input_insert_tenant_admin", command: "INSERT", predicate: "public.is_tenant_admin(tenant_id)" },
      ],
      absentPolicies: { DELETE: "history preserved" },
    },
    {
      name: "cg_event_route_queue",
      posture: "zero-policy",
      rationale: "router-owned delivery state — unchanged deny-by-default",
    },
  ],
});

describe("MH2-05 posture-file parser (parsePostureFile / validatePostureEntry)", () => {
  const FILE = "rls-table-postures-fixture.json";

  it("parses the landed sibling shape (object wrapper + tables array + name + policy objects)", () => {
    const entries = battery.parsePostureFile(SUBSTRATE_LIKE, FILE);
    expect(entries).toHaveLength(2);

    const [input, queue] = entries;
    expect(input.name).toBe("cg_reconciliation_input");
    expect(input.posture).toBe("policy-backed");
    expect(input.forceRls).toBe(true);
    expect(input.tenantColumn).toBe("tenant_id");
    // Declaration objects normalize to the exact expected policy-name set.
    expect(input.policies).toEqual([
      "reconciliation_input_select_own_tenant",
      "reconciliation_input_insert_tenant_admin",
    ]);
    expect(input.policyDeclarations).toHaveLength(2);
    // Declared least-privilege grant expectation is preserved for section (c).
    expect(input.privileges).toEqual({ authenticated: ["SELECT", "INSERT"], anon: [], service_role: ["ALL"] });
    // Provenance: explicit source survives; unknown fields pass through untouched.
    expect(input.source).toBe("20261002000005_coregrid_v1_reconciliation.sql");
    expect(input.appendOnly).toBe(true);
    expect(input.absentPolicies).toEqual({ DELETE: "history preserved" });
    expect(input.postureSource).toBe(FILE);

    expect(queue.name).toBe("cg_event_route_queue");
    expect(queue.posture).toBe("zero-policy");
    expect(queue.forceRls).toBe(false);
    expect(queue.policies).toEqual([]);
    expect(queue.rationale).toBe("router-owned delivery state — unchanged deny-by-default");
    // Provenance default (AGENTS §12): WHERE it came from is always answerable.
    expect(queue.source).toBe(`posture-file:${FILE}`);
  });

  it("accepts a bare JSON array and a postures-wrapper shape", () => {
    const bare = battery.parsePostureFile(
      JSON.stringify([{ name: "cg_entity", posture: "zero-policy" }]),
      FILE,
    );
    expect(bare).toHaveLength(1);
    expect(bare[0].name).toBe("cg_entity");

    const wrapped = battery.parsePostureFile(
      JSON.stringify({ postures: [{ table: "cg_entity", posture: "zero-policy" }] }),
      FILE,
    );
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0].name).toBe("cg_entity");
  });

  it("accepts sourceMigration provenance (transport-file convention)", () => {
    const [entry] = battery.parsePostureFile(
      JSON.stringify([
        {
          name: "transport_buses",
          sourceMigration: "database/supabase/migrations/20260626150625_example.sql",
          posture: "zero-policy",
        },
      ]),
      FILE,
    );
    expect(entry.name).toBe("transport_buses");
    expect(entry.source).toBe("database/supabase/migrations/20260626150625_example.sql");
    expect(entry.forceRls).toBe(false);
  });

  it("rejects invalid JSON and files without an entries array", () => {
    expect(() => battery.parsePostureFile("{not json", FILE)).toThrow(/not valid JSON/);
    expect(() => battery.parsePostureFile(JSON.stringify({ nope: true }), FILE)).toThrow(
      /"tables" \(or "postures"\) array/,
    );
    expect(() => battery.parsePostureFile(JSON.stringify("just a string"), FILE)).toThrow(
      /"tables" \(or "postures"\) array/,
    );
  });

  const invalidCases: [string, unknown][] = [
    ["non-object entry", "cg_entity"],
    ["missing table name", { posture: "zero-policy" }],
    ["table name with hostile characters", { name: "cg_evil; DROP TABLE", posture: "zero-policy" }],
    ["uppercase table name", { name: "CG_Entity", posture: "zero-policy" }],
    ["unknown posture", { name: "cg_entity", posture: "unrestricted" }],
    ["conflicting table names", { name: "cg_entity", table: "cg_other", posture: "zero-policy" }],
    [
      "policy-backed without policies",
      { name: "cg_x", posture: "policy-backed", tenantColumn: "tenant_id", forceRls: true },
    ],
    [
      "policy-backed without tenantColumn",
      { name: "cg_x", posture: "policy-backed", forceRls: true, policies: ["x_select"] },
    ],
    [
      "policy-backed with forceRls=false",
      {
        name: "cg_x",
        posture: "policy-backed",
        tenantColumn: "tenant_id",
        forceRls: false,
        policies: ["x_select"],
      },
    ],
    [
      "zero-policy declaring policies",
      { name: "cg_x", posture: "zero-policy", policies: ["x_select"] },
    ],
    ["zero-policy expecting FORCE RLS", { name: "cg_x", posture: "zero-policy", forceRls: true }],
    [
      "repeated policy name",
      {
        name: "cg_x",
        posture: "policy-backed",
        tenantColumn: "tenant_id",
        policies: ["x_select", "x_select"],
      },
    ],
    [
      "policies not an array",
      { name: "cg_x", posture: "policy-backed", tenantColumn: "tenant_id", policies: "x_select" },
    ],
    [
      "policy declaration object without a name",
      { name: "cg_x", posture: "policy-backed", tenantColumn: "tenant_id", policies: [{ command: "SELECT" }] },
    ],
    [
      "non-identifier tenantColumn",
      {
        name: "cg_x",
        posture: "policy-backed",
        tenantColumn: "tenant_id; DROP TABLE",
        policies: ["x_select"],
      },
    ],
    [
      "policy-backed with empty declared authenticated privileges",
      {
        name: "cg_x",
        posture: "policy-backed",
        tenantColumn: "tenant_id",
        policies: ["x_select"],
        privileges: { authenticated: [] },
      },
    ],
    [
      "partial probe recipe (payload without seed rows)",
      {
        name: "cg_x",
        posture: "policy-backed",
        tenantColumn: "tenant_id",
        policies: ["x_select"],
        probeInsertPayload: { tenant_id: "$TENANT_B" },
      },
    ],
    [
      "probe recipe on a zero-policy table",
      { name: "cg_x", posture: "zero-policy", probeSeedRows: [{ tenant_id: "$TENANT_A" }], probeInsertPayload: {} },
    ],
    [
      "empty probeSeedRows",
      {
        name: "cg_x",
        posture: "policy-backed",
        tenantColumn: "tenant_id",
        policies: ["x_select"],
        probeSeedRows: [],
        probeInsertPayload: { tenant_id: "$TENANT_B" },
      },
    ],
  ];

  for (const [label, entry] of invalidCases) {
    it(`fails closed on: ${label}`, () => {
      expect(() => battery.validatePostureEntry(entry, FILE)).toThrow(/invalid posture file/);
    });
  }

  it("derives forceRls=true by default for policy-backed and keeps the exact declared policy set", () => {
    const entry = battery.validatePostureEntry(
      { name: "cg_x", posture: "policy-backed", tenantColumn: "tenant_id", policies: ["x_select"] },
      FILE,
    );
    expect(entry.forceRls).toBe(true);
    expect(entry.policies).toEqual(["x_select"]);
    expect("policyDeclarations" in entry).toBe(false);
  });
});

describe("MH2-05 posture resolution (resolvePostureRegistry)", () => {
  it("falls back to the built-in canonical posture with no files (36 tables, dual posture)", () => {
    const registry = battery.resolvePostureRegistry([]);
    expect(registry.fallbackUsed).toBe(true);
    expect(registry.files).toEqual([]);
    expect(registry.overridden).toEqual([]);
    expect(registry.added).toEqual([]);
    expect(registry.tables).toHaveLength(36);
    for (const canonical of CANONICAL_POLICY_BACKED) {
      const table = registry.tables.find((t) => t.name === canonical.name);
      expect(table?.posture).toBe("policy-backed");
      expect(table?.forceRls).toBe(true);
      expect(table?.tenantColumn).toBe(canonical.tenantColumn);
      expect(table?.policies).toEqual(canonical.policies);
      expect(table?.postureSource).toBe("builtin-canonical");
    }
    const policyBacked = registry.tables.filter((t) => t.posture === "policy-backed");
    expect(policyBacked.map((t) => t.name)).toEqual(
      CANONICAL_POLICY_BACKED.map((t) => t.name),
    );
  });

  it("never mutates the built-in canonical fallback when files override it", () => {
    const before = JSON.stringify(battery.BUILTIN_TABLE_POSTURES);
    battery.resolvePostureRegistry([
      {
        name: "rls-table-postures-override.json",
        entries: [{ name: "cg_entity", posture: "policy-backed", tenantColumn: "tenant_id", policies: ["entity_select"] }],
      },
    ]);
    expect(JSON.stringify(battery.BUILTIN_TABLE_POSTURES)).toBe(before);
  });

  it("overrides a table's posture in place, preserving battery order and provenance", () => {
    const registry = battery.resolvePostureRegistry([
      {
        name: "rls-table-postures-substrate.json",
        entries: [
          {
            name: "cg_reconciliation_input",
            source: "20261002000005_coregrid_v1_reconciliation.sql",
            posture: "policy-backed",
            tenantColumn: "tenant_id",
            forceRls: true,
            policies: ["reconciliation_input_select_own_tenant", "reconciliation_input_insert_tenant_admin"],
          },
        ],
      },
    ]);
    const builtinIndex = battery.BUILTIN_TABLE_POSTURES.findIndex((t) => t.name === "cg_reconciliation_input");
    expect(registry.tables[builtinIndex]?.name).toBe("cg_reconciliation_input");
    expect(registry.tables[builtinIndex]?.posture).toBe("policy-backed");
    expect(registry.tables[builtinIndex]?.postureSource).toBe("rls-table-postures-substrate.json");
    expect(registry.overridden).toEqual(["cg_reconciliation_input"]);
    expect(registry.added).toEqual([]);
    expect(registry.fallbackUsed).toBe(false);
  });

  it("appends a declared table outside the built-in namespace (e.g. transport_buses)", () => {
    const registry = battery.resolvePostureRegistry([
      {
        name: "rls-table-postures-transport.json",
        entries: [
          {
            name: "transport_buses",
            sourceMigration: "database/supabase/migrations/20260626150625_example.sql",
            posture: "zero-policy",
          },
        ],
      },
    ]);
    const added = registry.tables[registry.tables.length - 1];
    expect(added.name).toBe("transport_buses");
    expect(added.posture).toBe("zero-policy");
    expect(added.postureSource).toBe("rls-table-postures-transport.json");
    expect(registry.added).toEqual(["transport_buses"]);
    expect(registry.overridden).toEqual([]);
  });

  it("rejects a table declared in two different files (one source of truth)", () => {
    expect(() =>
      battery.resolvePostureRegistry([
        { name: "rls-table-postures-a.json", entries: [{ name: "cg_entity", posture: "zero-policy" }] },
        { name: "rls-table-postures-b.json", entries: [{ name: "cg_entity", posture: "zero-policy" }] },
      ]),
    ).toThrow(/declared more than once \(rls-table-postures-a\.json and rls-table-postures-b\.json\)/);
  });

  it("rejects a table declared twice within the same file", () => {
    expect(() =>
      battery.resolvePostureRegistry([
        {
          name: "rls-table-postures-a.json",
          entries: [
            { name: "cg_entity", posture: "zero-policy" },
            { name: "cg_entity", posture: "zero-policy" },
          ],
        },
      ]),
    ).toThrow(/declared more than once/);
  });

  it("re-validates raw file entries (defense in depth — no bypass of fail-closed validation)", () => {
    expect(() =>
      battery.resolvePostureRegistry([
        { name: "rls-table-postures-bad.json", entries: [{ name: "cg_entity", posture: "unrestricted" }] },
      ]),
    ).toThrow(/invalid posture file rls-table-postures-bad\.json/);
  });
});

describe("MH2-05 §4.4 probe-stage resolution (data-declared, fail closed)", () => {
  it("routes the neutral-membership exemplar tables to the built-in probe stage", () => {
    for (const name of ["cg_org_membership", "cg_role_assignment", "cg_role_grant"]) {
      expect(battery.NEUTRAL_MEMBERSHIP_PROBE_TABLES.has(name)).toBe(true);
    }
    const registry = battery.resolvePostureRegistry([]);
    for (const name of battery.NEUTRAL_MEMBERSHIP_PROBE_TABLES) {
      const table = registry.tables.find((t) => t.name === name);
      expect(table && battery.resolveProbeStage(table)).toBe("neutral-membership");
    }
  });

  it("is not applicable to zero-policy tables (strongest-form derivation instead)", () => {
    const registry = battery.resolvePostureRegistry([]);
    const zeroPolicy = registry.tables.find((t) => t.name === "cg_entity");
    expect(zeroPolicy && battery.resolveProbeStage(zeroPolicy)).toBe("not-applicable");
  });

  it("fails closed for policy-backed tables without a declared probe recipe", () => {
    const registry = battery.resolvePostureRegistry([
      {
        name: "rls-table-postures-substrate.json",
        entries: [
          {
            name: "cg_reconciliation_input",
            posture: "policy-backed",
            tenantColumn: "tenant_id",
            policies: ["reconciliation_input_select_own_tenant"],
          },
        ],
      },
    ]);
    const table = registry.tables.find((t) => t.name === "cg_reconciliation_input");
    expect(table && battery.resolveProbeStage(table)).toBe("undeclared");
  });

  it("accepts a fully declared probe recipe", () => {
    const registry = battery.resolvePostureRegistry([
      {
        name: "rls-table-postures-recipe.json",
        entries: [
          {
            name: "cg_reconciliation_input",
            posture: "policy-backed",
            tenantColumn: "tenant_id",
            policies: ["reconciliation_input_select_own_tenant"],
            probeSeedRows: [{ tenant_id: "$TENANT_A", resolution_ref: "$RUN_ID" }],
            probeInsertPayload: { tenant_id: "$TENANT_B", resolution_ref: "$RUN_ID" },
          },
        ],
      },
    ]);
    const table = registry.tables.find((t) => t.name === "cg_reconciliation_input");
    expect(table && battery.resolveProbeStage(table)).toBe("recipe");
  });
});

describe("MH2-05 probe-recipe helpers (pure, offline)", () => {
  it("substitutes placeholders exactly and recursively, leaving other values untouched", () => {
    const ctx = {
      $TENANT_A: "battery-tenant-a-abc",
      $TENANT_B: "battery-tenant-b-abc",
      $ACTOR_A_ID: "user-a-uuid",
      $RUN_ID: "abc",
    };
    const row = {
      tenant_id: "$TENANT_A",
      principal_ref: "$ACTOR_A_ID",
      note: "$NOT_A_PLACEHOLDER",
      nested: { tenant: "$TENANT_B", count: 2, keep: null },
      list: ["$RUN_ID", 7, false],
    };
    expect(battery.substituteProbeValue(row, ctx)).toEqual({
      tenant_id: "battery-tenant-a-abc",
      principal_ref: "user-a-uuid",
      note: "$NOT_A_PLACEHOLDER",
      nested: { tenant: "battery-tenant-b-abc", count: 2, keep: null },
      list: ["abc", 7, false],
    });
    expect(battery.substituteProbeValue(42, ctx)).toBe(42);
    expect(battery.substituteProbeValue(null, ctx)).toBeNull();
  });

  it("escapes SQL literals defensively", () => {
    expect(battery.sqlLiteral("o'brien")).toBe("'o''brien'");
    expect(battery.sqlLiteral(42)).toBe("42");
    expect(battery.sqlLiteral(true)).toBe("TRUE");
    expect(battery.sqlLiteral(false)).toBe("FALSE");
    expect(battery.sqlLiteral(null)).toBe("NULL");
    expect(battery.sqlLiteral({ a: "b'c" })).toBe(`'{"a":"b''c"}'`);
  });

  it("builds privileged-channel INSERT statements for declared probe rows", () => {
    const sql = battery.buildProbeSeedSql("cg_reconciliation_input", [
      { tenant_id: "$TENANT_A", resolution_ref: "$RUN_ID" },
      { tenant_id: "$TENANT_A", resolution_ref: "$RUN_ID-2" },
    ]);
    expect(sql).toContain("INSERT INTO public.cg_reconciliation_input (tenant_id, resolution_ref)");
    expect(sql.split("\n")).toHaveLength(2);
  });

  it("refuses to interpolate unsafe table or column identifiers into SQL", () => {
    expect(() => battery.buildProbeSeedSql("cg_x; DROP TABLE cg_entity", [{ a: 1 }])).toThrow(/unsafe probe seed target table/);
    expect(() => battery.buildProbeSeedSql("cg_x", [{ "a; DROP TABLE cg_entity": 1 }])).toThrow(/unsafe probe seed column/);
  });
});

describe("MH2-05 posture registry loader (offline)", () => {
  it("uses the built-in canonical fallback when the directory has no posture files", () => {
    const dir = makeTempDir();
    writePostureFile(dir, "unrelated-registry.json", JSON.stringify([{ name: "cg_x" }]));
    const registry = battery.loadPostureRegistry(dir);
    expect(registry.fallbackUsed).toBe(true);
    expect(registry.files).toEqual([]);
    expect(registry.tables).toHaveLength(36);
  });

  it("merges a valid posture file over the built-in fallback (override + add)", () => {
    const dir = makeTempDir();
    writePostureFile(dir, "rls-table-postures-substrate.json", SUBSTRATE_LIKE);
    writePostureFile(dir, "rls-table-postures-transport.json", JSON.stringify({ tables: [{ name: "transport_buses", posture: "zero-policy" }] }));
    const registry = battery.loadPostureRegistry(dir);
    expect(registry.fallbackUsed).toBe(false);
    expect(registry.files).toEqual(["rls-table-postures-substrate.json", "rls-table-postures-transport.json"]);
    expect(registry.overridden).toEqual(["cg_reconciliation_input", "cg_event_route_queue"]);
    expect(registry.added).toEqual(["transport_buses"]);
    const input = registry.tables.find((t) => t.name === "cg_reconciliation_input");
    expect(input?.posture).toBe("policy-backed");
    expect(input?.privileges?.authenticated).toEqual(["SELECT", "INSERT"]);
  });

  it("fails closed on an invalid posture file, naming the file", () => {
    const dir = makeTempDir();
    writePostureFile(dir, "rls-table-postures-broken.json", "{ this is not json");
    expect(() => battery.loadPostureRegistry(dir)).toThrow(/rls-table-postures-broken\.json.*not valid JSON/);
  });

  it("fails closed on a semantically invalid entry in a loadable file", () => {
    const dir = makeTempDir();
    writePostureFile(
      dir,
      "rls-table-postures-bad.json",
      JSON.stringify([{ name: "cg_entity", posture: "policy-backed", policies: [] }]),
    );
    expect(() => battery.loadPostureRegistry(dir)).toThrow(/rls-table-postures-bad\.json/);
  });

  it("matches only the rls-table-postures-*.json file pattern", () => {
    expect(battery.POSTURE_FILE_PATTERN.test("rls-table-postures-substrate.json")).toBe(true);
    expect(battery.POSTURE_FILE_PATTERN.test("registry-drift-declaration.json")).toBe(false);
    expect(battery.POSTURE_FILE_PATTERN.test("rls-table-postures-.json")).toBe(false);
  });

  it("resolves the real repo posture directory (offline read, no live database)", () => {
    const registry = battery.loadPostureRegistry(join(process.cwd(), "scripts", "verification"));
    // The built-in canonical 36 are always present; landed sibling files may
    // extend/override them — every resolved posture must stay valid and
    // provenance-attributed either way.
    expect(registry.tables.length).toBeGreaterThanOrEqual(36);
    for (const canonical of CANONICAL_POLICY_BACKED) {
      const table = registry.tables.find((t) => t.name === canonical.name);
      expect(table?.posture).toBe("policy-backed");
      expect(table?.tenantColumn).toBe(canonical.tenantColumn);
      expect(table?.policies).toEqual(canonical.policies);
      expect(table?.forceRls).toBe(true);
    }
    for (const table of registry.tables) {
      expect(battery.TABLE_POSTURES).toContain(table.posture);
      expect(table.source).toBeTruthy();
      expect(table.postureSource).toBeTruthy();
      if (table.posture === "policy-backed") {
        expect(table.tenantColumn).toBeTruthy();
        expect(table.policies?.length ?? 0).toBeGreaterThan(0);
        expect(table.forceRls).toBe(true);
      }
    }
  });
});