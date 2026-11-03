import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const CHECK_RESULT = read(
  "database/supabase/migrations/20261103140000_sherivs_sec01_check_result_uniform.sql",
);
const CHECK_RESULT_ROLLBACK = read(
  "database/supabase/rollbacks/20261103140000_sherivs_sec01_check_result_uniform.sql",
);
const CONSENT_GRANTS = read(
  "database/supabase/migrations/20261103140100_sherivs_sec01_consent_set_for_actor_grants.sql",
);
const CONSENT_GRANTS_ROLLBACK = read(
  "database/supabase/rollbacks/20261103140100_sherivs_sec01_consent_set_for_actor_grants.sql",
);

describe("SEC-01 database hardening", () => {
  it("returns uniform checker errors after rate limiting and preserves the success payload", () => {
    expect(CHECK_RESULT).toContain(
      "public.rate_limit_take('result_checker.serial', coalesce(p_serial, '?'), 10, interval '1 hour')",
    );
    const limiter = CHECK_RESULT.indexOf("public.rate_limit_take");
    expect(limiter).toBeGreaterThanOrEqual(0);
    expect(CHECK_RESULT.slice(limiter)).not.toMatch(/\bRAISE\b/i);
    expect(CHECK_RESULT).not.toMatch(/student not found/i);
    expect(CHECK_RESULT).toContain(
      "IF r.serial IS NULL OR r.pin_hash <> extensions.crypt(coalesce(p_pin, ''), r.pin_hash) THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'invalid serial or PIN');",
    );
    expect(CHECK_RESULT).toContain(
      "IF st.id IS NULL THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'invalid serial or PIN');",
    );
    expect(CHECK_RESULT).toContain(
      "IF r.student_id IS NOT NULL AND r.student_id <> st.id THEN\n    RETURN jsonb_build_object('ok', false, 'error', 'invalid serial or PIN');",
    );
    expect(CHECK_RESULT).toContain(
      "RETURN jsonb_build_object('ok', false, 'error', 'card exhausted');",
    );
    expect(CHECK_RESULT).toContain("'uses_left', r.max_uses - r.uses - 1");
    expect(CHECK_RESULT).not.toMatch(/\b(?:GRANT|REVOKE)\b/i);
    expect(CHECK_RESULT).not.toMatch(/\b(?:BEGIN|COMMIT)\s*;/i);
    expect(CHECK_RESULT).not.toMatch(/\bset_config\s*\(/i);
    expect(CHECK_RESULT_ROLLBACK).toContain("CREATE OR REPLACE FUNCTION public.check_result");
  });

  it("limits the consent actor RPC to service_role and restores its previous grants on rollback", () => {
    expect(CONSENT_GRANTS.trim()).toBe(
      "REVOKE EXECUTE ON FUNCTION public.consent_set_for_actor(uuid,uuid,text,boolean,uuid,text,text,text) FROM PUBLIC, anon, authenticated;\n" +
        "GRANT EXECUTE ON FUNCTION public.consent_set_for_actor(uuid,uuid,text,boolean,uuid,text,text,text) TO service_role;",
    );
    expect(CONSENT_GRANTS).not.toMatch(/\b(?:BEGIN|COMMIT)\s*;/i);
    expect(CONSENT_GRANTS_ROLLBACK).toContain("FROM PUBLIC, anon;");
    expect(CONSENT_GRANTS_ROLLBACK).toContain("TO authenticated, service_role;");
  });
});
