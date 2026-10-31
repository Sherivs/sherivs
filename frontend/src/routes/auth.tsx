import { createFileRoute, Link, Navigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, LogIn, Mail } from "lucide-react";
import { EnterpriseLoginFields } from "@/components/auth/enterprise-login-fields";
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
import {
  currentEffectiveHostKind,
  postSignInPath,
  sanitizeConsoleNextPath,
} from "@/lib/experience/console-host-routing";
import { authPageExperience, effectiveAuthMode } from "@/lib/experience/auth-page-experience";
import { identityFromAppState } from "@/lib/identity/context";
import { ACCOUNT_INVITATION_COPY } from "@/lib/auth/organization-access";
import { assertPostAuthOrganizationAccess } from "@/lib/auth/organization-access-client";
import {
  INVITE_LOGIN_ERROR,
  classifySignInIdentifier,
  toPasswordSignInPayload,
} from "@/lib/auth/sign-in-identifier";
import { signInWithOrgIdentifier } from "@/lib/auth/resolve-sign-in-identifier.functions";
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
import { postSecurityAudit } from "@/lib/security/post-security-audit";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import {
  activateConsoleVisualFixture,
  CONSOLE_FIXTURE_PERSONAS,
  consoleVisualFixtureEnabled,
} from "@/lib/internal-console/visual-fixture";
import "@/components/app-entry/app-entry.css";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { mode?: string; next?: string } => {
    const out: { mode?: string; next?: string } = {};
    if (typeof search.mode === "string") out.mode = search.mode;
    if (typeof search.next === "string") out.next = search.next;
    return out;
  },
  beforeLoad: () => {
    if (typeof window === "undefined") return;
    if (currentEffectiveHostKind() === "app") {
      throw redirect({ to: "/", search: { panel: "signin" } });
    }
  },
  component: AuthPage,
});

type Mode = "signin" | "signup";

const backoff = createLoginBackoff(typeof window !== "undefined" ? window.localStorage : undefined);

function AuthPage() {
  const app = useApp();
  const { loading, refresh, school, tenantSlug, authUser } = app;
  const search = Route.useSearch();
  const localFixtureEnabled = consoleVisualFixtureEnabled();
  // Console host (console.sherivs.com): staff-branded copy, no self-service
  // sign-up. Login, reset, Turnstile and MFA are unchanged.
  const hostKind = currentEffectiveHostKind();
  const experience = authPageExperience(hostKind);
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
        const classified = classifySignInIdentifier(email);
        let userId: string | undefined;
        if (classified.kind === "username") {
          const minted = await signInWithOrgIdentifier({
            data: { identifier: email, password, captchaToken: captcha },
          });
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: minted.accessToken,
            refresh_token: minted.refreshToken,
          });
          if (sessionError) throw new Error(INVITE_LOGIN_ERROR);
          userId = minted.userId;
        } else {
          const payload = toPasswordSignInPayload(classified, password, captcha);
          const { data, error } = await supabase.auth.signInWithPassword(payload);
          if (error) {
            void postSecurityAudit({ event: "login_failed", email }).catch(() => {});
            const wait = backoff.recordFailure();
            setWaitMs(wait);
            throw new Error(loginErrorMessage(error));
          }
          userId = data.user?.id;
        }
        backoff.reset();
        setWaitMs(0);

        if (userId) {
          await assertPostAuthOrganizationAccess({
            userId,
            tenantSlug,
            schoolId: school?.id ?? null,
          });
        }

        void postSecurityAudit({ event: "login_succeeded", email }).catch(() => {});

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

  async function continueLocalFixture(personaKey: string) {
    if (!consoleVisualFixtureEnabled()) return;
    reset();
    activateConsoleVisualFixture(personaKey);
    await refresh();
  }

  async function handleGoogle() {
    reset();
    setRememberPreference(remember);
    setBusy(true);
    setBusyKind("google");
    const next = sanitizeConsoleNextPath(search.next);
    const authReturn = next ? `/auth?next=${encodeURIComponent(next)}` : "/auth";
    const result = await startGoogleSignIn((args) => supabase.auth.signInWithOAuth(args), {
      redirectTo: googleSignInRedirectTo(window.location.origin, authReturn),
      loginHint: classifySignInIdentifier(email).kind === "email" ? email : undefined,
    });
    if (!result.ok) {
      setBusy(false);
      setBusyKind(null);
      setError(result.error);
    }
  }

  const title = experience.heading ?? (mode === "signin" ? "Welcome back" : "Create account");
  const signInCopy = mode === "signin";
  const signedInDestination = postSignInPath({
    hostKind,
    identityDestination: identityFromAppState({
      superAdmin: app.superAdmin,
      platformStaff: app.platformStaff,
      profile: app.profile,
      school: app.school,
    }).destination,
    next: search.next,
  });

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
    return <Navigate to={signedInDestination as never} />;
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
          {school ? (
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
          ) : (
            <div className="mb-4">
              <SherivsLogo size={32} wordmarkClassName="text-lg" />
            </div>
          )}
          <p className="app-entry-login-kicker">Please enter your details</p>
          <h1 className="app-entry-login-title">{title}</h1>
          {hostKind === "internal" ? (
            <p className="app-entry-login-invite">{experience.subtext}</p>
          ) : null}
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
          {signInCopy ? (
            <EnterpriseLoginFields
              identifier={email}
              password={password}
              remember={remember}
              forgotSearch={
                classifySignInIdentifier(email).kind === "email" ? { email: email.trim() } : {}
              }
              onIdentifierChange={setEmail}
              onPasswordChange={setPassword}
              onRememberChange={setRemember}
            />
          ) : (
            <>
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
                  minLength={PASSWORD_MIN_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  name="password"
                  placeholder="Password"
                  inputClassName="app-entry-login-input app-entry-login-input-password"
                />
              </label>
              <PasswordStrengthMeter password={password} email={email} />
            </>
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
          {info && <div className="app-entry-alert app-entry-alert-info">{info}</div>}

          <button
            type="submit"
            disabled={busy || (mode === "signin" && waitMs > 0)}
            className="app-entry-login-submit"
            data-testid="auth-submit"
          >
            <span className="app-entry-glass-icon" aria-hidden="true">
              <LogIn />
            </span>
            {busyKind === "password"
              ? "Please wait…"
              : mode === "signup"
                ? "Create account"
                : "Sign in"}
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

        {localFixtureEnabled ? (
          <div className="mt-4 space-y-2" data-testid="console-role-simulation">
            <p className="app-entry-login-invite">
              Local V1 role simulation. These are not production identities and do not write staff,
              invitation, or workspace records.
            </p>
            <div className="app-entry-fixture-roles">
              {CONSOLE_FIXTURE_PERSONAS.map((persona) => (
                <button
                  key={persona.key}
                  type="button"
                  className="app-entry-login-google"
                  data-testid={
                    persona.key === "platform_owner"
                      ? "console-visual-fixture"
                      : `console-fixture-${persona.key}`
                  }
                  onClick={() => void continueLocalFixture(persona.key)}
                >
                  Continue as {persona.jobTitle}
                </button>
              ))}
            </div>
          </div>
        ) : null}

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
            <p className="app-entry-login-invite">{ACCOUNT_INVITATION_COPY}</p>
          )}
          {hostKind !== "internal" ? (
            <Link to="/" className="block text-xs text-muted-foreground hover:text-foreground">
              Back to site
            </Link>
          ) : null}
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
