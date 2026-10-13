/**
 * Four-eyes: LOGIN → Scholar is forbidden unless runtime+membership resolve.
 * Command Centre must not be the public `/` surface.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLATFORM_NAME } from "@/lib/platform";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

describe("identity gateway four-eyes", () => {
  it("index does not mount CommandCentre on the public home", () => {
    const index = read("frontend/src/routes/index.tsx");
    expect(index).toContain("SherivsPublicHome");
    expect(index).toContain("resolveIdentityGateway");
    expect(index).not.toMatch(/from\s+"@\/components\/command-centre\/command-centre"/);
  });

  it("auth uses the identity gateway instead of scholarWorkspaceHome alone", () => {
    const auth = read("frontend/src/routes/auth.tsx");
    expect(auth).toContain("resolveIdentityGateway");
    expect(auth).not.toMatch(/navigate\(\s*\{\s*to:\s*scholarWorkspaceHome/);
  });

  it("customer-facing platform name is Sherivs", () => {
    expect(PLATFORM_NAME).toBe("Sherivs");
    const platform = read("frontend/src/lib/platform.ts");
    expect(platform).toMatch(/PLATFORM_NAME\s*=\s*"Sherivs"/);
    expect(platform).toContain("LEGACY_PLATFORM_IDENTIFIER");
  });

  it("authenticated shell redirects LEGACY Scholar paths when an org slug is known", () => {
    const layout = read("frontend/src/routes/_authenticated/route.tsx");
    expect(layout).toContain("isLegacyScholarPath");
    expect(layout).toContain("bindNavUrl");
    expect(layout).toContain("/onboarding");
  });
});
