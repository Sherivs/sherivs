/**
 * M4 (ADR-121): access-review campaigns and delegation handlers — validation and refusal paths.
 * The database side (bounds guard, trim/revoke on source change, cross-organization refusal) is
 * proven by tests/sql/m4-role-builder.sql.
 */
import { describe, expect, it } from "vitest";
import { RoleBuilderError } from "@/lib/role-builder/role-builder-core";
import {
  handleDecide,
  handleGrantDelegation,
  handleListCampaigns,
  handleMyActingContext,
  handleRevokeDelegation,
  handleStartCampaign,
  type AccessPort,
  type AssignmentRow,
  type ReviewCampaign,
} from "@/lib/role-builder/access-delegation";

const ORG = "aaaaaaaa-0000-0000-0000-000000000001";
const ME = "a0000000-0000-0000-0000-0000000000a1";
const HOLDER = "a0000000-0000-0000-0000-0000000000a3";
const DELEGATE = "a0000000-0000-0000-0000-0000000000a4";
const ASSIGNMENT = "c0000000-0000-4000-8000-000000000001";
const ITEM = "d0000000-0000-4000-8000-000000000001";
const OWN_ITEM = "d0000000-0000-4000-8000-000000000002";
const NOW = Date.parse("2026-11-18T09:00:00.000Z");
const iso = (days: number) => new Date(NOW + days * 86_400_000).toISOString();

function fakePort(patch: Partial<{ canManageRoles: boolean; orgId: string | null }> = {}) {
  const calls: string[] = [];
  const assignment: AssignmentRow = {
    id: ASSIGNMENT,
    userId: HOLDER,
    userName: "Holder",
    roleCode: "custom.x.fees_desk",
    roleName: "Fees desk",
    startedAt: iso(-10),
    validUntil: iso(10),
  };
  const campaign: ReviewCampaign = {
    id: "e0000000-0000-4000-8000-000000000001",
    title: "Term review",
    status: "open",
    dueAt: iso(5),
    createdAt: iso(-1),
    completedAt: null,
    auditCount: 1,
    items: [
      {
        id: ITEM,
        campaignId: "c",
        userId: HOLDER,
        userName: "Holder",
        roleCode: "r",
        roleName: "R",
        status: "pending",
        decidedBy: null,
        decidedAt: null,
      },
      {
        id: OWN_ITEM,
        campaignId: "c",
        userId: ME,
        userName: "Me",
        roleCode: "r",
        roleName: "R",
        status: "pending",
        decidedBy: null,
        decidedAt: null,
      },
    ],
  };
  const port: AccessPort = {
    caller: async () => ({ userId: ME, orgId: ORG, isAdmin: true, canManageRoles: true, ...patch }),
    listCampaigns: async () => [campaign],
    startCampaign: async () => (calls.push("start"), "new-campaign"),
    decide: async () => (calls.push("decide"), "retained"),
    listAssignments: async () => [assignment],
    listDelegations: async () => [],
    members: async () => [],
    grantDelegation: async () => (calls.push("grant"), "new-delegation"),
    revokeDelegation: async () => void calls.push("revoke"),
    myActingContext: async () => [
      {
        kind: "delegated",
        recordId: "x",
        roleCode: "r",
        roleName: "Fees desk",
        holderName: "Holder",
        validFrom: iso(0),
        validUntil: iso(2),
      },
    ],
  };
  return { port, calls, campaign };
}

const expectCode = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RoleBuilderError);
  expect((error as RoleBuilderError).code).toBe(code);
};

describe("M4 access reviews", () => {
  it("needs roles.assign and an organization", async () => {
    await expectCode(handleListCampaigns(fakePort({ canManageRoles: false }).port), "FORBIDDEN");
    await expectCode(handleListCampaigns(fakePort({ orgId: null }).port), "NO_ORGANIZATION");
  });
  it("validates the campaign title and due date", async () => {
    const { port, calls } = fakePort();
    await expectCode(handleStartCampaign(port, { title: "x", dueAt: iso(5) }, NOW), "VALIDATION");
    await expectCode(
      handleStartCampaign(port, { title: "Term", dueAt: "tomorrow" }, NOW),
      "VALIDATION",
    );
    await expectCode(
      handleStartCampaign(port, { title: "Term", dueAt: iso(-1) }, NOW),
      "VALIDATION",
    );
    await expectCode(
      handleStartCampaign(port, { title: "Term", dueAt: iso(400) }, NOW),
      "VALIDATION",
    );
    expect(calls).toEqual([]);
    await expect(
      handleStartCampaign(port, { title: "Term review", dueAt: iso(7) }, NOW),
    ).resolves.toEqual({ id: "new-campaign" });
  });
  it("refuses a bad decision, an unknown item and a review of one's own access", async () => {
    const { port, calls } = fakePort();
    await expectCode(handleDecide(port, { itemId: ITEM, decision: "maybe" }), "VALIDATION");
    await expectCode(
      handleDecide(port, { itemId: "f0000000-0000-4000-8000-000000000009", decision: "retain" }),
      "NOT_FOUND",
    );
    await expectCode(handleDecide(port, { itemId: OWN_ITEM, decision: "revoke" }), "SELF_GRANT");
    expect(calls).toEqual([]);
    await expect(handleDecide(port, { itemId: ITEM, decision: "retain" })).resolves.toEqual({
      result: "retained",
    });
  });
  it("refuses deciding an item twice", async () => {
    const { port, campaign } = fakePort();
    campaign.items[0]!.status = "retained";
    await expectCode(handleDecide(port, { itemId: ITEM, decision: "revoke" }), "CONFLICT");
  });
});

describe("M4 delegations", () => {
  const input = (patch = {}) => ({
    assignmentId: ASSIGNMENT,
    delegateUserId: DELEGATE,
    validFrom: iso(0),
    validUntil: iso(5),
    ...patch,
  });
  it("refuses an end after the source assignment, before the database is called", async () => {
    const { port, calls } = fakePort();
    await expectCode(
      handleGrantDelegation(port, input({ validUntil: iso(11) }), NOW),
      "DELEGATION_EXCEEDS_SOURCE",
    );
    await expectCode(
      handleGrantDelegation(port, input({ validFrom: iso(-11) }), NOW),
      "DELEGATION_EXCEEDS_SOURCE",
    );
    expect(calls).toEqual([]);
  });
  it("refuses delegating to the holder or oneself, bad windows and unknown assignments", async () => {
    const { port, calls } = fakePort();
    await expectCode(
      handleGrantDelegation(port, input({ delegateUserId: HOLDER }), NOW),
      "SELF_GRANT",
    );
    await expectCode(handleGrantDelegation(port, input({ delegateUserId: ME }), NOW), "SELF_GRANT");
    await expectCode(handleGrantDelegation(port, input({ validUntil: iso(0) }), NOW), "VALIDATION");
    await expectCode(
      handleGrantDelegation(port, input({ validFrom: iso(-3), validUntil: iso(-1) }), NOW),
      "VALIDATION",
    );
    await expectCode(
      handleGrantDelegation(
        port,
        input({ assignmentId: "f0000000-0000-4000-8000-000000000009" }),
        NOW,
      ),
      "NOT_FOUND",
    );
    await expectCode(
      handleGrantDelegation(port, input({ assignmentId: "nope" }), NOW),
      "VALIDATION",
    );
    expect(calls).toEqual([]);
  });
  it("grants a delegation inside the source window and revokes it", async () => {
    const { port, calls } = fakePort();
    await expect(handleGrantDelegation(port, input(), NOW)).resolves.toEqual({
      id: "new-delegation",
    });
    await handleRevokeDelegation(port, { id: "f0000000-0000-4000-8000-000000000001" });
    expect(calls).toEqual(["grant", "revoke"]);
  });
  it("needs roles.assign to grant or revoke", async () => {
    const { port } = fakePort({ canManageRoles: false });
    await expectCode(handleGrantDelegation(port, input(), NOW), "FORBIDDEN");
    await expectCode(
      handleRevokeDelegation(port, { id: "f0000000-0000-4000-8000-000000000001" }),
      "FORBIDDEN",
    );
  });
  it("returns the caller's acting context for the banner", async () => {
    const rows = await handleMyActingContext(fakePort().port);
    expect(rows.map((r) => r.kind)).toEqual(["delegated"]);
  });
});
