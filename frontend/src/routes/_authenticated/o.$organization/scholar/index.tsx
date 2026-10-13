import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useApp } from "@/contexts/app-context";
import { scholarBoundHome } from "@/lib/experience/organization-routes";
import { scholarWorkspaceHome } from "@/lib/runtime/nav-registry";

export const Route = createFileRoute("/_authenticated/o/$organization/scholar/")({
  component: ScholarRuntimeHome,
});

function ScholarRuntimeHome() {
  const { organization } = Route.useParams();
  const { role, loading } = useApp();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !role) return;
    const destination = scholarBoundHome(organization, scholarWorkspaceHome(role));
    void navigate({ to: destination as never, replace: true });
  }, [loading, role, organization, navigate]);

  return (
    <div className="min-h-[40vh] grid place-items-center text-muted-foreground">Opening runtime…</div>
  );
}
