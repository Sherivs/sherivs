/** Government portal layout (SHERIVS-027): own sign-in gate, own menu, no school chrome. */
import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { GovJurisdictionContext } from "@/lib/gov/context";
import { GOV_NAV, govMyJurisdictions, loadJurisdiction, saveJurisdiction } from "@/lib/gov/portal";

export const Route = createFileRoute("/gov")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
  },
  component: GovLayout,
});


function GovLayout() {
  const navigate = useNavigate();
  const mine = useQuery({ queryKey: ["gov-mine"], queryFn: govMyJurisdictions });
  const [sel, setSel] = useState("");
  useEffect(() => setSel(loadJurisdiction()), []);
  const list = mine.data ?? [];
  const current = list.find((j) => j.id === sel) ?? list[0] ?? null;

  if (mine.isLoading) return <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground" role="status">Loading…</div>;
  if (!list.length) {
    return (
      <main className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-xl font-semibold">No government access on this account</h1>
        <p className="mt-2 text-sm text-muted-foreground">Ask Sherivs to grant your ministry or board access to a state or LGA. School staff should use their school workspace.</p>
        <Button className="mt-4" variant="outline" onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }}>Sign out</Button>
      </main>
    );
  }
  return (
    <GovJurisdictionContext.Provider value={{ jurisdiction: current }}>
      <div className="min-h-dvh md:grid md:grid-cols-[220px_1fr]">
        <aside className="border-b p-4 md:border-b-0 md:border-r">
          <div className="text-sm font-semibold">Sherivs · Government</div>
          {list.length > 1 ? (
            <select className="mt-3 w-full rounded-md border bg-background p-2 text-sm" aria-label="Jurisdiction" value={current?.id}
              onChange={(e) => { setSel(e.target.value); saveJurisdiction(e.target.value); }}>
              {list.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
            </select>
          ) : <div className="mt-2 text-xs text-muted-foreground">{current?.name}</div>}
          <nav className="mt-4 flex gap-2 md:flex-col" aria-label="Government menu">
            {GOV_NAV.map((n) => (
              <Link key={n.to} to={n.to} activeOptions={{ exact: true }} className="rounded-md px-2 py-1 text-sm hover:bg-muted" activeProps={{ className: "bg-muted font-medium" }}>{n.label}</Link>
            ))}
          </nav>
          <Button size="sm" variant="ghost" className="mt-4" onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); }}>Sign out</Button>
        </aside>
        <main className="p-4 md:p-6"><Outlet /></main>
      </div>
    </GovJurisdictionContext.Provider>
  );
}
