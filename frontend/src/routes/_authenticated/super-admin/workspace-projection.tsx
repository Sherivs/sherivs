import { createFileRoute } from "@tanstack/react-router";

import { PortalPage } from "@/components/portal-shell";
import { composeWorkspaces } from "@/lib/workspace-projection";
import {
  SCHOLAR_WORKSPACE_KINDS,
  scholarCompositionInputs,
  scholarRoleWorkspaceCoverage,
  scholarRoleWorkspaceSample,
} from "@/lib/runtime/scholar-workspace-projection";

/**
 * Phase 06 — Workspace Engine (platform, control plane).
 *
 * Access is enforced by the super-admin layout guard and, for any data, by the
 * canonical server-side gate. This page declares NO role list of its own: a
 * hand-written list of roles is exactly what goes stale — the installed runtime catalog
 * defines hundreds of reality roles and grows with the institution.
 *
 * Everything rendered here is catalog-derived: the neutral Phase 06 engine composes
 * navigation per workspace kind, and the runtime adapter supplies the kinds,
 * the contributions, the full reality-role registry, its coverage and the role
 * workspace engine's own audit findings.
 */
export const Route = createFileRoute("/_authenticated/super-admin/workspace-projection")({
  component: WorkspaceProjectionPage,
  head: () => ({ meta: [{ title: "Workspace projection — Sherivs" }] }),
});

function WorkspaceProjectionPage() {
  const compositions = composeWorkspaces(scholarCompositionInputs());
  const coverage = scholarRoleWorkspaceCoverage();
  const sample = scholarRoleWorkspaceSample(20);

  return (
    <PortalPage
      title="Workspace projection"
      subtitle="The workspace is a projection of authority: what each kind of workspace receives, and how the full reality-role registry maps onto workspaces."
    >
      <section className="uos-card p-6">
        <h2 className="font-display text-lg font-bold">Reality roles and workspace coverage</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {coverage.roleCount} roles in the registry (catalog-derived — the count grows with the
          institution; no role is enumerated by hand here).
        </p>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2">Workspace</th>
              <th className="py-2">Label</th>
              <th className="py-2">Roles requiring it</th>
            </tr>
          </thead>
          <tbody>
            {coverage.workspaces.map((workspace) => (
              <tr key={workspace.key} className="border-t border-border">
                <td className="py-2 font-mono text-xs">{workspace.key}</td>
                <td className="py-2">{workspace.label}</td>
                <td className="py-2">{workspace.roleCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {coverage.unassignedRoleIds.length > 0 && (
          <p className="mt-3 text-xs text-destructive">
            {coverage.unassignedRoleIds.length} role(s) declare no workspace requirement:{" "}
            {coverage.unassignedRoleIds.slice(0, 10).join(", ")}
            {coverage.unassignedRoleIds.length > 10 ? "…" : ""}
          </p>
        )}
        {coverage.auditFindings.length > 0 && (
          <div className="mt-3 text-xs text-muted-foreground">
            Role-workspace audit findings: {coverage.auditFindings.length}
            <ul className="mt-1 list-disc pl-5">
              {coverage.auditFindings.slice(0, 5).map((finding) => (
                <li key={finding}>{finding}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">Composition by workspace kind</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {SCHOLAR_WORKSPACE_KINDS.length} kinds declared by the installed runtime catalog.
          Navigation items are withheld when their required capabilities are absent — derived from
          authorization, never from the UI.
        </p>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2">Kind</th>
              <th className="py-2">Capabilities</th>
              <th className="py-2">Sections</th>
              <th className="py-2">Items</th>
              <th className="py-2">Home</th>
            </tr>
          </thead>
          <tbody>
            {compositions.map((composition) => (
              <tr key={composition.key} className="border-t border-border">
                <td className="py-2 font-mono text-xs">{composition.key}</td>
                <td className="py-2">{composition.capabilityCount}</td>
                <td className="py-2">{composition.sectionCount}</td>
                <td className="py-2">{composition.itemCount}</td>
                <td className="py-2 font-mono text-xs">{composition.home ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {compositions.some((composition) => composition.empty) && (
          <p className="mt-4 text-xs text-muted-foreground">
            Kinds resolving to an empty workspace:{" "}
            {compositions
              .filter((composition) => composition.empty)
              .map((composition) => composition.key)
              .join(", ")}
            .
          </p>
        )}
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">
          Role → workspace sample ({sample.length} of {coverage.roleCount})
        </h2>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2">Role</th>
              <th className="py-2">Category</th>
              <th className="py-2">Workspaces</th>
            </tr>
          </thead>
          <tbody>
            {sample.map((row) => (
              <tr key={row.roleId} className="border-t border-border">
                <td className="py-2">{row.name}</td>
                <td className="py-2 font-mono text-xs">{row.category}</td>
                <td className="py-2 text-xs text-muted-foreground">
                  {row.workspaces.length > 0 ? row.workspaces.join(", ") : "— none declared"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </PortalPage>
  );
}
