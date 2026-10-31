import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, LogIn } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { Turnstile, captchaRequired } from "@/components/security/turnstile";
import { turnstileEnabled } from "@/lib/security/turnstile-config";
import {
  GENERIC_LOGIN_ERROR,
  createLoginBackoff,
  formatSeconds,
  loginErrorMessage,
} from "@/lib/security/auth-feedback";
import { GoogleMark } from "@/components/auth/google-mark";
import { type AppEntryPanel } from "@/lib/experience/app-entry-host";
import {
  INVITE_LOGIN_ERROR,
  classifySignInIdentifier,
  toPasswordSignInPayload,
} from "@/lib/auth/sign-in-identifier";
import { signInWithOrgIdentifier } from "@/lib/auth/resolve-sign-in-identifier.functions";
import { ACCOUNT_INVITATION_COPY } from "@/lib/auth/organization-access";
import { assertPostAuthOrganizationAccess } from "@/lib/auth/organization-access-client";
import {
  consumeOAuthError,
  googleSignInRedirectTo,
  parseOAuthCallbackError,
  startGoogleSignIn,
} from "@/lib/auth/google-sign-in";
import { rememberPreferenceActive, setRememberPreference } from "@/lib/auth/remember-session";
import { postSecurityAudit } from "@/lib/security/post-security-audit";
import {
  SHERIVS_LOADING_FLOOR_MS,
  signInLoadingRemainingMs,
} from "@/lib/auth/signin-loading-wordmark";
import { SherivsMark } from "@/components/brand/sherivs-logo";
import { AppEntryCanvas } from "./app-entry-canvas";
import { AppEntryWordmark } from "./app-entry-wordmark";
import { EnterpriseLoginFields } from "@/components/auth/enterprise-login-fields";
import { SignInLoading } from "./signin-loading";

const backoff = createLoginBackoff(typeof window !== "undefined" ? window.localStorage : undefined);

export function AppEntryScreen({ panel }: { panel: AppEntryPanel }) {
  const { loading, authUser } = useApp();
  const [signingIn, setSigningIn] = useState(false);
  const login = panel === "signin" || Boolean(authUser);

  if (!loading && authUser && !signingIn) {
    return <Navigate to="/home" />;
  }

  if (login) {
    return (
      <AppEntryCanvas tone="login">
        {signingIn ? <SignInLoading /> : null}
        <div hidden={signingIn}>
          <SignInPanel onSigningChange={setSigningIn} />
        </div>
      </AppEntryCanvas>
    );
  }

  return (
    <AppEntryCanvas tone="login">
      <BrandBlock />
      <SplashCards />
    </AppEntryCanvas>
  );
}

function BrandBlock() {
  return (
    <header className="app-entry-brand">
      <div className="app-entry-mark-wrap">
        <SherivsMark size={68} decorative className="app-entry-mark" />
      </div>
      <AppEntryWordmark />
    </header>
  );
}

function GlassIcon({ children }: { children: ReactNode }) {
  return (
    <span className="app-entry-glass-icon" aria-hidden="true">
      {children}
    </span>
  );
}

function SplashCards() {
  const navigate = useNavigate();
  return (
    <div className="app-entry-actions" data-testid="app-entry-splash">
      <button
        type="button"
        className="app-entry-card app-entry-card-primary"
        data-testid="app-entry-sign-in-card"
        onClick={() => void navigate({ to: "/", search: (prev) => ({ ...prev, panel: "signin" }) })}
      >
        <GlassIcon>
          <LogIn />
        </GlassIcon>
        Sign In
      </button>
      <p className="app-entry-legal">Access is by invitation. An administrator must invite you.</p>
    </div>
  );
}

function SignInPanel({ onSigningChange }: { onSigningChange: (signing: boolean) => void }) {
  const { refresh, school, tenantSlug } = useApp();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(() =>
    typeof window !== "undefined" ? rememberPreferenceActive() : false,
  );
  const [busy, setBusy] = useState<"password" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaNonce, setCaptchaNonce] = useState(0);
  const [captchaUnavailable, setCaptchaUnavailable] = useState(false);
  const [waitMs, setWaitMs] = useState(() => backoff.remainingMs());

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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (backoff.remainingMs() > 0) {
      setWaitMs(backoff.remainingMs());
      return;
    }
    if (captchaRequired(turnstileEnabled(), captchaToken, captchaUnavailable)) {
      return setError("Please complete the security check.");
    }
    const classified = classifySignInIdentifier(identifier);
    const payload = toPasswordSignInPayload(classified, password, captchaToken ?? undefined);
    const auditEmail = classified.kind === "email" ? classified.value : undefined;
    setRememberPreference(remember);
    setBusy("password");
    onSigningChange(true);
    const startedAt = Date.now();
    try {
      let userId: string | undefined;
      if (classified.kind === "username") {
        const minted = await signInWithOrgIdentifier({
          data: {
            identifier,
            password,
            captchaToken: captchaToken ?? undefined,
          },
        });
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: minted.accessToken,
          refresh_token: minted.refreshToken,
        });
        if (sessionError) throw new Error(INVITE_LOGIN_ERROR);
        userId = minted.userId;
      } else {
        const { data, error: authError } = await supabase.auth.signInWithPassword(payload);
        if (authError) {
          void postSecurityAudit({ event: "login_failed", email: auditEmail }).catch(() => {});
          const wait = backoff.recordFailure();
          setWaitMs(wait);
          const mapped = loginErrorMessage(authError);
          throw new Error(mapped === GENERIC_LOGIN_ERROR ? INVITE_LOGIN_ERROR : mapped);
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

      void postSecurityAudit({ event: "login_succeeded", email: auditEmail }).catch(() => {});

      await refresh();
      const remain = signInLoadingRemainingMs(startedAt, Date.now(), SHERIVS_LOADING_FLOOR_MS);
      if (remain > 0) await new Promise((resolve) => setTimeout(resolve, remain));
    } catch (err) {
      setError(err instanceof Error ? err.message : INVITE_LOGIN_ERROR);
    } finally {
      setBusy(null);
      onSigningChange(false);
      setCaptchaToken(null);
      setCaptchaNonce((n) => n + 1);
    }
  }

  async function handleGoogle() {
    setError(null);
    setRememberPreference(remember);
    setBusy("google");
    const result = await startGoogleSignIn((args) => supabase.auth.signInWithOAuth(args), {
      redirectTo: googleSignInRedirectTo(window.location.origin, "/?panel=signin"),
      loginHint: classifySignInIdentifier(identifier).kind === "email" ? identifier : undefined,
    });
    if (!result.ok) {
      setBusy(null);
      setError(result.error);
    }
  }

  const forgotSearch =
    classifySignInIdentifier(identifier).kind === "email" ? { email: identifier.trim() } : {};
  const submitting = busy !== null;

  return (
    <section
      className="app-entry-login-card"
      data-testid="app-entry-signin"
      aria-labelledby="app-entry-signin-heading"
    >
      <button
        type="button"
        className="app-entry-back app-entry-login-back"
        onClick={() =>
          void navigate({
            to: "/",
            search: (prev) => {
              const { panel: _panel, ...rest } = prev;
              return rest;
            },
          })
        }
      >
        <ChevronLeft size={16} aria-hidden="true" />
        Back
      </button>
      <p className="app-entry-login-kicker">Please enter your details</p>
      <h2 id="app-entry-signin-heading" className="app-entry-login-title">
        Welcome back
      </h2>
      <form onSubmit={handleSubmit} className="app-entry-login-form">
        <EnterpriseLoginFields
          identifier={identifier}
          password={password}
          remember={remember}
          identifierTestId="app-entry-identifier"
          rememberTestId="app-entry-remember"
          forgotSearch={forgotSearch}
          onIdentifierChange={setIdentifier}
          onPasswordChange={setPassword}
          onRememberChange={setRemember}
        />
        <Turnstile
          onToken={setCaptchaToken}
          onUnavailable={() => setCaptchaUnavailable(true)}
          resetKey={`app-entry:${captchaNonce}`}
        />
        {waitMs > 0 && (
          <div role="status" className="app-entry-alert app-entry-alert-wait">
            Too many unsuccessful attempts. Please wait <strong>{formatSeconds(waitMs)}</strong>{" "}
            before trying again, or reset your password.
          </div>
        )}
        {error && (
          <div role="alert" className="app-entry-alert app-entry-alert-error">
            {error}
          </div>
        )}
        <button
          type="submit"
          className="app-entry-login-submit"
          disabled={submitting || waitMs > 0}
          data-testid="app-entry-submit"
        >
          <span className="app-entry-glass-icon" aria-hidden="true">
            <LogIn />
          </span>
          {busy === "password" ? "Please wait…" : "Sign in"}
        </button>
        <button
          type="button"
          className="app-entry-login-google"
          data-testid="app-entry-google"
          disabled={submitting || waitMs > 0}
          onClick={() => void handleGoogle()}
        >
          <span className="app-entry-glass-icon app-entry-google-glass" aria-hidden="true">
            <GoogleMark size={16} />
          </span>
          {busy === "google" ? "Opening Google…" : "Sign in with Google"}
        </button>
        <p className="app-entry-login-invite">{ACCOUNT_INVITATION_COPY}</p>
      </form>
    </section>
  );
}
