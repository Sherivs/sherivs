/** Stores (inventory) and fixed-asset register (SHERIVS-024). */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { naira, rows, rpc, sdb } from "@/lib/scholar/rpc";

export const Route = createFileRoute("/_authenticated/admin/stores-assets")({ ssr: false, component: StoresAssets });

function StoresAssets() {
  const { school } = useApp(); const org = school?.id ?? ""; const qc = useQueryClient();
  const [item, setItem] = useState({ sku: "", name: "", unit: "pcs", reorder: "0" }); const [move, setMove] = useState<Record<string, string>>({});
  const [asset, setAsset] = useState({ tag: "", name: "", category: "ICT", cost: "", acquired: "", life: "5" });
  const items = useQuery({ queryKey: ["inv", org], enabled: !!org, queryFn: () => rows<{ id: string; sku: string; name: string; unit: string; qty: number; reorder_level: number }>(sdb.from("inventory_items").select("id,sku,name,unit,qty,reorder_level").eq("school_id", org).order("name")) });
  const assets = useQuery({ queryKey: ["assets", org], enabled: !!org, queryFn: () => rows<{ id: string; tag: string; name: string; status: string; cost: number }>(sdb.from("fixed_assets").select("id,tag,name,status,cost").eq("school_id", org).order("tag")) });
  async function go(fn: string, args: Record<string, unknown>, ok: string) { try { await rpc(fn, args); toast.success(ok); await qc.invalidateQueries(); } catch (e) { toast.error((e as Error).message); } }
  return (
    <PortalPage title="Stores & assets" subtitle="Stock can never go below zero, and every movement is kept.">
      <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium">Items</h3>
        <div className="grid gap-2 md:grid-cols-5"><Input placeholder="SKU" value={item.sku} onChange={(e) => setItem({ ...item, sku: e.target.value })} /><Input placeholder="Name" value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} />
          <Input placeholder="Unit" value={item.unit} onChange={(e) => setItem({ ...item, unit: e.target.value })} /><Input placeholder="Reorder at" value={item.reorder} onChange={(e) => setItem({ ...item, reorder: e.target.value })} />
          <Button onClick={() => go("inventory_item_upsert", { p_school: org, p_sku: item.sku, p_name: item.name, p_unit: item.unit, p_reorder: Number(item.reorder) }, "Saved")}>Save item</Button></div>
        <table className="w-full text-sm"><tbody>{(items.data ?? []).map((i) => (
          <tr key={i.id} className="border-t"><td>{i.sku}</td><td>{i.name}</td><td className={i.qty <= i.reorder_level ? "text-red-600" : ""}>{i.qty} {i.unit}</td>
            <td><Input className="w-24" placeholder="qty" value={move[i.id] ?? ""} onChange={(e) => setMove({ ...move, [i.id]: e.target.value })} /></td>
            <td className="flex gap-1"><Button size="sm" onClick={() => go("inventory_move", { p_item: i.id, p_delta: Number(move[i.id]), p_reason: "purchase" }, "Received")}>Receive</Button>
              <Button size="sm" variant="outline" onClick={() => go("inventory_move", { p_item: i.id, p_delta: -Number(move[i.id]), p_reason: "issue" }, "Issued")}>Issue</Button></td></tr>))}</tbody></table></div>
      <div className="mt-4 space-y-2 rounded-lg border p-3"><h3 className="font-medium">Fixed assets</h3>
        <div className="grid gap-2 md:grid-cols-6">{(["tag", "name", "category", "cost"] as const).map((k) => <Input key={k} placeholder={k} value={asset[k]} onChange={(e) => setAsset({ ...asset, [k]: e.target.value })} />)}
          <Input type="date" value={asset.acquired} onChange={(e) => setAsset({ ...asset, acquired: e.target.value })} aria-label="Acquired" />
          <Button onClick={() => go("asset_register", { p_school: org, p_tag: asset.tag, p_name: asset.name, p_category: asset.category, p_cost: Number(asset.cost), p_acquired: asset.acquired, p_life: Number(asset.life) }, "Registered")}>Register</Button></div>
        <ul className="text-sm">{(assets.data ?? []).map((a) => <li key={a.id} className="flex justify-between border-t py-1"><span>{a.tag} · {a.name} · {naira(a.cost)} · {a.status}</span>
          {a.status !== "disposed" && <Button size="sm" variant="outline" onClick={() => go("asset_update", { p_asset: a.id, p_status: "disposed" }, "Disposed")}>Dispose</Button>}</li>)}</ul></div>
    </PortalPage>);
}
