import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { packInsertSql } from "../../frontend/src/lib/runtime/scholar/workflow-packs/private-school-pack";

describe("WF-15a harness SQL", () => {
  it("the generated block in the integration harness matches packInsertSql()", () => {
    const sql = readFileSync("tests/integration/wf15a-pack-install.local.sql", "utf8");
    const m = sql.match(/-- BEGIN GENERATED[^\n]*\n([\s\S]*?)\n-- END GENERATED/);
    expect(m?.[1].trim()).toBe(packInsertSql().trim());
  });
});
