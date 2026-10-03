/**
 * V1 vertical-slice follow-up (F-13 T5 finding): the onboarding engine's
 * §27.6 success audit must attribute WHO correctly for BOTH actor shapes —
 * a platform super admin WITH a canonical public.users row (actor id) and a
 * bootstrap-claimed super admin WITHOUT one (audit_logs.user_id FKs
 * public.users, so a raw auth uid is rejected fail-closed; attribution then
 * degrades to the verified email claim, exactly like the bootstrap claim
 * audit). Structural source assertions per repo node-env conventions.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FN_FILE = join(
  ROOT,
  "frontend/src/lib/onboarding/provision-organization.functions.ts",
);

describe("onboarding provision_organization — audit actor resolution (F-13 T5 defect)", () => {
  const src = readFileSync(FN_FILE, "utf8");

  it("resolves the actor's canonical users row before attributing the audit", () => {
    expect(src).toMatch(/\.from\("users"\)/);
    expect(src).toMatch(/\.eq\("id", context\.userId\)/);
    expect(src).toMatch(/\.maybeSingle\(\)/);
  });

  it("degrades to actorId: null + verified email claim when no canonical row exists", () => {
    expect(src).toMatch(/actorId: actorHasCanonicalRow \? context\.userId : null/);
    expect(src).toMatch(/actorEmail/);
    // The bootstrap claim audit is the declared precedent for the shape.
    const claim = readFileSync(
      join(ROOT, "frontend/src/lib/runtime/scholar/provisioning.functions.ts"),
      "utf8",
    );
    expect(claim).toMatch(/actorId: null/);
    expect(claim).toMatch(/actorEmail: email/);
  });

  it("keeps the audit fail-closed (writeAuditRecord throw contract unchanged)", () => {
    const hook = readFileSync(
      join(ROOT, "frontend/src/lib/server/write-audit.ts"),
      "utf8",
    );
    expect(hook).toMatch(/refusing to persist an unattributed write/);
    expect(src).toMatch(/await writeAuditRecord/);
  });
});
