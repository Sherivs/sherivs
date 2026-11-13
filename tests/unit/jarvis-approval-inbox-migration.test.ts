import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "database", "supabase");
const VERSION = "20261103165000";
const NAME = "sherivs_jarvis02_approval_inbox.sql";
const up = readFileSync(join(ROOT, "migrations", `${VERSION}_${NAME}`), "utf8");
const down = readFileSync(join(ROOT, "rollbacks", `${VERSION}_${NAME}`), "utf8");

describe("JARVIS-02 approval inbox migration (static)", () => {
  it("uses a version inside the reserved block", () => {
    expect(Number(VERSION)).toBeGreaterThanOrEqual(20261103165000);
    expect(Number(VERSION)).toBeLessThanOrEqual(20261103165999);
  });
  it("forces RLS on both tables", () => {
    for (const t of ["jarvis_approval_requests", "jarvis_approval_events"]) {
      expect(up).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
      expect(up).toContain(`ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY`);
    }
  });
  it("revokes default privileges from every API role before granting the minimum", () => {
    expect(up).toMatch(/REVOKE ALL ON[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
    expect(up).not.toMatch(/GRANT[^;]*\bTO\s+anon\b/);
    expect(up).not.toMatch(/GRANT[^;]*(DELETE|TRUNCATE)[^;]*TO/);
  });
  it("re-enforces T3 sheriff + passkey, console-only approval and no self-approval", () => {
    expect(up).toContain("decided_role = 'sheriff' AND passkey_step_up_verified");
    expect(up).toContain("decided_channel = 'console'");
    expect(up).toContain("decided_by <> requester_ref");
  });
  it("is append-only for events and has a matching rollback", () => {
    expect(up).toContain("jarvis_approval_events_append_only");
    expect(down).toContain("DROP TABLE IF EXISTS public.jarvis_approval_events");
    expect(down).toContain("DROP TABLE IF EXISTS public.jarvis_approval_requests");
  });
  it("contains no secrets or live-data hooks", () => {
    expect(up).not.toMatch(/password|secret|api[_-]?key|token/i);
  });
});
