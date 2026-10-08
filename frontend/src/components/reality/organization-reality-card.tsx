import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useApp } from "@/contexts/app-context";
import {
  readMyOrganizationsReality,
} from "@/lib/reality/organization-reality.functions";
import { organizationStateLabel } from "@/lib/reality/organization-reality";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Organization reality inside the runtime workspace.
 *
 * Renders the Milestone 9 read-model — the universal answer to "what is the
 * state of this organization" — derived from verified truth only (Constitution
 * §9): lifecycle state from real flags, member count as visible to THIS reader
 * under RLS. Nulls are rendered as not-visible, never fabricated, and nothing
 * on the card is predicted or inferred.
 */
const STATE_STYLES: Record<string, string> = {
  onboarding: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  operational: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  inactive: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function OrganizationRealityCard() {
  const { school } = useApp();
  const readReality = useServerFn(readMyOrganizationsReality);
  const reality = useQuery({
    queryKey: ["organization-reality", school?.id ?? null],
    enabled: !!school?.id,
    staleTime: 60_000,
    queryFn: () => readReality({ data: { organizationId: school!.id } }),
  });

  const org = reality.data?.[0] ?? null;

  return (
    <div className="uos-card p-5" data-testid="organization-reality-card">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-sm font-semibold">Organization reality</h3>
          <p className="truncate text-xs text-muted-foreground">
            Verified platform truth for {org?.name ?? "your organization"}
          </p>
        </div>
        {reality.isLoading ? (
          <Skeleton className="h-6 w-24" />
        ) : org ? (
          <span
            className={`shrink-0 rounded-full border px-3 py-0.5 text-[11px] font-semibold ${STATE_STYLES[org.state] ?? ""}`}
          >
            {organizationStateLabel(org.state)}
          </span>
        ) : null}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div className="min-w-0 rounded-xl border border-border bg-muted/10 p-2.5">
          <dt className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
            Roster (as visible to you)
          </dt>
          <dd className="mt-0.5 truncate font-semibold tabular-nums">
            {reality.isLoading
              ? "…"
              : org?.memberCount !== null && org?.memberCount !== undefined
                ? `${org.memberCount} member${org.memberCount === 1 ? "" : "s"}`
                : "Not visible in this context"}
          </dd>
        </div>
        <div className="min-w-0 rounded-xl border border-border bg-muted/10 p-2.5">
          <dt className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
            Workspace address
          </dt>
          <dd className="mt-0.5 truncate font-semibold">
            {org?.slug ? `${org.slug}.sherivs.com` : "—"}
          </dd>
        </div>
        <div className="min-w-0 rounded-xl border border-border bg-muted/10 p-2.5">
          <dt className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
            Onboarding
          </dt>
          <dd className="mt-0.5 truncate font-semibold">
            {reality.isLoading ? "…" : org ? (org.onboardingCompleted ? "Completed" : "In progress") : "—"}
          </dd>
        </div>
      </dl>

      <p className="mt-3 text-[11px] text-muted-foreground">
        Derived from verified records only — live reads under your own access scope. Nothing here
        is predicted, inferred, or AI-generated.
      </p>
    </div>
  );
}
