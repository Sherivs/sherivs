import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Boxes, Building2, LayoutDashboard, ShieldAlert } from "lucide-react";
import { getMyFeatureAccess } from "@/lib/runtime/scholar/scholar-feature-access.functions";
import { getMyRealityRoles } from "@/lib/runtime/scholar/scholar-role-assignments.functions";
import { buildRuntimeView } from "@/lib/surfaces/runtime-view";

export const Route = createFileRoute("/_authenticated/runtime")({
  component: GeneratedRuntime,
  head: () => ({
    meta: [{ title: "Generated runtime — CoreGrid" }],
  }),
});

function errorText(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

/**
 * The internal surface every person receives: workspaces, dashboards and (when
 * they staff the platform organization) CoreGrid departments. Everything is
 * composed from the roles the SERVER resolved — this page never asserts a role,
 * a feature code or a tenant, and it states an empty result instead of filling it.
 */
function GeneratedRuntime() {
  const realityRolesFn = useServerFn(getMyRealityRoles);
  const featureAccessFn = useServerFn(getMyFeatureAccess);

  const realityRoles = useQuery({
    queryKey: ["runtime-reality-roles"],
    queryFn: () => realityRolesFn({ data: {} }),
  });
  const featureAccess = useQuery({
    queryKey: ["runtime-feature-access"],
    queryFn: () => featureAccessFn({ data: {} }),
  });

  const view = useMemo(() => {
    const roleIds = [
      ...new Set([...(realityRoles.data?.roleIds ?? []), ...(featureAccess.data?.roleIds ?? [])]),
    ].sort();
    const enabledCodes = [
      ...new Set([...(realityRoles.data?.enabled ?? []), ...(featureAccess.data?.enabled ?? [])]),
    ].sort();
    return buildRuntimeView({
      tenantId: realityRoles.data?.tenantId ?? featureAccess.data?.tenantId ?? null,
      roleIds,
      enabledCodes,
      rejectedGrants: realityRoles.data?.rejectedGrants,
    });
  }, [realityRoles.data, featureAccess.data]);

  const failures = [errorText(realityRoles.error), errorText(featureAccess.error)].filter(
    (message): message is string => Boolean(message),
  );
  const widgetCount = view.workspaces.reduce(
    (total, workspace) => total + workspace.widgets.length,
    0,
  );

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <h1 className="font-display text-2xl font-bold">Your generated runtime</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Workspaces, dashboards and platform departments composed by the engines from the roles the
          server resolved for your identity. Nothing on this page computes a permission, and no role
          is asserted by the browser: when the platform grants nothing, this surface shows nothing.
        </p>
      </header>

      {(failures.length > 0 || view.notices.length > 0) && (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldAlert className="size-4" /> Fail-closed: why this runtime looks the way it does
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs text-muted-foreground">
            {view.notices.map((notice) => (
              <p key={notice}>• {notice}</p>
            ))}
            {failures.map((failure) => (
              <p key={failure}>• resolution error: {failure}</p>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Resolved scope (server-derived)</CardTitle>
          <CardDescription className="text-xs">
            Tenant, roles and enabled feature codes as the server resolved them — never as supplied
            by this page.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-xs sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Tenant</p>
            <p className="font-mono">{view.tenantId ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Reality roles</p>
            <p className="font-display text-lg">{view.roleIds.length}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Enabled feature codes</p>
            <p className="font-display text-lg">{view.enabledCodes.length}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Landing workspace</p>
            <p className="font-mono">{view.landing ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <LayoutDashboard className="size-4 text-muted-foreground" /> Workspaces and dashboards (
          {view.workspaces.length} workspaces · {widgetCount} widgets)
        </h2>
        {view.workspaces.length === 0 ? (
          <p className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
            No workspace resolves for this identity. A workspace exists only because a role
            participates in it, and a widget only because the feature it belongs to is enabled AND
            one of your roles participates in that workspace.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {view.workspaces.map((workspace) => (
              <Card key={workspace.workspace}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{workspace.label}</CardTitle>
                  <CardDescription className="font-mono text-[10px]">
                    {workspace.workspace} · roles: {workspace.sourceRoles.join(", ")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1.5 text-xs">
                  {workspace.widgets.length === 0 ? (
                    <p className="text-muted-foreground">
                      No widget is enabled in this workspace for your roles.
                    </p>
                  ) : (
                    workspace.widgets.map((widget) => (
                      <div key={widget.code} className="flex items-start justify-between gap-2">
                        <span>{widget.label}</span>
                        <Badge variant="secondary" className="border-0 font-mono text-[10px]">
                          {widget.featureCode}
                        </Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Building2 className="size-4 text-muted-foreground" /> CoreGrid departments you staff (
          {view.platformDepartments.length})
        </h2>
        {view.platformDepartments.length === 0 ? (
          <p className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
            None. The platform organization generates a department only for the roles that staff it
            — this is the CoreGrid internal workspace, not a tenant workspace.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {view.platformDepartments.map((department) => (
              <Card key={department.department}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{department.label}</CardTitle>
                  <CardDescription className="font-mono text-[10px]">
                    {department.department} · {department.roles.length} role(s)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1.5 text-xs">
                  {department.widgets.map((widget) => (
                    <div key={widget} className="flex items-center gap-2 text-muted-foreground">
                      <Boxes className="size-3.5" />
                      <span className="font-mono">{widget}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <nav className="flex flex-wrap gap-4 pt-2 text-xs">
        <Link to="/" className="underline">
          Command Centre
        </Link>
        <a href="/platform/org" className="underline">
          Platform organization
        </a>
        <a href="/marketplace" className="underline">
          Marketplace catalog
        </a>
      </nav>
    </div>
  );
}
