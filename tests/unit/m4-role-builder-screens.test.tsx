/**
 * M4 (ADR-116): the three screens and the acting banner render accessibly from seeded data, and
 * the card registry opens them as live, lazily loaded sections.
 * Screens: frontend/src/components/app-shell/custom-role-builder-screen,
 * frontend/src/components/app-shell/access-review-screen,
 * frontend/src/components/app-shell/delegation-screen.
 * No browser, screenshot or axe scan runs here (node environment, static render).
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
vi.mock("@/lib/role-builder/role-builder.functions", () => ({
  activateCustomRole: fail,
  approveCustomRole: fail,
  customRoleHistory: fail,
  defineCustomResponsibility: fail,
  loadRoleBuilder: fail,
  previewCustomRole: fail,
  saveCustomRoleDraft: fail,
  simulateCustomRole: fail,
  submitCustomRole: fail,
  withdrawCustomRole: fail,
}));
vi.mock("@/lib/role-builder/access-delegation.functions", () => ({
  decideAccessReviewItem: fail,
  listAccessReviews: fail,
  startAccessReview: fail,
  getMyActingContext: fail,
  grantDelegation: fail,
  listDelegations: fail,
  revokeDelegation: fail,
}));

import { CustomRoleBuilderScreen } from "@/components/app-shell/custom-role-builder-screen";
import { AccessReviewScreen } from "@/components/app-shell/access-review-screen";
import { DelegationScreen } from "@/components/app-shell/delegation-screen";
import { ActingContextBanner, actingBannerText } from "@/components/app-shell/acting-context-banner";
import { CARD_REGISTRY, resolveCard } from "@/lib/shell/card-registry";
import { previewDraft, simulateDraft, type BuilderCatalogue } from "@/lib/role-builder/role-builder-core";
import type { CustomRoleVersion } from "@/lib/role-builder/role-builder-port";

const ME = "a0000000-0000-0000-0000-0000000000a1";
const OTHER = "a0000000-0000-0000-0000-0000000000a2";
const catalogue: BuilderCatalogue = {
  institutionType: "private_secondary",
  templates: [
    { code: "bursar_t", scope: "org", mandatory: ["fees.view"], optional: ["reports.view"], nav: [], workspaceMode: "full" },
  ],
  permissions: [
    { code: "fees.view", label: "View fees", module: "fees", sensitivity: "internal", protected: false },
    { code: "payments.reconcile", label: "Reconcile", module: "payments", sensitivity: "confidential", protected: false },
    { code: "payroll.approve", label: "Approve payroll", module: "payroll", sensitivity: "restricted", protected: true },
    { code: "reports.view", label: "Reports", module: "reports", sensitivity: "internal", protected: false },
  ],
  allowedPermissions: ["fees.view", "payments.reconcile", "reports.view"],
  sodRules: [{ a: "fees.view", b: "payments.reconcile", description: "Test rule" }],
  responsibilities: [],
};
const nav = [
  { id: "a1", label: "Collections" },
  { id: "b1", label: "Receipts" },
  { id: "c1", label: "Reports" },
];
const version = (patch: Partial<CustomRoleVersion>): CustomRoleVersion => ({
  id: "00000000-0000-4000-8000-000000000001",
  code: "custom.fees_desk",
  name: "Fees desk",
  version: 1,
  status: "pending_approval",
  baseTemplate: "bursar_t",
  permissions: ["fees.view"],
  responsibilities: [],
  scopeCeiling: "org",
  workspaceCategory: "administrative_operations",
  layout: { nav, widgets: [] },
  createdBy: ME,
  approvedBy: null,
  approvedAt: null,
  createdAt: "2026-11-18T09:00:00Z",
  updatedAt: "2026-11-18T09:00:00Z",
  ...patch,
});

describe("M4 custom role builder screen", () => {
  const draft = {
    slug: "fees_desk",
    name: "Fees desk",
    baseTemplate: "bursar_t",
    permissions: ["fees.view", "payments.reconcile"],
    responsibilities: [],
    scopeCeiling: "org" as const,
    workspaceCategory: "administrative_operations" as const,
    layout: { nav, widgets: [] },
  };
  const html = renderToStaticMarkup(
    <CustomRoleBuilderScreen
      initial={{
        catalogue,
        versions: [version({}), version({ id: "00000000-0000-4000-8000-000000000002", code: "custom.other", createdBy: OTHER })],
        me: ME,
        draft: { ...draft, slug: "Bad Code" },
        preview: previewDraft(draft, catalogue),
        simulation: simulateDraft(draft, catalogue, "2026-11-18T09:00:00.000Z"),
      }}
    />,
  );

  it("labels every field and links errors with aria-describedby", () => {
    const idMatch = /<label for="([^"]+)"[^>]*>Role code<\/label>/.exec(html);
    expect(idMatch).not.toBeNull();
    const id = idMatch![1]!;
    expect(html).toContain(`id="${id}"`);
    expect(html).toMatch(new RegExp(`aria-describedby="${id}-hint ${id}-error"`));
    expect(html).toContain(`id="${id}-error"`);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Error: use 2 to 60 lower-case letters");
  });

  it("flags protected permissions and does not let them be selected", () => {
    expect(html).toMatch(/data-protected="true"[^>]*><input type="checkbox" class="size-5" disabled=""/);
    expect(html).toContain("(protected)");
  });

  it("shows the SoD explanation and the simulated three sections", () => {
    expect(html).toContain("fees.view and payments.reconcile cannot be held by one role: Test rule.");
    expect(html).toContain("This draft cannot be saved yet.");
    expect(html).toMatch(/data-testid="simulated-nav">(<li[^>]*>(Collections|Receipts|Reports)<\/li>){3}<\/ol>/);
  });

  it("disables approval for the creator with a text explanation and allows it for another admin", () => {
    expect(html).toContain("You created this version, so another administrator must approve it.");
    expect(html).toMatch(/disabled="" aria-describedby="four-eyes-00000000-0000-4000-8000-000000000001"/);
    const otherRow = html.slice(html.indexOf("custom.other"));
    expect(otherRow).not.toContain("four-eyes-00000000-0000-4000-8000-000000000002");
  });

  it("states status in text, not colour alone, and uses 44 px targets", () => {
    expect(html).toContain("Waiting for a second administrator");
    expect(html).toContain("min-h-11 min-w-11");
  });
});

describe("M4 access review screen", () => {
  const html = renderToStaticMarkup(
    <AccessReviewScreen
      initial={{
        me: ME,
        campaigns: [
          {
            id: "e1",
            title: "Term review",
            status: "open",
            dueAt: "2026-12-01T00:00:00Z",
            createdAt: "2026-11-18T00:00:00Z",
            completedAt: null,
            auditCount: 1,
            items: [
              { id: "i1", campaignId: "e1", userId: OTHER, userName: "Ada", roleCode: "r", roleName: "Bursar", status: "pending", decidedBy: null, decidedAt: null },
              { id: "i2", campaignId: "e1", userId: ME, userName: "Me", roleCode: "r", roleName: "Admin", status: "pending", decidedBy: null, decidedAt: null },
            ],
          },
        ],
      }}
    />,
  );
  it("offers keep and revoke with names, but not on one's own access", () => {
    expect(html).toContain('aria-label="Keep Bursar for Ada"');
    expect(html).toContain('aria-label="Revoke Bursar from Ada"');
    expect(html).not.toContain("Revoke Admin from Me");
    expect(html).toContain("Your own access: another reviewer decides.");
    expect(html).toContain("0 of 2 decided");
  });
});

describe("M4 delegation screen", () => {
  const html = renderToStaticMarkup(
    <DelegationScreen
      initial={{
        me: ME,
        assignmentId: "as1",
        assignments: [
          { id: "as1", userId: OTHER, userName: "Ada", roleCode: "r", roleName: "Bursar", startedAt: "2026-11-01T00:00:00Z", validUntil: "2026-12-01T00:00:00Z" },
        ],
        delegations: [
          { id: "d1", assignmentId: "as1", delegateUserId: "x", delegateName: "Bola", validFrom: "2026-11-18T00:00:00Z", validUntil: "2026-11-20T00:00:00Z", revokedAt: null },
        ],
        members: [{ id: "x", name: "Bola" }],
      }}
    />,
  );
  it("states the source end as the limit and lists delegations with text status", () => {
    expect(html).toContain("No later than 2026-12-01T00:00:00Z.");
    expect(html).toContain("Bola covers Bursar for Ada");
    expect(html).toContain("In force");
    expect(html).toContain('aria-label="Revoke the delegation to Bola"');
  });
});

describe("M4 acting banner", () => {
  const rows = [
    { kind: "delegated" as const, recordId: "1", roleCode: "r", roleName: "Bursar", holderName: "Ada", validFrom: "2026-11-18T00:00:00Z", validUntil: "2026-11-20T08:00:00Z" },
    { kind: "acting" as const, recordId: "2", roleCode: "p", roleName: "Head", holderName: null, validFrom: "2026-11-18T00:00:00Z", validUntil: null },
  ];
  it("says acting or delegated in words and is announced politely", () => {
    const html = renderToStaticMarkup(<ActingContextBanner initialRows={rows} />);
    expect(html).toContain('role="status"');
    expect(html).toContain("<strong>Delegated</strong>");
    expect(html).toContain("<strong>Acting</strong>");
    expect(actingBannerText(rows)).toEqual([
      "Delegated: you are covering Bursar for Ada until 2026-11-20 08:00. Actions are recorded under your name.",
      "Acting as Head. Actions are recorded under your name.",
    ]);
  });
  it("renders nothing without an acting context", () => {
    expect(renderToStaticMarkup(<ActingContextBanner initialRows={[]} />)).toBe("");
  });
});

describe("M4 card registry", () => {
  it.each([
    ["role-builder", "custom-role-builder-screen", "CustomRoleBuilderScreen"],
    ["access-reviews", "access-review-screen", "AccessReviewScreen"],
    ["delegations", "delegation-screen", "DelegationScreen"],
  ])("%s is a live, lazily loaded section", async (key, module, exported) => {
    const resolution = resolveCard(key);
    expect(resolution.kind).toBe("live");
    const contract = CARD_REGISTRY[key]!;
    expect(contract.screenModule).toBe(`frontend/src/components/app-shell/${module}`);
    expect(contract.auditEvents.length).toBeGreaterThan(0);
    const loaded = await contract.screen!();
    expect(loaded.default.name).toBe(exported);
  });
});
