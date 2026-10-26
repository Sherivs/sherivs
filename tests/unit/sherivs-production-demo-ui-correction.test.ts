import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

describe("public root no longer mounts in-memory Command Centre", () => {
  const index = read("frontend/src/routes/index.tsx");
  const home = read("frontend/src/components/public/sherivs-home.tsx");

  it("renders the Sherivs public home instead of CommandCentre on /", () => {
    expect(index).toContain("<SherivsHome />");
    expect(index).not.toMatch(/from ["']@\/components\/command-centre\/command-centre["']/);
    expect(index).not.toContain("<CommandCentre");
    expect(index).not.toContain("user:demo-administrator");
    expect(existsSync(join(ROOT, "frontend/src/components/public/platform-home.tsx"))).toBe(false);
  });

  it("uses the shared Sherivs logo component (real public brand assets) and real auth/overview routes", () => {
    expect(home).toContain("SiteHeader");
    const logo = readFileSync(join(ROOT, "frontend/src/components/brand/sherivs-logo.tsx"), "utf8");
    expect(logo).toContain("/brand/sherivs-mark-");
    for (const px of [64, 128, 256])
      expect(existsSync(join(ROOT, `public/brand/sherivs-mark-${px}.png`))).toBe(true);
    expect(logo).toContain("`${PLATFORM_NAME} logo`");
    expect(home).not.toContain("tenant:coregrid-demo");
    expect(home).not.toMatch(/\b94%\b/);
    expect(home).not.toMatch(/Live attendance/);
  });

  it("preserves tenant public sites without authenticated workspace routing", () => {
    expect(index).toContain("<SiteView");
    expect(index).not.toContain("identityFromAppState");
    expect(index).toContain('createFileRoute("/")');
  });
});

describe("hard-coded metric placeholders removed from production portal paths", () => {
  it("deletes the portal pages that previously held fabricated metrics", () => {
    expect(existsSync(join(ROOT, "frontend/src/routes/_authenticated/admin/intelligence.tsx"))).toBe(
      false,
    );
    expect(
      existsSync(join(ROOT, "frontend/src/routes/_authenticated/admin/health-certificate.tsx")),
    ).toBe(false);
    expect(
      existsSync(join(ROOT, "frontend/src/routes/_authenticated/teacher/class-intelligence.tsx")),
    ).toBe(false);
  });
});
