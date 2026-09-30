import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PortalPage } from "@/components/portal-shell";
import {
  listIdentities,
  registerIdentity,
  type IdentitySummary,
} from "@/lib/identity-registry.functions";
import { IDENTITY_KINDS, IDENTITY_STATES } from "@/lib/identity-registry";

/**
 * Phase 02 Identity — workspace projection (P02-2).
 *
 * Reads REAL state: `listIdentities` resolves the tenant boundary from the
 * signed-in actor's school scope and returns the identities inside it. Nothing on
 * this page is manufactured — an empty tenant renders an empty list, and the
 * boundary the data was scoped to is shown so the operator can see it.
 */
export const Route = createFileRoute("/_authenticated/admin/identities")({
  ssr: false,
  // Access is enforced by the /admin layout guard, and for any data by the
  // canonical server-side gate. No role list is declared here: a hand-written list
  // of staff roles goes stale as the institution's catalog grows.
  component: IdentitiesPage,
});

const KIND_LABEL: Record<string, string> = {
  human: "Person",
  organization: "Organization",
  agent: "AI agent",
  service: "Service",
  device: "Device",
  runtime: "Runtime",
};

function IdentitiesPage() {
  const queryClient = useQueryClient();
  const list = useServerFn(listIdentities);
  const register = useServerFn(registerIdentity);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ kind: "human", display_name: "" });

  const {
    data,
    isLoading,
    isError,
    error: queryError,
  } = useQuery({
    queryKey: ["identities"],
    queryFn: () => list({ data: { limit: 50 } }),
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await register({
        data: {
          kind: form.kind as (typeof IDENTITY_KINDS)[number],
          display_name: form.display_name.trim(),
        },
      });
      setForm({ kind: "human", display_name: "" });
      await queryClient.invalidateQueries({ queryKey: ["identities"] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Registration failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <PortalPage
      title="Identities"
      subtitle="Every person, agent, service, device and organization the platform knows inside your institution."
    >
      <section className="uos-card p-6">
        <h2 className="font-display text-lg font-bold">Register an identity</h2>
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={submit}>
          <label className="text-sm">
            <span className="block text-muted-foreground">Kind</span>
            <select
              className="mt-1 rounded-md border border-border bg-transparent px-3 py-2"
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value })}
            >
              {IDENTITY_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABEL[kind] ?? kind}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-muted-foreground">Display name</span>
            <input
              required
              maxLength={200}
              className="mt-1 rounded-md border border-border bg-transparent px-3 py-2"
              value={form.display_name}
              onChange={(event) => setForm({ ...form, display_name: event.target.value })}
            />
          </label>
          <button
            type="submit"
            disabled={pending || form.display_name.trim().length === 0}
            className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            {pending ? "Registering…" : "Register identity"}
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </section>

      <section className="uos-card mt-6 p-6">
        <h2 className="font-display text-lg font-bold">Identities in this tenant</h2>
        {data && (
          <p className="mt-1 text-xs text-muted-foreground">
            Scoped to tenant <code>{data.tenant_id}</code> — resolved from your own session, never
            from the browser.
          </p>
        )}
        {isLoading && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
        {isError && (
          <p className="mt-4 text-sm text-destructive">
            {queryError instanceof Error ? queryError.message : "Could not load identities"}
          </p>
        )}
        {data && data.identities.length === 0 && !isLoading && (
          <p className="mt-4 text-sm text-muted-foreground">
            No identities registered in this tenant yet.
          </p>
        )}
        {data && data.identities.length > 0 && (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-2">Name</th>
                <th className="py-2">Kind</th>
                <th className="py-2">State</th>
                <th className="py-2">Verified</th>
              </tr>
            </thead>
            <tbody>
              {data.identities.map((identity: IdentitySummary) => (
                <tr key={identity.id} className="border-t border-border">
                  <td className="py-2">{identity.display_name}</td>
                  <td className="py-2">{KIND_LABEL[identity.kind] ?? identity.kind}</td>
                  <td className="py-2">{identity.state}</td>
                  <td className="py-2">{identity.verified ? "Yes" : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && (
          <p className="mt-4 text-xs text-muted-foreground">
            Lifecycle states: {IDENTITY_STATES.join(" → ")}
          </p>
        )}
      </section>
    </PortalPage>
  );
}
