/**
 * M2c (ADR-161): the role overrides screen renders accessibly from seeded data and the card registry opens it as a
 * live section. Screen: frontend/src/components/app-shell/role-overrides-screen.
 * No browser or axe scan runs here (node environment, static render).
 */
import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
const { fail } = vi.hoisted(() => ({
  fail: () => Promise.reject(new Error("not called in this test")),
}));
vi.mock("@/lib/role-builder/role-overrides.functions", () => ({
  approveRoleOverride: fail,
  endRoleOverride: fail,
  listRoleOverrides: fail,
  proposeRoleOverride: fail,
}));

import { RoleOverridesScreen } from "@/components/app-shell/role-overrides-screen";
import { CARD_REGISTRY } from "@/lib/shell/card-registry";
import type { OverridesView } from "@/lib/role-builder/role-overrides";

const row = (over: Partial<OverridesView["rows"][number]>): OverridesView["rows"][number] => ({
  id: "i1",
  template: "accountant",
  kind: "rename",
  payload: { name: "Bursar" },
  effectiveFrom: "2026-11-01T00:00:00Z",
  effectiveTo: null,
  createdBy: "me",
  approvedBy: null,
  approvedAt: null,
  createdAt: "2026-11-01T00:00:00Z",
  state: "pending",
  ...over,
});
const view = (isAdmin: boolean, rows: OverridesView["rows"]): OverridesView => ({
  caller: { userId: "me", orgId: "o1", isAdmin },
  rows,
});

describe("RoleOverridesScreen", () => {
  it("shows the form and labels every field", () => {
    const html = renderToStaticMarkup(<RoleOverridesScreen initial={{ view: view(true, []) }} />);
    expect(html).toContain('data-testid="role-overrides-screen"');
    expect(html).toContain("Propose an override");
    expect(html).toContain("Role template");
    expect(html).toContain("What to change");
    expect(html).toContain("No overrides yet.");
  });
  it("tells a proposer that a second administrator must approve, and disables their own approve button", () => {
    const html = renderToStaticMarkup(
      <RoleOverridesScreen initial={{ view: view(true, [row({})]) }} />,
    );
    expect(html).toContain("a second administrator must approve it");
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Approve/);
    expect(html).toContain("Rename the role to &quot;Bursar&quot;");
    expect(html).toContain("Withdraw");
  });
  it("lets a different administrator approve and shows ended rows with no actions", () => {
    const html = renderToStaticMarkup(
      <RoleOverridesScreen
        initial={{
          view: view(true, [
            row({ id: "i2", createdBy: "someone-else" }),
            row({ id: "i3", state: "ended", approvedBy: "x" }),
          ]),
        }}
      />,
    );
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Approve/);
    expect(html).toContain(">Approve</button>");
    expect(html).toContain("Ended");
    expect((html.match(/End now/g) ?? []).length).toBe(0);
  });
  it("shows a plain refusal and no form to a member", () => {
    const html = renderToStaticMarkup(<RoleOverridesScreen initial={{ view: view(false, []) }} />);
    expect(html).toContain("Only an administrator can manage role overrides.");
    expect(html).not.toContain("Propose an override");
  });
  it("is a live, lazily loaded section in the card registry", () => {
    const entry = CARD_REGISTRY["role-overrides"];
    expect(entry).toBeDefined();
    expect(entry.status).toBe("live");
    expect(entry.serverFns).toContain("fn:proposeRoleOverride");
  });
});
