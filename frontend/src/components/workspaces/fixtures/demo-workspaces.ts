import { computeWorkspace, type WorkspaceManifest } from "@/lib/sherivs-ws/engine";
import roleTemplates from "@/lib/sherivs-ws/role-templates.data";

export const DEMO_WORKSPACE_ROLES = [
  { key: "teacher", label: "Teacher", template: "teacher" },
  { key: "bursar", label: "Bursar", template: "bursar" },
  { key: "principal", label: "Principal", template: "head_of_institution" },
  { key: "parent", label: "Parent", template: "parent" },
  { key: "government-officer", label: "Government officer", template: "regulator_inspector" },
] as const;

const DEMO_ORGANIZATION = {
  id: "demo-school-a",
  name: "Demo School A",
  plan: "demo",
  features: [
    "core",
    "sms",
    "ai",
    "cbt",
    "wallet",
    "payroll",
    "library",
    "hostel",
    "health",
    "transport",
  ],
};

function demoManifest(role: (typeof DEMO_WORKSPACE_ROLES)[number]): WorkspaceManifest {
  const assignedScopes: Record<string, string[]> =
    role.key === "teacher"
      ? { campus: ["demo-campus-north", "demo-campus-south"] }
      : role.key === "parent"
        ? { campus: ["demo-campus-south"] }
        : {};
  const permissions = (roleTemplates[role.template] ?? [])
    .filter(([, kind, on]) => kind === "m" || on)
    .map(([code]) => ({
      code,
      scopes: [
        {
          type: "org",
          ref: DEMO_ORGANIZATION.id,
          ...(Object.keys(assignedScopes).length ? { dims: assignedScopes } : {}),
        },
      ],
    }));

  return computeWorkspace({
    org: DEMO_ORGANIZATION,
    roles: [{ code: `demo.${role.key}`, template: role.template, name: role.label }],
    permissions,
  });
}

export const DEMO_WORKSPACE_MANIFESTS = Object.fromEntries(
  DEMO_WORKSPACE_ROLES.map((role) => [role.key, demoManifest(role)]),
) as Record<(typeof DEMO_WORKSPACE_ROLES)[number]["key"], WorkspaceManifest>;

export const DEMO_WORKSPACE_NOTIFICATIONS = [
  {
    title: "Demo reminder",
    message: "This synthetic reminder is only for workspace preview.",
    unread: true,
  },
  {
    title: "Demo update",
    message: "No real learner or institution records are included.",
    unread: false,
  },
] as const;

export const DEMO_WORKSPACE_RECENT = [
  { title: "Demo attendance view", label: "Synthetic recent item" },
  { title: "Demo timetable view", label: "Synthetic recent item" },
] as const;
