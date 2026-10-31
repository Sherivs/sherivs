import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { GoogleMark } from "@/components/auth/google-mark";
import {
  googleAuthErrorMessage,
  googleOAuthStartOptions,
  googleSignInRedirectTo,
  hasGoogleIdentity,
  probeGoogleAuthorizeUrl,
} from "@/lib/auth/google-sign-in";
import { sendTestPush } from "@/lib/push.functions";
import {
  getPushSupport,
  registerPushSubscription,
  unregisterPushToken,
  type PushSupport,
} from "@/lib/push-client";
import {
  BIOMETRIC_PASKEY_STEPS,
  GOOGLE_LINK_STEPS,
  GOOGLE_PROVIDER_STEPS,
  PUSH_DEVICE_STEPS,
} from "@/lib/shell/auth-setup";
import { APP_SHELL_HOME } from "@/lib/shell/paths";
import { useAppShell } from "./shell-context";
import { ShellGlassIcon } from "./glass-icon";

function SectionBack() {
  return (
    <Link to={APP_SHELL_HOME as never} className="app-shell-back">
      ← Home
    </Link>
  );
}

export function AppProfileScreen() {
  const app = useApp();
  const shell = useAppShell();
  return (
    <section className="app-shell-section">
      <SectionBack />
      <h1>Profile</h1>
      <p className="app-shell-org">{app.profile?.email}</p>
      <div className="app-shell-card">
        <div>
          <p>{shell.name.display}</p>
          <small>
            {shell.roleTitle} · {shell.orgName}
          </small>
        </div>
      </div>
    </section>
  );
}

export function AppSettingsScreen() {
  const shell = useAppShell();
  return (
    <section className="app-shell-section">
      <SectionBack />
      <h1>Settings</h1>
      <p className="app-shell-empty">
        Workspace density and hidden widgets stay personal. Administration still decides which
        sections you may open.
      </p>
      <div className="app-shell-card">
        <div>
          <p>Active organization</p>
          <small>{shell.orgName}</small>
        </div>
      </div>
    </section>
  );
}

export function AppSecurityScreen() {
  const app = useApp();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const googleConnected = hasGoogleIdentity(app.authUser);

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (password.length < 8 || password !== confirm) {
      setMessage("Use two matching passwords of at least 8 characters.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    setMessage(error ? error.message : "Password updated.");
    setPassword("");
    setConfirm("");
  }

  async function connectGoogle() {
    setGoogleBusy(true);
    setMessage(null);
    const args = googleOAuthStartOptions({
      redirectTo: googleSignInRedirectTo(window.location.origin, "/home/security"),
    });
    const { data, error } = await supabase.auth.linkIdentity({
      provider: args.provider,
      options: {
        redirectTo: args.options.redirectTo,
        queryParams: args.options.queryParams,
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url) {
      setGoogleBusy(false);
      setMessage(googleAuthErrorMessage(error));
      return;
    }
    const probed = await probeGoogleAuthorizeUrl(data.url);
    if (!probed.ok) {
      setGoogleBusy(false);
      setMessage(probed.error);
      return;
    }
    window.location.assign(probed.url);
  }

  return (
    <section className="app-shell-section">
      <SectionBack />
      <h1>Biometric and authentication</h1>

      <div className="app-shell-card">
        <div className="app-shell-status">
          <div>
            <p>Password</p>
            <small>Change the invitation password on this identity.</small>
          </div>
        </div>
      </div>
      <form className="app-shell-form" onSubmit={(event) => void savePassword(event)}>
        <label>
          New password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
          />
        </label>
        <button type="submit">Update password</button>
      </form>
      {message ? <p className="app-shell-empty">{message}</p> : null}

      <div className="app-shell-card">
        <ShellGlassIcon>
          <GoogleMark size={16} />
        </ShellGlassIcon>
        <div>
          <p>Google</p>
          <small>{googleConnected ? "Connected to this login." : "Not connected yet."}</small>
        </div>
      </div>
      {googleConnected ? null : (
        <button
          type="button"
          className="app-shell-primary"
          disabled={googleBusy}
          onClick={() => void connectGoogle()}
        >
          {googleBusy ? "Opening Google…" : "Connect Google"}
        </button>
      )}
      <p className="app-shell-org">For the member</p>
      <ol className="app-shell-steps">
        {GOOGLE_LINK_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="app-shell-org">For the project owner — enable Google in Supabase</p>
      <ol className="app-shell-steps" data-testid="google-owner-steps">
        {GOOGLE_PROVIDER_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <p className="app-shell-org">Passkeys</p>
      <p className="app-shell-empty">
        Passkeys are registered and used in the Sherivs iOS and Android apps. Browser sign-in uses
        password, Google, and Cloudflare Turnstile.
      </p>
      <p className="app-shell-org">How passkeys work here</p>
      <ol className="app-shell-steps" data-testid="biometric-owner-steps">
        {BIOMETRIC_PASKEY_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}

export function AppHelpScreen() {
  return (
    <section className="app-shell-section">
      <SectionBack />
      <h1>Help and support</h1>
      <p className="app-shell-empty">
        Ask your administrator to invite this same login into another organization as a membership,
        not a second account. One person can hold several roles and several schools on one identity.
      </p>
      <p className="app-shell-org">Enable Google sign-in</p>
      <ol className="app-shell-steps">
        {GOOGLE_PROVIDER_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="app-shell-org">Enable passkeys</p>
      <ol className="app-shell-steps">
        {BIOMETRIC_PASKEY_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <a className="app-shell-primary" href="mailto:hello@sherivs.com">
        Email support
      </a>
    </section>
  );
}

function pushStatusLabel(support: PushSupport): string {
  if (!support.vapidConfigured) return "This build is missing the public VAPID key.";
  if (!support.supported) return "This browser cannot receive web push.";
  if (support.permission === "granted") return "This device is allowed to receive push.";
  if (support.permission === "denied")
    return "This browser blocked notifications. Allow them in site settings.";
  return "Push is off on this device until you enable it.";
}

export function AppNotificationsScreen() {
  const app = useApp();
  const shell = useAppShell();
  const inbox = shell.manifest?.inbox ?? [];
  const userId = app.profile?.id ?? app.authUser?.id ?? "";
  const [support, setSupport] = useState<PushSupport>(() => getPushSupport());
  const [busy, setBusy] = useState<"enable" | "disable" | "test" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSupport(getPushSupport());
  }, []);

  async function enablePush() {
    setBusy("enable");
    setMessage(null);
    const result = await registerPushSubscription(userId);
    setSupport(getPushSupport());
    setBusy(null);
    if (result.ok) {
      setMessage("Push is enabled on this device.");
      return;
    }
    if (result.reason === "missing_vapid") {
      setMessage("Push is not configured on this build. The public VAPID key is required.");
      return;
    }
    if (result.reason === "denied") {
      setMessage(
        "This browser blocked notifications. Allow them in site settings, then try again.",
      );
      return;
    }
    if (result.reason === "unsupported") {
      setMessage("This browser cannot receive web push.");
      return;
    }
    setMessage("Could not enable push on this device.");
  }

  async function disablePush() {
    setBusy("disable");
    setMessage(null);
    try {
      await unregisterPushToken(userId);
      setSupport(getPushSupport());
      setMessage("Push is disabled on this device.");
    } catch {
      setMessage("Could not disable push on this device.");
    }
    setBusy(null);
  }

  async function testPush() {
    setBusy("test");
    setMessage(null);
    try {
      const result = await sendTestPush();
      if (result.delivered > 0) {
        setMessage("Test notification sent. Open the ping to return here.");
      } else if (result.skipped === "vapid_keys_missing") {
        setMessage("The server is missing VAPID keys, so the test could not be signed.");
      } else {
        setMessage("No stored subscription on this member yet. Enable push first.");
      }
    } catch {
      setMessage("Could not send a test notification.");
    }
    setBusy(null);
  }

  return (
    <section className="app-shell-section">
      <SectionBack />
      <h1>Notifications</h1>

      <div className="app-shell-card">
        <ShellGlassIcon>
          <Bell />
        </ShellGlassIcon>
        <div>
          <p>Device push</p>
          <small data-testid="push-status">{pushStatusLabel(support)}</small>
        </div>
      </div>
      <div className="app-shell-push-actions">
        <button
          type="button"
          className="app-shell-primary"
          data-testid="push-enable"
          disabled={Boolean(busy) || !userId}
          onClick={() => void enablePush()}
        >
          {busy === "enable" ? "Enabling…" : "Enable push on this device"}
        </button>
        <button
          type="button"
          className="app-shell-secondary"
          data-testid="push-disable"
          disabled={Boolean(busy) || !userId}
          onClick={() => void disablePush()}
        >
          {busy === "disable" ? "Disabling…" : "Disable push"}
        </button>
        <button
          type="button"
          className="app-shell-secondary"
          data-testid="push-test"
          disabled={Boolean(busy) || !userId}
          onClick={() => void testPush()}
        >
          {busy === "test" ? "Sending…" : "Send test"}
        </button>
      </div>
      {message ? <p className="app-shell-empty">{message}</p> : null}
      <p className="app-shell-org">On this device</p>
      <ol className="app-shell-steps" data-testid="push-device-steps">
        {PUSH_DEVICE_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      {inbox.length === 0 ? (
        <p className="app-shell-empty">No in-app notification streams are enabled for this role.</p>
      ) : (
        <div className="app-shell-cards">
          {inbox.map((item) => (
            <a
              key={item.key}
              className="app-shell-card"
              href={`/home/s/${encodeURIComponent(item.key)}`}
            >
              <div>
                <p>{item.label}</p>
                <small>Role inbox</small>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

export function AppAiScreen() {
  return (
    <section className="app-shell-section">
      <SectionBack />
      <ShellGlassIcon size={44} tone="accent">
        <Sparkles />
      </ShellGlassIcon>
      <h1>AI</h1>
      <p className="app-shell-empty">
        The assistant uses the Sherivs AI gateway with only the records this role may see. Ask your
        administrator if this section is empty.
      </p>
    </section>
  );
}
