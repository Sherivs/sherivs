import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PLATFORM_NAME } from "@/lib/platform";
import { rpc } from "@/lib/scholar/rpc";
import { GlassPanel, PublicButton, inputClass } from "@/components/public/ui";

/** Public result checker (SHERIVS-020): scratch-card serial + PIN + admission number. */
export const Route = createFileRoute("/(site)/check-result")({
  component: CheckResult,
  head: () => ({ meta: [{ title: `Check result — ${PLATFORM_NAME}` }] }),
});
type Res = {
  ok: boolean;
  error?: string;
  school?: string;
  term?: string;
  academic_year?: string;
  uses_left?: number;
  subjects?: { subject: string; ca: number; exam: number; total: number; grade: string }[];
};

function CheckResult() {
  const [f, setF] = useState({ serial: "", pin: "", adm: "" });
  const [r, setR] = useState<Res | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      setR(
        await rpc<Res>("check_result", {
          p_serial: f.serial.trim(),
          p_pin: f.pin.trim(),
          p_admission_number: f.adm.trim(),
        }),
      );
    } catch (e) {
      setR({ ok: false, error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto w-full max-w-2xl px-[var(--sherivs-gutter)] py-16">
      <GlassPanel enter className="px-6 py-10 sm:px-10">
        <h1 className="sherivs-display text-3xl font-semibold">Check your result</h1>
        <p className="mt-2 text-sm text-sherivs-muted">
          Enter the serial and PIN from your scratch card, and the student&apos;s admission number.
        </p>
        <div className="mt-6 grid gap-3">
          <input
            className={inputClass}
            placeholder="Card serial (e.g. SRV1A2B3C4D5E)"
            value={f.serial}
            onChange={(e) => setF({ ...f, serial: e.target.value })}
          />
          <input
            className={inputClass}
            placeholder="12-digit PIN"
            inputMode="numeric"
            value={f.pin}
            onChange={(e) => setF({ ...f, pin: e.target.value })}
          />
          <input
            className={inputClass}
            placeholder="Admission number"
            value={f.adm}
            onChange={(e) => setF({ ...f, adm: e.target.value })}
          />
          <PublicButton type="button" disabled={busy} onClick={go}>
            {busy ? "Checking…" : "Check result"}
          </PublicButton>
        </div>
        {r && !r.ok && <p className="mt-6 text-sherivs-warning">{r.error}</p>}
        {r?.ok && (
          <div className="sherivs-glass-card mt-6 rounded-[var(--sherivs-radius)] p-4">
            <p className="font-medium">
              {r.school} · {r.term} {r.academic_year}
            </p>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-sherivs-muted">
                  <th>Subject</th>
                  <th>CA</th>
                  <th>Exam</th>
                  <th>Total</th>
                  <th>Grade</th>
                </tr>
              </thead>
              <tbody>
                {(r.subjects ?? []).map((s) => (
                  <tr key={s.subject} className="border-t border-[var(--sherivs-border)]">
                    <td>{s.subject}</td>
                    <td>{s.ca}</td>
                    <td>{s.exam}</td>
                    <td>{s.total}</td>
                    <td>{s.grade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(r.subjects ?? []).length === 0 && (
              <p className="text-sm text-sherivs-muted">
                Results for this term are not published yet.
              </p>
            )}
            <p className="mt-3 text-xs text-sherivs-muted">
              {r.uses_left} checks left on this card.
            </p>
          </div>
        )}
      </GlassPanel>
    </section>
  );
}
