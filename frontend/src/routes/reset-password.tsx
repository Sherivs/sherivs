import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatDuration, tokenMsRemaining } from "@/lib/auth-helpers";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Supabase puts the recovery token in the URL hash; the SDK auto-exchanges it
  // and emits a PASSWORD_RECOVERY event.
  useEffect(() => {
    const accept = (exp: number | null | undefined) => {
      setReady(true);
      setExpiresAt(exp ?? null);
    };
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      if (event === "PASSWORD_RECOVERY") accept(sess?.expires_at);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) accept(data.session.expires_at);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Tick the countdown each second
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => setRemainingMs(tokenMsRemaining(expiresAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const expired = expiresAt !== null && remainingMs <= 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      // Audit the completion (fire and forget)
      void fetch("/api/public/audit/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "password_reset_completed",
          user_id: data.user?.id,
          email: data.user?.email,
        }),
      });

      setDone(true);
      // Sign out so the user logs in fresh with the new password
      await supabase.auth.signOut();
      setTimeout(() => navigate({ to: "/auth", replace: true }), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh grid place-items-center px-4">
      <div className="w-full max-w-md uos-card p-8">
        <h1 className="font-display text-2xl font-bold">Set a new password</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a strong password you haven't used before.
        </p>

        {!ready && !done && (
          <div className="mt-6 rounded-md border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
            Waiting for the recovery link to be verified… If this page was not opened from a
            password-reset email, request a new link from{" "}
            <Link to="/auth" className="underline">
              the sign-in page
            </Link>
            .
          </div>
        )}

        {ready && !done && expiresAt !== null && (
          <div
            className={`mt-4 rounded-md border px-3 py-2 text-xs ${
              expired
                ? "border-destructive/40 bg-destructive/10 text-destructive-foreground"
                : remainingMs < 60_000
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                  : "border-border bg-muted/30 text-muted-foreground"
            }`}
            aria-live="polite"
          >
            {expired ? (
              <>
                Reset link expired.{" "}
                <Link to="/auth" className="underline">
                  Request a new one
                </Link>
                .
              </>
            ) : (
              <>
                Link expires in <strong>{formatDuration(remainingMs)}</strong>.
              </>
            )}
          </div>
        )}

        {ready && !done && !expired && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                New password
              </span>
              <input
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="uos-input"
                autoComplete="new-password"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                Confirm password
              </span>
              <input
                required
                type="password"
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="uos-input"
                autoComplete="new-password"
              />
            </label>
            {error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-60"
            >
              {busy ? "Updating…" : "Update password"}
            </button>
          </form>
        )}

        {done && (
          <div className="mt-6 rounded-md border border-border bg-muted/30 px-3 py-3 text-sm">
            Password updated. Redirecting you to sign in…
          </div>
        )}
      </div>

      <style>{`.uos-input{display:block;width:100%;border-radius:.5rem;background:var(--color-surface-2);border:1px solid var(--color-border);padding:.55rem .75rem;color:var(--color-foreground);outline:none}.uos-input:focus{box-shadow:0 0 0 2px var(--color-ring)}`}</style>
    </div>
  );
}
