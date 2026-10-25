import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rpc } from "@/lib/scholar/rpc";
import { useGovJurisdiction } from "@/lib/gov/context";
import { canDo, govCirculars } from "@/lib/gov/modules";

export const Route = createFileRoute("/gov/circulars")({ ssr: false, component: GovCirculars });

function GovCirculars() {
  const j = useGovJurisdiction();
  const qc = useQueryClient();
  const role = (j as { agency_role?: string | null } | null)?.agency_role ?? null;
  const list = useQuery({ queryKey: ["gov-circ", j?.id], enabled: !!j, queryFn: () => govCirculars(j!.id) });
  const [f, setF] = useState({ title: "", body: "", lgas: "", ref: "", ack: true });
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (fn: string, args: Record<string, unknown>) => {
    setMsg(null);
    try { await rpc(fn, args); await qc.invalidateQueries({ queryKey: ["gov-circ", j?.id] }); return true; } catch (e) { setMsg((e as Error).message); return false; }
  };
  return (
    <section>
      <h1 className="text-xl font-semibold">Circulars</h1>
      <p className="text-sm text-muted-foreground">Sent to schools that share with {j?.name}; optionally only to some LGAs.</p>
      {msg && <p className="mt-2 text-sm text-destructive" role="alert">{msg}</p>}
      {canDo(role, "publish") && (
        <div className="mt-3 space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap gap-2">
            <Input className="max-w-40" placeholder="Ref no. (optional)" value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />
            <Input className="flex-1" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </div>
          <textarea className="w-full rounded-md border bg-background p-2 text-sm" rows={4} placeholder="Message (at least 20 characters)" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          <div className="flex flex-wrap items-center gap-2">
            <Input className="flex-1" placeholder="LGAs, comma separated (blank = all)" value={f.lgas} onChange={(e) => setF({ ...f, lgas: e.target.value })} />
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.ack} onChange={(e) => setF({ ...f, ack: e.target.checked })} /> Ask schools to acknowledge</label>
            <Button disabled={f.title.trim().length < 5 || f.body.trim().length < 20} onClick={async () => {
              const lgas = f.lgas.split(",").map((x) => x.trim()).filter(Boolean);
              if (await act("gov_circular_publish", { p_jurisdiction: j!.id, p_title: f.title, p_body: f.body, p_lgas: lgas.length ? lgas : null, p_requires_ack: f.ack, p_ref_no: f.ref || null }))
                setF({ title: "", body: "", lgas: "", ref: "", ack: true }); }}>Publish</Button>
          </div>
        </div>
      )}
      <ul className="mt-4 space-y-3">
        {(list.data ?? []).map((c) => (
          <li key={c.id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{c.ref_no ? `${c.ref_no} · ` : ""}{c.title}{c.withdrawn ? " (withdrawn)" : ""}</span>
              <span className="text-muted-foreground">{c.published_at.slice(0, 10)} · {c.acked}/{c.recipients} acknowledged{c.lgas?.length ? ` · ${c.lgas.join(", ")}` : ""}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
            {!c.withdrawn && canDo(role, "publish") && <Button size="sm" variant="ghost" className="mt-1" onClick={() => { if (confirm("Withdraw this circular?")) void act("gov_circular_withdraw", { p_id: c.id }); }}>Withdraw</Button>}
          </li>))}
      </ul>
    </section>
  );
}
