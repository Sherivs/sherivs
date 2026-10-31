import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PLATFORM_NAME } from "@/lib/platform";
import { rpc } from "@/lib/scholar/rpc";
import { GlassPanel, PublicButton, inputClass } from "@/components/public/ui";

/** Public transcript verification (SHERIVS-020). Confirms authenticity only; no grades are shown. */
export const Route = createFileRoute("/(site)/verify-transcript")({
  component: Verify,
  head: () => ({ meta: [{ title: `Verify transcript — ${PLATFORM_NAME}` }] }),
});

function Verify() {
  const [code, setCode] = useState("");
  const [r, setR] = useState<{
    valid: boolean;
    school?: string;
    admission_number?: string;
    issued_at?: string;
  } | null>(null);
  return (
    <section className="mx-auto w-full max-w-xl px-[var(--sherivs-gutter)] py-16">
      <GlassPanel enter className="px-6 py-10 sm:px-10">
        <h1 className="sherivs-display text-3xl font-semibold">Verify a transcript</h1>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input
            className={inputClass}
            placeholder="Verification code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <PublicButton
            type="button"
            onClick={async () => setR(await rpc("verify_transcript", { p_code: code.trim() }))}
          >
            Verify
          </PublicButton>
        </div>
        {r &&
          (r.valid ? (
            <p className="mt-6 text-sm text-sherivs-success">
              Genuine transcript issued by {r.school} for admission number {r.admission_number} on{" "}
              {r.issued_at}.
            </p>
          ) : (
            <p className="mt-6 text-sm text-sherivs-warning">No transcript matches this code.</p>
          ))}
      </GlassPanel>
    </section>
  );
}
