import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LIB = join(__dirname, "../../frontend/src/lib");

describe("ENGINE-02: Hermes → Sherivs Conductor (ADR-080)", () => {
  it("conductor sources carry no Hermes naming except the physical table/migration identifiers", () => {
    const dir = join(LIB, "conductor");
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), "utf8");
      const stripped = text
        .replaceAll("cg_hermes_observation", "")
        .replaceAll("coregrid_hermes_observation_substrate", "");
      expect(stripped.toLowerCase(), f).not.toContain("hermes");
    }
  });

  it("the persisted identity is Conductor-named", async () => {
    const c = await import("../../frontend/src/lib/conductor/conductor-contract");
    expect(c.CONDUCTOR_ACTOR_REF).toBe("conductor");
    expect(c.CONDUCTOR_REPAIR_MISSION_PREFIX).toBe("conductor-repair-");
  });

  it("every deprecated hermes shim re-exports the identical Conductor binding", async () => {
    const pairs: Array<[string, string]> = [
      ["hermes-contract", "conductor-contract"],
      ["hermes-classifier", "conductor-classifier"],
      ["hermes-cycle", "conductor-cycle"],
      ["hermes-event-source", "conductor-event-source"],
      ["hermes-memory", "conductor-memory"],
      ["hermes-observation", "conductor-observation"],
    ];
    for (const [legacy, current] of pairs) {
      const l = (await import(`../../frontend/src/lib/hermes/${legacy}`)) as Record<
        string,
        unknown
      >;
      const n = (await import(`../../frontend/src/lib/conductor/${current}`)) as Record<
        string,
        unknown
      >;
      const legacyKeys = Object.keys(l);
      expect(legacyKeys.length, legacy).toBeGreaterThan(0);
      for (const k of legacyKeys) {
        const target = k
          .replace("Hermes", "Conductor")
          .replace("HERMES", "CONDUCTOR")
          .replace("hermes", "conductor");
        expect(l[k], `${legacy}.${k}`).toBe(n[target]);
      }
    }
  });

  it("legacy shims contain no logic (re-export statements only)", () => {
    const dir = join(LIB, "hermes");
    for (const f of readdirSync(dir)) {
      const code = readFileSync(join(dir, f), "utf8")
        .split("\n")
        .filter((l) => l.trim() && !/^\s*(\/\*\*|\*|\*\/)/.test(l));
      for (const line of code)
        expect(line, f).toMatch(/^export (type )?\{[^}]+\} from "\.\.\/conductor\//);
    }
  });
});
