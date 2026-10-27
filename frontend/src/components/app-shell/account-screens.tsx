import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Fingerprint, ScanFace, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
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
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<string | null>(null);

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

  return (
    <section className="app-shell-section">
      <SectionBack />
      <h1>Biometric and authentication</h1>
      <form className="app-shell-form" onSubmit={(event) => void savePassword(event)}>
        <label>
          New password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
        </label>
        <label>
          Confirm password
          <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" />
        </label>
        <button type="submit">Update password</button>
      </form>
      {message ? <p className="app-shell-empty">{message}</p> : null}
      <div className="app-shell-cards">
        <div className="app-shell-card">
          <ShellGlassIcon>
            <Fingerprint />
          </ShellGlassIcon>
          <div>
            <p>Fingerprint</p>
            <small>Uses this device’s biometric unlock. Sherivs never stores the print.</small>
          </div>
        </div>
        <div className="app-shell-card">
          <ShellGlassIcon>
            <ScanFace />
          </ShellGlassIcon>
          <div>
            <p>Face ID</p>
            <small>Available on devices that already protect the OS lock screen with Face ID.</small>
          </div>
        </div>
      </div>
    </section>
  );
}

export function AppHelpScreen() {
  return (
    <section className="app-shell-section">
      <SectionBack />
      <h1>Help and support</h1>
      <p className="app-shell-empty">
        Ask your organization administrator to invite you into another school as a membership, not a
        second login. Parents can hold staff roles and children in more than one school on the same
        identity.
      </p>
      <a className="app-shell-primary" href="mailto:hello@sherivs.com">
        Email support
      </a>
    </section>
  );
}

export function AppNotificationsScreen() {
  const shell = useAppShell();
  const inbox = shell.manifest?.inbox ?? [];
  return (
    <section className="app-shell-section">
      <SectionBack />
      <h1>Notifications</h1>
      {inbox.length === 0 ? (
        <p className="app-shell-empty">No notification streams are enabled for this role.</p>
      ) : (
        <div className="app-shell-cards">
          {inbox.map((item) => (
            <a key={item.key} className="app-shell-card" href={`/home/s/${encodeURIComponent(item.key)}`}>
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
