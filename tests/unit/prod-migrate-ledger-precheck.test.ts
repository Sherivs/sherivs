import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateProdMigrateLedger,
  parseLedgerTsv,
  parseMigrationFilename,
  runPrecheckCli,
  // @ts-expect-error — untyped plain-JS script imported into the TS unit suite (same pattern as tests/unit/sherivs-db-target.test.ts)
} from "../../scripts/prod-migrate-ledger-precheck.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "database", "supabase", "migrations");
const WORKFLOW = join(ROOT, ".github", "workflows", "prod-migrate-one.yml");
const SCRIPT = join(ROOT, "scripts", "prod-migrate-ledger-precheck.mjs");

const PUSH01 = "20261124000000_sherivs_push01_mobile_push_devices.sql";
const PUSH01B = "20261124170000_sherivs_push01b_rls_initplan.sql";
const COMMS = "20261104032000_sherivs_comms01_at_number_binding.sql";
const WF05 = "20261117000700_sherivs_wf05_event_sources_v1.sql";

type LedgerRow = { version: string; name: string };

function rows(...entries: Array<[string, string]>): LedgerRow[] {
  return entries.map(([version, name]) => ({ version, name }));
}

function runBlocks(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const folded = lines[index].match(/^(\s*)run:\s*[|>][+-]?\s*$/);
    const inline = lines[index].match(/^(\s*)run:\s*(\S.*)$/);
    if (folded) {
      const indent = folded[1].length;
      const body: string[] = [];
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const next = lines[cursor];
        if (next.trim() === "") {
          body.push(next);
          continue;
        }
        const nextIndent = next.match(/^ */)?.[0].length ?? 0;
        if (nextIndent <= indent) break;
        body.push(next);
        index = cursor;
      }
      blocks.push(body.join("\n"));
    } else if (inline && !inline[2].startsWith("|") && !inline[2].startsWith(">")) {
      blocks.push(inline[2]);
    }
  }
  return blocks;
}

describe("prod migrate ledger pre-check", () => {
  it("parses a migration filename into its version, stem, and unprefixed name", () => {
    expect(parseMigrationFilename(WF05)).toEqual({
      filename: WF05,
      version: "20261117000700",
      stem: "20261117000700_sherivs_wf05_event_sources_v1",
      unprefixed: "sherivs_wf05_event_sources_v1",
    });
    expect(parseMigrationFilename("notes.sql")).toBeNull();
    expect(parseMigrationFilename("20261117000700.sql")).toBeNull();
  });

  it("parses ledger TSV, including a blank name and a Windows newline", () => {
    expect(parseLedgerTsv("20261110095926\tsherivs_comms01_at_number_binding\r\n\r\n")).toEqual([
      { version: "20261110095926", name: "sherivs_comms01_at_number_binding" },
    ]);
    expect(parseLedgerTsv("20261104032000\t\n")).toEqual([{ version: "20261104032000", name: "" }]);
    expect(() => parseLedgerTsv("not-a-version\tname\n")).toThrow(/non-14-digit version/);
  });

  it("counts an earlier file as applied by version or by either ledger name form", () => {
    const files = [COMMS, WF05, PUSH01];
    const byVersion = evaluateProdMigrateLedger({
      targetVersion: "20261124000000",
      files,
      ledgerRows: rows(["20261104032000", ""], ["20261117000700", "something-else"]),
    });
    expect(byVersion.ok).toBe(true);

    const byNames = evaluateProdMigrateLedger({
      targetVersion: "20261124000000",
      files,
      ledgerRows: rows(
        ["20261110095926", "sherivs_comms01_at_number_binding"],
        ["20261117203609", "20261117000700_sherivs_wf05_event_sources_v1"],
      ),
    });
    expect(byNames.ok).toBe(true);
    expect(byNames.earlierCount).toBe(2);
  });

  it("does not treat a partial name, a different prefix, or a bare version in the name column as applied", () => {
    const files = [COMMS, PUSH01];
    const result = evaluateProdMigrateLedger({
      targetVersion: "20261124000000",
      files,
      ledgerRows: rows(
        ["20261110095926", "sherivs_comms01"],
        ["20261110095927", "20261110095926_sherivs_comms01_at_number_binding"],
        ["20261110095928", "20261104032000"],
        ["20261110095929", "sherivs_comms01_at_number_binding.sql"],
      ),
    });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["20261104032000_sherivs_comms01_at_number_binding"]);
  });

  it("refuses the target when its version or either of its names is already recorded", () => {
    const files = [COMMS, PUSH01];
    const earlier = rows(["20261104032000", "sherivs_comms01_at_number_binding"]);
    const byVersion = evaluateProdMigrateLedger({
      targetVersion: "20261124000000",
      files,
      ledgerRows: [...earlier, { version: "20261124000000", name: "other" }],
    });
    expect(byVersion.errors.join("\n")).toContain(
      "20261124000000 is already in the ledger (matched by version)",
    );

    const byStem = evaluateProdMigrateLedger({
      targetVersion: "20261124000000",
      files,
      ledgerRows: [
        ...earlier,
        { version: "20261124120000", name: "20261124000000_sherivs_push01_mobile_push_devices" },
      ],
    });
    expect(byStem.errors.join("\n")).toContain(
      "matched by name '20261124000000_sherivs_push01_mobile_push_devices'",
    );

    const byUnprefixed = evaluateProdMigrateLedger({
      targetVersion: "20261124000000",
      files,
      ledgerRows: [
        ...earlier,
        { version: "20261124120000", name: "sherivs_push01_mobile_push_devices" },
      ],
    });
    expect(byUnprefixed.ok).toBe(false);
    expect(byUnprefixed.errors[0]).toContain("sherivs_push01_mobile_push_devices");
  });

  it("ignores files newer than the target and still requires every earlier file", () => {
    const files = [COMMS, PUSH01, PUSH01B];
    const onlyComms = evaluateProdMigrateLedger({
      targetVersion: "20261124000000",
      files,
      ledgerRows: rows(["20261110095926", "sherivs_comms01_at_number_binding"]),
    });
    expect(onlyComms.ok).toBe(true);
    expect(onlyComms.missing).toEqual([]);

    const push01b = evaluateProdMigrateLedger({
      targetVersion: "20261124170000",
      files,
      ledgerRows: rows(["20261110095926", "sherivs_comms01_at_number_binding"]),
    });
    expect(push01b.missing).toEqual(["20261124000000_sherivs_push01_mobile_push_devices"]);
  });

  it("fails closed on a malformed filename, a missing target file, or a shared name", () => {
    expect(
      evaluateProdMigrateLedger({
        targetVersion: "20261124000000",
        files: ["README.sql"],
        ledgerRows: [],
      }).errors[0],
    ).toMatch(/migration filenames must be/);

    expect(
      evaluateProdMigrateLedger({
        targetVersion: "20261124000000",
        files: [COMMS],
        ledgerRows: rows(["20261104032000", ""]),
      }).errors[0],
    ).toMatch(/expected exactly 1 file/);

    expect(
      evaluateProdMigrateLedger({
        targetVersion: "20261124000000",
        files: ["20261101000060_shared_name.sql", "20261101000070_shared_name.sql", PUSH01],
        ledgerRows: [],
      }).errors[0],
    ).toMatch(/ambiguous migration names/);

    expect(
      evaluateProdMigrateLedger({
        targetVersion: "not-a-version",
        files: [PUSH01],
        ledgerRows: [],
      }).errors[0],
    ).toMatch(/14-digit version/);
  });

  it("accepts the repository tree when each earlier file is recorded by version or by name", () => {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const identities = files.map((file) => parseMigrationFilename(file));
    expect(identities.every(Boolean)).toBe(true);
    const earlier = identities.filter((identity) => identity.version < "20261124000000");
    const pending = identities
      .filter((identity) => identity.version >= "20261124000000")
      .map((identity) => identity.filename)
      .sort();
    expect(pending).toEqual([PUSH01, PUSH01B]);

    const ledgerRows = earlier.map((identity, index) => {
      if (identity.version < "20261101000060") {
        return { version: identity.version, name: "" };
      }
      const recordedAt = `19990101${String(index).padStart(6, "0")}`;
      expect(recordedAt).not.toBe(identity.version);
      return {
        version: recordedAt,
        name: index % 2 === 0 ? identity.stem : identity.unprefixed,
      };
    });

    const push01 = evaluateProdMigrateLedger({
      targetVersion: "20261124000000",
      files,
      ledgerRows,
    });
    expect(push01.ok).toBe(true);
    expect(push01.earlierCount).toBe(earlier.length);
    expect(push01.target.filename).toBe(PUSH01);

    const comms = ledgerRows.findIndex((row) => row.name.includes("comms01_at_number_binding"));
    const withoutComms = ledgerRows.filter((_, index) => index !== comms);
    const blocked = evaluateProdMigrateLedger({
      targetVersion: "20261124000000",
      files,
      ledgerRows: withoutComms,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.missing).toContain("20261104032000_sherivs_comms01_at_number_binding");

    const withPush01Name = [
      ...ledgerRows,
      { version: "20261124120000", name: "sherivs_push01_mobile_push_devices" },
    ];
    const doubleApply = evaluateProdMigrateLedger({
      targetVersion: "20261124000000",
      files,
      ledgerRows: withPush01Name,
    });
    expect(doubleApply.ok).toBe(false);
    expect(doubleApply.errors[0]).toContain("already in the ledger");

    const push01b = evaluateProdMigrateLedger({
      targetVersion: "20261124170000",
      files,
      ledgerRows: withPush01Name,
    });
    expect(push01b.ok).toBe(true);
    expect(push01b.target.filename).toBe(PUSH01B);
  });
});

describe("prod migrate ledger pre-check CLI", () => {
  function setup() {
    const dir = mkdtempSync(join(tmpdir(), "prod-migrate-ledger-"));
    const migrations = join(dir, "migrations");
    const ledger = join(dir, "ledger.tsv");
    mkdirSync(migrations);
    writeFileSync(join(migrations, COMMS), "-- fixture\n");
    writeFileSync(join(migrations, PUSH01), "-- fixture\n");
    writeFileSync(ledger, "20261110095926\tsherivs_comms01_at_number_binding\n");
    return { dir, migrations, ledger };
  }

  it("exits 0 from the environment variable and ledger file without reading SQL or a database", () => {
    const { migrations, ledger } = setup();
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--ledger", ledger, "--migrations", migrations],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", MIGRATION: "20261124000000" },
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("all 1 earlier repo migrations are in the ledger");
    expect(result.stderr).toBe("");
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/postgres:\/\/|PROD_DB/);
    expect(readFileSync(join(migrations, PUSH01), "utf8")).toBe("-- fixture\n");
  });

  it("exits 1 when the target name is already recorded", () => {
    const { migrations, ledger } = setup();
    writeFileSync(
      ledger,
      [
        "20261110095926\tsherivs_comms01_at_number_binding",
        "20261124120000\tsherivs_push01_mobile_push_devices",
        "",
      ].join("\n"),
    );
    const logs: string[] = [];
    const status = runPrecheckCli({
      argv: ["--ledger", ledger, "--migrations", migrations],
      env: { MIGRATION: "20261124000000" },
      stdout: () => {},
      stderr: (line: string) => logs.push(line),
    });
    expect(status).toBe(1);
    expect(logs.join("\n")).toContain("::error::20261124000000 is already in the ledger");
  });

  it("exits 2 when the ledger path is omitted", () => {
    const status = runPrecheckCli({
      argv: [],
      env: { MIGRATION: "20261124000000" },
      stdout: () => {},
      stderr: () => {},
    });
    expect(status).toBe(2);
  });
});

describe("prod-migrate-one workflow guards", () => {
  const workflow = readFileSync(WORKFLOW, "utf8");
  const blocks = runBlocks(workflow);
  const precheck = blocks.find((block) => block.includes("prod-migrate-ledger-precheck.mjs"));

  it("keeps the production confirmation, environment, and record-only guards", () => {
    expect(workflow).toContain("environment: Production");
    expect(workflow).toContain('"$CONFIRM" = "APPLY-$MIGRATION"');
    expect(workflow).toContain("record_only is only supported for 20261025100260");
    expect(workflow).toContain("SHERIVS_CONFIRM_PRODUCTION: nwrflbpbhyiqdptmlccm");
    expect(workflow).toContain("SHERIVS_DATABASE_TARGET: production");
    expect(workflow).toContain("group: prod-migrate");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683");
    expect(workflow).toContain("actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020");
  });

  it("decides the ledger pre-check in the script and does not interpolate inputs into run scripts", () => {
    expect(precheck).toBeDefined();
    expect(precheck).toContain(
      "select version, coalesce(name, '') from supabase_migrations.schema_migrations",
    );
    expect(precheck).not.toContain("$MIGRATION");
    expect(precheck).not.toContain("comm -23");
    expect(precheck).not.toContain("${{");
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).not.toContain("${{");
    }
    expect(readFileSync(SCRIPT, "utf8")).not.toMatch(
      /\b(psql|pg\.|createConnection|PROD_DB_URL)\b/,
    );
  });
});
