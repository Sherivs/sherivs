import { useState } from "react";
import { Fingerprint, Shield } from "lucide-react";
import { SherivsMark } from "@/components/brand/sherivs-logo";
import { Switch } from "@/components/ui/switch";
import {
  PASSKEY_ENROLL_HELP,
  platformPasskeyAvailable,
  registerPasskey,
  skipPasskeyOnboarding,
} from "@/lib/auth/webauthn-client";
import { WEBAUTHN_PUBLIC_ERROR } from "@/lib/auth/webauthn-policy";
import "./passkey-enrollment.css";

type Props = {
  onDone: () => void;
};

export function PasskeyEnrollmentScreen({ onDone }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState<"register" | "skip" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"error" | "ok" | "info">("info");

  async function startCeremony() {
    setBusy("register");
    setMessage("Waiting for this device…");
    setTone("info");
    try {
      await registerPasskey();
      setTone("ok");
      setMessage("Passkey saved. You can use it the next time you sign in.");
      window.setTimeout(() => onDone(), 700);
    } catch (err) {
      setEnabled(false);
      const text = err instanceof Error ? err.message : WEBAUTHN_PUBLIC_ERROR.register_failed;
      setTone("error");
      setMessage(
        text === WEBAUTHN_PUBLIC_ERROR.unsupported
          ? "This browser cannot create a passkey. You can keep using password or Google."
          : text,
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleToggle(next: boolean) {
    if (busy) return;
    setEnabled(next);
    setMessage(null);
    if (!next) return;
    const platform = await platformPasskeyAvailable();
    if (!platform) {
      setMessage(
        "This browser has no platform authenticator. A security key can still be used if you continue.",
      );
      setTone("info");
    }
    await startCeremony();
  }

  async function handleSkip() {
    if (busy === "register") return;
    setBusy("skip");
    try {
      await skipPasskeyOnboarding();
    } catch {
      /* skip must not trap the user out of the dashboard */
    } finally {
      onDone();
    }
  }

  return (
    <div className="passkey-enroll" data-testid="passkey-enrollment">
      <section className="passkey-enroll-card" aria-labelledby="passkey-enroll-title">
        <div className="passkey-enroll-brand">
          <SherivsMark size={28} decorative />
          Sherivs
        </div>
        <p className="passkey-enroll-kicker">Faster sign-in on this device</p>
        <h1 id="passkey-enroll-title">Use a passkey next time</h1>
        <p className="passkey-enroll-lead">{PASSKEY_ENROLL_HELP}</p>
        <div className="passkey-enroll-icons">
          <div className="passkey-enroll-icon">
            <Fingerprint size={20} aria-hidden="true" />
            <strong>Unlock you already use</strong>
            <small>Your device chooses the available verification method.</small>
          </div>
          <div className="passkey-enroll-icon">
            <Shield size={20} aria-hidden="true" />
            <strong>Stays on the device</strong>
            <small>Sherivs stores only a public key. Never a biometric template.</small>
          </div>
        </div>
        <label className="passkey-enroll-toggle">
          <span>Enable passkeys</span>
          <Switch
            checked={enabled}
            disabled={busy !== null}
            onCheckedChange={(next) => void handleToggle(next)}
            aria-label="Enable passkeys"
            data-testid="passkey-enroll-toggle"
          />
        </label>
        <div className="passkey-enroll-actions">
          <button
            type="button"
            className="passkey-enroll-primary"
            disabled={busy !== null || !enabled}
            onClick={() => void startCeremony()}
            data-testid="passkey-enroll-submit"
          >
            {busy === "register" ? "Waiting for this device…" : "Create a passkey"}
          </button>
          <button
            type="button"
            className="passkey-enroll-skip"
            disabled={busy === "register"}
            onClick={() => void handleSkip()}
            data-testid="passkey-enroll-skip"
          >
            {busy === "skip" ? "Continuing…" : "Skip for now"}
          </button>
        </div>
        <p
          className="passkey-enroll-status"
          role="status"
          data-tone={tone}
          data-testid="passkey-enroll-message"
        >
          {message}
        </p>
      </section>
    </div>
  );
}
