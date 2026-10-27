import { useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { Bell, Fingerprint, HelpCircle, LogOut, Menu, Settings, Sparkles, UserRound } from "lucide-react";
import { useApp } from "@/contexts/app-context";
import { shellIcon } from "@/lib/shell/icon-registry";
import {
  APP_SHELL_AI,
  APP_SHELL_HELP,
  APP_SHELL_HOME,
  APP_SHELL_NOTIFICATIONS,
  APP_SHELL_PROFILE,
  APP_SHELL_SECURITY,
  APP_SHELL_SETTINGS,
} from "@/lib/shell/paths";
import { ShellGlassIcon } from "./glass-icon";
import { AppShellStateProvider, useAppShell } from "./shell-context";
import "./app-shell.css";

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function ShellChrome({ children }: { children: ReactNode }) {
  const app = useApp();
  const shell = useAppShell();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const avatar = app.profile?.avatar_url;
  const display = shell.name.display;
  const path = location.pathname;

  function go(href: string) {
    setDrawer(false);
    void navigate({ to: href });
  }

  return (
    <div className="app-shell" data-testid="app-shell">
      <div className="app-shell-orbs" aria-hidden="true">
        <span className="app-shell-orb app-shell-orb-cyan" />
        <span className="app-shell-orb app-shell-orb-blue" />
        <span className="app-shell-orb app-shell-orb-violet" />
      </div>
      <div className="app-shell-frame">
        <header className="app-shell-header">
          <button
            type="button"
            className="app-shell-icon-btn"
            aria-label="Open menu"
            data-testid="app-shell-menu"
            onClick={() => setDrawer(true)}
          >
            <ShellGlassIcon>
              <Menu />
            </ShellGlassIcon>
          </button>
          <div className="app-shell-header-actions">
            <button
              type="button"
              className="app-shell-icon-btn"
              aria-label="Notifications"
              onClick={() => go(APP_SHELL_NOTIFICATIONS)}
            >
              <ShellGlassIcon>
                <Bell />
              </ShellGlassIcon>
            </button>
            <button
              type="button"
              className="app-shell-icon-btn"
              aria-label="Profile"
              onClick={() => go(APP_SHELL_PROFILE)}
            >
              {avatar ? (
                <img className="app-shell-avatar" src={avatar} alt="" />
              ) : (
                <span className="app-shell-avatar app-shell-avatar-fallback">{initials(display)}</span>
              )}
            </button>
          </div>
        </header>
        <main className="app-shell-main">{children}</main>
        <nav className="app-shell-bottom" aria-label="Primary">
          {shell.bottom.map((slot) => {
            if (slot.kind === "empty" || !slot.href) {
              return <span key={slot.key} className="is-empty" />;
            }
            const Icon = slot.kind === "ai" ? Sparkles : shellIcon(slot.icon);
            const active = path === slot.href || (slot.kind === "home" && path === APP_SHELL_HOME);
            return (
              <a
                key={slot.key}
                href={slot.href}
                className={active ? "is-active" : undefined}
                aria-label={slot.label}
              >
                <ShellGlassIcon active={active}>
                  <Icon />
                </ShellGlassIcon>
                {slot.label}
              </a>
            );
          })}
        </nav>
      </div>

      {drawer ? (
        <>
          <button type="button" className="app-shell-scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <aside className="app-shell-drawer" data-testid="app-shell-drawer">
            <div className="app-shell-drawer-profile">
              {avatar ? (
                <img className="app-shell-avatar" src={avatar} alt="" />
              ) : (
                <span className="app-shell-avatar app-shell-avatar-fallback">{initials(display)}</span>
              )}
              <div>
                <h2>{display}</h2>
                <p>
                  {shell.roleTitle} · {shell.orgName}
                </p>
              </div>
            </div>
            <div className="app-shell-drawer-list">
              {shell.drawer.map((item) => {
                const Icon = shellIcon(item.icon);
                const active = path === item.href;
                return (
                  <a
                    key={item.key}
                    href={item.href}
                    className={`app-shell-drawer-item${active ? " is-active" : ""}`}
                    onClick={() => setDrawer(false)}
                  >
                    <ShellGlassIcon active={active}>
                      <Icon />
                    </ShellGlassIcon>
                    {item.label}
                  </a>
                );
              })}
            </div>
            <div className="app-shell-drawer-account">
              <a className="app-shell-drawer-item" href={APP_SHELL_PROFILE} onClick={() => setDrawer(false)}>
                <ShellGlassIcon>
                  <UserRound />
                </ShellGlassIcon>
                Profile
              </a>
              <a className="app-shell-drawer-item" href={APP_SHELL_SETTINGS} onClick={() => setDrawer(false)}>
                <ShellGlassIcon>
                  <Settings />
                </ShellGlassIcon>
                Settings
              </a>
              <a className="app-shell-drawer-item" href={APP_SHELL_SECURITY} onClick={() => setDrawer(false)}>
                <ShellGlassIcon>
                  <Fingerprint />
                </ShellGlassIcon>
                Biometric and authentication
              </a>
              <a className="app-shell-drawer-item" href={APP_SHELL_HELP} onClick={() => setDrawer(false)}>
                <ShellGlassIcon>
                  <HelpCircle />
                </ShellGlassIcon>
                Help and support
              </a>
            </div>
            <button type="button" className="app-shell-signout" onClick={() => void app.signOut()}>
              <LogOut size={16} style={{ marginRight: 8, verticalAlign: "middle" }} />
              Sign out
            </button>
          </aside>
        </>
      ) : null}
    </div>
  );
}

export function AppShellLayout() {
  const { loading, authUser } = useApp();
  if (loading) return null;
  if (!authUser) return <Navigate to="/" search={{ panel: "signin" }} />;
  return (
    <AppShellStateProvider>
      <ShellChrome>
        <Outlet />
      </ShellChrome>
    </AppShellStateProvider>
  );
}

export function AppShellIndex() {
  return <Outlet />;
}
