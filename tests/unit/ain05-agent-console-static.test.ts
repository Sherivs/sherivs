/**
 * AIN-05: static guarantees on the migration, the server functions and the screen (ADR-129).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");
const MIG = read("database/supabase/migrations/20261117000996_sherivs_ain05_agent_console_read_models.sql");
const ROLLBACK = read("database/supabase/rollbacks/20261117000996_sherivs_ain05_agent_console_read_models.sql");
const FUNCS = read("frontend/src/lib/workflow-agent-console.functions.ts");
const SERVER = read("frontend/src/lib/workflow/agent-console.server.ts");
const SCREEN = read("frontend/src/components/app-shell/agent-console-screen.tsx");

describe("AIN-05 migration", () => {
  it("adds only the three read functions, SECURITY DEFINER, empty search_path, service role only", () => {
    const fns = [...MIG.matchAll(/CREATE FUNCTION public\.(wf_console_[a-z_]+)/g)].map((m) => m[1]);
    expect(fns.sort()).toEqual(["wf_console_agents", "wf_console_memory_list", "wf_console_safety_list"]);
    expect((MIG.match(/LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''/g) ?? []).length).toBe(3);
        expect(MIG).toMatch(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;/);
    expect(MIG).toMatch(/REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC, anon, authenticated, service_role;/);
    expect(MIG).not.toMatch(/TO (anon|authenticated|PUBLIC)/);
    expect(MIG).not.toMatch(/CREATE TABLE|ALTER TABLE|CREATE POLICY|CREATE TRIGGER/);
  });

  it("never writes and never reads the text or the hash of a screened output", () => {
    expect(MIG).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i);
    expect(MIG).not.toMatch(/text_sha256|content_sha256/i);
  });

  it("rolls back by dropping exactly those functions", () => {
    expect([...ROLLBACK.matchAll(/DROP FUNCTION public\.(wf_console_[a-z_]+)/g)]).toHaveLength(3);
  });
});

describe("AIN-05 server and screen", () => {
  it("reads no table but the caller's own users row, and never sends the person's free text", () => {
    expect([...FUNCS.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1])).toEqual(["users"]);
    expect(SERVER).not.toMatch(/\.from\(/);
    expect(SERVER).toMatch(/CONSOLE_REASON_SENTENCES\[input\.reason\]/);
  });

  it("every server function requires a signed-in session and takes the actor from it", () => {
    const n = (FUNCS.match(/createServerFn/g) ?? []).length - 1; // the import line
    expect((FUNCS.match(/requireSupabaseAuth\]\)/g) ?? []).length).toBe(n);
    expect(FUNCS).not.toMatch(/actorId:\s*data\./);
  });

  it("the screen has no promote control, no free-text field and no raw HTML", () => {
    expect(SCREEN).not.toMatch(/promoteConsole|wf_autonomy_promote|Raise to/);
    expect(SCREEN).not.toMatch(/<textarea|<input|dangerouslySetInnerHTML/);
    expect(SCREEN).toMatch(/Raising an agent&apos;s level is a founder decision/);
  });
});
