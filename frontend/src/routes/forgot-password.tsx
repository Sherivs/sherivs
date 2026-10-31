import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Turnstile, captchaRequired } from "@/components/security/turnstile";
import { turnstileEnabled } from "@/lib/security/turnstile-config";
import {
  formatSeconds,
  NEUTRAL_SENT_MESSAGE,
  RESEND_COOLDOWN_MS,
} from "@/lib/security/auth-feedback";
import { postSecurityAudit } from "@/lib/security/post-security-audit";
import { SherivsLogo } from "@/components/brand/sherivs-logo";

export const Route = createFileRoute("/forgot-password")({
  ssr: false,
  validateSearch: z.object({ email: z.string().max(254).optional() }),
  component: FindAccountPage,
});

function FindAccountPage() {
  const search = Route.useSearch();
  const [email, setEmail] = useState(search.email ?? "");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);

  const remaining = Math.max(0, cooldownUntil - now);
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    setError(null);
    if (remaining > 0) return;
    if (captchaRequired(turnstileEnabled(), captchaToken, captchaUnavailable)) {
      return setError("Please complete the security check.");
    }
    setBusy(true);
    try {
      // Server-side audit + per-IP limit first.
      const auditRes = await postSecurityAudit({ event: "password_reset_requested", email });
      if (auditRes?.status === 429) {
        const body = (await auditRes.json().catch(() => null)) as {
          retry_after_ms?: number;
        } | null;
        const wait = body?.retry_after_ms ?? RESEND_COOLDOWN_MS;
        setCooldownUntil(Date.now() + wait);
        setNow(Date.now());
        return setError(`Too many requests. Please try again in ${formatSeconds(wait)}.`);
      }
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
        captchaToken: captchaToken ?? undefined,
      });
      if (error) {
        const code = (error as { code?: string }).code ?? "";
        if (code.startsWith("captcha") || /captcha/i.test(error.message)) {
          return setError("The security check failed. Please try again.");
        }
        if (error.status === 429 || code.includes("rate_limit")) {
          setCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
          setNow(Date.now());
          return setError("Too many requests. Please wait a minute and try again.");
        }
        // Any other error: fall through to the neutral message (never reveal
        // whether the account exists).
      }
      setSentTo(email);
      setCooldownUntil(Date.now() + RESEND_COOLDOWN_MS);
      setNow(Date.now());
    } finally {
      setBusy(false);
      setCaptchaToken(null);
      setCaptchaNonce((n) => n + 1);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card uos-card" data-testid="auth-card">
        <Link to="/" aria-label="Sherivs home" className="mb-6 inline-flex">
          <SherivsLogo size={36} wordmarkClassName="text-xl" />
        </Link>
        {sentTo === null ? (
          <>
            <h1 className="font-display text-2xl font-bold">Find your account</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter the email address for your account and we'll send you a link to reset your
              password.
            </p>
            <form onSubmit={send} className="mt-6 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Email
                </span>
                <input
                  required
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="uos-input"
                />
              </label>
              <Turnstile
                onToken={setCaptchaToken}
                onUnavailable={() => setCaptchaUnavailable(true)}
                resetKey={captchaNonce}
              />
              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
                >
                  {error}
                </div>
              )}
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Link
                  to="/auth"
                  className="rounded-md border border-border px-4 py-3 text-center font-semibold hover:bg-muted/40"
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  disabled={busy || remaining > 0}
                  className="rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {busy
                    ? "Searching…"
                    : remaining > 0
                      ? `Try again in ${formatSeconds(remaining)}`
                      : "Search"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div data-testid="link-sent">
            <div className="mb-4 grid size-12 place-items-center rounded-full bg-primary/15 text-primary">
              <MailCheck className="size-6" aria-hidden="true" />
            </div>
            <h1 className="font-display text-2xl font-bold">Check your email</h1>
            <p className="mt-2 text-sm text-muted-foreground" role="status">
              {NEUTRAL_SENT_MESSAGE}
            </p>
            <p className="mt-3 break-all text-sm font-medium">{sentTo}</p>
            <Turnstile
              onToken={setCaptchaToken}
              onUnavailable={() => setCaptchaUnavailable(true)}
              resetKey={`sent:${captchaNonce}`}
            />
            {error && (
              <div
                role="alert"
                className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
              >
                {error}
              </div>
            )}
            <div className="mt-6 space-y-3">
              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || remaining > 0}
                className="w-full rounded-md border border-border px-4 py-3 font-semibold disabled:opacity-60"
              >
                {remaining > 0
                  ? `Resend link in ${formatSeconds(remaining)}`
                  : busy
                    ? "Sending…"
                    : "Resend link"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSentTo(null);
                  setError(null);
                }}
                className="block w-full text-sm text-muted-foreground hover:text-foreground"
              >
                Use a different email
              </button>
              <Link
                to="/auth"
                className="block w-full rounded-md bg-primary px-4 py-3 text-center font-semibold text-primary-foreground"
              >
                Back to sign in
              </Link>
            </div>
          </div>
        )}
      </div>
      <style>{`.uos-input{display:block;width:100%;border-radius:.5rem;background:var(--color-surface-2);border:1px solid var(--color-border);padding:.7rem .75rem;color:var(--color-foreground);outline:none;font-size:16px}.uos-input:focus{box-shadow:0 0 0 2px var(--color-ring)}`}</style>
    </div>
  );
}
