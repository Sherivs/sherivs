import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PortalPage } from "@/components/portal-shell";
import { listTenants, registerTenant, type TenantSummary } from "@/lib/tenant-registry.functions";
import { TENANT_STATUSES, TENANT_ENVIRONMENTS } from "@/lib/tenant-registry";

/**
 * Phase 03 Multi-Tenancy — workspace projection (P03-4).
 *
 * The platform control plane: every row comes from `cg_tenant` through
 * `listTenants`, which runs behind the canonical super-admin gate (fail closed).
 * Hierarchy is shown as a parent reference only — the surface never implies that
 * a parent tenant can reach a child tenant's resources (Invariant 14).
 */
export const Route = createFileRoute("/_authenticated/super-admin/tenants")({
  // Platform control plane. Access is enforced by the super-admin layout guard and,
  // server-side, by `requirePlatformSuperAdmin` inside every function this page
  // calls (fail closed) — no role list is declared here.
  component: TenantsPage,
  head: () => ({ meta: [{ title: "Tenants — Sherivs" }] }),
});

function TenantsPage() {
  const queryClient = useQueryClient();
  const list = useServerFn(listTenants);
  const create = useServerFn(registerTenant);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", slug: "", tenant_type: "school", region: "" });

  const {
    data,
    isLoading,
    isError,
    error: queryError,
  } = useQuery({
    queryKey: ["tenants"],
    queryFn: () => list({ data: { limit: 100 } }),
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await create({
        data: {
          tenant_type: form.tenant_type.trim(),
          name: form.name.trim(),
          slug: form.slug.trim(),
          region: form.region.trim() === "" ? null : form.region.trim(),
        },
      });
      setNotice(
        result.duplicated
          ? `Tenant ${result.slug} already existed — returned the existing environment (idempotent provisioning).`
          : `Tenant ${result.slug} registered in state ${result.status}.`,
      );
      setForm({ name: "", slug: "", tenant_type: "school", region: "" });
      await queryClient.invalidateQueries({ queryKey: ["tenants"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Registration failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <PortalPage
      title="Tenants"
      subtitle="Every institution, network, ministry and enterprise the platform hosts — with its lifecycle state, region and hierarchy."
    >
      <section className="uos-card p-6">
        <h2 className="font-display text-lg font-bold">Register a tenant</h2>
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={submit}>
          <label className="text-sm">
            <span className="block text-muted-foreground">Name</span>
            <input
              required
              maxLength={200}
              className="mt-1 rounded-md border border-border bg-transparent px-3 py-2"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="block text-muted-foreground">Slug</span>
            <input
              required
              pattern="[a-z0-9](?:[a-z0-9-]{0,60}[a-z0-9])?"
              className="mt-1 rounded-md border border-border bg-transparent px-3 py-2"
              value={form.slug}
              onChange={(event) => setForm({ ...form, slug: event.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="block text-muted-foreground">Type</span>
            <input
              required
              maxLength={80}
              className="mt-1 rounded-md border border-border bg-transparent px-3 py-2"
              value={form.tenant_type}
              onChange={(event) => setForm({ ...form, tenant_type: event.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="block text-muted-foreground">Region</span>
            <input
              maxLength={120}
              className="mt-1 rounded-md border border-border bg-transparent px-3 py-2"
              value={form.region}
              onChange={(event) => setForm({ ...form, region: event.target.value })}
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            {pending ? "Registering…" : "Register tenant"}
          </button>
        </form>
        {notice && <p className="mt-3 text-sm text-muted-foreground">{notice}</p>}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">Tenants on this platform</h2>
        {isLoading && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
        {isError && (
          <p className="mt-4 text-sm text-destructive">
            {queryError instanceof Error ? queryError.message : "Could not load tenants"}
          </p>
        )}
        {data && data.tenants.length === 0 && !isLoading && (
          <p className="mt-4 text-sm text-muted-foreground">No tenants registered yet.</p>
        )}
        {data && data.tenants.length > 0 && (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2">Name</th>
                <th className="py-2">Slug</th>
                <th className="py-2">Type</th>
                <th className="py-2">Status</th>
                <th className="py-2">Environment</th>
                <th className="py-2">Region</th>
                <th className="py-2">Parent</th>
              </tr>
            </thead>
            <tbody>
              {data.tenants.map((tenant: TenantSummary) => (
                <tr key={tenant.id} className="border-t border-border">
                  <td className="py-2">{tenant.name}</td>
                  <td className="py-2">{tenant.slug}</td>
                  <td className="py-2">{tenant.tenant_type}</td>
                  <td className="py-2">{tenant.status}</td>
                  <td className="py-2">{tenant.environment}</td>
                  <td className="py-2">{tenant.region ?? "—"}</td>
                  <td className="py-2">
                    {tenant.parent_tenant_id ? tenant.parent_tenant_id.slice(0, 8) : "root"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Lifecycle: {TENANT_STATUSES.join(" → ")} · Environments: {TENANT_ENVIRONMENTS.join(", ")}.
          A parent tenant never inherits access to a child tenant&apos;s resources.
        </p>
      </section>
    </PortalPage>
  );
}
