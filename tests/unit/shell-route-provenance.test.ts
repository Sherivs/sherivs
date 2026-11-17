/**
 * M3: after migration 20261117001200 the server manifest carries shell routes (`/home/s/<key>`).
 * Duplicate detection, catalogue provenance and notification-link matching must behave exactly as
 * they did with the legacy routes.
 */
import { describe, expect, it } from "vitest";
import {
  catalogueProvenance,
  toShellNavItem,
  uniqueCatalogItems,
} from "../../frontend/src/lib/shell/chrome";
import { permittedNotificationLink } from "../../frontend/src/lib/shell/notification-links";
import { CATALOG } from "../../frontend/src/lib/sherivs-ws/engine";

const shellRoute = (key: string) => (key === "nav.home" ? "/home" : `/home/s/${key}`);
const legacyItems = CATALOG.map((item) => ({
  key: item.key,
  label: item.label.en,
  icon: item.icon,
  to: item.to,
}));
const migratedItems = legacyItems.map((item) => ({ ...item, to: shellRoute(item.key) }));

describe("catalogue provenance after the route migration", () => {
  it("maps a shell route back to the legacy catalogue route, keeping the query", () => {
    expect(catalogueProvenance({ key: "nav.attendance", to: "/home/s/nav.attendance" })).toBe(
      "/teacher/attendance",
    );
    expect(
      catalogueProvenance({ key: "nav.attendance", to: "/home/s/nav.attendance?scope=campus%3AN" }),
    ).toBe("/teacher/attendance?scope=campus%3AN");
    expect(catalogueProvenance({ key: "nav.home", to: "/home" })).toBe("/workspace");
  });

  it("leaves legacy routes and unknown keys unchanged", () => {
    expect(catalogueProvenance({ key: "nav.attendance", to: "/teacher/attendance" })).toBe(
      "/teacher/attendance",
    );
    expect(catalogueProvenance({ key: "x.unknown", to: "/home/s/x.unknown" })).toBe(
      "/home/s/x.unknown",
    );
  });

  it("deduplicates exactly the same cards as before the migration", () => {
    expect(uniqueCatalogItems(migratedItems).map((i) => i.key)).toEqual(
      uniqueCatalogItems(legacyItems).map((i) => i.key),
    );
  });

  it("produces the same hrefs and provenance as before the migration", () => {
    for (let i = 0; i < legacyItems.length; i += 1) {
      const before = toShellNavItem(legacyItems[i]!);
      const after = toShellNavItem(migratedItems[i]!);
      expect(after.href, before.key).toBe(before.href);
      expect(after.catalogTo, before.key).toBe(before.catalogTo);
    }
  });

  it("still accepts notification links that name the legacy route", () => {
    const destinations = migratedItems.map(toShellNavItem);
    expect(permittedNotificationLink("/teacher/attendance", destinations)).toBe(
      "/home/s/nav.attendance",
    );
    expect(permittedNotificationLink("/home/s/nav.attendance", destinations)).toBe(
      "/home/s/nav.attendance",
    );
  });
});
