/**
 * Public bootstrap page — visited once, by the platform owner, to claim the
 * first super-admin account. After a super admin exists, this page locks.
 *
 * Flow:
 *   1. Page checks `checkPlatformBootstrap`. If already bootstrapped, render
 *      a locked screen pointing the user at /auth.
 *   2. Visitor signs up (email + password + full name) via supabase.auth.
 *   3. Once authenticated, `claimFirstSuperAdmin` writes them into
 *      public.super_admins — guarded server-side by a zero-count check.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { checkPlatformBootstrap, claimFirstSuperAdmin } from "@/lib/runtime/scholar/provisioning.functions";
import { useApp } from "@/contexts/app-context";

export const Route = createFileRoute("/super-admin-bootstrap")({
  ssr: false,
  component: BootstrapPage,
});

function BootstrapPage() {
  const navigate = useNavigate();
  const { refresh } = useApp();
  const check = useServerFn(checkPlatformBootstrap);
  const claim = useServerFn(claimFirstSuperAdmin);

  const status = useQuery({
    queryKey: ["platform-bootstrap"],
    queryFn: () => check(),
  });

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (status.isLoading) {
    return (
      <Shell>
        <div className="text-center text-muted-foreground">Checking platform state…</div>
      </Shell>
    );
  }

  if (status.data?.hasSuperAdmin) {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-bold">Bootstrap complete</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          A super admin already exists for this platform. New super admins must be invited by the
          existing one.
        </p>
        <Link
          to="/auth"
          className="mt-6 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
        >
          Go to sign-in
        </Link>
      </Shell>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      // 1. Sign up the auth user
      const { error: signErr } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}/super-admin-bootstrap`,
        },
      });
      // If user already exists in auth, try to sign in instead so we can claim
      if (signErr && /already/i.test(signErr.message)) {
        const { error: inErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (inErr) throw inErr;
      } else if (signErr) {
        throw signErr;
      } else {
        // Some projects require email confirmation; immediately sign in too
        // (signUp returns a session if confirmation is disabled — which it is on Cloud by default for first-party use).
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          const { error: inErr } = await supabase.auth.signInWithPassword({
            email,
            password,
          });
          if (inErr) throw inErr;
        }
      }

      // 2. Claim super admin
      await claim({ data: { fullName } });
      await refresh();
      navigate({ to: "/super-admin/dashboard", replace: true });
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Bootstrap failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="text-center">
        <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
          One-time setup
        </div>
        <h1 className="mt-4 font-display text-3xl font-bold">
          Claim the first super-admin account
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page works exactly once. After you submit, no one else can become a super admin
          without your invitation.
        </p>
      </div>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="Full name">
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            minLength={2}
            className="uos-input"
            autoComplete="name"
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="uos-input"
            autoComplete="email"
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="uos-input"
            autoComplete="new-password"
          />
        </Field>

        {err && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy ? "Setting up…" : "Become super admin"}
        </button>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh grid place-items-center px-4 py-12">
      <div className="w-full max-w-md uos-card p-8">{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-widest text-muted-foreground mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
