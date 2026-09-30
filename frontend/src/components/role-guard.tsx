import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useApp } from "@/contexts/app-context";
import type { AppRole } from "@/lib/roles";
import { scholarWorkspaceHome, scholarWorkspaceLabelForRole } from "@/lib/runtime/nav-registry";

/**
 * Client-side role guard. Wrap a portal's <Outlet /> with this to ensure
 * the signed-in user has one of the allowed roles. Super admins always pass.
 */
export function RoleGuard({ allow, children }: { allow: AppRole[]; children: ReactNode }) {
  const { role, superAdmin, loading } = useApp();

  if (loading) {
    return (
      <div className="min-h-[50vh] grid place-items-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  // Super admins can view any portal
  if (superAdmin) return <>{children}</>;

  if (!role || !allow.includes(role)) {
    const target = role ? scholarWorkspaceHome(role) : "/auth";
    return (
      <div className="min-h-[60vh] grid place-items-center px-4">
        <div className="uos-card p-8 max-w-md text-center">
          <h1 className="font-display text-xl font-bold">Access denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This workspace is restricted to{" "}
            <strong>{allow.map((r) => scholarWorkspaceLabelForRole(r)).join(", ")}</strong>.
            {role && (
              <>
                {" "}
                You're signed in as <strong>{scholarWorkspaceLabelForRole(role)}</strong>.
              </>
            )}
          </p>
          <Link
            to={target}
            className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Go to your dashboard
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
