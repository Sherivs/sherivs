import { createFileRoute, Link } from "@tanstack/react-router";
import { useApp } from "@/contexts/app-context";
import { PLATFORM_NAME } from "@/lib/platform";
import { INSTALLED_RUNTIME_ID, INSTALLED_RUNTIME_NAME } from "@/lib/runtime/installed-runtimes";
import { scholarBoundHome } from "@/lib/experience/organization-routes";
import { scholarWorkspaceHome } from "@/lib/runtime/nav-registry";

export const Route = createFileRoute("/_authenticated/o/$organization/")({
  component: OrganizationWorkspaceHome,
});

function OrganizationWorkspaceHome() {
  const { organization } = Route.useParams();
  const { school, role } = useApp();
  const scholarHome =
    role && INSTALLED_RUNTIME_ID === "runtime:scholar"
      ? scholarBoundHome(organization, scholarWorkspaceHome(role))
      : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Organization workspace
      </p>
      <h1 className="mt-2 font-display text-2xl font-bold">{school?.name ?? organization}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {PLATFORM_NAME} projects this workspace from organization membership, capabilities, and the
        installed domain runtime. Domain modules load through the runtime contract — they are not
        the platform.
      </p>
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <article className="rounded-xl border border-border p-5">
          <h2 className="font-display text-base font-semibold">Installed runtime</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {INSTALLED_RUNTIME_NAME} ({INSTALLED_RUNTIME_ID})
          </p>
          {scholarHome ? (
            <Link
              to="/o/$organization/scholar"
              params={{ organization }}
              className="mt-4 inline-block text-sm font-semibold underline-offset-4 hover:underline"
            >
              Open runtime →
            </Link>
          ) : null}
        </article>
        <article className="rounded-xl border border-border p-5">
          <h2 className="font-display text-base font-semibold">Universal shell</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>
              <Link to="/settings" className="hover:text-foreground">
                Settings
              </Link>
            </li>
            <li>
              <Link to="/messages" className="hover:text-foreground">
                Messages
              </Link>
            </li>
            <li>
              <Link to="/notifications" className="hover:text-foreground">
                Notifications
              </Link>
            </li>
          </ul>
        </article>
      </div>
    </div>
  );
}
