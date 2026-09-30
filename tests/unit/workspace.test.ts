import { describe, expect, it } from "vitest";
import { tenantId } from "@/lib/tenant-core";
import {
  workspaceId,
  workspaceMembershipId,
  workspaceRoleId,
  workspaceInvitationId,
  moduleId,
  pageId,
  widgetInstanceId,
  widgetTypeId,
  layoutId,
  viewId,
  filterId,
  type Workspace,
  type WorkspaceAuditEvent,
  createWorkspace,
  changeWorkspaceLifecycle,
  validateWorkspaceForActivation,
  switchWorkspaceContext,
  searchWorkspaces,
  provisionDefaultWorkspace,
  evaluateWorkspaceHealth,
  isWorkspaceLifecycleTransitionAllowed,
} from "@/lib/workspace-core";
import {
  type WorkspaceMembership,
  type WorkspaceInvitation,
  addWorkspaceMember,
  changeWorkspaceMemberRole,
  removeWorkspaceMember,
  sendWorkspaceInvitation,
  acceptWorkspaceInvitation,
  evaluateWorkspaceAccess,
  DEFAULT_WORKSPACE_ROLE_DEFINITIONS,
  type WorkspaceRole,
  type WorkspaceRoleDefinition,
} from "@/lib/workspace-membership";
import {
  createPage,
  createDashboard,
  enableModule,
  disableModule,
  createView,
  shareView,
  createCard,
  personalizeWidgetInstance,
  savePersonalizedView,
  validateLayout,
  areFiltersOnApprovedFields,
  areSortFieldsApproved,
  resolveTemplateValueFromOverrides,
  type WorkspaceView,
  type WorkspacePage,
  type WorkspaceLayout,
  type FilterDefinition,
  type WidgetInstance,
  type Views,
} from "@/lib/workspace-composition";
import {
  validateWorkspacePolicy,
  createConfigurationSnapshot,
  recordConfigVersion,
  filterWorkspaceAuditEvents,
  resolveCatalogInheritance,
  type WorkspaceConfigurationPolicy,
} from "@/lib/workspace-governance";

const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");
const NOW = "2026-08-23T10:00:00.000Z";
const NOW_LATER = "2026-08-23T12:00:00.000Z";

const CURRENT_WS = workspaceId("tenant-a:admin_ws");

function makeRoleDefinitions(): Map<WorkspaceRole, WorkspaceRoleDefinition> {
  const map = new Map<WorkspaceRole, WorkspaceRoleDefinition>();
  for (const def of DEFAULT_WORKSPACE_ROLE_DEFINITIONS) {
    map.set(def.role, {
      ...def,
      id: workspaceRoleId(`role:${def.role}`),
      tenantId: TENANT_A,
      workspaceId: CURRENT_WS,
      createdAt: NOW,
      updatedAt: NOW,
    });
  }
  return map;
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: CURRENT_WS,
    tenantId: TENANT_A,
    workspaceId: CURRENT_WS,
    name: "Administration Workspace",
    code: "ADMIN_WS",
    type: "institution",
    parentWorkspaceId: null,
    lifecycleState: "active",
    moduleIds: [],
    defaultPageId: pageId(`${CURRENT_WS}:dashboard`),
    isDiscoverable: true,
    region: "NG-LA",
    timezone: "Africa/Lagos",
    locale: "en-NG",
    suspensionReason: null,
    archiveReason: null,
    configVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeMember(identityId: string, role: WorkspaceRole): WorkspaceMembership {
  return {
    id: workspaceMembershipId(`${CURRENT_WS}:${identityId}`),
    tenantId: TENANT_A,
    workspaceId: CURRENT_WS,
    identityId,
    role,
    state: "active",
    isActive: true,
    dataClassification: "TENANT_INTERNAL",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeInvitation(inviteeId: string, expiresAt: string): WorkspaceInvitation {
  return {
    id: workspaceInvitationId(`${CURRENT_WS}:${inviteeId}`),
    tenantId: TENANT_A,
    workspaceId: CURRENT_WS,
    inviterId: "admin-1",
    inviteeId,
    intendedRole: "editor",
    expiresAt,
    status: "pending",
    acceptedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeView(name = "View"): WorkspaceView {
  return {
    id: viewId(`tenant-a:${name}:creator`),
    tenantId: TENANT_A,
    workspaceId: CURRENT_WS,
    name,
    scope: "private",
    creatorId: "creator-1",
    ownerId: "creator-1",
    version: 1,
    sharedTo: null,
    viewType: "table" as Views,
    columns: [],
    filters: [],
    sorting: [],
    grouping: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makePage(key: string): WorkspacePage {
  return {
    id: pageId(`${CURRENT_WS}:${key}`),
    tenantId: TENANT_A,
    workspaceId: CURRENT_WS,
    key,
    title: "Test Page",
    description: null,
    isDefault: false,
    layoutId: null,
    components: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("Phase 06 — Workspace Engine", () => {
  describe("Workspace core & lifecycle (Sections F, I–O)", () => {
    it("creates a workspace with audit event", () => {
      const result = createWorkspace(
        {
          tenantId: TENANT_A,
          name: "Student Portal",
          code: "STUDENT_PORTAL",
          type: "institution",
          creatorId: "admin-1",
          now: NOW,
        },
        [],
        NOW,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.workspace.lifecycleState).toBe("draft");
        expect(result.workspace.type).toBe("institution");
        expect(result.workspace.tenantId).toBe(TENANT_A);
        expect(result.auditEvent.type).toBe("WorkspaceCreated");
      }
    });

    it("rejects invalid workspace code", () => {
      const result = createWorkspace(
        {
          tenantId: TENANT_A,
          name: "Bad",
          code: "has space",
          type: "institution",
          creatorId: "admin-1",
          now: NOW,
        },
        [],
        NOW,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("code");
    });

    it("rejects duplicate workspace code within tenant (Section DB)", () => {
      const existing = createWorkspace(
        {
          tenantId: TENANT_A,
          name: "A",
          code: "EXIST",
          type: "institution",
          creatorId: "u",
          now: NOW,
        },
        [],
        NOW,
      );
      expect(existing.ok).toBe(true);

      const result = createWorkspace(
        {
          tenantId: TENANT_A,
          name: "B",
          code: "EXIST",
          type: "institution",
          creatorId: "u",
          now: NOW,
        },
        existing.ok ? [existing.workspace] : [],
        NOW,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("already exists");
    });

    it("rejects cross-tenant lifecycle change (Section GU)", () => {
      const ws = makeWorkspace();
      const result = changeWorkspaceLifecycle(
        {
          tenantId: TENANT_B,
          workspaceId: ws.id,
          to: "active",
          reason: null,
          actorId: "admin-2",
          now: NOW,
        },
        ws,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("different tenant");
    });

    it("allows draft → active activation", () => {
      const ws = makeWorkspace({ lifecycleState: "draft" });
      const result = changeWorkspaceLifecycle(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          to: "active",
          reason: null,
          actorId: "admin-1",
          now: NOW,
        },
        ws,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.workspace.lifecycleState).toBe("active");
        expect(result.auditEvent.type).toBe("WorkspaceActivated");
      }
    });

    it("requires reason for suspension (Section M)", () => {
      const ws = makeWorkspace({ lifecycleState: "active" });
      const result = changeWorkspaceLifecycle(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          to: "suspended",
          reason: null,
          actorId: "admin-1",
          now: NOW,
        },
        ws,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("reason");
    });

    it("suspends a workspace with reason and audit", () => {
      const ws = makeWorkspace({ lifecycleState: "active" });
      const result = changeWorkspaceLifecycle(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          to: "suspended",
          reason: "Policy hold",
          actorId: "admin-1",
          now: NOW,
        },
        ws,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.workspace.lifecycleState).toBe("suspended");
        expect(result.workspace.suspensionReason).toBe("Policy hold");
        expect(result.auditEvent.type).toBe("WorkspaceSuspended");
      }
    });

    it("blocks direct draft → deleted with no reason (Section O)", () => {
      const ws = makeWorkspace({ lifecycleState: "draft" });
      const result = changeWorkspaceLifecycle(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          to: "deleted",
          reason: null,
          actorId: "admin-1",
          now: NOW,
        },
        ws,
      );
      expect(result.ok).toBe(false);
    });

    it("enforces lifecycle transition rules", () => {
      expect(isWorkspaceLifecycleTransitionAllowed("draft", "active").allowed).toBe(true);
      expect(isWorkspaceLifecycleTransitionAllowed("suspended", "deleted").allowed).toBe(true);
      expect(isWorkspaceLifecycleTransitionAllowed("archived", "active").allowed).toBe(true);
      expect(isWorkspaceLifecycleTransitionAllowed("active", "draft").allowed).toBe(false);
    });

    it("validates workspace for activation (required modules/nav/default page)", () => {
      const ws = makeWorkspace({
        lifecycleState: "draft",
        moduleIds: [moduleId(`${CURRENT_WS}:academic`)],
      });
      expect(
        validateWorkspaceForActivation(ws, [moduleId(`${CURRENT_WS}:academic`)], true, true).ok,
      ).toBe(true);
      expect(validateWorkspaceForActivation(ws, [], true, true).ok).toBe(false);
      expect(
        validateWorkspaceForActivation(ws, [moduleId(`${CURRENT_WS}:academic`)], false, true).ok,
      ).toBe(false);
    });

    it("provisions an idempotent default workspace (Section HA)", () => {
      const existing: Workspace[] = [];
      const first = provisionDefaultWorkspace(
        {
          tenantId: TENANT_A,
          workspaceType: "institution",
          role: "",
          actorId: "admin-1",
          now: NOW,
        },
        existing,
      );
      expect(first.ok).toBe(true);

      const second = provisionDefaultWorkspace(
        {
          tenantId: TENANT_A,
          workspaceType: "institution",
          role: "",
          actorId: "admin-1",
          now: NOW,
        },
        first.ok ? [first.workspace] : [],
      );
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.created).toBe(false);
    });

    it("switches workspace context with authorization (Section BY)", () => {
      const from = {
        tenantId: TENANT_A,
        workspaceId: workspaceId("tenant-a:current"),
        workspaceName: "Current",
        workspaceType: "institution" as const,
        actorId: "admin-1",
        accessibleWorkspaceIds: [CURRENT_WS],
        activePageId: null,
        isCrossTenantSwitch: false,
      };
      const to = makeWorkspace();
      const ok = switchWorkspaceContext(from, to, "admin-1", [to.id]);
      expect(ok.ok).toBe(true);
      if (ok.ok) expect(ok.context.workspaceId).toBe(to.id);
    });

    it("blocks unauthorized workspace switch", () => {
      const from = {
        tenantId: TENANT_A,
        workspaceId: workspaceId("tenant-a:current"),
        workspaceName: "Current",
        workspaceType: "institution" as const,
        actorId: "admin-1",
        accessibleWorkspaceIds: [],
        activePageId: null,
        isCrossTenantSwitch: false,
      };
      const to = makeWorkspace();
      expect(switchWorkspaceContext(from, to, "admin-1", []).ok).toBe(false);
    });

    it("searches workspaces within tenant only (Section HH)", () => {
      const wsA = makeWorkspace();
      const wsB = makeWorkspace({
        id: workspaceId("tenant-b:other"),
        tenantId: TENANT_B,
        workspaceId: workspaceId("tenant-b:other"),
        name: "Other",
        code: "OTHER",
      });

      const results = searchWorkspaces({ tenantId: TENANT_A, query: "admin" }, [wsA, wsB]);
      expect(results).toHaveLength(1);
      expect(results[0].workspaceId).toBe(wsA.id);
    });

    it("evaluates workspace health correctly (Section HK)", () => {
      const healthy = evaluateWorkspaceHealth(
        CURRENT_WS,
        true,
        [],
        [{ capabilityName: "academic", available: true, enabled: true }],
      );
      expect(healthy.overallStatus).toBe("healthy");

      const degraded = evaluateWorkspaceHealth(
        CURRENT_WS,
        true,
        [],
        [
          { capabilityName: "finance", available: false, enabled: false },
          { capabilityName: "academic", available: true, enabled: true },
        ],
      );
      expect(degraded.overallStatus).toBe("degraded");

      const unhealthy = evaluateWorkspaceHealth(
        CURRENT_WS,
        true,
        [],
        [{ capabilityName: "academic", available: false, enabled: true }],
      );
      expect(unhealthy.overallStatus).toBe("unhealthy");
    });
  });

  describe("Workspace membership & roles (Sections P–U)", () => {
    it("adds a member with audit event (Section P)", () => {
      const ws = makeWorkspace();
      const result = addWorkspaceMember(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          identityId: "user-1",
          role: "viewer",
          actorId: "admin-1",
          now: NOW,
        },
        [],
        makeRoleDefinitions(),
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.membership.role).toBe("viewer");
        expect(result.membership.isActive).toBe(true);
        expect(result.auditEvent.type).toBe("WorkspaceMemberAdded");
      }
    });

    it("rejects duplicate active members", () => {
      const ws = makeWorkspace();
      const result = addWorkspaceMember(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          identityId: "user-1",
          role: "viewer",
          actorId: "admin-1",
          now: NOW,
        },
        [makeMember("user-1", "viewer")],
        makeRoleDefinitions(),
      );
      expect(result.ok).toBe(false);
    });

    it("changes a member role with audit (Section R)", () => {
      const ws = makeWorkspace();
      const member = makeMember("user-1", "viewer");
      const result = changeWorkspaceMemberRole(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          membershipId: member.id,
          newRole: "editor",
          actorId: "admin-1",
          now: NOW,
        },
        member,
        () => true,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.membership.role).toBe("editor");
        expect(result.auditEvent.type).toBe("WorkspaceRoleChanged");
      }
    });

    it("cannot assign a role the actor does not possess (Section DW)", () => {
      const ws = makeWorkspace();
      const member = makeMember("user-1", "viewer");
      const result = changeWorkspaceMemberRole(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          membershipId: member.id,
          newRole: "manager",
          actorId: "viewer",
          now: NOW,
        },
        member,
        () => false,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("cannot assign");
    });

    it("blocks owner demotion through ordinary role change", () => {
      const ws = makeWorkspace();
      const member = makeMember("owner-1", "owner");
      const result = changeWorkspaceMemberRole(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          membershipId: member.id,
          newRole: "viewer",
          actorId: "admin-1",
          now: NOW,
        },
        member,
        () => true,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("ownership transfer");
    });

    it("removes a member with audit (Section Q)", () => {
      const ws = makeWorkspace();
      const member = makeMember("user-1", "viewer");
      const result = removeWorkspaceMember(TENANT_A, ws.id, member, "admin-1", NOW);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.membership.state).toBe("removed");
        expect(result.membership.isActive).toBe(false);
        expect(result.auditEvent.type).toBe("WorkspaceMemberRemoved");
      }
    });

    it("cannot remove the owner", () => {
      const ws = makeWorkspace();
      expect(
        removeWorkspaceMember(TENANT_A, ws.id, makeMember("owner-1", "owner"), "admin-1", NOW).ok,
      ).toBe(false);
    });

    it("sends an invitation with future expiration (Section T)", () => {
      const ws = makeWorkspace();
      const result = sendWorkspaceInvitation(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          inviterId: "admin-1",
          inviteeId: "user-9",
          intendedRole: "editor",
          expiresAt: "2026-09-01T00:00:00.000Z",
          now: NOW,
        },
        [],
        [],
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.invitation.status).toBe("pending");
        expect(result.auditEvent.type).toBe("WorkspaceInvitationSent");
      }
    });

    it("rejects an invitation with past expiration", () => {
      const ws = makeWorkspace();
      const result = sendWorkspaceInvitation(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          inviterId: "admin-1",
          inviteeId: "user-9",
          intendedRole: "editor",
          expiresAt: "2020-01-01T00:00:00.000Z",
          now: NOW,
        },
        [],
        [],
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("future");
    });

    it("accepts an invitation and creates membership (Section T)", () => {
      const ws = makeWorkspace();
      const invitation = makeInvitation("user-9", "2026-09-01T00:00:00.000Z");
      const result = acceptWorkspaceInvitation(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          invitationId: invitation.id,
          acceptingIdentityId: "user-9",
          now: NOW_LATER,
        },
        invitation,
        [],
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.invitation.status).toBe("accepted");
        expect(result.membership.role).toBe("editor");
        expect(result.auditEvent.type).toBe("WorkspaceInvitationAccepted");
      }
    });

    it("cannot accept an expired invitation", () => {
      const ws = makeWorkspace();
      const invitation = makeInvitation("user-1", "2020-01-01T00:00:00.000Z");
      expect(
        acceptWorkspaceInvitation(
          {
            tenantId: TENANT_A,
            workspaceId: ws.id,
            invitationId: invitation.id,
            acceptingIdentityId: "user-1",
            now: NOW,
          },
          invitation,
          [],
        ).ok,
      ).toBe(false);
    });

    it("enforces access decisions by role (Sections DO, DR)", () => {
      const ws = makeWorkspace();
      const viewer = makeMember("viewer", "viewer");
      const admin = makeMember("admin", "administrator");

      expect(
        evaluateWorkspaceAccess(
          {
            tenantId: TENANT_A,
            workspaceId: ws.id,
            identityId: "viewer",
            requiredCapability: "read",
          },
          viewer,
        ).decision,
      ).toBe("ALLOW");
      expect(
        evaluateWorkspaceAccess(
          {
            tenantId: TENANT_A,
            workspaceId: ws.id,
            identityId: "viewer",
            requiredCapability: "write",
          },
          viewer,
        ).decision,
      ).toBe("DENY");
      expect(
        evaluateWorkspaceAccess(
          {
            tenantId: TENANT_A,
            workspaceId: ws.id,
            identityId: "admin",
            requiredCapability: "manage_lifecycle",
          },
          admin,
        ).decision,
      ).toBe("ALLOW");
    });

    it("denies access when membership is not active", () => {
      const ws = makeWorkspace();
      const inactive: WorkspaceMembership = {
        id: workspaceMembershipId(`${ws.id}:user-1`),
        tenantId: TENANT_A,
        workspaceId: ws.id,
        identityId: "user-1",
        role: "editor",
        state: "suspended",
        isActive: false,
        dataClassification: "TENANT_INTERNAL",
        createdAt: NOW,
        updatedAt: NOW,
      };
      expect(
        evaluateWorkspaceAccess(
          {
            tenantId: TENANT_A,
            workspaceId: ws.id,
            identityId: "user-1",
            requiredCapability: "read",
          },
          inactive,
        ).decision,
      ).toBe("DENY");
    });
  });

  describe("Workspace composition (Sections Y–AA, AH–BF)", () => {
    it("creates a page with audit (Section AD)", () => {
      const ws = makeWorkspace();
      const result = createPage(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          key: "dashboard",
          title: "Dashboard",
          actorId: "admin-1",
          now: NOW,
        },
        [],
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.page.key).toBe("dashboard");
        expect(result.auditEvent.type).toBe("WorkspaceNavigationChanged");
      }
    });

    it("rejects duplicate page key", () => {
      const ws = makeWorkspace();
      expect(
        createPage(
          {
            tenantId: TENANT_A,
            workspaceId: ws.id,
            key: "dashboard",
            title: "Dashboard",
            actorId: "admin-1",
            now: NOW,
          },
          [makePage("dashboard")],
        ).ok,
      ).toBe(false);
    });

    it("creates a dashboard (Section AH)", () => {
      const ws = makeWorkspace();
      const result = createDashboard(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          name: "Operations",
          actorId: "admin-1",
          now: NOW,
        },
        [],
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.dashboard.name).toBe("Operations");
    });

    it("enables then disables a module (Section AA)", () => {
      const ws = makeWorkspace();
      const enabled = enableModule("academic", "Academic", TENANT_A, ws.id, "admin-1", NOW);
      expect(enabled.ok).toBe(true);
      if (!enabled.ok) return;

      expect(enabled.module.status).toBe("enabled");

      const disabled = disableModule(TENANT_A, ws.id, enabled.module, "admin-1", NOW_LATER);
      expect(disabled.ok).toBe(true);
      if (disabled.ok) expect(disabled.module.status).toBe("disabled");
    });

    it("creates a view (Section BD)", () => {
      const ws = makeWorkspace();
      const result = createView(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          name: "Active Students",
          scope: "private",
          creatorId: "admin-1",
          ownerId: "admin-1",
          viewType: "table",
          now: NOW,
        },
        [],
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.view.version).toBe(1);
        expect(result.view.columns).toEqual([]);
        expect(result.auditEvent.type).toBe("WorkspaceViewCreated");
      }
    });

    it("shares a view only with publish permission (Section BE)", () => {
      const view = makeView("Shared");
      const denied = shareView(view, { type: "workspace", ref: CURRENT_WS }, "admin-1", false, NOW);
      expect(denied.ok).toBe(false);

      const allowed = shareView(view, { type: "department", ref: "dept-1" }, "admin-1", true, NOW);
      expect(allowed.ok).toBe(true);
      if (allowed.ok) {
        expect(allowed.view.scope).toBe("department");
        expect(allowed.view.version).toBe(2);
      }
    });

    it("creates a card", () => {
      expect(createCard(TENANT_A, CURRENT_WS, "Summary", NOW).ok).toBe(true);
    });

    it("personalizes a widget instance (Section AY)", () => {
      const ws = makeWorkspace();
      const instance: WidgetInstance = {
        id: widgetInstanceId("tenant-a:widget:1"),
        tenantId: TENANT_A,
        workspaceId: ws.id,
        widgetTypeId: widgetTypeId("revenue"),
        region: "top",
        settings: {},
        createdAt: NOW,
        updatedAt: NOW,
      };
      const result = personalizeWidgetInstance(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          identityId: "admin-1",
          widgetInstanceId: instance.id,
          settings: { density: "compact" },
        },
        instance,
        NOW_LATER,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.instance.settings).toMatchObject({ density: "compact" });
    });

    it("rejects personalization across tenant (Section AZ)", () => {
      const instance: WidgetInstance = {
        id: widgetInstanceId("tenant-a:widget:1"),
        tenantId: TENANT_A,
        workspaceId: CURRENT_WS,
        widgetTypeId: widgetTypeId("reports"),
        region: "top",
        settings: {},
        createdAt: NOW,
        updatedAt: NOW,
      };
      expect(
        personalizeWidgetInstance(
          {
            tenantId: TENANT_B,
            workspaceId: CURRENT_WS,
            identityId: "x",
            widgetInstanceId: instance.id,
            settings: {},
          },
          instance,
          NOW,
        ).ok,
      ).toBe(false);
    });

    it("validates layout breakpoints and spans (Sections AT–AX)", () => {
      const validLayout: WorkspaceLayout = {
        id: layoutId("tenant-a:main"),
        tenantId: TENANT_A,
        workspaceId: CURRENT_WS,
        name: "Main",
        regions: [{ id: "header", order: 0, span: 12, slots: [] }],
        breakpoints: new Map([
          ["sm", "640"],
          ["md", "768"],
          ["lg", "1024"],
          ["xl", "1280"],
        ]),
        isValid: true,
        validationIssues: [],
        createdAt: NOW,
        updatedAt: NOW,
      };
      expect(validateLayout(validLayout).isValid).toBe(true);

      const invalidLayout: WorkspaceLayout = {
        ...validLayout,
        id: layoutId("tenant-a:broken"),
        regions: [{ id: "wide", order: 0, span: 20, slots: [] }],
        breakpoints: new Map([
          ["sm", "1280"],
          ["md", "640"],
          ["lg", "1024"],
          ["xl", "1280"],
        ]),
      };
      const result = validateLayout(invalidLayout);
      expect(result.isValid).toBe(false);
      expect(result.issues.some((i) => i.includes("invalid span"))).toBe(true);
    });

    it("restricts filters to approved fields (Section BH)", () => {
      const filter: FilterDefinition = {
        id: filterId("f1"),
        field: "status",
        operator: "eq",
        value: "active",
      };
      expect(areFiltersOnApprovedFields([filter], ["status", "level"])).toBe(true);
      expect(areFiltersOnApprovedFields([{ ...filter, field: "password" }], ["status"])).toBe(
        false,
      );
    });

    it("restricts sorting to approved fields (Section BI)", () => {
      expect(
        areSortFieldsApproved([{ field: "name", direction: "asc" }], ["name", "createdAt"]),
      ).toBe(true);
      expect(areSortFieldsApproved([{ field: "privateNote", direction: "desc" }], ["name"])).toBe(
        false,
      );
    });

    it("resolves template overrides deterministically (Section CL)", () => {
      expect(
        resolveTemplateValueFromOverrides("base", [{ key: "layout", value: "grid12" }], "layout"),
      ).toEqual({ ok: true, value: "grid12" });
      expect(resolveTemplateValueFromOverrides("base", [], "layout")).toEqual({
        ok: true,
        value: "base",
      });
    });

    it("saves a personalized view (Section AY)", () => {
      const ws = makeWorkspace();
      const result = savePersonalizedView(
        {
          tenantId: TENANT_A,
          workspaceId: ws.id,
          identityId: "admin-1",
          name: "My View",
          targetRef: { type: "page", id: "dashboard" },
          filters: [],
          sorting: [],
          grouping: [],
          isDefault: false,
          visible: true,
          now: NOW,
        },
        [],
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.savedView.visible).toBe(true);
      }
    });
  });

  describe("Workspace governance (Sections CM–CQ, CC–CD, GE)", () => {
    it("validates workspace policy (Section CM)", () => {
      const policy: WorkspaceConfigurationPolicy = {
        tenantId: TENANT_A,
        workspaceId: CURRENT_WS,
        allowedModuleKeys: ["academic", "finance"],
        allowedWidgetKeys: ["attendance"],
        defaultLayoutKey: "main",
        allowedIntegrationKeys: ["paystack"],
        maxWidgetsPerDashboard: 20,
        allowPersonalization: true,
        allowSharedViews: true,
        allowCustomModules: false,
      };
      expect(
        validateWorkspacePolicy(policy, ["academic", "finance"], ["attendance"], ["paystack"]).ok,
      ).toBe(true);

      const invalid = validateWorkspacePolicy(policy, ["academic"], ["attendance"], ["paystack"]);
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.errors.some((e) => e.includes("finance"))).toBe(true);
    });

    it("creates a configuration snapshot with audit (Section CC)", () => {
      const ws = makeWorkspace();
      const result = createConfigurationSnapshot(
        TENANT_A,
        ws,
        {
          lifecycleState: "active",
          moduleIds: [],
          pages: [],
          dashboards: [],
          navigation: [],
          layout: [],
          views: [],
          configVersion: 1,
        },
        "pre-release",
        "admin-1",
        NOW,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.snapshot.version).toBe(1);
        expect(result.snapshot.isCurrent).toBe(true);
        expect(result.auditEvent.type).toBe("WorkspaceSnapshotCreated");
      }
    });

    it("records configuration version entries (Section CD)", () => {
      const ws = makeWorkspace();
      const result = recordConfigVersion(
        TENANT_A,
        ws.id,
        2,
        "admin-1",
        "Added finance module",
        NOW,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.entry.version).toBe(2);
        expect(result.entry.changeSummary).toBe("Added finance module");
        expect(result.auditEvent.type).toBe("WorkspaceConfigVersioned");
      }
    });

    it("filters workspace audit events (Section CP)", () => {
      const events: WorkspaceAuditEvent[] = [
        makeAuditEvent(),
        { ...makeAuditEvent(), id: "audit-2" },
        { ...makeAuditEvent(), id: "audit-3", tenantId: TENANT_B },
      ];

      const result = filterWorkspaceAuditEvents(events, {
        tenantId: TENANT_A,
        workspaceId: CURRENT_WS,
        eventTypes: ["WorkspaceCreated"],
      });
      expect(result.map((e) => e.id)).toEqual(["audit-evt-1", "audit-2"]);
    });

    it("resolves catalog inheritance without cross-tenant leakage (Section GE)", () => {
      const inherited = resolveCatalogInheritance(TENANT_A, CURRENT_WS, {
        modules: [],
        dashboards: [],
        pages: [],
        views: [],
      });
      expect(inherited.modules).toEqual([]);
      expect(inherited.dashboards).toEqual([]);
      expect(inherited.pages).toEqual([]);
      expect(inherited.views).toEqual([]);
    });
  });
});

function makeAuditEvent(): WorkspaceAuditEvent {
  return {
    id: "audit-evt-1",
    type: "WorkspaceCreated",
    tenantId: TENANT_A,
    workspaceId: CURRENT_WS,
    actorId: "admin-1",
    occurredAt: NOW,
    result: "success",
    metadata: {},
  };
}
