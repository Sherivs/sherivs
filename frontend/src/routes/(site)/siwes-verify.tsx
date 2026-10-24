import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PLATFORM_NAME } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rpc } from "@/lib/scholar/rpc";

/** Public SIWES logbook verification for industry supervisors (SHERIVS-023). */
export const Route = createFileRoute("/(site)/siwes-verify")({ component: SiwesVerify, head: () => ({ meta: [{ title: `SIWES logbook verification — ${PLATFORM_NAME}` }] }) });

function SiwesVerify() {
  const [f, setF] = useState({ placement: "", code: "", week: "1", note: "" }); const [msg, setMsg] = useState("");
  async function go() {
    try { const r = await rpc<{ ok: boolean; error?: string }>("siwes_supervisor_verify", { p_placement: f.placement.trim(), p_code: f.code.trim(), p_week: Number(f.week), p_note: f.note || null });
      setMsg(r.ok ? `Week ${f.week} verified. Thank you.` : `Not verified: ${r.error}`); }
    catch (e) { setMsg((e as Error).message); }
  }
  return (
    <section className="mx-auto w-full max-w-xl px-4 py-16">
      <h1 className="text-3xl font-semibold">Verify a SIWES logbook week</h1>
      <p className="mt-2 text-muted-foreground">Use the placement link and supervisor code the institution gave you.</p>
      <div className="mt-6 grid gap-3">
        <Input placeholder="Placement ID" value={f.placement} onChange={(e) => setF({ ...f, placement: e.target.value })} />
        <Input placeholder="Supervisor code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        <Input placeholder="Week" inputMode="numeric" value={f.week} onChange={(e) => setF({ ...f, week: e.target.value })} />
        <Input placeholder="Comment (optional)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <Button onClick={go}>Verify week</Button>
      </div>
      {msg && <p className="mt-6">{msg}</p>}
    </section>);
}
