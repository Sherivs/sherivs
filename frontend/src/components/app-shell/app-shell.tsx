import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { Bell, LogOut, Menu, Sparkles } from "lucide-react";
import { useApp } from "@/contexts/app-context";
import { refreshPushTokenIfGranted } from "@/lib/push-client";
import { SHELL_ACCOUNT_NAV } from "@/lib/shell/account";
import { shellIcon } from "@/lib/shell/icon-registry";
import { APP_SHELL_HOME, APP_SHELL_NOTIFICATIONS, APP_SHELL_PROFILE } from "@/lib/shell/paths";
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
  const [pending, setPending] = useState<string | null>(null);
  const avatar = app.profile?.avatar_url;
  const display = shell.name.display;
  const path = location.pathname;
  const pushUserId = app.profile?.id ?? app.authUser?.id;

  useEffect(() => {
    if (!pushUserId) return;
    void refreshPushTokenIfGranted(pushUserId);
  }, [pushUserId]);

  function go(href: string, key?: string) {
    if (key) setPending(key);
    window.setTimeout(
      () => {
        setDrawer(false);
        setPending(null);
        void navigate({ to: href as never });
      },
      key ? 170 : 0,
    );
  }

  const portrait = avatar ? (
    <img className="app-shell-avatar" src={avatar} alt="" />
  ) : (
    <span className="app-shell-avatar app-shell-avatar-fallback">{initials(display)}</span>
  );

  return (
    <div className={`app-shell${drawer ? " is-drawer-open" : ""}`} data-testid="app-shell">
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
            aria-expanded={drawer}
            data-testid="app-shell-menu"
            onClick={() => setDrawer(true)}
          >
            <ShellGlassIcon tone="dark">
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
              <ShellGlassIcon tone="dark">
                <Bell />
              </ShellGlassIcon>
            </button>
            <button type="button" className="app-shell-icon-btn" aria-label="Profile" onClick={() => go(APP_SHELL_PROFILE)}>
              {portrait}
            </button>
          </div>
        </header>
        <main className="app-shell-main">
          <div className="app-shell-sheet">{children}</div>
        </main>
        <nav className="app-shell-bottom" aria-label="Primary">
          {shell.bottom.map((slot) => {
            if (slot.kind === "empty" || !slot.href) {
              return <span key={slot.key} className="app-shell-bottom-empty" aria-hidden="true" />;
            }
            const Icon = slot.kind === "ai" ? Sparkles : shellIcon(slot.icon);
            const active = path === slot.href || (slot.kind === "home" && path === APP_SHELL_HOME);
            return (
              <Link key={slot.key} to={slot.href as never} className={active ? "is-active" : undefined} aria-label={slot.label}>
                <ShellGlassIcon active={active}>
                  <Icon />
                </ShellGlassIcon>
                {slot.label}
              </Link>
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
                <img className="app-shell-avatar app-shell-avatar-lg" src={avatar} alt="" />
              ) : (
                <span className="app-shell-avatar app-shell-avatar-lg app-shell-avatar-fallback">{initials(display)}</span>
              )}
              <div>
                <h2>{display}</h2>
                <p>
                  {shell.roleTitle} · {shell.orgName}
                </p>
              </div>
            </div>
            <div className="app-shell-drawer-account">
              {SHELL_ACCOUNT_NAV.map((item) => {
                const Icon = shellIcon(item.icon);
                const active = pending === item.key || path === item.href;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`app-shell-drawer-item${active ? " is-active" : ""}`}
                    onClick={() => go(item.href, item.key)}
                  >
                    <ShellGlassIcon active={active}>
                      <Icon />
                    </ShellGlassIcon>
                    {item.label}
                  </button>
                );
              })}
            </div>
            {shell.drawer.length ? <p className="app-shell-drawer-kicker">Workspace</p> : null}
            <div className="app-shell-drawer-list">
              {shell.drawer.map((item) => {
                const Icon = shellIcon(item.icon);
                const active = pending === item.key || path === item.href;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`app-shell-drawer-item${active ? " is-active" : ""}`}
                    onClick={() => go(item.href, item.key)}
                  >
                    <ShellGlassIcon active={active}>
                      <Icon />
                    </ShellGlassIcon>
                    {item.label}
                  </button>
                );
              })}
            </div>
            <button type="button" className="app-shell-signout" onClick={() => void app.signOut()}>
              <LogOut size={16} />
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
