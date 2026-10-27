import { createFileRoute, Link, Navigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, LogIn, Mail } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
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
import { GoogleMark } from "@/components/auth/google-mark";
import { resolveTenantDomain } from "@/lib/tenant";
import { schoolDomainLoginAllowed } from "@/lib/domains/school-domains";
import { currentEffectiveHostKind } from "@/lib/experience/console-host-routing";
import { authPageExperience, effectiveAuthMode } from "@/lib/experience/auth-page-experience";
import {
  consumeOAuthError,
  googleSignInRedirectTo,
  parseOAuthCallbackError,
  startGoogleSignIn,
} from "@/lib/auth/google-sign-in";
import { rememberPreferenceActive, setRememberPreference } from "@/lib/auth/remember-session";
import {
  SHERIVS_LOADING_FLOOR_MS,
  signInLoadingRemainingMs,
} from "@/lib/auth/signin-loading-wordmark";
import { SignInLoading } from "@/components/app-entry/signin-loading";
import "@/components/app-entry/app-entry.css";

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
  const { loading, refresh, school, tenantSlug, authUser } = useApp();
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
  const [remember, setRemember] = useState(() =>
    typeof window !== "undefined" ? rememberPreferenceActive() : false,
  );
  const [busyKind, setBusyKind] = useState<"password" | "google" | null>(null);

  // Count down any active backoff after repeated failed sign-ins.
  useEffect(() => {
    if (waitMs <= 0) return;
    const id = setInterval(() => setWaitMs(backoff.remainingMs()), 1000);
    return () => clearInterval(id);
  }, [waitMs > 0]);

  useEffect(() => {
    const stored = consumeOAuthError();
    const params = new URLSearchParams(window.location.search);
    const fromCallback = parseOAuthCallbackError(params);
    const next = stored ?? fromCallback;
    if (next) setError(next);
    if (fromCallback && params.has("error")) {
      params.delete("error");
      params.delete("error_description");
      params.delete("error_code");
      const qs = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }
  }, []);

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
    if (mode === "signin") setRememberPreference(remember);
    setBusy(true);
    setBusyKind("password");
    const startedAt = Date.now();
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
        const remain = signInLoadingRemainingMs(startedAt, Date.now(), SHERIVS_LOADING_FLOOR_MS);
        if (remain > 0) await new Promise((resolve) => setTimeout(resolve, remain));
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
      setBusyKind(null);
      // Turnstile tokens are single-use: always fetch a fresh one.
      setCaptchaToken(null);
      setCaptchaNonce((n) => n + 1);
    }
  }

  async function handleGoogle() {
    reset();
    setRememberPreference(remember);
    setBusy(true);
    setBusyKind("google");
    const result = await startGoogleSignIn(
      (args) => supabase.auth.signInWithOAuth(args),
      {
        redirectTo: googleSignInRedirectTo(window.location.origin, "/auth"),
        loginHint: email,
      },
    );
    if (!result.ok) {
      setBusy(false);
      setBusyKind(null);
      setError(result.error);
    }
  }

  const title = experience.heading ?? (mode === "signin" ? "Welcome back" : "Create account");
  const signInCopy = mode === "signin";

  if (busy && busyKind === "password") {
    return (
      <div className="auth-shell app-entry app-entry-login">
        <div className="app-entry-login-orbs" aria-hidden="true">
          <span className="app-entry-orb app-entry-orb-cyan" />
          <span className="app-entry-orb app-entry-orb-blue" />
          <span className="app-entry-orb app-entry-orb-violet" />
        </div>
        <SignInLoading />
      </div>
    );
  }

  if (!loading && authUser) {
    return <Navigate to="/home" />;
  }

  return (
    <div className="auth-shell app-entry app-entry-login">
      <div className="app-entry-login-orbs" aria-hidden="true">
        <span className="app-entry-orb app-entry-orb-cyan" />
        <span className="app-entry-orb app-entry-orb-blue" />
        <span className="app-entry-orb app-entry-orb-violet" />
      </div>
      <div className="auth-card uos-card app-entry-login-card" data-testid="auth-card">
        <div className="mb-2">
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
          <p className="app-entry-login-kicker">Please enter your details</p>
          <h1 className="app-entry-login-title">{signInCopy ? "Welcome back" : title}</h1>
          <p className="mt-0 mb-4 text-sm text-muted-foreground">{experience.subtext}</p>
        </div>

        <form onSubmit={handleSubmit} className="app-entry-login-form">
          {mode === "signup" && (
            <Field label="Full name">
              <input
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="app-entry-login-input"
                style={{ paddingLeft: "0.95rem" }}
                autoComplete="name"
              />
            </Field>
          )}
          <label className="app-entry-login-field">
            <span className="sr-only">Email address</span>
            <span className="app-entry-login-field-icon">
              <span className="app-entry-glass-icon" aria-hidden="true">
                <Mail />
              </span>
            </span>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="app-entry-login-input"
              placeholder="Email address"
              autoComplete="email"
            />
          </label>
          <label className="app-entry-login-field">
            <span className="sr-only">Password</span>
            <span className="app-entry-login-field-icon">
              <span className="app-entry-glass-icon" aria-hidden="true">
                <Lock />
              </span>
            </span>
            <PasswordInput
              required
              minLength={mode === "signup" ? PASSWORD_MIN_LENGTH : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              name="password"
              placeholder="Password"
              inputClassName="app-entry-login-input app-entry-login-input-password"
            />
          </label>

          {mode === "signup" && <PasswordStrengthMeter password={password} email={email} />}

          {signInCopy && (
            <div className="app-entry-login-row">
              <label className="app-entry-login-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember for 30 days
              </label>
              <Link to="/forgot-password" search={email ? { email } : {}} className="app-entry-login-forgot">
                Forgot password
              </Link>
            </div>
          )}

          <Turnstile
            onToken={setCaptchaToken}
            onUnavailable={() => setCaptchaUnavailable(true)}
            resetKey={`${mode}:${captchaNonce}`}
          />

          {mode === "signin" && waitMs > 0 && (
            <div role="status" className="app-entry-alert app-entry-alert-wait">
              Too many unsuccessful attempts. For your security, please wait{" "}
              <strong>{formatSeconds(waitMs)}</strong> before trying again, or reset your password.
            </div>
          )}

          {error && (
            <div role="alert" className="app-entry-alert app-entry-alert-error">
              {error}
            </div>
          )}
          {info && (
            <div className="app-entry-alert app-entry-alert-info">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || (mode === "signin" && waitMs > 0)}
            className="app-entry-login-submit"
          >
            <span className="app-entry-glass-icon" aria-hidden="true">
              <LogIn />
            </span>
            {busyKind === "password"
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </button>

          {signInCopy && (
            <button
              type="button"
              className="app-entry-login-google"
              disabled={busy || waitMs > 0}
              onClick={() => void handleGoogle()}
              data-testid="auth-google"
            >
              <span className="app-entry-glass-icon app-entry-google-glass" aria-hidden="true">
                <GoogleMark size={16} />
              </span>
              {busyKind === "google" ? "Opening Google…" : "Sign in with Google"}
            </button>
          )}
        </form>

        <div className="mt-5 space-y-2 text-center text-sm">
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
          {signInCopy && !experience.allowSignup && (
            <p className="app-entry-login-invite">
              Need an account? Ask your administrator to invite you.
            </p>
          )}
          <Link to="/" className="block text-xs text-muted-foreground hover:text-foreground">
            Back to site
          </Link>
        </div>
      </div>
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
