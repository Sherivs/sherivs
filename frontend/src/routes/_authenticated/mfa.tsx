import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import { takeMfaReturn } from "@/lib/head-console/host";
import { pickEnrolment, pickVerifiedFactorId, runMfaStep } from "@/lib/security/mfa-flow";

/**
 * Security P2 — TOTP enrolment + challenge. Internal users (super admins,
 * platform staff) must reach AAL2 before /internal/* opens.
 */
export const Route = createFileRoute("/_authenticated/mfa")({
  ssr: false,
  component: MfaPage,
});

type SetupState =
  | { kind: "loading" }
  | { kind: "ready"; factorId: string; qr: string | null }
  | { kind: "failed"; message: string };

function MfaPage() {
  const navigate = useNavigate();
  const [setup, setSetup] = useState<SetupState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSetup({ kind: "loading" });
    void (async () => {
      const aal = await runMfaStep(
        "setup",
        () => supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        (d) => d,
      );
      if (cancelled) return;
      if (aal.ok && aal.value.currentLevel === "aal2") {
        navigate({ to: takeMfaReturn("/internal") as "/internal", replace: true });
        return;
      }
      const factors = await runMfaStep(
        "setup",
        () => supabase.auth.mfa.listFactors(),
        (d) => ({ verifiedId: pickVerifiedFactorId(d) }),
      );
      if (cancelled) return;
      if (!factors.ok) return setSetup({ kind: "failed", message: factors.message });
      if (factors.value.verifiedId) {
        return setSetup({ kind: "ready", factorId: factors.value.verifiedId, qr: null });
      }
      const enrolled = await runMfaStep(
        "setup",
        () =>
          supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Sherivs authenticator" }),
        pickEnrolment,
      );
      if (cancelled) return;
      if (!enrolled.ok) return setSetup({ kind: "failed", message: enrolled.message });
      setSetup({ kind: "ready", factorId: enrolled.value.id, qr: enrolled.value.qr });
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, attempt]);

  async function verify() {
    if (setup.kind !== "ready") return;
    setBusy(true);
    setError(null);
    const result = await runMfaStep(
      "verify",
      () => supabase.auth.mfa.challengeAndVerify({ factorId: setup.factorId, code: code.trim() }),
      () => true,
    );
    setBusy(false);
    if (!result.ok) {
      setCode("");
      return setError(result.message);
    }
    navigate({ to: takeMfaReturn("/internal") as "/internal", replace: true });
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4 px-4 py-10 text-sm">
      <SherivsLogo size={40} wordmarkClassName="text-xl" />
      <h1 className="font-display text-2xl font-bold">Two-factor verification</h1>
      {setup.kind === "loading" && (
        <p className="text-muted-foreground" role="status">
          Preparing two-factor verification…
        </p>
      )}
      {setup.kind === "failed" && (
        <div role="alert" data-testid="mfa-setup-error" className="space-y-3">
          <p className="text-destructive">{setup.message}</p>
          <button
            type="button"
            className="rounded bg-primary px-4 py-2 text-primary-foreground"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {setup.kind === "ready" && (
        <>
          <p className="text-muted-foreground">
            Internal access requires an authenticator app (TOTP).
            {setup.qr
              ? " Scan this code, then enter the 6-digit code."
              : " Enter the 6-digit code."}
          </p>
          {setup.qr && <img src={setup.qr} alt="Authenticator QR code" className="h-48 w-48" />}
          <input
            className="w-full rounded border px-3 py-2"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            aria-label="6-digit code"
          />
          {error && (
            <p role="alert" data-testid="mfa-verify-error" className="text-destructive">
              {error}
            </p>
          )}
          <button
            type="button"
            className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
            disabled={busy || code.trim().length !== 6}
            onClick={verify}
          >
            {error ? "Try again" : "Verify"}
          </button>
        </>
      )}
    </div>
  );
}
