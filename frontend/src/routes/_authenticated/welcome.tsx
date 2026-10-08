import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useApp } from "@/contexts/app-context";
import { PLATFORM_NAME } from "@/lib/platform";

/**
 * Unlinked-account state (§11 — new/pending customer).
 *
 * A signed-in user whose account is not yet linked to an organization lands
 * here: never inside a runtime workspace. They can request a demo, contact
 * Sherivs, or sign out.
 */
export const Route = createFileRoute("/_authenticated/welcome")({
  ssr: false,
  component: WelcomePage,
});

function WelcomePage() {
  const { authUser, signOut } = useApp();
  const navigate = useNavigate();

  return (
    <div className="mx-auto grid min-h-[70vh] w-full max-w-xl place-items-center px-4 py-12">
      <div className="uos-card w-full p-8 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-xl uos-tenant-bg font-display text-lg font-bold text-primary-foreground">
          S
        </div>
        <h1 className="mt-6 font-display text-2xl font-bold tracking-tight">
          Welcome to {PLATFORM_NAME}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your account
          {authUser?.email ? <strong> ({authUser.email})</strong> : null} is verified, but it
          isn&apos;t linked to an organization yet. Create your own organization, request a demo, or
          wait for an organization admin (or a {PLATFORM_NAME} platform administrator) to assign you
          a role.
        </p>

        <div className="mt-8 grid gap-3">
          <Link
            to="/onboarding"
            className="rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Create your organization
          </Link>
          <Link
            to="/request-demo"
            className="rounded-md border border-border px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-accent"
          >
            Request a demo
          </Link>
          <a
            href="mailto:hello@sherivs.com?subject=Link%20my%20account"
            className="rounded-md border border-border px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-accent"
          >
            Contact {PLATFORM_NAME}
          </a>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              navigate({ to: "/auth", replace: true });
            }}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
