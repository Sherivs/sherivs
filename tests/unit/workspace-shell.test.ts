import { describe, expect, it } from "vitest";
import { fallbackManifest } from "@/lib/shell/fallback-manifest";
import type { AppRole } from "@/lib/roles";
import {
  additionalResponsibilities,
  permittedWidgetCatalog,
  primarySections,
  reorderWidgetKeys,
  WIDGET_REGISTRY,
} from "@/components/workspaces/workspace-shell";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

function manifestFor(role: AppRole) {
  return fallbackManifest({ organizationId: ORG_ID, organizationName: "Demo School A", role });
}

describe("workspace shell manifest presentation", () => {
  it.each(["teacher", "bursar", "principal", "parent"] as const)(
    "selects three authorized primary sections for %s",
    (role) => {
      const manifest = manifestFor(role);
      const primary = primarySections(manifest);

      expect(primary).toHaveLength(3);
      expect(primary.every((item) => manifest.nav.some((nav) => nav.key === item.key))).toBe(true);
      expect(additionalResponsibilities(manifest, primary).some((item) =>
        primary.some((primaryItem) => primaryItem.key === item.key),
      )).toBe(false);
    },
  );

  it("only exposes catalog widgets already admitted by the server manifest", () => {
    const manifest = manifestFor("teacher");
    const catalog = permittedWidgetCatalog(manifest);
    const visible = new Set([...manifest.widgets, ...manifest.available].map((item) => item.key));

    expect(WIDGET_REGISTRY.length).toBeGreaterThan(0);
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.every((item) => visible.has(item.key))).toBe(true);
    expect(catalog.some((item) => item.key === "w.fee_collection")).toBe(false);
  });

  it("moves widgets one position and leaves unknown or out-of-range moves unchanged", () => {
    expect(reorderWidgetKeys(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(reorderWidgetKeys(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(reorderWidgetKeys(["a", "b"], "missing", 1)).toEqual(["a", "b"]);
  });
});
