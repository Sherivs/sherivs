/**
 * Sherivs internal operating workspace surface (WAVE-R41).
 *
 * Renders the PLATFORM organization — the departments Sherivs staffs, the roles
 * that staff them and the widgets each department renders. It is generated from
 * the SHERIVS_INTERNAL role groups by the platform-org engine: this page lists
 * what the engine produced, and shows the structural audit that must be empty.
 */
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { BadgeCheck, ShieldAlert } from "lucide-react";
import { PLATFORM_WIDGET_KEYS } from "@/lib/scholar/platform-org/department-catalog";
import {
  auditPlatformOrg,
  platformOrgRoles,
  platformOrgSnapshot,
} from "@/lib/scholar/platform-org/platform-workspace-engine";

export const Route = createFileRoute("/platform/org")({
  ssr: false,
  // Internal Sherivs operating surface — never public. Session-checked and
  // excluded from search indexing.
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
  },
  component: PlatformOrganization,
  head: () => ({
    meta: [
      { title: "Sherivs internal operating workspace — generated organization" },
      {
        name: "description",
        content:
          "The Sherivs platform organization: departments, the roles that staff them and the widgets each department renders — generated from the role engine, audited on every render.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function PlatformOrganization() {
  const snapshot = useMemo(() => platformOrgSnapshot(), []);
  const roles = useMemo(() => platformOrgRoles(), []);
  const issues = useMemo(() => auditPlatformOrg(), []);

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-lg font-bold">Sherivs internal organization</p>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              internal operating workspace · generated from role data
            </p>
          </div>
          <nav className="flex flex-wrap gap-4 text-xs">
            <Link to="/" className="underline">
              Sherivs Control
            </Link>
            <Link to="/platform" className="underline">
              The platform
            </Link>
            <Link to="/reality/$class" params={{ class: "company" }} className="underline">
              Generated environment
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
        <section className="space-y-2">
          <h1 className="font-display text-2xl font-bold">
            The platform organization staffs {roles.length} roles across{" "}
            {snapshot.departments.length} departments
          </h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            No department is drawn by hand: each one exists because roles in the platform role
            groups staff it, and each widget key is rendered by the department that declares it. An
            operator&apos;s own departments come from their roles — see{" "}
            <span className="font-mono">/runtime</span>.
          </p>
        </section>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">Departments</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-display text-2xl">{snapshot.departments.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">Platform roles</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-display text-2xl">{snapshot.roleCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs text-muted-foreground">Widget keys</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-display text-2xl">{snapshot.widgetCount}</p>
              <p className="text-[10px] text-muted-foreground">
                {PLATFORM_WIDGET_KEYS.length} keys in the index
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className={issues.length === 0 ? "border-emerald-500/40" : "border-red-500/40"}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              {issues.length === 0 ? (
                <BadgeCheck className="size-4 text-emerald-600" />
              ) : (
                <ShieldAlert className="size-4 text-red-600" />
              )}
              Structural audit: {issues.length === 0 ? "sound" : `${issues.length} issue(s)`}
            </CardTitle>
            <CardDescription className="text-xs">
              Duplicate department keys, unstaffed departments, departments without widgets and
              widget keys outside the index are all failures.
            </CardDescription>
          </CardHeader>
          {issues.length > 0 && (
            <CardContent className="text-xs text-red-600">
              <ul className="space-y-0.5">
                {issues.map((issue) => (
                  <li key={issue}>• {issue}</li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>

        <Separator />

        <section className="grid gap-3 sm:grid-cols-2">
          {snapshot.departments.map((department) => (
            <Card key={department.department}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{department.label}</CardTitle>
                <CardDescription className="font-mono text-[10px]">
                  {department.department} · {department.roles.length} role(s)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <div className="flex flex-wrap gap-1.5">
                  {department.widgets.map((widget) => (
                    <Badge
                      key={widget}
                      variant="secondary"
                      className="border-0 font-mono text-[10px]"
                    >
                      {widget}
                    </Badge>
                  ))}
                </div>
                <p className="font-mono text-[10px] break-words text-muted-foreground">
                  {department.roles.join(", ")}
                </p>
              </CardContent>
            </Card>
          ))}
        </section>

        <p className="text-[11px] text-muted-foreground">
          Every department renders in the Sherivs internal workspace and is audited above on every
          render. Departments are provisioned from role data, never configured by hand.
        </p>
      </main>
    </div>
  );
}
