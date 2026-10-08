/**
 * Sherivs experience foundation — brand, classification and registry tests (V1).
 *
 * Guards the customer-facing rename (Sherivs) while the technical kernel
 * identifier (CoreGrid) stays preserved, and proves the public registry
 * contains no fabricated destinations.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  SHERIVS_NAME,
  SHERIVS_CATEGORY,
  SHERIVS_PUBLIC_ORIGIN,
  SHERIVS_EXECUTIVE_INTELLIGENCE,
  SHERIVS_AI_WORKFORCE,
  SHERIVS_BRAND_REFERENCE_RULES,
  classifyVersionTarget,
} from "@/lib/sherivs-brand";
import { PLATFORM_NAME, PLATFORM_KERNEL_NAME } from "@/lib/platform";
import {
  SHERIVS_PRIMARY_NAV,
  SHERIVS_FOOTER_COLUMNS,
  SHERIVS_SOCIAL_LINKS,
} from "@/components/sherivs/public-registry";

const ROOT = process.cwd();

function routeFileFor(path: string): string | null {
  // Maps a public path to its TanStack file-route source (dot notation).
  if (path === "/") return "frontend/src/routes/index.tsx";
  const clean = path.split("#")[0].replace(/^\//, "");
  if (!clean) return null;
  if (clean === "auth") return "frontend/src/routes/auth.tsx";
  if (clean === "blog") return "frontend/src/routes/blog.tsx";
  if (clean === "platform") return "frontend/src/routes/platform.tsx";
  const dotted = clean.replace(/\//g, ".");
  return `frontend/src/routes/${dotted}.tsx`;
}

describe("Sherivs brand identity", () => {
  it("declares the canonical customer-facing brand", () => {
    expect(SHERIVS_NAME).toBe("Sherivs");
    expect(SHERIVS_CATEGORY).toBe("Institutional Intelligence Infrastructure");
    expect(SHERIVS_PUBLIC_ORIGIN).toBe("https://sherivs.com");
    expect(SHERIVS_EXECUTIVE_INTELLIGENCE).toBe("Jarvis");
    expect(SHERIVS_AI_WORKFORCE).toBe("Sherivs AI Workforce");
  });

  it("renders Sherivs in UI chrome while preserving the technical kernel name", () => {
    expect(PLATFORM_NAME).toBe("Sherivs");
    expect(PLATFORM_KERNEL_NAME).toBe("CoreGrid");
    expect(PLATFORM_NAME).not.toBe(PLATFORM_KERNEL_NAME);
  });

  it("classifies every reference rule as customer-facing or technical", () => {
    expect(SHERIVS_BRAND_REFERENCE_RULES.length).toBeGreaterThan(0);
    for (const rule of SHERIVS_BRAND_REFERENCE_RULES) {
      expect(["CUSTOMER_FACING", "TECHNICAL"]).toContain(rule.classification);
      expect(rule.action.length).toBeGreaterThan(0);
    }
    expect(SHERIVS_BRAND_REFERENCE_RULES.some((rule) => rule.classification === "TECHNICAL")).toBe(
      true,
    );
  });

  it("classifies version targets with V2/V3 frozen", () => {
    expect(classifyVersionTarget("organization-workspace")).toBe("V1");
    expect(classifyVersionTarget("device-telemetry")).toBe("V2_FROZEN");
    expect(classifyVersionTarget("simulation-sandbox")).toBe("V3_FROZEN");
  });
});

describe("Sherivs public registry integrity (no fabricated destinations)", () => {
  it("points primary nav at real route files", () => {
    expect(SHERIVS_PRIMARY_NAV.length).toBeGreaterThan(0);
    for (const item of SHERIVS_PRIMARY_NAV) {
      const file = routeFileFor(item.to);
      expect(file, `${item.label} → ${item.to}`).not.toBeNull();
      expect(existsSync(join(ROOT, file!)), `${item.label} → ${item.to}`).toBe(true);
    }
  });

  it("points every footer link at a real route file and existing anchor", () => {
    for (const column of SHERIVS_FOOTER_COLUMNS) {
      for (const link of column.links) {
        const [path, hash] = link.to.split("#");
        const file = routeFileFor(path || "/");
        expect(file, `${column.heading} / ${link.label} → ${link.to}`).not.toBeNull();
        expect(existsSync(join(ROOT, file!))).toBe(true);
        if (hash) {
          const source = readFileSync(join(ROOT, file!), "utf8");
          expect(
            source.includes(`id="${hash}"`),
            `${link.to} anchor #${hash} must exist in ${file}`,
          ).toBe(true);
        }
      }
    }
  });

  it("lists no social profiles until verified accounts exist", () => {
    expect(SHERIVS_SOCIAL_LINKS).toEqual([]);
  });
});
