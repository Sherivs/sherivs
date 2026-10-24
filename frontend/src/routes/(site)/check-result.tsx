import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PLATFORM_NAME } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rpc } from "@/lib/scholar/rpc";

/** Public result checker (SHERIVS-020): scratch-card serial + PIN + admission number. */
export const Route = createFileRoute("/(site)/check-result")({ component: CheckResult, head: () => ({ meta: [{ title: `Check result — ${PLATFORM_NAME}` }] }) });
type Res = { ok: boolean; error?: string; school?: string; term?: string; academic_year?: string; uses_left?: number;
  subjects?: { subject: string; ca: number; exam: number; total: number; grade: string }[] };

function CheckResult() {
  const [f, setF] = useState({ serial: "", pin: "", adm: "" }); const [r, setR] = useState<Res | null>(null); const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { setR(await rpc<Res>("check_result", { p_serial: f.serial.trim(), p_pin: f.pin.trim(), p_admission_number: f.adm.trim() })); }
    catch (e) { setR({ ok: false, error: (e as Error).message }); } finally { setBusy(false); }
  }
  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-semibold">Check your result</h1>
      <p className="mt-2 text-muted-foreground">Enter the serial and PIN from your scratch card, and the student's admission number.</p>
      <div className="mt-6 grid gap-3">
        <Input placeholder="Card serial (e.g. SRV1A2B3C4D5E)" value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} />
        <Input placeholder="12-digit PIN" inputMode="numeric" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} />
        <Input placeholder="Admission number" value={f.adm} onChange={(e) => setF({ ...f, adm: e.target.value })} />
        <Button disabled={busy} onClick={go}>{busy ? "Checking…" : "Check result"}</Button>
      </div>
      {r && !r.ok && <p className="mt-6 text-red-600">{r.error}</p>}
      {r?.ok && (
        <div className="mt-6 rounded-lg border p-4">
          <p className="font-medium">{r.school} · {r.term} {r.academic_year}</p>
          <table className="mt-3 w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th>Subject</th><th>CA</th><th>Exam</th><th>Total</th><th>Grade</th></tr></thead>
            <tbody>{(r.subjects ?? []).map((s) => <tr key={s.subject} className="border-t"><td>{s.subject}</td><td>{s.ca}</td><td>{s.exam}</td><td>{s.total}</td><td>{s.grade}</td></tr>)}</tbody></table>
          {(r.subjects ?? []).length === 0 && <p className="text-sm text-muted-foreground">Results for this term are not published yet.</p>}
          <p className="mt-3 text-xs text-muted-foreground">{r.uses_left} checks left on this card.</p>
        </div>)}
    </section>
  );
}
