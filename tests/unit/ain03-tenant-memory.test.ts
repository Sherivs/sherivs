import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MEMORY_AGENT_DAILY_PROPOSALS,
  MEMORY_ORG_ITEM_CAP,
  MEMORY_SCOPES,
  MEMORY_SCOPE_RULES,
  MEMORY_VALUE_MAX_BYTES,
  memoryExpiresAtMs,
  memoryValueRefusal,
  memoryWriteRefusal,
} from "../../frontend/src/lib/workflow/tenant-memory";

const MIGRATION =
  "database/supabase/migrations/20261117000990_sherivs_ain03_tenant_memory_context_scopes.sql";
const ROLLBACK =
  "database/supabase/rollbacks/20261117000990_sherivs_ain03_tenant_memory_context_scopes.sql";
const migration = readFileSync(MIGRATION, "utf8");
const rollback = readFileSync(ROLLBACK, "utf8");
const seed = migration.slice(
  migration.indexOf("-- BEGIN AIN03 SEED"),
  migration.indexOf("-- END AIN03 SEED"),
);

describe("AIN-03 memory: the TypeScript restatement matches the migration", () => {
  it("scope rules match the seed row for row", () => {
    const start = seed.indexOf("INSERT INTO public.wf_memory_scope_kind");
    const rows = [
      ...seed
        .slice(start, seed.indexOf(";", start))
        .matchAll(/\('([a-z]+)', (\d+), (\d+), (\d+), (true|false), '/g),
    ];
    expect(new Set(rows.map((r) => r[1]))).toEqual(new Set(MEMORY_SCOPES));
    expect(rows).toHaveLength(MEMORY_SCOPES.length);
    for (const [, kind, def, max, items, agent] of rows) {
      const rule = MEMORY_SCOPE_RULES[kind as keyof typeof MEMORY_SCOPE_RULES];
      expect(rule.defaultTtlDays, kind).toBe(Number(def));
      expect(rule.maxTtlDays, kind).toBe(Number(max));
      expect(rule.maxItems, kind).toBe(Number(items));
      expect(rule.agentMayPropose, kind).toBe(agent === "true");
    }
  });

  it("the cross-scope caps match the SQL functions", () => {
    expect(migration).toMatch(/wf_memory_org_item_cap\(\)[\s\S]{0,200}SELECT 2000 \$\$/);
    expect(migration).toMatch(/wf_memory_agent_daily_proposals\(\)[\s\S]{0,200}SELECT 50 \$\$/);
    expect(MEMORY_ORG_ITEM_CAP).toBe(2000);
    expect(MEMORY_AGENT_DAILY_PROPOSALS).toBe(50);
    expect(migration).toContain("octet_length(p_value::text) <= 4096");
    expect(MEMORY_VALUE_MAX_BYTES).toBe(4096);
    expect(migration).toContain("BETWEEN 1 AND 20");
    expect(migration).toContain("BETWEEN 1 AND 300");
  });

  it("agents propose only into agent and run, and the database says so as a CHECK", () => {
    expect(
      Object.entries(MEMORY_SCOPE_RULES)
        .filter(([, r]) => r.agentMayPropose)
        .map(([k]) => k)
        .sort(),
    ).toEqual(["agent", "run"]);
    expect(migration).toContain("CHECK (agent_may_propose = (kind IN ('agent', 'run')))");
  });
});

describe("AIN-03 memory: shape rules", () => {
  it("accepts flat codes in reference and short text in note", () => {
    expect(
      memoryValueRefusal("reference", { plan_code: "term-1", n: 3, on: true, r: "a/b:c.d_e-f" }),
    ).toBeNull();
    expect(
      memoryValueRefusal("note", { text: "Prefers a reminder before the due date." }),
    ).toBeNull();
  });

  it("refuses names, addresses, spaces, nesting, lists, nulls, empty and non-objects", () => {
    expect(memoryValueRefusal("reference", { owner: "Ada Obi" })).toBe(
      "reference_string_not_a_code",
    );
    expect(memoryValueRefusal("reference", { owner: "a@b.example" })).toBe(
      "reference_string_not_a_code",
    );
    expect(memoryValueRefusal("reference", { owner: "" })).toBe("reference_string_not_a_code");
    expect(memoryValueRefusal("note", { a: { b: 1 } })).toBe("value_not_flat");
    expect(memoryValueRefusal("note", { a: [1] })).toBe("value_not_flat");
    expect(memoryValueRefusal("note", { a: null })).toBe("value_not_flat");
    expect(memoryValueRefusal("note", {})).toBe("value_entry_count");
    expect(memoryValueRefusal("note", [1])).toBe("value_not_an_object");
    expect(memoryValueRefusal("note", null)).toBe("value_not_an_object");
    expect(memoryValueRefusal("secret", { a: 1 })).toBe("invalid_class");
  });

  it("limits keys, entries, text length and size", () => {
    expect(memoryValueRefusal("note", { Bad: "x" })).toBe("value_key_invalid");
    expect(
      memoryValueRefusal(
        "note",
        Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 1])),
      ),
    ).toBe("value_entry_count");
    expect(memoryValueRefusal("note", { a: "x".repeat(301) })).toBe("note_text_length");
    expect(memoryValueRefusal("note", { a: "x".repeat(300) })).toBeNull();
    expect(
      memoryValueRefusal(
        "note",
        Object.fromEntries(
          Array.from({ length: 20 }, (_, i) => [`k${String(i).padStart(2, "0")}`, "x".repeat(300)]),
        ),
      ),
    ).toBe("value_too_large");
  });
});

describe("AIN-03 memory: who may write what", () => {
  const base = {
    scope: "organization",
    key: "term-plan",
    cls: "reference",
    value: { plan_code: "t1" },
  } as const;

  it("a person may write any scope inside its lifetime bounds", () => {
    for (const scope of MEMORY_SCOPES)
      expect(memoryWriteRefusal({ ...base, by: "person", scope })).toBeNull();
    expect(memoryWriteRefusal({ ...base, by: "person", scope: "run", ttlDays: 30 })).toBeNull();
    expect(memoryWriteRefusal({ ...base, by: "person", scope: "run", ttlDays: 31 })).toBe(
      "lifetime_out_of_bounds",
    );
    expect(memoryWriteRefusal({ ...base, by: "person", ttlDays: 0 })).toBe(
      "lifetime_out_of_bounds",
    );
    expect(memoryWriteRefusal({ ...base, by: "person", ttlDays: 1.5 })).toBe(
      "lifetime_out_of_bounds",
    );
  });

  it("an agent never writes organization or workflow memory, and never marks anything readable by an agent", () => {
    const note = { cls: "note", value: { text: "x" } };
    expect(memoryWriteRefusal({ ...base, ...note, by: "agent", scope: "organization" })).toBe(
      "agent_cannot_write_this_scope",
    );
    expect(memoryWriteRefusal({ ...base, ...note, by: "agent", scope: "workflow" })).toBe(
      "agent_cannot_write_this_scope",
    );
    expect(memoryWriteRefusal({ ...base, ...note, by: "agent", scope: "agent" })).toBeNull();
    expect(memoryWriteRefusal({ ...base, by: "agent", scope: "run", aiReadable: true })).toBe(
      "ai_readable_needs_reference",
    );
  });

  it("only reference memory can be marked readable by an agent; unknown scopes and keys are refused", () => {
    expect(memoryWriteRefusal({ ...base, by: "person", aiReadable: true })).toBeNull();
    expect(
      memoryWriteRefusal({
        ...base,
        by: "person",
        cls: "note",
        value: { t: "x" },
        aiReadable: true,
      }),
    ).toBe("ai_readable_needs_reference");
    expect(memoryWriteRefusal({ ...base, by: "person", scope: "constructor" })).toBe(
      "invalid_scope",
    );
    expect(memoryWriteRefusal({ ...base, by: "person", scope: "toString" })).toBe("invalid_scope");
    expect(memoryWriteRefusal({ ...base, by: "person", key: "Bad Key" })).toBe("invalid_key");
  });

  it("the expiry is computed from the clock passed in", () => {
    expect(memoryExpiresAtMs(0, "run")).toBe(7 * 86_400_000);
    expect(memoryExpiresAtMs(1000, "organization", 1)).toBe(1000 + 86_400_000);
  });
});

describe("AIN-03 memory: migration hygiene", () => {
  it("is marked not applied, transactional and has a rollback that refuses while data exists", () => {
    expect(migration.startsWith("-- NOT APPLIED.")).toBe(true);
    expect(migration).toMatch(/^BEGIN;$/m);
    expect(migration).toMatch(/^COMMIT;$/m);
    expect(rollback).toContain("memory items or ledger rows exist");
  });

  it("every function pins an empty search_path and none is granted to PUBLIC, anon or authenticated", () => {
    const fns = migration.split("CREATE FUNCTION public.").slice(1);
    expect(fns.length).toBe(14);
    for (const f of fns) expect(f.slice(0, f.indexOf("AS $$"))).toContain("SET search_path = ''");
    expect(migration).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*(anon|authenticated|PUBLIC)/);
    expect(migration).toMatch(
      /GRANT SELECT ON public\.wf_memory_item, public\.wf_memory_change TO authenticated;/,
    );
    expect(migration).not.toMatch(/GRANT[^;]*wf_memory_item[^;]*service_role/);
  });

  it("calls no model and sends nothing: no network, no http, no edge function", () => {
    expect(migration).not.toMatch(/\bhttp|net\.|pg_net|openai|anthropic|resend|twilio|bulksms/i);
  });

  it("the agent read path starts by checking the AI route", () => {
    const fn = migration.slice(migration.indexOf("CREATE FUNCTION public.wf_memory_agent_read"));
    const body = fn.slice(fn.indexOf("BEGIN"), fn.indexOf("BEGIN") + 200);
    expect(body).toContain("wf_ai_route_approved()");
  });
});
