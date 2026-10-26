import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PLATFORM_NAME, PLATFORM_URL } from "@/lib/platform";
import { Turnstile, captchaRequired } from "@/components/security/turnstile";
import { PasswordInput } from "@/components/security/password-input";
import { PasswordStrengthMeter } from "@/components/security/password-strength-meter";
import { turnstileEnabled } from "@/lib/security/turnstile-config";
import { PASSWORD_MIN_LENGTH } from "@/lib/security/password-policy";
import { newPasswordError } from "@/lib/security/password-strength";
import {
  createLoginBackoff,
  formatSeconds,
  loginErrorMessage,
  newPasswordServerMessage,
} from "@/lib/security/auth-feedback";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import { resolveTenantDomain } from "@/lib/tenant";
import { schoolDomainLoginAllowed } from "@/lib/domains/school-domains";
import { currentEffectiveHostKind } from "@/lib/experience/console-host-routing";
import { authPageExperience, effectiveAuthMode } from "@/lib/experience/auth-page-experience";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    if (currentEffectiveHostKind() === "app") {
      throw redirect({ to: "/", search: { panel: "signin" } });
    }
  },
  component: AuthPage,
});

type Mode = "signin" | "signup";

const backoff = createLoginBackoff(
  typeof window !== "undefined" ? window.localStorage : undefined,
);

function AuthPage() {
  const { loading, refresh, school, tenantSlug, authUser, signOut } = useApp();
  // Console host (console.sherivs.com): staff-branded copy, no self-service
  // sign-up. Login, reset, Turnstile and MFA are unchanged.
  const experience = authPageExperience(currentEffectiveHostKind());
  const [requestedMode, setMode] = useState<Mode>(() =>
    typeof window !== "undefined"
      ? effectiveAuthMode(new URLSearchParams(window.location.search).get("mode"), experience)
      : "signin",
  );
  const mode: Mode = effectiveAuthMode(requestedMode, experience);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);
  const [waitMs, setWaitMs] = useState(() => backoff.remainingMs());

  // Count down any active backoff after repeated failed sign-ins.
  useEffect(() => {
    if (waitMs <= 0) return;
    const id = setInterval(() => setWaitMs(backoff.remainingMs()), 1000);
    return () => clearInterval(id);
  }, [waitMs > 0]);

  function reset() {
    setError(null);
    setInfo(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    reset();
    if (mode === "signin" && backoff.remainingMs() > 0) {
      setWaitMs(backoff.remainingMs());
      return;
    }
    if (mode === "signup") {
      const pwErr = newPasswordError(password, email);
      if (pwErr) return setError(pwErr);
    }
    if (captchaRequired(turnstileEnabled(), captchaToken, captchaUnavailable)) {
      return setError("Please complete the security check.");
    }
    const captcha = captchaToken ?? undefined;
    setBusy(true);
    try {
      if (mode === "signin") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
          options: { captchaToken: captcha },
        });
        if (error) {
          // Audit the failure (fire-and-forget, never block UX)
          void fetch("/api/public/audit/password-reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: "login_failed", email }),
          }).catch(() => {});
          const wait = backoff.recordFailure();
          setWaitMs(wait);
          throw new Error(loginErrorMessage(error));
        }
        backoff.reset();
        setWaitMs(0);

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

        // SHERIVS-029: on a school's own domain only that school's members may sign in.
        const customHost = resolveTenantDomain();
        if (customHost && data.user && !(await schoolDomainLoginAllowed(customHost))) {
          await supabase.auth.signOut();
          void fetch("/api/public/audit/password-reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event: "login_failed", email, user_id: data.user.id }),
          }).catch(() => {});
          throw new Error(
            `This account does not belong to ${school?.name ?? "this school"}. Please sign in on your own school's address or at app.sherivs.com.`,
          );
        }

        void fetch("/api/public/audit/password-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "login_succeeded", email, user_id: data.user?.id }),
        }).catch(() => {});

        await refresh();
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName, tenant_slug: tenantSlug ?? null },
            emailRedirectTo: `${window.location.origin}/auth`,
            captchaToken: captcha,
          },
        });
        if (error) throw new Error(newPasswordServerMessage(error));
        setInfo(
          "Account created. Check your email and click the link to confirm your address. Access to a workspace is granted by your organization or by Sherivs.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
      // Turnstile tokens are single-use: always fetch a fresh one.
      setCaptchaToken(null);
      setCaptchaNonce((n) => n + 1);
    }
  }

  const title = experience.heading ?? (mode === "signin" ? "Sign in" : "Create account");

  if (!loading && authUser) {
    return (
      <div className="auth-shell">
        <div className="auth-card uos-card" data-testid="auth-card">
          <Link to="/" aria-label={`${PLATFORM_NAME} home`} className="mb-6 inline-flex">
            <SherivsLogo size={36} wordmarkClassName="text-xl" />
          </Link>
          <h1 className="font-display text-2xl font-bold">Signed in</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The application workspace is not available. The {PLATFORM_NAME} company website remains
            at sherivs.com.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            <a
              href={PLATFORM_URL}
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
            >
              Open sherivs.com
            </a>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-md border border-border px-4 py-3 text-sm font-semibold hover:bg-accent"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-shell">
      <div className="auth-card uos-card" data-testid="auth-card">
        <div className="mb-6">
          {!school && (
            <Link to="/" aria-label={`${PLATFORM_NAME} home`} className="mb-6 inline-flex">
              <SherivsLogo size={36} wordmarkClassName="text-xl" />
            </Link>
          )}
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
          <p className="mt-1 text-sm text-muted-foreground">{experience.subtext}</p>
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
          <Field label="Password">
            <PasswordInput
              required
              minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              name="password"
            />
          </Field>

          {mode === "signup" && <PasswordStrengthMeter password={password} email={email} />}

          <Turnstile
            onToken={setCaptchaToken}
            onUnavailable={() => setCaptchaUnavailable(true)}
            resetKey={`${mode}:${captchaNonce}`}
          />

          {mode === "signin" && waitMs > 0 && (
            <div
              role="status"
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
            >
              Too many unsuccessful attempts. For your security, please wait{" "}
              <strong>{formatSeconds(waitMs)}</strong> before trying again, or reset your password.
            </div>
          )}

          {error && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
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
            disabled={busy || (mode === "signin" && waitMs > 0)}
            className="w-full rounded-md bg-primary px-4 py-3 font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </button>

          {mode === "signin" && (
            <div className="text-center">
              <Link
                to="/forgot-password"
                search={email ? { email } : {}}
                className="text-sm font-medium text-primary underline-offset-2 hover:underline"
              >
                Forgotten password?
              </Link>
            </div>
          )}
        </form>

        <div className="mt-6 space-y-2 text-center text-sm">
          {mode === "signin" && experience.allowSignup && (
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
