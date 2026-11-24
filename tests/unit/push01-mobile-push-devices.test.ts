import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION =
  "database/supabase/migrations/20261124000000_sherivs_push01_mobile_push_devices.sql";
const ROLLBACK =
  "database/supabase/rollbacks/20261124000000_sherivs_push01_mobile_push_devices.sql";
const ADR = "architecture/adr/ADR-112_PUSH01_DEVICE_REGISTRY_AND_PUSH_PREFERENCES.md";
const STAGING = "tests/integration/push01-mobile-push-devices.staging.sql";

const up = readFileSync(MIGRATION, "utf8");
const body = up.replace(/--.*$/gm, "");
const down = readFileSync(ROLLBACK, "utf8");

describe("PUSH-01 mobile push devices migration (static posture)", () => {
  it("creates the device table with forced RLS and token uniqueness", () => {
    expect(body).toContain("org_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE");
    expect(body).toContain("CREATE TABLE IF NOT EXISTS public.mobile_push_devices");
    expect(body).toContain("expo_push_token text NOT NULL");
    expect(body).toContain(
      "CONSTRAINT mobile_push_devices_expo_push_token_key UNIQUE (expo_push_token)",
    );
    expect(body).toContain("ALTER TABLE public.mobile_push_devices ENABLE ROW LEVEL SECURITY");
    expect(body).toContain("ALTER TABLE public.mobile_push_devices FORCE ROW LEVEL SECURITY");
  });

  it("keeps anon without grants and restricts writes to RPC", () => {
    expect(body).toContain(
      "REVOKE ALL ON TABLE public.mobile_push_devices FROM PUBLIC, anon, authenticated, service_role",
    );
    expect(body).toContain("GRANT SELECT ON TABLE public.mobile_push_devices TO authenticated");
    expect(body).toContain("GRANT SELECT ON TABLE public.mobile_push_devices TO service_role");
    expect(body).not.toMatch(
      /GRANT[^;]*\b(INSERT|UPDATE|DELETE|TRUNCATE)\b[^;]*mobile_push_devices/i,
    );
    expect(body).toContain("CREATE POLICY mobile_push_devices_read_own");
    expect(body).toContain("USING (user_id = auth.uid())");
  });

  it("defines authenticated-only definer RPCs with empty search_path", () => {
    expect(body).toContain("CREATE OR REPLACE FUNCTION public.register_push_device(");
    expect(body).toContain(
      "CREATE OR REPLACE FUNCTION public.unregister_push_device(p_token text)",
    );
    const fns =
      body.match(
        /CREATE OR REPLACE FUNCTION public\.(register_push_device|unregister_push_device)[\s\S]*?\$\$;/g,
      ) ?? [];
    expect(fns).toHaveLength(2);
    for (const fn of fns) {
      expect(fn).toContain("SECURITY DEFINER");
      expect(fn).toContain("SET search_path = ''");
      expect(fn).toContain("coalesce(auth.role(), '') <> 'authenticated'");
    }
    expect(body).toContain("device cap reached (10)");
    expect(body).toContain("ON CONFLICT (expo_push_token)");
    expect(body).toContain("user_id = EXCLUDED.user_id");
    expect(body).toContain("org_id = EXCLUDED.org_id");
    expect(body).toContain("SELECT public.get_my_organization_id() INTO v_org_id");
    expect(body).toContain(
      "GRANT EXECUTE ON FUNCTION public.register_push_device(text, text, text, text) TO authenticated",
    );
    expect(body).toContain(
      "GRANT EXECUTE ON FUNCTION public.unregister_push_device(text) TO authenticated",
    );
    expect(body).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.(register_push_device|unregister_push_device)[^;]*\banon\b/i,
    );
    expect(body).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.(register_push_device|unregister_push_device)[^;]*\bservice_role\b/i,
    );
  });

  it("extends notification preferences with push toggles and timezone default", () => {
    for (const col of [
      "push_messages",
      "push_announcements",
      "push_grades",
      "push_attendance",
      "push_fees",
    ]) {
      expect(body).toContain(`ADD COLUMN IF NOT EXISTS ${col} boolean NOT NULL DEFAULT true`);
    }
    expect(body).toContain(
      "ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Lagos'",
    );
  });

  it("ships rollback, ADR, and staging verification SQL", () => {
    expect(existsSync(ROLLBACK)).toBe(true);
    expect(down).toContain(
      "DROP FUNCTION IF EXISTS public.register_push_device(text, text, text, text)",
    );
    expect(down).toContain("DROP FUNCTION IF EXISTS public.unregister_push_device(text)");
    expect(down).toContain("DROP TABLE IF EXISTS public.mobile_push_devices CASCADE");
    expect(down).toContain("DROP COLUMN IF EXISTS push_messages");
    expect(down).toContain("DROP COLUMN IF EXISTS timezone");
    expect(existsSync(ADR)).toBe(true);
    expect(readFileSync(ADR, "utf8")).toContain(
      "20261124000000_sherivs_push01_mobile_push_devices.sql",
    );
    expect(existsSync(STAGING)).toBe(true);
    expect(readFileSync(STAGING, "utf8")).toContain("PUSH01 STAGING CHECKS PASS");
  });
});
