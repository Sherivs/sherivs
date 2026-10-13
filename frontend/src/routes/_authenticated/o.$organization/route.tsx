import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { useApp } from "@/contexts/app-context";

export const Route = createFileRoute("/_authenticated/o/$organization")({
  component: OrganizationWorkspaceLayout,
});

function OrganizationWorkspaceLayout() {
  const { organization } = Route.useParams();
  const { school, superAdmin, loading } = useApp();

  if (loading) {
    return <div className="min-h-[40vh] grid place-items-center text-muted-foreground">Loading…</div>;
  }

  if (!superAdmin && school?.slug && school.slug !== organization) {
    return (
      <div className="min-h-[50vh] grid place-items-center px-4">
        <div className="uos-card max-w-md p-8 text-center">
          <h1 className="font-display text-xl font-bold">Wrong organization</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This workspace belongs to a different organization than the one you are signed into.
          </p>
          <Link
            to="/o/$organization"
            params={{ organization: school.slug }}
            className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Open your workspace
          </Link>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
