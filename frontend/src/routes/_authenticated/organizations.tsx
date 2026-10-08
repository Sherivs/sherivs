import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/contexts/app-context";
import { identityFromAppState } from "@/lib/identity/context";
import { switchActiveOrganization } from "@/lib/identity/memberships.functions";
import { scholarWorkspaceLabelForRole } from "@/lib/runtime/nav-registry";
import { readMyOrganizationsReality } from "@/lib/reality/organization-reality.functions";
import { organizationStateLabel } from "@/lib/reality/organization-reality";
import { Initial } from "@/components/public/_shared";

/**
 * Organization selector (§11 — multi-organization members).
 *
 * Shown when a signed-in user resolves to more than one organization
 * membership. Choosing an organization SWITCHES the active workspace context
 * server-side (submit–resolve: the client submits an organization id; the
 * server validates it against the caller's own membership set before
 * persisting) and routes into the switched workspace.
 */
export const Route = createFileRoute("/_authenticated/organizations")({
  ssr: false,
  component: OrganizationSelectorPage,
});

function OrganizationSelectorPage() {
  const { profile, superAdmin, school, loading, refresh } = useApp();
  const navigate = useNavigate();
  const switchOrganization = useServerFn(switchActiveOrganization);
  const readReality = useServerFn(readMyOrganizationsReality);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Reality read-model (Milestone 9): live organization state under the
  // caller's RLS scope — lifecycle state and roster size where readable.
  const reality = useQuery({
    queryKey: ["organizations-reality"],
    queryFn: () => readReality(),
  });
  const realityFor = (organizationId: string) =>
    reality.data?.find((r) => r.organizationId === organizationId);

  if (loading) {
    return (
      <div className="min-h-[50vh] grid place-items-center text-muted-foreground">Loading…</div>
    );
  }

  const identity = identityFromAppState({ superAdmin, profile, school });

  if (identity.kind === "sherivs_internal") {
    void navigate({ to: "/internal", replace: true });
    return null;
  }

  if (identity.kind === "unlinked") {
    void navigate({ to: "/welcome", replace: true });
    return null;
  }

  async function handleChoose(organizationId: string) {
    setBusyId(organizationId);
    setError(null);
    try {
      const result = await switchOrganization({ data: { organizationId } });
      await refresh();
      await navigate({ to: result.destination, replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch organization");
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <header className="text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Choose a workspace
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Your organizations
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          You&apos;re a member of more than one organization. Select the one you want to work in —
          you can switch again at any time.
        </p>
      </header>

      {error && (
        <div
          role="alert"
          className="mx-auto mt-6 max-w-md rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive-foreground"
        >
          {error}
        </div>
      )}

      <ul className="mt-10 grid gap-4">
        {identity.organizations.map((org) => (
          <li key={org.organizationId}>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => void handleChoose(org.organizationId)}
              className="uos-card flex w-full items-center gap-4 p-5 text-left transition-opacity hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Initial name={org.name} size={44} className="rounded-xl" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-base font-semibold">
                  {org.name}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {scholarWorkspaceLabelForRole(org.role)} · {org.runtimeName} workspace
                  {(() => {
                    const r = realityFor(org.organizationId);
                    if (!r) return null;
                    const parts = [
                      organizationStateLabel(r.state),
                      r.memberCount === null ? null : `${r.memberCount} member${r.memberCount === 1 ? "" : "s"}`,
                    ].filter(Boolean);
                    return ` · ${parts.join(" · ")}`;
                  })()}
                </span>
              </span>
              <span aria-hidden="true" className="shrink-0 text-sm font-semibold text-primary">
                {busyId === org.organizationId ? "Switching…" : "Open →"}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
