/**
 * Data port for the M4 builder screens (ADR-116). One implementation talks to Supabase with the
 * CALLER's JWT (never the service role): every write is a SECURITY DEFINER function that reads
 * `auth.uid()` and `get_my_school_id()`, so four-eyes, the organization and the audit actor are
 * decided by the database. Tests use an in-memory fake with the same contract.
 */
import {
  RoleBuilderError,
  mapDatabaseError,
  type BuilderCatalogue,
  type CataloguePermission,
  type CatalogueResponsibility,
  type CatalogueTemplate,
  type CustomRoleDraftInput,
  type ResponsibilityInput,
  type RoleLayout,
  type ScopeCeiling,
} from "./role-builder-core";

export interface CallerContext {
  userId: string;
  orgId: string | null;
  isAdmin: boolean;
}

export type CustomRoleStatus = "draft" | "pending_approval" | "active" | "retired";
export interface CustomRoleVersion {
  id: string;
  code: string;
  name: string;
  version: number;
  status: CustomRoleStatus;
  baseTemplate: string | null;
  permissions: string[];
  responsibilities: string[];
  scopeCeiling: ScopeCeiling;
  workspaceCategory: string;
  layout: RoleLayout;
  createdBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AuditEntry {
  recordId: string;
  action: string;
  actor: string | null;
  at: string;
}

export interface RoleBuilderPort {
  caller(): Promise<CallerContext>;
  loadCatalogue(orgId: string): Promise<BuilderCatalogue>;
  listVersions(orgId: string): Promise<CustomRoleVersion[]>;
  auditFor(orgId: string, recordIds: string[]): Promise<AuditEntry[]>;
  saveDraft(draft: CustomRoleDraftInput & { code: string }): Promise<string>;
  submit(id: string): Promise<void>;
  withdraw(id: string): Promise<void>;
  approve(id: string): Promise<void>;
  activate(id: string): Promise<string>;
  defineResponsibility(input: ResponsibilityInput): Promise<string>;
}

// ---------------------------------------------------------------------------
// Supabase implementation (user JWT)
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string } | null };
type Query = PromiseLike<Result> & {
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  is(column: string, value: null): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
};
export interface UserClient {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<Result>;
}

function rows(result: Result): Row[] {
  if (result.error) throw mapDatabaseError(result.error);
  return Array.isArray(result.data)
    ? result.data.filter((r): r is Row => typeof r === "object" && r !== null)
    : [];
}
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown) => (typeof v === "string" ? v : null);
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

async function rpc(client: UserClient, name: string, args?: Record<string, unknown>) {
  const result = await client.rpc(name, args);
  if (result.error) throw mapDatabaseError(result.error);
  return result.data;
}

export async function resolveCaller(client: UserClient, userId: string): Promise<CallerContext> {
  if (!userId) throw new RoleBuilderError("UNAUTHENTICATED", "Sign in again.");
  const orgId = strOrNull(await rpc(client, "get_my_school_id"));
  if (!orgId) return { userId, orgId: null, isAdmin: false };
  const isAdmin = (await rpc(client, "can_administer_org", { p_org: orgId })) === true;
  return { userId, orgId, isAdmin };
}

function toVersion(row: Row): CustomRoleVersion {
  const layout = (row.layout ?? {}) as Partial<RoleLayout>;
  return {
    id: str(row.id),
    code: str(row.code),
    name: str(row.name),
    version: Number(row.version),
    status: str(row.status) as CustomRoleStatus,
    baseTemplate: strOrNull(row.base_template_code),
    permissions: list(row.permissions),
    responsibilities: list(row.responsibilities),
    scopeCeiling: str(row.scope_ceiling) as ScopeCeiling,
    workspaceCategory: str(row.workspace_category),
    layout: {
      nav: Array.isArray(layout.nav) ? layout.nav : [],
      widgets: Array.isArray(layout.widgets) ? layout.widgets : [],
    },
    createdBy: str(row.created_by),
    approvedBy: strOrNull(row.approved_by),
    approvedAt: strOrNull(row.approved_at),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export function supabaseRoleBuilderPort(client: UserClient, userId: string): RoleBuilderPort {
  return {
    caller: () => resolveCaller(client, userId),
    async loadCatalogue(orgId) {
      const [perms, templates, templatePerms, sod, roles, profile, resp, respPerms] =
        await Promise.all([
          client.from("permission_catalog").select("code,label,module,sensitivity,protected"),
          client.from("role_templates").select("code,default_scope,workspace_mode,nav_sections"),
          client.from("role_template_permissions").select("template_code,permission_code,kind"),
          client.from("sod_permission_rules").select("permission_a,permission_b,description"),
          client.from("role_catalog").select("template_code,institution_types").is("org_id", null),
          client
            .from("institution_profile")
            .select("institution_type")
            .eq("org_id", orgId)
            .is("effective_to", null)
            .limit(1),
          client
            .from("workspace_responsibility_catalog")
            .select("id,org_id,code,label,kind,description,evidence_required,review_cadence_days")
            .order("code"),
          client.from("workspace_responsibility_permissions").select("responsibility_id,permission_code"),
        ]);
      const institutionType = strOrNull(rows(profile)[0]?.institution_type);
      const permissions: CataloguePermission[] = rows(perms).map((r) => ({
        code: str(r.code),
        label: str(r.label),
        module: str(r.module),
        sensitivity: str(r.sensitivity) as CataloguePermission["sensitivity"],
        protected: r.protected === true,
      }));
      const tp = rows(templatePerms);
      const roleRows = rows(roles);
      const allowedTemplateCodes = new Set(
        roleRows
          .filter((r) => !institutionType || list(r.institution_types).includes(institutionType))
          .map((r) => str(r.template_code)),
      );
      const templateList: CatalogueTemplate[] = rows(templates)
        .filter((t) => allowedTemplateCodes.has(str(t.code)))
        .map((t) => ({
          code: str(t.code),
          scope: str(t.default_scope) as ScopeCeiling,
          mandatory: tp
            .filter((p) => p.template_code === t.code && p.kind === "mandatory")
            .map((p) => str(p.permission_code)),
          optional: tp
            .filter((p) => p.template_code === t.code && p.kind === "optional")
            .map((p) => str(p.permission_code)),
          nav: list(t.nav_sections),
          workspaceMode: (str(t.workspace_mode) || "full") as CatalogueTemplate["workspaceMode"],
        }))
        .sort((a, b) => a.code.localeCompare(b.code));
      const protectedSet = new Set(permissions.filter((p) => p.protected).map((p) => p.code));
      const allowedPermissions = [
        ...new Set(templateList.flatMap((t) => [...t.mandatory, ...t.optional])),
      ]
        .filter((code) => !protectedSet.has(code))
        .sort();
      const rp = rows(respPerms);
      const responsibilities: CatalogueResponsibility[] = rows(resp)
        .filter((r) => !str(r.code).startsWith("nav."))
        .map((r) => ({
          id: str(r.id),
          code: str(r.code),
          label: str(r.label),
          kind: str(r.kind) as CatalogueResponsibility["kind"],
          permissions: rp.filter((p) => p.responsibility_id === r.id).map((p) => str(p.permission_code)),
          description: strOrNull(r.description),
          evidenceRequired: list(r.evidence_required),
          reviewCadenceDays: typeof r.review_cadence_days === "number" ? r.review_cadence_days : null,
        }));
      return {
        institutionType,
        templates: templateList,
        permissions,
        allowedPermissions,
        sodRules: rows(sod).map((r) => ({
          a: str(r.permission_a),
          b: str(r.permission_b),
          description: str(r.description),
        })),
        responsibilities,
      };
    },
    async listVersions(orgId) {
      const result = await client
        .from("org_custom_roles")
        .select(
          "id,code,name,version,status,base_template_code,permissions,responsibilities,scope_ceiling,workspace_category,layout,created_by,approved_by,approved_at,created_at,updated_at",
        )
        .eq("org_id", orgId)
        .order("code")
        .order("version", { ascending: false });
      return rows(result).map(toVersion);
    },
    async auditFor(orgId, recordIds) {
      if (recordIds.length === 0) return [];
      const result = await client
        .from("audit_logs")
        .select("record_id,action,user_id,created_at")
        .eq("school_id", orgId)
        .in("record_id", recordIds)
        .order("created_at", { ascending: false });
      return rows(result).map((r) => ({
        recordId: str(r.record_id),
        action: str(r.action),
        actor: strOrNull(r.user_id),
        at: str(r.created_at),
      }));
    },
    async saveDraft(draft) {
      return str(
        await rpc(client, "custom_role_save_draft", {
          p_code: draft.code,
          p_name: draft.name,
          p_base_template: draft.baseTemplate,
          p_permissions: draft.permissions,
          p_responsibilities: draft.responsibilities,
          p_scope_ceiling: draft.scopeCeiling,
          p_workspace_category: draft.workspaceCategory,
          p_layout: draft.layout,
        }),
      );
    },
    async submit(id) {
      await rpc(client, "custom_role_submit", { p_id: id });
    },
    async withdraw(id) {
      await rpc(client, "custom_role_withdraw", { p_id: id });
    },
    async approve(id) {
      await rpc(client, "custom_role_approve", { p_id: id });
    },
    async activate(id) {
      return str(await rpc(client, "custom_role_activate", { p_id: id }));
    },
    async defineResponsibility(input) {
      return str(
        await rpc(client, "workspace_responsibility_define", {
          p_code: input.code,
          p_label: input.label,
          p_description: input.description,
          p_permissions: input.permissions,
          p_evidence_required: input.evidenceRequired,
          p_review_cadence_days: input.reviewCadenceDays,
          p_daily_priority: input.dailyPriority,
          p_primary_nav_id: input.navSection.id,
          p_primary_nav_label: input.navSection.label,
        }),
      );
    },
  };
}
