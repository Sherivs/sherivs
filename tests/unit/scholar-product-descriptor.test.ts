/**
 * Approved Sherivs Scholar positioning line.
 *
 * The homepage hero renders the line as the product descriptor, beside the
 * product name and headline. Homepage title and description carry the same
 * line. Vitest here is node (no jsdom), so "renders" is the hero markup
 * binding the descriptor into the page, the same way other public-site
 * surfaces are checked.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLATFORM_PAGE_DESCRIPTION, PLATFORM_PAGE_TITLE } from "@/lib/platform";
import { POSITIONING_RETHINKING, PRODUCT_DESCRIPTOR } from "@/lib/public-site/company";
import { SCHOLAR_HERO } from "@/lib/public-site/scholar";

const LINE = "The Reality Operating Environment for Schools";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

describe("Sherivs Scholar product descriptor", () => {
  it("keeps the approved positioning line word for word", () => {
    expect(PRODUCT_DESCRIPTOR).toBe(LINE);
    expect(SCHOLAR_HERO.descriptor).toBe(LINE);
    expect(SCHOLAR_HERO.eyebrow).toBe("SHERIVS SCHOLAR");
    expect(SCHOLAR_HERO.headline).toBe("Your school. One intelligent operating environment.");
    expect(LINE).not.toMatch(/Scholar is|Scholar's/);
  });

  it("renders the descriptor in the homepage hero between the product name and headline", () => {
    const home = read("frontend/src/components/public/sherivs-home.tsx");
    const hero = home.slice(
      home.indexOf("function HeroSection"),
      home.indexOf("function OrganizationSection"),
    );
    const eyebrow = hero.indexOf("{SCHOLAR_HERO.eyebrow}");
    const descriptor = hero.indexOf("{SCHOLAR_HERO.descriptor}");
    const headline = hero.indexOf("{SCHOLAR_HERO.headline}");
    expect(eyebrow).toBeGreaterThan(-1);
    expect(descriptor).toBeGreaterThan(eyebrow);
    expect(headline).toBeGreaterThan(descriptor);
    const descriptorElement = hero.slice(hero.lastIndexOf("<p", descriptor), descriptor);
    expect(descriptorElement).toContain("text-[var(--sherivs-ink)]");
    expect(descriptorElement).not.toContain("sherivs-kicker");
  });

  it("carries the descriptor in the homepage title and description", () => {
    expect(PLATFORM_PAGE_TITLE).toBe(`Sherivs Scholar | ${LINE}`);
    expect(PLATFORM_PAGE_DESCRIPTION.startsWith(`${LINE}. `)).toBe(true);
    expect(PLATFORM_PAGE_DESCRIPTION).toContain(POSITIONING_RETHINKING);
    const index = read("frontend/src/routes/index.tsx");
    expect(index).toContain("title: PLATFORM_PAGE_TITLE");
    expect(index).toContain("content: PLATFORM_PAGE_DESCRIPTION");
  });
});
