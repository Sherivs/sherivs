/**
 * Marketplace discover/install surface (WAVE-R41).
 *
 * The catalog is published FROM the organization's reality (one listing per
 * installed feature code) through the marketplace's existing contracts — not
 * hand-maintained. Installation is decided by the R38 gate: tenant, known code,
 * not-installed and an ACTIVE entitlement. This surface never assumes an
 * entitlement: it renders the decision and says what is missing.
 */
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ShieldAlert, ShieldCheck, Store } from "lucide-react";
import { experiencePresetKeys } from "@/lib/scholar/experience/experience-presets";
import { organizationClassLabel } from "@/lib/surfaces/generated-site-view";
import {
  buildMarketplaceView,
  searchMarketplace,
  sortByTrust,
} from "@/lib/surfaces/marketplace-view";

type SearchParams = { class?: string };

export const Route = createFileRoute("/marketplace")({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    class: typeof s.class === "string" ? s.class : undefined,
  }),
  component: MarketplacePage,
  head: () => ({
    meta: [
      { title: "Marketplace — published from reality — Sherivs" },
      {
        name: "description",
        content:
          "Sherivs publishes a marketplace catalog from each organization's own reality: one listing per installed feature code, entitlement-gated installation, and no self-asserted trust.",
      },
    ],
  }),
});

function MarketplacePage() {
  const { class: orgType = "school" } = Route.useSearch();
  const [query, setQuery] = useState("");

  const view = useMemo(
    () =>
      buildMarketplaceView({
        orgType,
        // No tenant is bound on this surface: installation is denied, and the
        // surface explains exactly which condition is unmet.
        tenantId: null,
        entitlements: [],
        installedCodes: [],
      }),
    [orgType],
  );

  const visible = useMemo(
    () => (query.trim() ? searchMarketplace(view, query) : sortByTrust(view.listings)),
    [view, query],
  );

  return (
    <div className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-lg font-bold">Marketplace</p>
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
              published from reality · {view.label}
            </p>
          </div>
          <nav className="flex flex-wrap gap-4 text-xs">
            <Link to="/" className="underline">
              Sherivs Control
            </Link>
            <Link to="/reality/$class" params={{ class: orgType }} className="underline">
              Generated environment
            </Link>
            <Link to="/platform" className="underline">
              The platform
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
        <Card className="border-amber-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldAlert className="size-4" /> Installation is gated (fail closed)
            </CardTitle>
            <CardDescription className="text-xs">
              {view.installBlockers.length === 0
                ? "Every listing below is installable."
                : view.installBlockers.map((blocker) => (
                    <span key={blocker} className="mr-2 inline-block">
                      • {blocker}
                    </span>
                  ))}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Entitlements are tenant plan data resolved server-side; a browser cannot assert one. An
            unentitled install request is denied by the gate before any write — the reason is shown
            on each listing.
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Publication state:{" "}
              {view.discoverable ? "live" : `${view.draftCount} draft listing(s)`}
            </CardTitle>
            <CardDescription className="text-xs">{view.reviewNote}</CardDescription>
          </CardHeader>
        </Card>

        <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Store className="size-4 text-muted-foreground" />
            <h2 className="font-display text-lg font-semibold">
              {visible.length} of {view.listings.length} listings
            </h2>
            {view.complete ? (
              <Badge variant="secondary" className="border-0">
                complete catalog
              </Badge>
            ) : (
              <Badge variant="destructive" className="border-0">
                catalog incomplete
              </Badge>
            )}
          </div>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the published catalog…"
            className="sm:max-w-xs"
            aria-label="Search the published catalog"
          />
        </section>

        <section className="flex flex-wrap gap-2">
          {experiencePresetKeys().map((key) => (
            <Link
              key={key}
              to="/marketplace"
              search={{ class: key }}
              className={
                key === orgType
                  ? "rounded-full border border-border bg-accent px-3 py-1 text-xs"
                  : "rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
              }
            >
              {organizationClassLabel(key)}
            </Link>
          ))}
        </section>

        <Separator />

        <section className="grid gap-3 sm:grid-cols-2">
          {visible.map((listing) => (
            <Card key={listing.featureCode}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  <span>{listing.label}</span>
                  <Badge
                    variant={listing.install.allowed ? "secondary" : "outline"}
                    className="border-0 font-mono text-[10px]"
                  >
                    {listing.install.allowed ? "installable" : "gated"}
                  </Badge>
                </CardTitle>
                <CardDescription className="font-mono text-[10px]">
                  {listing.featureCode} · {listing.workspace} · {listing.productType} ·{" "}
                  {listing.trustLevel} · {listing.supportLevel}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p className="text-muted-foreground">
                  vendor <span className="font-mono">{listing.vendorRef}</span> · version{" "}
                  <span className="font-mono">{listing.versionRef}</span>
                  {listing.installed ? " · installed" : ""}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {listing.requirements.map((requirement) => (
                    <span
                      key={requirement}
                      className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px]"
                    >
                      {requirement}
                    </span>
                  ))}
                </div>
                <p className="flex items-start gap-1.5 text-muted-foreground">
                  {listing.install.allowed ? (
                    <ShieldCheck className="mt-0.5 size-3.5 text-emerald-600" />
                  ) : (
                    <ShieldAlert className="mt-0.5 size-3.5 text-amber-600" />
                  )}
                  <span>{listing.install.reasons.join("; ")}</span>
                </p>
              </CardContent>
            </Card>
          ))}
          {visible.length === 0 && (
            <p className="rounded-lg border border-border p-4 text-xs text-muted-foreground">
              No listing matches this search. Discovery runs over the published catalog only — a
              product that was never published cannot be installed.
            </p>
          )}
        </section>

        {view.issues.length > 0 && (
          <section className="rounded-lg border border-border p-4 text-xs">
            <p className="font-medium">Publication issues</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {view.issues.map((issue) => (
                <li key={issue}>• {issue}</li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-[11px] text-muted-foreground">
          Catalog for {view.label}: {view.publishedCodes.length} published code(s) ·{" "}
          {view.publishedCodes.join(", ") || "none"}. Trust stays{" "}
          <span className="font-mono">unverified</span> until a product is reviewed — publishing
          never self-asserts trust.
        </p>
      </main>
    </div>
  );
}
