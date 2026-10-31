import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDuration, tokenMsRemaining } from "@/lib/auth-helpers";
import { PASSWORD_MIN_LENGTH } from "@/lib/security/password-policy";
import { newPasswordError } from "@/lib/security/password-strength";
import { newPasswordServerMessage, recoveryLinkError } from "@/lib/security/auth-feedback";
import { PasswordInput } from "@/components/security/password-input";
import { PasswordStrengthMeter } from "@/components/security/password-strength-meter";
import { postSecurityAudit } from "@/lib/security/post-security-audit";
import { SherivsLogo } from "@/components/brand/sherivs-logo";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  component: ResetPasswordPage,
});

/** How long to wait for the SDK to exchange the recovery token before calling the link invalid. */
const LINK_WAIT_MS = 6000;

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | undefined>();
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Supabase puts the recovery token (or an error) in the URL; the SDK
  // auto-exchanges a valid token and emits PASSWORD_RECOVERY.
  useEffect(() => {
    const fromUrl = recoveryLinkError(window.location.hash, window.location.search);
    if (fromUrl) {
      setLinkError(fromUrl);
      return;
    }
    let accepted = false;
    const accept = (exp: number | null | undefined, email?: string) => {
      accepted = true;
      setReady(true);
      setExpiresAt(exp ?? null);
      setUserEmail(email);
    };
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === "PASSWORD_RECOVERY") accept(sess?.expires_at, sess?.user?.email);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) accept(data.session.expires_at, data.session.user?.email);
    });
    const timer = setTimeout(() => {
      if (!accepted) setLinkError("This password reset link is invalid or has already been used.");
    }, LINK_WAIT_MS);
    return () => {
      clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setRemainingMs(tokenMsRemaining(expiresAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const expired = expiresAt !== null && remainingMs <= 0;
  const invalid = linkError ?? (expired ? "This password reset link has expired." : null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const pwErr = newPasswordError(password, userEmail);
    if (pwErr) return setError(pwErr);
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw new Error(newPasswordServerMessage(error));

      void postSecurityAudit({
        event: "password_reset_completed",
        email: data.user?.email,
      }).catch(() => {});

      if (signOutOthers) {
        // Revoke every other session (other devices); keep this one.
        await supabase.auth.signOut({ scope: "others" }).catch(() => {});
      }
      setDone(true);
      // /auth routes a signed-in user straight to their workspace/dashboard.
      setTimeout(() => navigate({ to: "/auth", replace: true }), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update your password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card uos-card" data-testid="auth-card">
        <Link to="/" aria-label="Sherivs home" className="mb-6 inline-flex">
          <SherivsLogo size={36} wordmarkClassName="text-xl" />
        </Link>
        <h1 className="font-display text-2xl font-bold">
          {invalid ? "Link not valid" : "Choose a new password"}
        </h1>

        {invalid && !done && (
          <div className="mt-4 space-y-4" data-testid="link-invalid">
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm"
            >
              {invalid} For your security, reset links work once and expire after a short time.
            </p>
            <Link
              to="/forgot-password"
              className="block w-full rounded-md bg-primary px-4 py-3 text-center font-semibold text-primary-foreground"
            >
              Send a new link
            </Link>
            <Link
              to="/auth"
              className="block text-center text-sm text-muted-foreground hover:text-foreground"
            >
              Back to sign in
            </Link>
          </div>
        )}

        {!invalid && !ready && !done && (
          <p className="mt-4 text-sm text-muted-foreground" role="status">
            Verifying your reset link…
          </p>
        )}

        {!invalid && ready && !done && (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a strong password you don't use anywhere else.
              {expiresAt !== null && (
                <>
                  {" "}
                  This link expires in <strong>{formatDuration(remainingMs)}</strong>.
                </>
              )}
            </p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {userEmail && (
                <input type="email" autoComplete="username" value={userEmail} readOnly hidden />
              )}
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  New password
                </span>
                <PasswordInput
                  required
                  autoFocus
                  minLength={PASSWORD_MIN_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  fieldLabel="new password"
                />
              </label>
              <PasswordStrengthMeter password={password} email={userEmail} />
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Confirm new password
                </span>
                <PasswordInput
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  fieldLabel="confirmation password"
                />
              </label>
              {confirm && password !== confirm && (
                <p className="-mt-2 text-xs text-destructive">Passwords do not match.</p>
              )}
              <label className="flex items-start gap-3 rounded-md border border-border px-3 py-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-5 accent-[color:var(--color-primary)]"
                  checked={signOutOthers}
                  onChange={(e) => setSignOutOthers(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Sign out of other devices</span>
                  <span className="block text-xs text-muted-foreground">
                    Recommended if you think someone else may know your password.
                  </span>
                </span>
              </label>
              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground"
                >
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60"
              >
                {busy ? "Saving…" : "Save new password"}
              </button>
            </form>
          </>
        )}

        {done && (
          <div
            className="mt-6 rounded-md border border-border bg-muted/30 px-3 py-3 text-sm"
            role="status"
          >
            Your password has been changed
            {signOutOthers ? " and other devices were signed out" : ""}. Taking you to your
            dashboard…
          </div>
        )}
      </div>

      <style>{`.uos-input{display:block;width:100%;border-radius:.5rem;background:var(--color-surface-2);border:1px solid var(--color-border);padding:.7rem .75rem;color:var(--color-foreground);outline:none;font-size:16px}.uos-input:focus{box-shadow:0 0 0 2px var(--color-ring)}`}</style>
    </div>
  );
}
