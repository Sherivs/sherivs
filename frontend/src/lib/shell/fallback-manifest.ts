import type { AppRole } from "@/lib/roles";
import { computeWorkspace, type WorkspaceManifest } from "@/lib/sherivs-ws/engine";
import templates from "@/lib/sherivs-ws/role-templates.data";
import { templateForAppRole } from "./role-template";

const PLAN_FEATURES = ["core", "sms", "whatsapp", "ai"];
const MODULES = ["cbt", "wallet", "payroll", "library", "hostel", "health", "transport"];

export function fallbackManifest(input: {
  organizationId: string;
  organizationName: string;
  role: AppRole;
}): WorkspaceManifest {
  const template = templateForAppRole(input.role);
  const perms = new Map<string, { type: string; ref: string | null }[]>();
  for (const [code, kind, on] of templates[template] ?? templates.support_staff ?? []) {
    if (kind === "o" && !on) continue;
    perms.set(code, [{ type: "org", ref: null }]);
  }
  return computeWorkspace({
    org: {
      id: input.organizationId,
      name: input.organizationName,
      plan: "growth",
      features: [...PLAN_FEATURES, ...MODULES],
    },
    roles: [{ code: `legacy.${input.role}`, template, name: input.role }],
    permissions: [...perms].map(([code, scopes]) => ({ code, scopes })),
  });
}
