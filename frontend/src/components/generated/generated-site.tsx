/**
 * Sherivs — generated site renderer components (WAVE-R40).
 *
 * Renders a `GeneratedSiteView`. Every block comes from the view-model, which
 * comes from the experience engine: no organization name, section or colour is
 * written here. A section that requires approval renders as an approval notice
 * instead of content — the surface enforces the publication law it is told about
 * rather than displaying unpublished material.
 */

import type { CSSProperties, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { GeneratedSiteBlock, GeneratedSiteView } from "@/lib/surfaces/generated-site-view";

function brandStyle(view: GeneratedSiteView): CSSProperties {
  return {
    ["--generated-primary" as string]: view.brand.primaryColor,
    ["--generated-secondary" as string]: view.brand.secondaryColor,
    fontFamily: view.brand.fontFamily,
  };
}

function GovernanceBanner({ view }: { view: GeneratedSiteView }) {
  const preview = view.governance.issues.some((issue) => issue.includes("no tenant context"));
  return (
    <div
      className={
        preview
          ? "rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
          : "rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm"
      }
    >
      <p className="flex items-center gap-2 font-medium">
        {preview ? <ShieldAlert className="size-4" /> : <ShieldCheck className="size-4" />}
        {preview
          ? "Preview — not tenant-bound. This environment is generated for the organization class and cannot be published until a tenant is bound and approvals are recorded."
          : "Governed environment — tenant context, audience exposure and approvals verified by the runtime."}
      </p>
      {view.governance.issues.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
          {view.governance.issues.map((issue) => (
            <li key={issue}>• {issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SectionBlock({ block }: { block: GeneratedSiteBlock }) {
  return (
    <section id={block.section} className="scroll-mt-24 rounded-xl border border-border p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">{block.label}</h2>
        <div className="flex flex-wrap gap-1.5">
          {block.components.map((component) => (
            <Badge key={component} variant="secondary" className="border-0 font-mono text-[10px]">
              {component}
            </Badge>
          ))}
        </div>
      </div>

      {block.awaitingApproval ? (
        <p className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          Awaiting an approved content item — AI-authored proposals are never published without a
          named human approver.
        </p>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Composed by the runtime from this organization&apos;s reality. Content is bound to the
          tenant&apos;s own records; nothing on this page is hand-authored per organization.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-medium">Why this section exists:</span>
        {block.rationale.map((reason) => (
          <span key={reason} className="rounded-full border border-border px-2 py-0.5 font-mono">
            {reason}
          </span>
        ))}
        <span className="ml-auto">audiences: {block.audiences.join(", ")}</span>
      </div>
    </section>
  );
}

export function GeneratedSite(props: { view: GeneratedSiteView; footer?: ReactNode }) {
  const { view } = props;
  return (
    <div
      className="min-h-screen bg-[color:var(--background)] text-[color:var(--foreground)]"
      style={brandStyle(view)}
    >
      <header
        className="border-b border-border"
        style={{ background: "var(--generated-secondary)" }}
      >
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-display text-lg font-bold text-white">{view.brand.name}</p>
            <p className="text-[11px] uppercase tracking-widest text-slate-300">
              {view.orgType} · generated environment · {view.brand.language} · {view.brand.tone}
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {view.navigation.map((item) => (
              <a key={item.section} href={item.anchor} className="text-white hover:underline">
                {item.label}
              </a>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
        <GovernanceBanner view={view} />

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">What the platform generated</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-xs sm:grid-cols-4">
            <div>
              <p className="text-muted-foreground">Sections served</p>
              <p className="font-display text-lg">{view.blocks.length}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Requiring approval</p>
              <p className="font-display text-lg">
                {view.blocks.filter((block) => block.awaitingApproval).length}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Internal workspaces</p>
              <p className="font-display text-lg">
                {view.experience.internalApplication.workspaces.length}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Manifest installable</p>
              <p className="font-display text-lg">{view.installable ? "yes" : "no"}</p>
            </div>
          </CardContent>
        </Card>

        {view.blocks.map((block) => (
          <SectionBlock key={block.section} block={block} />
        ))}

        <Separator />

        <section className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">
                App manifest (served at /manifest.webmanifest)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p className="font-mono">name: {view.manifest.name}</p>
              <p className="font-mono">short_name: {view.manifest.short_name}</p>
              <p className="font-mono">theme: {view.manifest.theme_color}</p>
              <p>
                {view.manifest.shortcuts.length} shortcut(s) — generated from the same navigation
                this page renders.
              </p>
              {view.manifestIssues.length > 0 ? (
                <ul className="text-amber-600">
                  {view.manifestIssues.map((issue) => (
                    <li key={issue}>• {issue}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-emerald-600">Installability validated.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Native shells (generic adapters)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              {view.shells.map((shell) => (
                <p key={shell.target} className="font-mono">
                  {shell.target}: {shell.adapter.offlineStrategy} · touch{" "}
                  {shell.adapter.minTouchTarget}px · back {shell.adapter.backBehaviour}
                  {shell.issues.length > 0 ? ` · ${shell.issues.length} issue(s)` : ""}
                </p>
              ))}
            </CardContent>
          </Card>
        </section>

        <p className="text-[11px] text-muted-foreground">
          Internal application for this reality:{" "}
          {view.experience.internalApplication.workspaces
            .map((workspace) => workspace.workspace)
            .join(", ") || "—"}{" "}
          · landing {view.experience.internalApplication.primary ?? "—"}
        </p>
      </main>

      {props.footer}
    </div>
  );
}
