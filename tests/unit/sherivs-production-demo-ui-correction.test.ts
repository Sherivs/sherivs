import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

describe("public root no longer mounts in-memory Command Centre", () => {
  const index = read("frontend/src/routes/index.tsx");
  const home = read("frontend/src/components/public/platform-home.tsx");

  it("renders the neutral public home (SherivsHome) instead of CommandCentre on /", () => {
    expect(index).toContain("<SherivsHome />");
    expect(index).not.toMatch(/from ["']@\/components\/command-centre\/command-centre["']/);
    expect(index).not.toContain("<CommandCentre");
    expect(index).not.toContain("user:demo-administrator");
  });

  it("uses the shared Sherivs logo component (real public brand assets) and real auth/overview routes", () => {
    expect(home).toContain("<SherivsMark");
    const logo = readFileSync(join(ROOT, "frontend/src/components/brand/sherivs-logo.tsx"), "utf8");
    expect(logo).toContain("/brand/sherivs-mark-");
    for (const px of [64, 128, 256])
      expect(existsSync(join(ROOT, `public/brand/sherivs-mark-${px}.png`))).toBe(true);
    expect(logo).toContain("`${PLATFORM_NAME} logo`");
    expect(home).toContain('to="/auth"');
    expect(home).toContain('to="/sherivs"');
    expect(home).not.toContain("tenant:coregrid-demo");
    expect(home).not.toMatch(/\b94%\b/);
    expect(home).not.toMatch(/Live attendance/);
  });

  it("preserves tenant public sites and authenticated workspace routing", () => {
    expect(index).toContain("<SiteView"); // dynamic website engine (SHERIVS-100)
    // master routes signed-in users via the resolved identity chain.
    expect(index).toContain("identityFromAppState");
    expect(index).toContain('createFileRoute("/")');
  });
});

describe("hard-coded metric placeholders removed from production portal paths", () => {
  const intelligence = read("frontend/src/routes/_authenticated/admin/intelligence.tsx");
  const health = read("frontend/src/routes/_authenticated/admin/health-certificate.tsx");
  const teacher = read("frontend/src/routes/_authenticated/teacher/class-intelligence.tsx");

  it("admin intelligence and health certificate use honest-scores instead of parentScore = 70", () => {
    expect(intelligence).toContain("parentEngagementRate(");
    expect(intelligence).not.toMatch(/parentScore\s*=\s*70/);
    expect(health).toContain("const parentScore: number | null = null");
    expect(health).not.toMatch(/parentScore\s*=\s*70/);
  });

  it("does not treat empty fees as 100% collection", () => {
    expect(intelligence).toContain("feeCollectionRate(");
    expect(health).toContain("feeCollectionRate(");
    expect(intelligence).not.toMatch(
      /totalBilled > 0 \? \(totalCollected \/ totalBilled\) \* 100 : 100/,
    );
    expect(health).not.toMatch(/totalBilled > 0 \? \(totalCollected \/ totalBilled\) \* 100 : 100/);
  });

  it("teacher class intelligence does not default attendance to 100 or fees to 100", () => {
    expect(teacher).toContain("studentRiskFromAvailable");
    expect(teacher).toContain("attendanceRate(");
    expect(teacher).not.toMatch(/srate \?\? 100/);
    expect(teacher).not.toMatch(/feeScore\s*=\s*100/);
    expect(teacher).not.toMatch(/grScore\s*=\s*savg \?\? 60/);
    expect(teacher).toContain("Not enough data");
  });

  it("keeps school_id filters on the live reads (tenant isolation not weakened)", () => {
    expect(intelligence).toMatch(/\.eq\("school_id", schoolId\)/);
    expect(health).toMatch(/\.eq\("school_id", schoolId\)/);
    expect(teacher).toMatch(/\.eq\("school_id", schoolId!\)/);
  });

  it("keeps feature-locked and missing-school query gates (unauthorized/unavailable)", () => {
    expect(intelligence).toContain("canIntelligence");
    expect(intelligence).toContain("FeatureLockedCard");
    expect(intelligence).toContain("enabled: !!schoolId && canIntelligence");
    expect(health).toContain("canHealth");
    expect(health).toContain("FeatureLockedCard");
    expect(health).toContain("enabled: !!schoolId && canHealth");
    expect(intelligence).toContain('score === null ? "Unavailable"');
    expect(health).toContain("Overall health score unavailable");
  });
});
