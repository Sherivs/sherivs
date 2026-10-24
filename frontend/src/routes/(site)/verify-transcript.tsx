import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PLATFORM_NAME } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rpc } from "@/lib/scholar/rpc";

/** Public transcript verification (SHERIVS-020). Confirms authenticity only; no grades are shown. */
export const Route = createFileRoute("/(site)/verify-transcript")({ component: Verify, head: () => ({ meta: [{ title: `Verify transcript — ${PLATFORM_NAME}` }] }) });

function Verify() {
  const [code, setCode] = useState(""); const [r, setR] = useState<{ valid: boolean; school?: string; admission_number?: string; issued_at?: string } | null>(null);
  return (
    <section className="mx-auto w-full max-w-xl px-4 py-16">
      <h1 className="text-3xl font-semibold">Verify a transcript</h1>
      <div className="mt-6 flex gap-2"><Input placeholder="Verification code" value={code} onChange={(e) => setCode(e.target.value)} />
        <Button onClick={async () => setR(await rpc("verify_transcript", { p_code: code.trim() }))}>Verify</Button></div>
      {r && (r.valid
        ? <p className="mt-6 text-emerald-700">Genuine transcript issued by {r.school} for admission number {r.admission_number} on {r.issued_at}.</p>
        : <p className="mt-6 text-red-600">No transcript matches this code.</p>)}
    </section>
  );
}
