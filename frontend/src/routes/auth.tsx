import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { scholarWorkspaceHome } from "@/lib/runtime/nav-registry";
import { PLATFORM_NAME } from "@/lib/platform";
import { resolveSherivsIdentity } from "@/lib/identity/resolve-identity.functions";
import { identityFromAppState } from "@/lib/identity/context";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const { loading, role, refresh, school, tenantSlug, profile, superAdmin } = useApp();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const resolveIdentity = useServerFn(resolveSherivsIdentity);

  // Identity-based post-auth routing (§11): signed-in users are routed by the
  // resolved identity chain — internal workforce → /internal, one membership
  // → its workspace, several → the organization selector, none → /welcome —
  // never unconditionally into a runtime workspace.
  const contextIdentity = identityFromAppState({ superAdmin, profile, school });
  useEffect(() => {
    if (!loading && role) {
      navigate({ to: contextIdentity.destination, replace: true });
    }
  }, [loading, role, contextIdentity.destination, navigate]);

  function reset() {
    setError(null);
    setInfo(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    reset();
    try {
      if (mode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          // Audit the failure (fire-and-forget, never block UX)
          void fetch("/api/public/audit/password-reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: "login_failed", email }),
          }).catch(() => {});
          throw error;
        }

        // Tenant-aware sign-in: if visiting on a tenant slug, verify the user
        // belongs to that school.
        if (tenantSlug && school && data.user) {
          const { data: u } = await supabase
            .from("users")
            .select("school_id, role")
            .eq("id", data.user.id)
            .maybeSingle();
          // Super admins (no `users` row) are always allowed.
          if (u && u.school_id !== school.id) {
            await supabase.auth.signOut();
            void fetch("/api/public/audit/password-reset", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ event: "login_failed", email, user_id: data.user.id }),
            }).catch(() => {});
            throw new Error(
              `This account does not belong to ${school.name}. Please sign in on your own school portal.`,
            );
          }
        }

        void fetch("/api/public/audit/password-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "login_succeeded", email, user_id: data.user?.id }),
        }).catch(() => {});

        await refresh();

        // Server-authoritative identity resolution (§11): resolve the full
        // chain — memberships → organizations → roles → runtime → workspace
        // — and route to its destination. The context effect above is the
        // fallback if the server round-trip fails.
        try {
          const identity = await resolveIdentity();
          await navigate({ to: identity.destination, replace: true });
        } catch {
          // context effect handles routing — never block sign-in on resolution
        }
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, tenant_slug: tenantSlug ?? null },
            emailRedirectTo: `${window.location.origin}/auth`,
          },
        });
        if (error) throw error;
        setInfo(
          "Account created. An organization admin must link your account to an organization before you can access a workspace.",
        );
      } else {
        // forgot password — call audit FIRST so the server can enforce rate-limit.
        const auditRes = await fetch("/api/public/audit/password-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "password_reset_requested", email }),
        });
        if (auditRes.status === 429) {
          const body = (await auditRes.json().catch(() => null)) as {
            retry_after_ms?: number;
          } | null;
          const { formatDuration } = await import("@/lib/auth-helpers");
          throw new Error(
            `Too many reset requests. Please try again in ${formatDuration(body?.retry_after_ms ?? 60_000)}.`,
          );
        }
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        setInfo(
          "If an account exists for that email, we've sent a password-reset link. Check your inbox.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Reset your password";

  return (
    <div className="min-h-dvh grid place-items-center px-4">
      <div className="w-full max-w-md uos-card p-8">
        <div className="mb-6">
          {school && (
            <div className="mb-4 flex items-center gap-3">
              {school.logo_url ? (
                <img
                  src={school.logo_url}
                  alt=""
                  width={40}
                  height={40}
                  loading="lazy"
                  decoding="async"
                  className="size-10 rounded-md object-cover"
                />
              ) : (
                <div className="size-10 rounded-md uos-tenant-bg grid place-items-center font-bold">
                  {(school.name?.[0] ?? "U") as string}
                </div>
              )}
              <div className="leading-tight">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Signing in to
                </div>
                <div className="font-display font-bold">{school.name}</div>
              </div>
            </div>
          )}
          <h1 className="font-display text-2xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "forgot"
              ? "Enter the email tied to your account and we'll send you a reset link."
              : `Sign in to ${PLATFORM_NAME} — your organization's operating environment.`}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <Field label="Full name">
              <input
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="uos-input"
                autoComplete="name"
              />
            </Field>
          )}
          <Field label="Email">
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="uos-input"
              autoComplete="email"
            />
          </Field>
          {mode !== "forgot" && (
            <Field label="Password">
              <input
                required
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="uos-input"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
            </Field>
          )}

          {mode === "signin" && (
            <div className="flex justify-end -mt-2">
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  reset();
                }}
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                Forgot password?
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
              {error}
            </div>
          )}
          {info && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-primary px-4 py-2.5 font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
          </button>
        </form>

        <div className="mt-6 space-y-2 text-center text-sm">
          {mode === "signin" && (
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                reset();
              }}
              className="block w-full text-muted-foreground hover:text-foreground"
            >
              Need an account? Create one
            </button>
          )}
          {mode === "signup" && (
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                reset();
              }}
              className="block w-full text-muted-foreground hover:text-foreground"
            >
              Already have an account? Sign in
            </button>
          )}
          {mode === "forgot" && (
            <button
              type="button"
              onClick={() => {
                setMode("signin");
                reset();
              }}
              className="block w-full text-muted-foreground hover:text-foreground"
            >
              ← Back to sign in
            </button>
          )}
          <Link to="/" className="block text-xs text-muted-foreground hover:text-foreground">
            Back to site
          </Link>
        </div>
      </div>

      <style>{`.uos-input{display:block;width:100%;border-radius:.5rem;background:var(--color-surface-2);border:1px solid var(--color-border);padding:.55rem .75rem;color:var(--color-foreground);outline:none}.uos-input:focus{box-shadow:0 0 0 2px var(--color-ring)}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}
