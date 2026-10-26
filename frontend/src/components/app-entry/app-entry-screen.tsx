import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, LogIn, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PLATFORM_URL } from "@/lib/platform";
import { Turnstile, captchaRequired } from "@/components/security/turnstile";
import { PasswordInput } from "@/components/security/password-input";
import { turnstileEnabled } from "@/lib/security/turnstile-config";
import {
  GENERIC_LOGIN_ERROR,
  createLoginBackoff,
  formatSeconds,
  loginErrorMessage,
} from "@/lib/security/auth-feedback";
import { SherivsMark } from "@/components/brand/sherivs-logo";
import { resolveTenantDomain } from "@/lib/tenant";
import { schoolDomainLoginAllowed } from "@/lib/domains/school-domains";
import { type AppEntryPanel } from "@/lib/experience/app-entry-host";
import {
  INVITE_LOGIN_ERROR,
  classifySignInIdentifier,
  toPasswordSignInPayload,
} from "@/lib/auth/sign-in-identifier";
import { AppEntryCanvas } from "./app-entry-canvas";
import { AppEntryWordmark } from "./app-entry-wordmark";

const backoff = createLoginBackoff(
  typeof window !== "undefined" ? window.localStorage : undefined,
);

export function AppEntryScreen({ panel }: { panel: AppEntryPanel }) {
  const { loading, authUser, signOut } = useApp();

  if (!loading && authUser) {
    return (
      <AppEntryCanvas>
        <BrandBlock />
        <section className="app-entry-panel" data-testid="app-entry-signed-in">
          <h2>Signed in</h2>
          <p className="app-entry-panel-lead">
            You are authenticated. The internal application workspace is the next
            phase — it is not on this screen.
          </p>
          <a className="app-entry-card app-entry-card-primary" href={PLATFORM_URL}>
            <GlassIcon>
              <LogIn />
            </GlassIcon>
            Open sherivs.com
          </a>
          <button
            type="button"
            className="app-entry-card app-entry-card-secondary"
            style={{ marginTop: "0.85rem" }}
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </section>
      </AppEntryCanvas>
    );
  }

  return (
    <AppEntryCanvas>
      <BrandBlock />
      {panel === "signin" ? <SignInPanel /> : <SplashCards />}
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

function GlassIcon({ children }: { children: React.ReactNode }) {
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
      <Link
        to="/onboarding"
        className="app-entry-card app-entry-card-secondary"
        data-testid="app-entry-create-account-card"
      >
        <GlassIcon>
          <UserPlus />
        </GlassIcon>
        Create Account
      </Link>
    </div>
  );
}

function SignInPanel() {
  const { refresh, school, tenantSlug } = useApp();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword(payload);
      if (authError) {
        void fetch("/api/public/audit/password-reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: "login_failed", email: auditEmail }),
        }).catch(() => {});
        const wait = backoff.recordFailure();
        setWaitMs(wait);
        const mapped = loginErrorMessage(authError);
        throw new Error(mapped === GENERIC_LOGIN_ERROR ? INVITE_LOGIN_ERROR : mapped);
      }
      backoff.reset();
      setWaitMs(0);

      if (tenantSlug && school && data.user) {
        const { data: u } = await supabase
          .from("users")
          .select("school_id, role")
          .eq("id", data.user.id)
          .maybeSingle();
        if (u && u.school_id !== school.id) {
          await supabase.auth.signOut();
          throw new Error(INVITE_LOGIN_ERROR);
        }
      }

      const customHost = resolveTenantDomain();
      if (customHost && data.user && !(await schoolDomainLoginAllowed(customHost))) {
        await supabase.auth.signOut();
        throw new Error(INVITE_LOGIN_ERROR);
      }

      void fetch("/api/public/audit/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "login_succeeded", email: auditEmail, user_id: data.user?.id }),
      }).catch(() => {});

      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : INVITE_LOGIN_ERROR);
    } finally {
      setBusy(false);
      setCaptchaToken(null);
      setCaptchaNonce((n) => n + 1);
    }
  }

  const forgotSearch = classifySignInIdentifier(identifier).kind === "email" ? { email: identifier.trim() } : {};

  return (
    <section className="app-entry-panel" data-testid="app-entry-signin" aria-labelledby="app-entry-signin-heading">
      <button
        type="button"
        className="app-entry-back"
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
      <h2 id="app-entry-signin-heading">Sign in</h2>
      <form onSubmit={handleSubmit} className="app-entry-form">
        <label className="app-entry-field">
          <span>Username, email, or phone number</span>
          <input
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            className="app-entry-input"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            name="username"
            data-testid="app-entry-identifier"
          />
        </label>
        <label className="app-entry-field">
          <span>Password</span>
          <PasswordInput
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            name="password"
            inputClassName="app-entry-input"
            fieldLabel="password"
          />
        </label>
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
          disabled={busy || waitMs > 0}
          className="app-entry-card app-entry-card-primary app-entry-submit"
          data-testid="app-entry-submit"
        >
          <GlassIcon>
            <LogIn />
          </GlassIcon>
          {busy ? "Please wait…" : "Sign In"}
        </button>
        <Link to="/forgot-password" search={forgotSearch} className="app-entry-forgot">
          Forgot password?
        </Link>
      </form>
    </section>
  );
}
