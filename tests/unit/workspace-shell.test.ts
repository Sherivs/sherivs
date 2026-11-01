import { describe, expect, it, vi } from "vitest";
import { fallbackManifest } from "@/lib/shell/fallback-manifest";
import type { AppRole } from "@/lib/roles";
import { runAuditedBulkAction } from "@/components/workspaces/bulk-action";
import {
  DEMO_WORKSPACE_MANIFESTS,
  DEMO_WORKSPACE_ROLES,
} from "@/components/workspaces/fixtures/demo-workspaces";
import { permittedNotificationLink } from "@/lib/shell/notification-links";
import { composeBottomSlots } from "@/lib/shell/chrome";
import { focusScope } from "@/lib/sherivs-ws/engine";
import roleTemplates from "@/lib/sherivs-ws/role-templates.data";
import {
  additionalResponsibilities,
  permittedWidgetCatalog,
  primarySections,
  reorderWidgetKeys,
  WIDGET_REGISTRY,
  workspaceResponsibilityIcon,
} from "@/components/workspaces/workspace-shell";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

function manifestFor(role: AppRole) {
  return fallbackManifest({ organizationId: ORG_ID, organizationName: "Demo School A", role });
}

describe("workspace shell manifest presentation", () => {
  it("builds synthetic fixtures for every V1 role template", () => {
    expect(Object.keys(DEMO_WORKSPACE_MANIFESTS).sort()).toEqual(Object.keys(roleTemplates).sort());
  });

  it.each(["teacher", "bursar", "principal", "parent"] as const)(
    "selects three authorized primary sections for %s",
    (role) => {
      const manifest = manifestFor(role);
      const primary = primarySections(manifest);
      const manifestKeys = new Set(
        [...manifest.widgets, ...manifest.nav, ...manifest.actions, ...manifest.inbox].map(
          (item) => item.key,
        ),
      );

      expect(primary).toHaveLength(3);
      expect(primary.every((item) => manifestKeys.has(item.key))).toBe(true);
      expect(
        additionalResponsibilities(manifest, primary).some((item) =>
          primary.some((primaryItem) => primaryItem.key === item.key),
        ),
      ).toBe(false);
    },
  );

  it.each(Object.keys(roleTemplates) as AppRole[])(
    "provides three permitted fallback sections for %s",
    (role) => {
      const manifest = manifestFor(role);
      const primary = primarySections(manifest);
      const permitted = new Set(
        [...manifest.widgets, ...manifest.nav, ...manifest.actions, ...manifest.inbox].map(
          (item) => item.key,
        ),
      );

      expect(primary).toHaveLength(3);
      expect(primary.every((item) => permitted.has(item.key))).toBe(true);
    },
  );

  it.each(DEMO_WORKSPACE_ROLES)(
    "provides exactly three permitted primary sections for $label",
    (role) => {
      const manifest = DEMO_WORKSPACE_MANIFESTS[role.key];
      const primary = primarySections(manifest);
      expect(primary).toHaveLength(3);
      expect(
        composeBottomSlots(manifest)
          .slice(1, 4)
          .map((item) => item.key),
      ).toEqual(primary.map((item) => item.key));
    },
  );

  it.each(DEMO_WORKSPACE_ROLES)(
    "deduplicates responsibilities and resolves card icons for $label",
    (role) => {
      const manifest = DEMO_WORKSPACE_MANIFESTS[role.key];
      const primary = primarySections(manifest);
      const responsibilities = [...primary, ...additionalResponsibilities(manifest, primary)];
      const keys = new Set<string>();
      const destinations = new Set<string>();

      for (const item of responsibilities) {
        const path = item.to.trim().split(/[?#]/, 1)[0] ?? "";
        const destination = path.replace(/\/+$/, "") || (path ? "/" : "");
        expect(keys.has(item.key), `duplicate key ${item.key}`).toBe(false);
        if (destination) {
          expect(destinations.has(destination), `duplicate destination ${destination}`).toBe(false);
          destinations.add(destination);
        }
        expect(workspaceResponsibilityIcon(item)).toBeTruthy();
        keys.add(item.key);
      }
    },
  );

  it("uses a catalog icon or the dashboard fallback when a card has no icon", () => {
    const knownItem = DEMO_WORKSPACE_MANIFESTS.teacher.widgets.find(
      (item) => item.key === "w.grading_queue",
    )!;
    expect(workspaceResponsibilityIcon({ ...knownItem, icon: "" })).toBe("clipboard");
    expect(
      workspaceResponsibilityIcon({ ...knownItem, key: "unknown", to: "/unknown", icon: "" }),
    ).toBe("dashboard");
  });

  it("only exposes catalog widgets already admitted by the server manifest", () => {
    const manifest = manifestFor("teacher");
    const catalog = permittedWidgetCatalog(manifest);
    const visible = new Set([...manifest.widgets, ...manifest.available].map((item) => item.key));

    expect(WIDGET_REGISTRY.length).toBeGreaterThan(0);
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.every((item) => visible.has(item.key))).toBe(true);
    expect(catalog.some((item) => item.key === "w.fee_collection")).toBe(false);
  });

  it("applies an assigned scope to nav, widgets, and actions but rejects unassigned scopes", () => {
    const manifest = DEMO_WORKSPACE_MANIFESTS.teacher;
    const focused = focusScope(manifest, { dim: "campus", ref: "demo-campus-north" });

    for (const item of [...focused.nav, ...focused.widgets, ...focused.actions]) {
      expect(new URL(item.to, "https://demo.invalid").searchParams.get("scope")).toBe(
        "campus:demo-campus-north",
      );
    }
    expect(focusScope(manifest, { dim: "campus", ref: "demo-campus-west" })).toBe(manifest);
  });

  it("moves widgets one position and leaves unknown or out-of-range moves unchanged", () => {
    expect(reorderWidgetKeys(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(reorderWidgetKeys(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(reorderWidgetKeys(["a", "b"], "missing", 1)).toEqual(["a", "b"]);
  });

  it("requires explicit confirmation and an audit reference for bulk actions", async () => {
    const execute = vi.fn(async () => ({ auditRef: "audit-record" }));
    const action = { id: "archive", label: "Archive", execute };

    expect(await runAuditedBulkAction(action, ["one"], false)).toBeNull();
    expect(execute).not.toHaveBeenCalled();
    await expect(runAuditedBulkAction(action, ["one"], true)).resolves.toEqual({
      auditRef: "audit-record",
    });

    await expect(
      runAuditedBulkAction({ ...action, execute: async () => ({ auditRef: " " }) }, ["one"], true),
    ).rejects.toThrow("no audit reference");
  });

  it("only deep-links notifications to currently authorized workspace destinations", () => {
    const destinations = [{ href: "/home/s/nav.attendance", catalogTo: "/teacher/attendance" }];

    expect(permittedNotificationLink("/teacher/attendance", destinations)).toBe(
      "/home/s/nav.attendance",
    );
    expect(permittedNotificationLink("/admin/payroll", destinations)).toBeNull();
    expect(permittedNotificationLink("//external.example/path", destinations)).toBeNull();
  });
});
