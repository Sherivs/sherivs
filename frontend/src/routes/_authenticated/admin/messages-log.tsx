/** Messaging log (SHERIVS-020): every SMS/WhatsApp attempt with status, cost and consent outcome. */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Badge } from "@/components/ui/badge";
import { naira, rows, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/messages-log")({ ssr: false, component: Log });
type Msg = { id: string; channel: string; to_address: string; template_code: string; language: string; status: string; cost: number; provider: string; created_at: string };

function Log() {
  const { school } = useApp(); const org = school?.id ?? "";
  const msgs = useQuery({ queryKey: ["outbound", org], enabled: !!org, queryFn: () => rows<Msg>(sdb.from("outbound_messages").select("id,channel,to_address,template_code,language,status,cost,provider,created_at").eq("school_id", org).order("created_at", { ascending: false }).limit(200)) });
  const tone = (s: string) => (s.startsWith("blocked") || s === "failed" ? "destructive" : "outline") as "destructive" | "outline";
  return (
    <PortalPage title="Messaging log" subtitle="Live sending is off until a provider account is connected; messages are recorded by the stub adapter.">
      <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>When</th><th>Channel</th><th>To</th><th>Template</th><th>Status</th><th>Cost</th></tr></thead>
        <tbody>{(msgs.data ?? []).map((m) => (
          <tr key={m.id} className="border-t"><td>{new Date(m.created_at).toLocaleString()}</td><td>{m.channel} · {m.provider}</td><td>{m.to_address.replace(/\d(?=\d{4})/g, "•")}</td>
            <td>{m.template_code} ({m.language})</td><td><Badge variant={tone(m.status)}>{m.status.replace("_", " ")}</Badge></td><td>{naira(m.cost)}</td></tr>))}</tbody></table>
    </PortalPage>
  );
}
