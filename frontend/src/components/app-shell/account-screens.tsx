import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
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
import { NotificationCentre } from "./notification-centre";
import { AssistantScreen } from "./assistant-screen";
import {
  configureVoiceAgent,
  decideVoiceCall,
  dispatchApprovedVoiceCall,
  getVoiceAgentSettings,
  listVoiceCalls,
  requestVoiceCall,
  type VoiceAgentCall,
  type VoiceAgentSettings,
} from "@/lib/communications/voice-agent.functions";

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
      <div className="app-shell-card">
        <div>
          <p>Organization voice agent</p>
          <small>Available to organization administrators; server authorization is enforced.</small>
        </div>
        <Link to={"/home/voice-agent" as never} className="app-shell-back">
          Manage voice agent →
        </Link>
      </div>
    </section>
  );
}

export function AppVoiceAgentScreen() {
  const [settings, setSettings] = useState<VoiceAgentSettings | null>(null);
  const [calls, setCalls] = useState<VoiceAgentCall[]>([]);
  const provider = "africas_talking" as const;
  const [providerNumber, setProviderNumber] = useState("");
  const [extension, setExtension] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [category, setCategory] = useState<"fee_reminder" | "absence_alert">("fee_reminder");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function reload() {
    try {
      const [nextSettings, nextCalls] = await Promise.all([
        getVoiceAgentSettings({ data: {} }),
        listVoiceCalls({ data: {} }),
      ]);
      setSettings(nextSettings);
      setEnabled(nextSettings.enabled);
      setProviderNumber(nextSettings.providerNumber ?? "");
      setExtension(nextSettings.extension ?? "");
      setCalls(nextCalls);
      setMessage(null);
    } catch {
      setMessage("Voice settings are available only to an authorized organization administrator.");
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function submitSettings(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await configureVoiceAgent({
        data: { enabled, provider, providerNumber, extension },
      });
      await reload();
      setMessage(
        "Voice agent settings saved. Live calling remains controlled by the voice_live flag.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Voice settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCall(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await requestVoiceCall({ data: { category, recipientPhone } });
      setRecipientPhone("");
      await reload();
      setMessage(
        "Call request queued for approval. A different organization administrator must approve it.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Call request could not be queued.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(callId: string, approve: boolean) {
    setBusy(true);
    try {
      await decideVoiceCall({ data: { callId, approve } });
      await reload();
      setMessage(
        approve
          ? "Call approved. Dispatch remains off until live voice is enabled."
          : "Call request rejected.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Call decision could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  async function dispatch(callId: string) {
    setBusy(true);
    try {
      const result = await dispatchApprovedVoiceCall({ data: { callId } });
      await reload();
      setMessage(
        result.status === "completed"
          ? "The provider accepted the call."
          : result.status === "failed"
            ? "The call could not be placed; the usage reservation was released."
            : result.status === "provider_not_configured"
              ? "Africa’s Talking is not configured for server-side voice dispatch."
              : "Live voice is disabled. The approved call remains queued.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Call dispatch could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="app-shell-section" data-testid="org-voice-agent">
      <Link to="/home/settings" className="app-shell-back">
        ← Settings
      </Link>
      <h1>Organization voice agent</h1>
      <p className="app-shell-empty">
        Configure an organization number and manage consent-checked outbound call approvals. Live
        voice stays disabled until the separate voice_live flag is explicitly enabled.
      </p>
      <p className="app-shell-empty">
        Incoming callers are not authenticated. The voice agent currently answers public help only;
        organization-specific fees, results, admissions, and timetable records remain unavailable
        until secure caller verification is implemented.
      </p>
      {message ? (
        <p role="status" className="app-shell-empty">
          {message}
        </p>
      ) : null}
      {!settings ? (
        <p className="app-shell-empty">
          Load this page as an authorized organization administrator.
        </p>
      ) : (
        <>
          <div className="app-shell-card">
            <div>
              <p>Live voice</p>
              <small>
                {settings.voiceLive
                  ? "Enabled by the existing feature flag"
                  : "Disabled by default"}
              </small>
            </div>
            <div>
              <p>Voice minutes</p>
              <small>
                {settings.voiceMinutesUsed} of {settings.voiceMinutesQuota} used this month
              </small>
            </div>
          </div>
          <form className="app-shell-form" onSubmit={submitSettings}>
            <h2>Number and add-on</h2>
            <label>
              Provider
              <select value={provider} disabled>
                <option value="africas_talking">Africa&apos;s Talking</option>
              </select>
            </label>
            <label>
              Organization number
              <input
                type="tel"
                required
                autoComplete="tel"
                placeholder="+2348012345678"
                value={providerNumber}
                onChange={(event) => setProviderNumber(event.target.value)}
              />
            </label>
            <label>
              Optional extension
              <input
                value={extension}
                maxLength={12}
                onChange={(event) => setExtension(event.target.value)}
              />
            </label>
            <label className="app-shell-checkbox">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              Enable organization add-on
            </label>
            <button type="submit" className="app-shell-primary" disabled={busy}>
              Save settings
            </button>
          </form>
          <form className="app-shell-form" onSubmit={submitCall}>
            <h2>Request an outbound call</h2>
            <p>
              Recipient must have active voice consent. Requests do not place a call until another
              admin approves.
            </p>
            <label>
              Call purpose
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as typeof category)}
              >
                <option value="fee_reminder">Fee reminder</option>
                <option value="absence_alert">Absence alert</option>
              </select>
            </label>
            <label>
              Consented recipient number
              <input
                type="tel"
                required
                autoComplete="tel"
                placeholder="+2348012345678"
                value={recipientPhone}
                onChange={(event) => setRecipientPhone(event.target.value)}
              />
            </label>
            <button
              type="submit"
              className="app-shell-primary"
              disabled={busy || !settings.enabled}
            >
              Request approval
            </button>
          </form>
          <section aria-labelledby="voice-approval-heading">
            <h2 id="voice-approval-heading">Approval queue</h2>
            {calls.length === 0 ? (
              <p className="app-shell-empty">No pending or approved calls.</p>
            ) : (
              calls.map((call) => (
                <article className="app-shell-card" key={call.id}>
                  <div>
                    <p>{call.category === "fee_reminder" ? "Fee reminder" : "Absence alert"}</p>
                    <small>
                      {call.recipient_redacted} · {new Date(call.created_at).toLocaleString()}
                    </small>
                    <p>{call.script}</p>
                  </div>
                  <div className="app-shell-actions">
                    {call.status === "pending" ? (
                      <>
                        <button
                          type="button"
                          className="app-shell-primary"
                          disabled={busy}
                          onClick={() => void decide(call.id, true)}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="app-shell-secondary"
                          disabled={busy}
                          onClick={() => void decide(call.id, false)}
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="app-shell-primary"
                        disabled={
                          busy ||
                          !settings.voiceLive ||
                          !settings.enabled ||
                          settings.provider !== "africas_talking"
                        }
                        onClick={() => void dispatch(call.id)}
                      >
                        Dispatch approved call
                      </button>
                    )}
                  </div>
                </article>
              ))
            )}
          </section>
        </>
      )}
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
      <NotificationCentre />

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
  return <AssistantScreen />;
}
