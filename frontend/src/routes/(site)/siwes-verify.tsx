import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PLATFORM_NAME } from "@/lib/platform";
import { rpc } from "@/lib/scholar/rpc";
import { GlassPanel, PublicButton, inputClass } from "@/components/public/ui";

/** Public SIWES logbook verification for industry supervisors (SHERIVS-023). */
export const Route = createFileRoute("/(site)/siwes-verify")({
  component: SiwesVerify,
  head: () => ({ meta: [{ title: `SIWES logbook verification — ${PLATFORM_NAME}` }] }),
});

function SiwesVerify() {
  const [f, setF] = useState({ placement: "", code: "", week: "1", note: "" });
  const [msg, setMsg] = useState("");
  async function go() {
    try {
      const r = await rpc<{ ok: boolean; error?: string }>("siwes_supervisor_verify", {
        p_placement: f.placement.trim(),
        p_code: f.code.trim(),
        p_week: Number(f.week),
        p_note: f.note || null,
      });
      setMsg(r.ok ? `Week ${f.week} verified. Thank you.` : `Not verified: ${r.error}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  return (
    <section className="mx-auto w-full max-w-xl px-[var(--sherivs-gutter)] py-16">
      <GlassPanel enter className="px-6 py-10 sm:px-10">
        <h1 className="sherivs-display text-3xl font-semibold">Verify a SIWES logbook week</h1>
        <p className="mt-2 text-sm text-sherivs-muted">
          Use the placement link and supervisor code the institution gave you.
        </p>
        <div className="mt-6 grid gap-3">
          <input
            className={inputClass}
            placeholder="Placement ID"
            value={f.placement}
            onChange={(e) => setF({ ...f, placement: e.target.value })}
          />
          <input
            className={inputClass}
            placeholder="Supervisor code"
            value={f.code}
            onChange={(e) => setF({ ...f, code: e.target.value })}
          />
          <input
            className={inputClass}
            placeholder="Week"
            inputMode="numeric"
            value={f.week}
            onChange={(e) => setF({ ...f, week: e.target.value })}
          />
          <input
            className={inputClass}
            placeholder="Comment (optional)"
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
          />
          <PublicButton type="button" onClick={go}>
            Verify week
          </PublicButton>
        </div>
        {msg && <p className="mt-6 text-sm">{msg}</p>}
      </GlassPanel>
    </section>
  );
}
