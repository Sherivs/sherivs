import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { useApp } from "@/contexts/app-context";
import { supabase } from "@/integrations/supabase/client";
import { resolveWorkspaceManifest } from "@/lib/workspaces/manifest-resolver";
import type {
  Responsibility,
  ResponsibilityGrant,
  RoleAssignment,
  RoleDelegation,
  RoleTemplate,
  RoleScopeType,
  WorkspaceCategory,
} from "@/lib/workspaces/contract";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_SHELL_HOME } from "@/lib/shell/paths";

type Row = Record<string, unknown>;
const EMPTY_ROWS: Row[] = [];
type QueryResult = { data: unknown; error: { message: string } | null };
type Query = PromiseLike<QueryResult> & {
  eq(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
};
type RoleManagementClient = {
  from(table: string): { select(columns: string): Query };
  rpc(name: string, args: Record<string, unknown>): Promise<QueryResult>;
};

const db = supabase as unknown as RoleManagementClient;
const CATEGORY: WorkspaceCategory = "institutional_executive";
const SCOPE_TYPES: RoleScopeType[] = [
  "class",
  "subject",
  "campus",
  "shift",
  "institution",
  "group",
];

function rowList(data: unknown): Row[] {
  return Array.isArray(data)
    ? data.filter((row): row is Row => typeof row === "object" && row !== null)
    : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function scope(value: unknown): RoleScopeType {
  return SCOPE_TYPES.includes(value as RoleScopeType) ? (value as RoleScopeType) : "institution";
}

function toLocalIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function RoleManagementScreen() {
  const app = useApp();
  const orgId = app.school?.id ?? "";
  const userId = app.profile?.id ?? "";
  const [rows, setRows] = useState<Record<string, Row[]>>({});
  const [canAssign, setCanAssign] = useState(false);
  const [canConfigure, setCanConfigure] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [roleName, setRoleName] = useState("");
  const [roleBase, setRoleBase] = useState("");
  const [createdRole, setCreatedRole] = useState("");
  const [copiedRole, setCopiedRole] = useState(false);
  const [responsibilityRole, setResponsibilityRole] = useState("");
  const [responsibilityCode, setResponsibilityCode] = useState("");
  const [responsibilityLabel, setResponsibilityLabel] = useState("");
  const [responsibilityPriority, setResponsibilityPriority] = useState("100");
  const [responsibilityNav, setResponsibilityNav] = useState("");
  const [responsibilityNavLabel, setResponsibilityNavLabel] = useState("");
  const [responsibilityPermissions, setResponsibilityPermissions] = useState("");
  const [assignmentUser, setAssignmentUser] = useState("");
  const [assignmentRole, setAssignmentRole] = useState("");
  const [assignmentScope, setAssignmentScope] = useState<RoleScopeType>("institution");
  const [assignmentScopeRef, setAssignmentScopeRef] = useState("");
  const [assignmentStart, setAssignmentStart] = useState("");
  const [assignmentEnd, setAssignmentEnd] = useState("");
  const [assignmentTemporary, setAssignmentTemporary] = useState(false);
  const [grantAssignment, setGrantAssignment] = useState("");
  const [grantResponsibility, setGrantResponsibility] = useState("");
  const [grantStart, setGrantStart] = useState("");
  const [grantEnd, setGrantEnd] = useState("");
  const [delegateAssignment, setDelegateAssignment] = useState("");
  const [delegateUser, setDelegateUser] = useState("");
  const [delegateStart, setDelegateStart] = useState("");
  const [delegateEnd, setDelegateEnd] = useState("");

  const load = useCallback(async () => {
    if (!orgId || !userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const [assignPermission, configurePermission, ...results] = await Promise.all([
      db.rpc("can_manage_roles", { p_org: orgId, p_perm: "roles.assign" }),
      db.rpc("can_manage_roles", { p_org: orgId, p_perm: "roles.configure" }),
      db.from("role_catalog").select("code,name,category,template_code,org_id").order("name"),
      db
        .from("user_role_assignments")
        .select(
          "id,org_id,user_id,role_code,scope_type,scope_ref,status,started_at,valid_until,temporary,org_unit_id,evidence,restrictions",
        )
        .eq("org_id", orgId)
        .order("started_at", { ascending: false }),
      db
        .from("users")
        .select("id,full_name,email,school_id,is_active")
        .eq("school_id", orgId)
        .eq("is_active", true)
        .order("full_name"),
      db
        .from("workspace_org_units")
        .select("id,org_id,unit_type,code,name")
        .eq("org_id", orgId)
        .order("name"),
      db
        .from("workspace_responsibility_catalog")
        .select("id,org_id,code,label,kind,daily_priority,primary_nav_id,primary_nav_label")
        .order("code"),
      db
        .from("workspace_role_responsibilities")
        .select("org_id,role_code,responsibility_id")
        .eq("org_id", orgId),
      db.from("workspace_responsibility_permissions").select("responsibility_id,permission_code"),
      db
        .from("role_assignment_responsibility_grants")
        .select(
          "id,org_id,assignment_id,responsibility_id,valid_from,valid_until,granted_by,revoked_at",
        )
        .eq("org_id", orgId)
        .order("granted_at", { ascending: false }),
      db
        .from("role_assignment_delegations")
        .select(
          "id,org_id,assignment_id,delegate_user_id,valid_from,valid_until,created_by,revoked_at",
        )
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),
      db
        .from("role_assignment_audit_events")
        .select(
          "id,actor_user_id,target_user_id,target_type,target_id,action,scope_type,scope_ref,before_state,after_state,occurred_at",
        )
        .eq("org_id", orgId)
        .order("occurred_at", { ascending: false }),
    ]);
    setCanAssign(assignPermission.data === true);
    setCanConfigure(configurePermission.data === true);
    const names = [
      "role_catalog",
      "user_role_assignments",
      "users",
      "workspace_org_units",
      "workspace_responsibility_catalog",
      "workspace_role_responsibilities",
      "workspace_responsibility_permissions",
      "role_assignment_responsibility_grants",
      "role_assignment_delegations",
      "role_assignment_audit_events",
    ];
    const next: Record<string, Row[]> = {};
    let firstError = "";
    results.forEach((result, index) => {
      next[names[index]!] = rowList(result.data);
      if (result.error && !firstError) firstError = result.error.message;
    });
    if (firstError) setError(firstError);
    setRows(next);
    const roleOptions = next.role_catalog ?? [];
    setRoleBase((current) => current || text(roleOptions.find((row) => row.org_id == null)?.code));
    setAssignmentRole((current) => current || text(roleOptions[0]?.code));
    setResponsibilityRole((current) => current || text(roleOptions[0]?.code));
    setAssignmentUser(
      (current) => current || text(next.users?.find((row) => row.id !== userId)?.id),
    );
    setDelegateUser((current) => current || text(next.users?.find((row) => row.id !== userId)?.id));
    setLoading(false);
  }, [orgId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const roleByCode = useMemo(
    () => new Map((rows.role_catalog ?? []).map((row) => [text(row.code), row])),
    [rows.role_catalog],
  );
  const responsibilityById = useMemo(
    () => new Map((rows.workspace_responsibility_catalog ?? []).map((row) => [text(row.id), row])),
    [rows.workspace_responsibility_catalog],
  );
  const userById = useMemo(
    () => new Map((rows.users ?? []).map((row) => [text(row.id), row])),
    [rows.users],
  );
  const roles = rows.role_catalog ?? EMPTY_ROWS;
  const assignments = rows.user_role_assignments ?? EMPTY_ROWS;
  const responsibilityRows = rows.workspace_responsibility_catalog ?? EMPTY_ROWS;
  const addOnResponsibilities = responsibilityRows.filter((row) => row.kind === "add_on");

  const templates: RoleTemplate[] = useMemo(() => {
    const linked = rows.workspace_role_responsibilities ?? [];
    const permissionRows = rows.workspace_responsibility_permissions ?? [];
    return roles.map((role) => ({
      id: text(role.code),
      code: text(role.code),
      label: text(role.name) || text(role.code),
      category: CATEGORY,
      responsibilities: linked
        .filter((link) => link.role_code === role.code)
        .map((link) => responsibilityById.get(text(link.responsibility_id)))
        .filter((responsibility): responsibility is Row => Boolean(responsibility))
        .map((responsibility): Responsibility => ({
          id: text(responsibility.id),
          code: text(responsibility.code),
          label: text(responsibility.label),
          kind:
            responsibility.kind === "add_on" || responsibility.kind === "core"
              ? responsibility.kind
              : "custom",
          permissionCodes: permissionRows
            .filter((row) => row.responsibility_id === responsibility.id)
            .map((row) => text(row.permission_code)),
          dailyPriority: Number(responsibility.daily_priority),
          primaryNav: {
            id: text(responsibility.primary_nav_id),
            label: text(responsibility.primary_nav_label),
          },
        })),
      permissions: [],
      approvalAuthorities: [],
      reportingRelationships: [],
    }));
  }, [
    roles,
    responsibilityById,
    rows.workspace_responsibility_permissions,
    rows.workspace_role_responsibilities,
  ]);

  const manifest = useMemo(() => {
    if (!userId || !orgId) return null;
    const normalizedAssignments: RoleAssignment[] = assignments.map((row) => {
      const roleCode = text(row.role_code);
      return {
        id: text(row.id),
        tenantId: text(row.org_id),
        userId: text(row.user_id),
        roleTemplateId: roleCode,
        scopeType: scope(row.scope_type),
        scopeRef: typeof row.scope_ref === "string" ? row.scope_ref : null,
        validFrom: text(row.started_at),
        validUntil: typeof row.valid_until === "string" ? row.valid_until : null,
        temporary: row.temporary === true,
        orgUnitId: typeof row.org_unit_id === "string" ? row.org_unit_id : null,
        evidence: Array.isArray(row.evidence) ? row.evidence.map(String) : [],
        restrictions: Array.isArray(row.restrictions) ? row.restrictions.map(String) : [],
        status: row.status === "ended" || row.status === "suspended" ? row.status : "active",
      };
    });
    const grants: ResponsibilityGrant[] = (rows.role_assignment_responsibility_grants ?? []).map(
      (row) => ({
        id: text(row.id),
        assignmentId: text(row.assignment_id),
        responsibilityId: text(row.responsibility_id),
        validFrom: text(row.valid_from),
        validUntil: typeof row.valid_until === "string" ? row.valid_until : null,
        revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
      }),
    );
    const delegations: RoleDelegation[] = (rows.role_assignment_delegations ?? []).map((row) => ({
      id: text(row.id),
      assignmentId: text(row.assignment_id),
      delegateUserId: text(row.delegate_user_id),
      validFrom: text(row.valid_from),
      validUntil: text(row.valid_until),
      revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
    }));
    return resolveWorkspaceManifest(
      { id: userId },
      { id: orgId, category: CATEGORY },
      {
        assignments: normalizedAssignments,
        roleTemplates: templates,
        responsibilityGrants: grants,
        delegations,
      },
      new Date().toISOString(),
    );
  }, [
    assignments,
    orgId,
    rows.role_assignment_delegations,
    rows.role_assignment_responsibility_grants,
    templates,
    userId,
  ]);

  async function mutate(
    event: FormEvent<HTMLFormElement>,
    rpc: string,
    args: Record<string, unknown>,
    done: (data: unknown) => void = () => {},
  ) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const { data, error: rpcError } = await db.rpc(rpc, args);
    if (rpcError) {
      setError(rpcError.message);
    } else {
      done(data);
      setNotice("Change saved and audited.");
      await load();
    }
    setBusy(false);
  }

  async function copyRoleCode() {
    try {
      await navigator.clipboard.writeText(createdRole);
      setCopiedRole(true);
      window.setTimeout(() => setCopiedRole(false), 1500);
    } catch {
      setError("Unable to copy the role code from this browser.");
    }
  }

  if (loading) return <p role="status">Loading role access…</p>;

  return (
    <section className="app-shell-section" data-testid="role-management-screen">
      <Link to={APP_SHELL_HOME as never} className="app-shell-back">
        ← Home
      </Link>
      <div>
        <p className="app-shell-org">HR / Administration · {app.school?.name}</p>
        <h1>Roles and responsibilities</h1>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}
      <Card data-testid="workspace-manifest">
        <CardHeader>
          <CardTitle>Your current workspace manifest</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {manifest ? (
            <>
              <p className="text-sm text-muted-foreground">Primary navigation</p>
              <ul className="grid gap-1 pl-5 text-sm">
                {manifest.primaryNav.map((item) => (
                  <li key={item.id}>
                    {item.label} · {item.kind}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-muted-foreground">Assigned responsibilities</p>
              <ul className="grid gap-1 pl-5 text-sm" data-testid="manifest-responsibilities">
                {manifest.sidePanel.map((item) => (
                  <li key={item.responsibilityId} data-responsibility={item.responsibilityId}>
                    {item.label} · {item.kind}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="manifest-empty">
              No active assignment currently provides the three required navigation sections.
            </p>
          )}
        </CardContent>
      </Card>
      {!canAssign && !canConfigure ? (
        <Card>
          <CardContent className="p-5">
            Your current permissions do not allow role management.
          </CardContent>
        </Card>
      ) : (
        <>
          {canConfigure ? (
            <Card>
              <CardHeader>
                <CardTitle>Create a custom role</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="app-shell-form"
                  onSubmit={(event) =>
                    void mutate(
                      event,
                      "role_create_custom",
                      {
                        p_org: orgId,
                        p_base_role: roleBase,
                        p_name: roleName,
                      },
                      (data) => {
                        setRoleName("");
                        setCreatedRole(text(data));
                      },
                    )
                  }
                >
                  <Field label="Base role">
                    <select
                      className="w-full rounded-md border bg-background p-2"
                      aria-label="Base role"
                      value={roleBase}
                      onChange={(event) => setRoleBase(event.target.value)}
                    >
                      {roles
                        .filter((row) => row.org_id == null)
                        .map((row) => (
                          <option key={text(row.code)} value={text(row.code)}>
                            {text(row.name)}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Custom role name">
                    <Input
                      required
                      minLength={3}
                      value={roleName}
                      onChange={(event) => setRoleName(event.target.value)}
                    />
                  </Field>
                  <Button disabled={busy || !roleName || !roleBase} type="submit">
                    Create role
                  </Button>
                </form>
                {createdRole ? (
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-sm">Created role code:</span>
                    <code className="min-w-0 flex-1 break-all rounded bg-muted p-2 text-xs">
                      {createdRole}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={copiedRole ? "Role code copied" : "Copy role code"}
                      onClick={() => void copyRoleCode()}
                    >
                      <Copy aria-hidden="true" />
                      {copiedRole ? "Copied" : "Copy"}
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {canConfigure ? (
            <Card>
              <CardHeader>
                <CardTitle>Add custom responsibility</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  className="app-shell-form"
                  onSubmit={(event) =>
                    void mutate(
                      event,
                      "workspace_responsibility_create_custom",
                      {
                        p_org: orgId,
                        p_role: responsibilityRole,
                        p_code: responsibilityCode,
                        p_label: responsibilityLabel,
                        p_daily_priority: Number(responsibilityPriority),
                        p_primary_nav_id: responsibilityNav,
                        p_primary_nav_label: responsibilityNavLabel,
                        p_permissions: responsibilityPermissions
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      },
                      () => {
                        setResponsibilityCode("");
                        setResponsibilityLabel("");
                        setResponsibilityNav("");
                        setResponsibilityNavLabel("");
                        setResponsibilityPermissions("");
                      },
                    )
                  }
                >
                  <Field label="Role">
                    <select
                      className="w-full rounded-md border bg-background p-2"
                      aria-label="Responsibility role"
                      value={responsibilityRole}
                      onChange={(event) => setResponsibilityRole(event.target.value)}
                    >
                      {roles.map((row) => (
                        <option key={text(row.code)} value={text(row.code)}>
                          {text(row.name)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Responsibility code">
                    <Input
                      required
                      pattern="[a-z][a-z0-9_.-]{1,63}"
                      value={responsibilityCode}
                      onChange={(event) => setResponsibilityCode(event.target.value)}
                    />
                  </Field>
                  <Field label="Responsibility label">
                    <Input
                      required
                      minLength={2}
                      value={responsibilityLabel}
                      onChange={(event) => setResponsibilityLabel(event.target.value)}
                    />
                  </Field>
                  <Field label="Daily priority">
                    <Input
                      type="number"
                      min={0}
                      max={10000}
                      required
                      value={responsibilityPriority}
                      onChange={(event) => setResponsibilityPriority(event.target.value)}
                    />
                  </Field>
                  <Field label="Navigation section id">
                    <Input
                      required
                      pattern="[a-z][a-z0-9_.-]{1,63}"
                      value={responsibilityNav}
                      onChange={(event) => setResponsibilityNav(event.target.value)}
                    />
                  </Field>
                  <Field label="Navigation section label">
                    <Input
                      required
                      value={responsibilityNavLabel}
                      onChange={(event) => setResponsibilityNavLabel(event.target.value)}
                    />
                  </Field>
                  <Field label="Permission codes (comma-separated; protected grants are rejected)">
                    <Input
                      value={responsibilityPermissions}
                      onChange={(event) => setResponsibilityPermissions(event.target.value)}
                    />
                  </Field>
                  <Button disabled={busy || !responsibilityRole} type="submit">
                    Add responsibility
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : null}

          {canAssign ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Assign a role</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    className="app-shell-form"
                    onSubmit={(event) =>
                      void mutate(
                        event,
                        "workspace_role_assignment_create",
                        {
                          p_org: orgId,
                          p_user: assignmentUser,
                          p_role: assignmentRole,
                          p_scope_type: assignmentScope,
                          p_scope_ref:
                            assignmentScope === "institution" ? null : assignmentScopeRef || null,
                          p_started_at: toLocalIso(assignmentStart),
                          p_valid_until: toLocalIso(assignmentEnd),
                          p_temporary: assignmentTemporary,
                          p_org_unit_id: null,
                          p_evidence: [],
                          p_restrictions: [],
                        },
                        () => {
                          setAssignmentScopeRef("");
                          setAssignmentEnd("");
                        },
                      )
                    }
                  >
                    <Field label="Member">
                      <select
                        className="w-full rounded-md border bg-background p-2"
                        aria-label="Member"
                        value={assignmentUser}
                        onChange={(event) => setAssignmentUser(event.target.value)}
                      >
                        {(rows.users ?? [])
                          .filter((row) => row.id !== userId)
                          .map((row) => (
                            <option key={text(row.id)} value={text(row.id)}>
                              {text(row.full_name) || text(row.email) || text(row.id)}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Role">
                      <select
                        className="w-full rounded-md border bg-background p-2"
                        aria-label="Assignment role"
                        value={assignmentRole}
                        onChange={(event) => setAssignmentRole(event.target.value)}
                      >
                        {roles.map((row) => (
                          <option key={text(row.code)} value={text(row.code)}>
                            {text(row.name)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Scope">
                      <select
                        className="w-full rounded-md border bg-background p-2"
                        aria-label="Assignment scope"
                        value={assignmentScope}
                        onChange={(event) =>
                          setAssignmentScope(event.target.value as RoleScopeType)
                        }
                      >
                        {SCOPE_TYPES.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {assignmentScope !== "institution" ? (
                      <Field label="Scope reference">
                        <Input
                          required
                          value={assignmentScopeRef}
                          onChange={(event) => setAssignmentScopeRef(event.target.value)}
                        />
                      </Field>
                    ) : null}
                    <Field label="Starts at">
                      <Input
                        type="datetime-local"
                        required
                        value={assignmentStart}
                        onChange={(event) => setAssignmentStart(event.target.value)}
                      />
                    </Field>
                    <Field label="Ends at (required for temporary assignment)">
                      <Input
                        type="datetime-local"
                        required={assignmentTemporary}
                        value={assignmentEnd}
                        onChange={(event) => setAssignmentEnd(event.target.value)}
                      />
                    </Field>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={assignmentTemporary}
                        onChange={(event) => setAssignmentTemporary(event.target.checked)}
                      />
                      Temporary assignment
                    </label>
                    <Button
                      disabled={
                        busy ||
                        !assignmentUser ||
                        !assignmentRole ||
                        !assignmentStart ||
                        (assignmentTemporary && !assignmentEnd)
                      }
                      type="submit"
                    >
                      Assign role
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Grant an add-on responsibility</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    className="app-shell-form"
                    onSubmit={(event) =>
                      void mutate(
                        event,
                        "workspace_responsibility_grant",
                        {
                          p_assignment: grantAssignment,
                          p_responsibility: grantResponsibility,
                          p_valid_from: toLocalIso(grantStart),
                          p_valid_until: toLocalIso(grantEnd),
                        },
                        () => {
                          setGrantStart("");
                          setGrantEnd("");
                        },
                      )
                    }
                  >
                    <Field label="Assignment">
                      <select
                        className="w-full rounded-md border bg-background p-2"
                        aria-label="Grant assignment"
                        value={grantAssignment}
                        onChange={(event) => setGrantAssignment(event.target.value)}
                      >
                        <option value="">Select assignment</option>
                        {assignments
                          .filter((row) => row.status === "active")
                          .map((row) => (
                            <option key={text(row.id)} value={text(row.id)}>
                              {text(userById.get(text(row.user_id))?.full_name) ||
                                text(row.user_id)}{" "}
                              · {text(roleByCode.get(text(row.role_code))?.name)}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Add-on">
                      <select
                        className="w-full rounded-md border bg-background p-2"
                        aria-label="Add-on responsibility"
                        value={grantResponsibility}
                        onChange={(event) => setGrantResponsibility(event.target.value)}
                      >
                        <option value="">Select add-on</option>
                        {addOnResponsibilities.map((row) => (
                          <option key={text(row.id)} value={text(row.id)}>
                            {text(row.label)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Starts at">
                      <Input
                        type="datetime-local"
                        required
                        value={grantStart}
                        onChange={(event) => setGrantStart(event.target.value)}
                      />
                    </Field>
                    <Field label="Ends at (optional)">
                      <Input
                        type="datetime-local"
                        value={grantEnd}
                        onChange={(event) => setGrantEnd(event.target.value)}
                      />
                    </Field>
                    <Button
                      disabled={busy || !grantAssignment || !grantResponsibility || !grantStart}
                      type="submit"
                    >
                      Grant add-on
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Delegate a role temporarily</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    className="app-shell-form"
                    onSubmit={(event) =>
                      void mutate(
                        event,
                        "workspace_role_delegate",
                        {
                          p_assignment: delegateAssignment,
                          p_delegate_user: delegateUser,
                          p_valid_from: toLocalIso(delegateStart),
                          p_valid_until: toLocalIso(delegateEnd),
                        },
                        () => {
                          setDelegateStart("");
                          setDelegateEnd("");
                        },
                      )
                    }
                  >
                    <Field label="Assignment">
                      <select
                        className="w-full rounded-md border bg-background p-2"
                        aria-label="Delegation assignment"
                        value={delegateAssignment}
                        onChange={(event) => setDelegateAssignment(event.target.value)}
                      >
                        <option value="">Select assignment</option>
                        {assignments
                          .filter((row) => row.status === "active")
                          .map((row) => (
                            <option key={text(row.id)} value={text(row.id)}>
                              {text(userById.get(text(row.user_id))?.full_name) ||
                                text(row.user_id)}{" "}
                              · {text(roleByCode.get(text(row.role_code))?.name)}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Delegate">
                      <select
                        className="w-full rounded-md border bg-background p-2"
                        aria-label="Delegate member"
                        value={delegateUser}
                        onChange={(event) => setDelegateUser(event.target.value)}
                      >
                        <option value="">Select member</option>
                        {(rows.users ?? [])
                          .filter((row) => row.id !== userId)
                          .map((row) => (
                            <option key={text(row.id)} value={text(row.id)}>
                              {text(row.full_name) || text(row.email) || text(row.id)}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <Field label="Starts at">
                      <Input
                        type="datetime-local"
                        required
                        value={delegateStart}
                        onChange={(event) => setDelegateStart(event.target.value)}
                      />
                    </Field>
                    <Field label="Ends at">
                      <Input
                        type="datetime-local"
                        required
                        value={delegateEnd}
                        onChange={(event) => setDelegateEnd(event.target.value)}
                      />
                    </Field>
                    <Button
                      disabled={
                        busy ||
                        !delegateAssignment ||
                        !delegateUser ||
                        !delegateStart ||
                        !delegateEnd
                      }
                      type="submit"
                    >
                      Delegate temporarily
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Role assignments</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {assignments.map((row) => (
                <div
                  key={text(row.id)}
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm"
                  data-testid="role-assignment-row"
                >
                  <span>
                    {text(userById.get(text(row.user_id))?.full_name) || text(row.user_id)} ·{" "}
                    {text(roleByCode.get(text(row.role_code))?.name) || text(row.role_code)} ·{" "}
                    {text(row.scope_type)} · {text(row.status)}
                    {row.temporary === true ? " · temporary" : ""}
                  </span>
                  {canAssign && row.status === "active" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void (async () => {
                          setBusy(true);
                          setError("");
                          setNotice("");
                          const { error: rpcError } = await db.rpc("role_unassign", {
                            p_assignment: text(row.id),
                          });
                          if (rpcError) setError(rpcError.message);
                          else {
                            setNotice("Role revoked and audited.");
                            await load();
                          }
                          setBusy(false);
                        })()
                      }
                    >
                      Revoke
                    </Button>
                  ) : null}
                </div>
              ))}
              {!assignments.length ? (
                <p className="text-sm text-muted-foreground">No role assignments found.</p>
              ) : null}
            </CardContent>
          </Card>

          {canAssign ? (
            <Card>
              <CardHeader>
                <CardTitle>Add-on grants and delegations</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {(rows.role_assignment_responsibility_grants ?? []).map((row) => (
                  <div
                    key={text(row.id)}
                    className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm"
                    data-testid="role-add-on-grant-row"
                  >
                    <span>
                      {text(responsibilityById.get(text(row.responsibility_id))?.label)} ·{" "}
                      {text(row.valid_from)} — {text(row.valid_until) || "no end"}{" "}
                      {row.revoked_at ? "· revoked" : ""}
                    </span>
                    {!row.revoked_at ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void (async () => {
                            setBusy(true);
                            setError("");
                            setNotice("");
                            const { error: rpcError } = await db.rpc(
                              "workspace_responsibility_revoke",
                              { p_grant: text(row.id) },
                            );
                            if (rpcError) setError(rpcError.message);
                            else {
                              setNotice("Add-on revoked and audited.");
                              await load();
                            }
                            setBusy(false);
                          })()
                        }
                      >
                        Revoke add-on
                      </Button>
                    ) : null}
                  </div>
                ))}
                {(rows.role_assignment_delegations ?? []).map((row) => (
                  <div
                    key={text(row.id)}
                    className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm"
                    data-testid="role-delegation-row"
                  >
                    <span>
                      Delegated to{" "}
                      {text(userById.get(text(row.delegate_user_id))?.full_name) ||
                        text(row.delegate_user_id)}{" "}
                      · {text(row.valid_from)} — {text(row.valid_until)}{" "}
                      {row.revoked_at ? "· revoked" : ""}
                    </span>
                    {!row.revoked_at ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void (async () => {
                            setBusy(true);
                            setError("");
                            setNotice("");
                            const { error: rpcError } = await db.rpc(
                              "workspace_role_delegation_revoke",
                              { p_delegation: text(row.id) },
                            );
                            if (rpcError) setError(rpcError.message);
                            else {
                              setNotice("Delegation revoked and audited.");
                              await load();
                            }
                            setBusy(false);
                          })()
                        }
                      >
                        Revoke delegation
                      </Button>
                    ) : null}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Assignment audit history</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {(rows.role_assignment_audit_events ?? []).slice(0, 50).map((row) => (
                <details key={text(row.id)} className="border-b pb-2 text-sm">
                  <summary className="cursor-pointer">
                    {text(row.occurred_at)} · {text(row.action)} · {text(row.target_type)} · actor{" "}
                    {text(row.actor_user_id)}
                  </summary>
                  <pre className="overflow-auto whitespace-pre-wrap text-xs">
                    {JSON.stringify(
                      {
                        target: row.target_id,
                        scope: [row.scope_type, row.scope_ref],
                        before: row.before_state,
                        after: row.after_state,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              ))}
              {!rows.role_assignment_audit_events?.length ? (
                <p className="text-sm text-muted-foreground">
                  No audit events are visible to this account.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
