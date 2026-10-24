/**
 * School domains (SHERIVS-029). A school admin adds its own address (portal.school.sch.ng,
 * school.edu.ng for accredited tertiary institutions, or any domain it owns), copies the DNS
 * records, and asks Sherivs to verify. Verified domains serve the school's branded login and
 * public website; only that school's members can sign in there.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";
import { dnsInstructions, type SchoolDomain } from "@/lib/domains/school-domains";
import { verifySchoolDomain } from "@/lib/domains/school-domains.functions";

export const Route = createFileRoute("/_authenticated/admin/domains")({ ssr: false, component: DomainsPage });

const PURPOSES = [
  { v: "app", l: "Login + app + public website" },
  { v: "public_site", l: "Public website only" },
  { v: "login", l: "Login only" },
] as const;

function DomainsPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const verify = useServerFn(verifySchoolDomain);
  const [host, setHost] = useState("");
  const [purpose, setPurpose] = useState<string>("app");
  const [busy, setBusy] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["school-domains", org], enabled: !!org,
    queryFn: () => rows<SchoolDomain>(sdb.from("school_domains").select("*").eq("school_id", org).order("created_at", { ascending: false })),
  });
  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try { await fn(); toast.success(ok); await qc.invalidateQueries({ queryKey: ["school-domains", org] }); }
    catch (e) { toast.error((e as Error).message); }
    finally { setBusy(null); }
  }
  const live = (list.data ?? []).filter((d) => d.status !== "removed");
  return (
    <PortalPage title="School domains" subtitle="Use your school's own address instead of a sherivs.com link. Sherivs keeps running everything underneath.">
      <div className="space-y-2 rounded-lg border p-3">
        <h3 className="font-medium">Add a domain</h3>
        <p className="text-sm text-muted-foreground">
          Primary and secondary schools: .sch.ng (for example portal.yourschool.sch.ng). Universities, polytechnics and colleges of
          education: .edu.ng. Buy it from a NiRA-accredited registrar first; Sherivs cannot register it for you.
        </p>
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-sm" placeholder="portal.yourschool.sch.ng" value={host} onChange={(e) => setHost(e.target.value)} aria-label="Domain" />
          <select className="rounded-md border bg-background p-2 text-sm" value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="Purpose">
            {PURPOSES.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
          <Button disabled={!host || busy === "add"} onClick={() => run("add", () => rpc("school_domain_add", { p_hostname: host, p_purpose: purpose }).then(() => setHost("")), "Domain added: now create the DNS records below")}>Add</Button>
        </div>
      </div>
      {list.error && <p className="mt-3 text-sm text-destructive">{(list.error as Error).message}</p>}
      <div className="mt-4 space-y-3">
        {live.map((d) => {
          const dns = dnsInstructions(d);
          return (
            <div key={d.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{d.hostname}</span>
                <span className="rounded border px-1.5 text-xs">{d.status}</span>
                {d.is_primary && <span className="rounded border px-1.5 text-xs">primary</span>}
                <span className="text-xs text-muted-foreground">{PURPOSES.find((p) => p.v === d.purpose)?.l}</span>
              </div>
              {d.status !== "verified" && (
                <table className="mt-2 w-full text-left text-xs">
                  <thead><tr className="text-muted-foreground"><th>Type</th><th>Name / host</th><th>Value</th></tr></thead>
                  <tbody>
                    <tr><td>{dns.apex ? "A" : "CNAME"}</td><td className="font-mono">{dns.cname.name}</td><td className="font-mono">{dns.cname.target}</td></tr>
                    <tr><td>TXT</td><td className="font-mono">{dns.txt.name}</td><td className="font-mono break-all">{dns.txt.value}</td></tr>
                  </tbody>
                </table>
              )}
              {d.failure_reason && <p className="mt-1 text-xs text-destructive">{d.failure_reason}</p>}
              {d.status === "verified" && d.vercel_status !== "added" && (
                <p className="mt-1 text-xs text-muted-foreground">Verified. Sherivs is attaching the address to the platform (status: {d.vercel_status}).</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" disabled={busy === d.id} onClick={() => run(d.id, () => verify({ data: { id: d.id } }), "Check finished")}>Check DNS</Button>
                {d.status === "verified" && !d.is_primary && (
                  <Button size="sm" variant="outline" onClick={() => run(d.id, () => rpc("school_domain_set_primary", { p_id: d.id }), "Primary domain set")}>Make primary</Button>
                )}
                <Button size="sm" variant="outline" onClick={() => run(d.id, () => rpc("school_domain_remove", { p_id: d.id }), "Domain removed")}>Remove</Button>
              </div>
            </div>
          );
        })}
      </div>
    </PortalPage>
  );
}
