import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  USER_SAFE_COLUMNS,
  USER_SENSITIVE_COLUMNS,
  withUserPrivateFields,
} from "../../frontend/src/lib/identity/user-private-fields";

const ROOT = join(__dirname, "..", "..");
const MIG = readFileSync(
  join(
    ROOT,
    "database/supabase/migrations/20261024000220_sherivs_015_privacy_lockdown_rls_speed.sql",
  ),
  "utf8",
);
const RB = readFileSync(
  join(
    ROOT,
    "database/supabase/rollbacks/20261024000220_sherivs_015_privacy_lockdown_rls_speed.sql",
  ),
  "utf8",
);

describe("SHERIVS-015 privacy lockdown", () => {
  it("safe column list never includes a sensitive column", () => {
    const safe = USER_SAFE_COLUMNS.split(",").map((c) => c.trim());
    for (const s of USER_SENSITIVE_COLUMNS) expect(safe).not.toContain(s);
    expect(safe).toContain("id");
  });

  it("migration revokes sensitive columns and grants only the rest", () => {
    expect(MIG).toMatch(/REVOKE SELECT ON public\.users FROM PUBLIC, anon, authenticated/);
    expect(MIG).toMatch(/NOT IN \('nin', 'account_number', 'salary', 'face_biometric', 'phone'\)/);
    expect(MIG).toMatch(/SECURITY DEFINER SET search_path = ''/);
    expect(MIG).toMatch(
      /REVOKE ALL ON FUNCTION public\.users_private_fields\(uuid\[\]\) FROM PUBLIC, anon/,
    );
    // NIN and face data are owner-only.
    expect(MIG).toMatch(/WHEN u\.id = me\.uid THEN u\.nin END/);
    expect(MIG).toMatch(/WHEN u\.id = me\.uid THEN u\.face_biometric END/);
  });

  it("legacy secret column drop fails closed when values exist", () => {
    expect(MIG).toMatch(
      /RAISE EXCEPTION 'SHERIVS-015: schools\.paystack_secret_key still holds values/,
    );
    expect(RB).toMatch(/DROP FUNCTION IF EXISTS public\.users_private_fields/);
    expect(RB).toMatch(
      /REVOKE SELECT \(paystack_secret_key\) ON public\.schools FROM PUBLIC, anon, authenticated/,
    );
  });

  it("app code no longer selects sensitive columns or * from users directly", () => {
    for (const f of [
      "frontend/src/contexts/app-context.tsx",
      "frontend/src/routes/_authenticated/admin/hr.tsx",
      "frontend/src/routes/_authenticated/admin/teachers.tsx",
      "frontend/src/lib/profile.functions.ts",
    ]) {
      const src = readFileSync(join(ROOT, f), "utf8");
      const selects = [...src.matchAll(/from\("users"\)\s*\.select\(\s*("[^"]*"|[A-Z_]+)/g)].map(
        (m) => m[1],
      );
      for (const s of selects) {
        expect(s, f).not.toBe('"*"');
        for (const c of USER_SENSITIVE_COLUMNS) expect(s, f).not.toMatch(new RegExp(`\\b${c}\\b`));
      }
    }
  });

  it("merges entitled fields and nulls the rest", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { id: "a", phone: "080", nin: null, account_number: null, salary: 5, face_biometric: null },
      ],
      error: null,
    });
    const rows = await withUserPrivateFields(
      { rpc } as never,
      [{ id: "a" }, { id: "b" }],
      ["phone", "salary"],
    );
    expect(rpc).toHaveBeenCalledWith("users_private_fields", { p_ids: ["a", "b"] });
    expect(rows).toEqual([
      { id: "a", phone: "080", salary: 5 },
      { id: "b", phone: null, salary: null },
    ]);
  });
});
