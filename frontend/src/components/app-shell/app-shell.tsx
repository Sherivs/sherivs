import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { Bell, LogOut, Menu, Settings2, Sparkles } from "lucide-react";
import { useApp } from "@/contexts/app-context";
import { refreshPushTokenIfGranted } from "@/lib/push-client";
import { SHELL_ACCOUNT_NAV } from "@/lib/shell/account";
import { shellIcon } from "@/lib/shell/icon-registry";
import { APP_SHELL_HOME, APP_SHELL_NOTIFICATIONS, APP_SHELL_PROFILE } from "@/lib/shell/paths";
import {
  affiliationForOrganization,
  organizationOptions,
  rolesForOrganization,
} from "@/lib/shell/membership-policy";
import { switchActiveOrganization } from "@/lib/identity/memberships.functions";
import { OrganizationAccessDenied } from "@/components/auth/organization-access-denied";
import { isActiveMembership } from "@/lib/auth/organization-access";
import { scholarWorkspaceLabelForRole } from "@/lib/runtime/nav-registry";
import { ShellGlassIcon } from "./glass-icon";
import { AppShellStateProvider, useAppShell } from "./shell-context";
import { ConnectionStatus } from "./connection-status";
import { rememberResource } from "@/lib/internal-console/recent";
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
  const [contextError, setContextError] = useState(false);
  const avatar = app.profile?.avatar_url;
  const display = shell.name.display;
  const path = location.pathname;
  const pushUserId = app.profile?.id ?? app.authUser?.id;
  const primary = shell.primaryNav;
  const primaryKeys = new Set(primary.map((slot) => slot.key));
  const additional = shell.drawer.filter((item) => !primaryKeys.has(item.key));
  const activeOrganizationId = app.school?.id ?? "";
  const activeRole = app.role ?? "";
  const organizations = organizationOptions(shell.affiliations);
  const roles = rolesForOrganization(shell.affiliations, activeOrganizationId);

  async function switchContext(organizationId: string, role: string) {
    setContextError(false);
    setPending("context");
    try {
      await switchActiveOrganization({ data: { organizationId, role } });
      await app.refresh();
    } catch {
      setContextError(true);
    } finally {
      setPending(null);
    }
  }

  useEffect(() => {
    if (!pushUserId) return;
    void refreshPushTokenIfGranted(pushUserId);
  }, [pushUserId]);

  function go(href: string, key?: string) {
    if (key) {
      setPending(key);
      if ([...shell.nav, ...shell.drawer].some((item) => item.key === key)) {
        shell.recordUsage(key);
      }
    }
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
      <div
        className={`app-shell-frame${path === "/home/s/roles" ? " is-role-management" : ""}${path === "/home/s/nav.students" || path === "/home/s/students" ? " is-student-mobility" : ""}`}
      >
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
          <div className="app-shell-header-center">
            <nav className="app-shell-primary-nav" aria-label="Primary sections">
              {primary.map((slot) => {
                const active = path === slot.href;
                return (
                  <Link
                    key={slot.key}
                    to={slot.href as never}
                    className={active ? "is-active" : undefined}
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      shell.recordUsage(slot.key);
                      rememberResource({
                        id: slot.key,
                        title: slot.label,
                        href: slot.href,
                        kind: "workspace-section",
                        at: new Date().toISOString(),
                      });
                    }}
                  >
                    {slot.label}
                  </Link>
                );
              })}
            </nav>
            {roles.length > 1 || organizations.length > 1 ? (
              <div className="app-shell-context-switchers">
                {roles.length > 1 ? (
                  <select
                    aria-label="Active role"
                    value={activeRole}
                    disabled={pending === "context"}
                    onChange={(event) =>
                      void switchContext(activeOrganizationId, event.target.value)
                    }
                  >
                    {roles.map((role) => (
                      <option key={role} value={role}>
                        {scholarWorkspaceLabelForRole(role)}
                      </option>
                    ))}
                  </select>
                ) : null}
                {organizations.length > 1 ? (
                  <select
                    aria-label="Active organization"
                    value={activeOrganizationId}
                    disabled={pending === "context"}
                    onChange={(event) => {
                      const affiliation = affiliationForOrganization(
                        shell.affiliations,
                        event.target.value,
                        activeRole,
                      );
                      if (affiliation)
                        void switchContext(affiliation.organizationId, affiliation.role);
                    }}
                  >
                    {organizations.map((organization) => (
                      <option key={organization.organizationId} value={organization.organizationId}>
                        {organization.organizationName}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            ) : null}
            {contextError ? (
              <p className="app-shell-context-error" role="alert">
                Could not switch workspace. Your current context is unchanged.
              </p>
            ) : null}
          </div>
          <div className="app-shell-header-actions">
            <ConnectionStatus />
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
            <button
              type="button"
              className="app-shell-icon-btn"
              aria-label="Profile"
              onClick={() => go(APP_SHELL_PROFILE)}
            >
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
              <Link
                key={slot.key}
                to={slot.href as never}
                className={active ? "is-active" : undefined}
                aria-label={slot.label}
                onClick={() => {
                  if (slot.kind === "role") shell.recordUsage(slot.key);
                }}
              >
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
          <button
            type="button"
            className="app-shell-scrim"
            aria-label="Close menu"
            onClick={() => setDrawer(false)}
          />
          <aside className="app-shell-drawer" data-testid="app-shell-drawer">
            <div className="app-shell-drawer-profile">
              {avatar ? (
                <img className="app-shell-avatar app-shell-avatar-lg" src={avatar} alt="" />
              ) : (
                <span className="app-shell-avatar app-shell-avatar-lg app-shell-avatar-fallback">
                  {initials(display)}
                </span>
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
            {primary.length ? (
              <p className="app-shell-drawer-kicker">Core responsibilities</p>
            ) : null}
            <nav className="app-shell-drawer-list" aria-label="Core responsibilities">
              {primary.map((item) => {
                const active = pending === item.key || path === item.href;
                const Icon = shellIcon(item.icon);
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`app-shell-drawer-item${active ? " is-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => go(item.href, item.key)}
                  >
                    <ShellGlassIcon active={active}>
                      <Icon />
                    </ShellGlassIcon>
                    {item.label}
                  </button>
                );
              })}
            </nav>
            {additional.length ? (
              <p className="app-shell-drawer-kicker">Add-on responsibilities</p>
            ) : null}
            <div className="app-shell-drawer-list">
              {additional.map((item) => {
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
            {app.profile ? (
              <button
                type="button"
                className={`app-shell-drawer-item${path === "/home/s/roles" ? " is-active" : ""}`}
                onClick={() => go("/home/s/roles", "role-management")}
                data-testid="role-management-link"
              >
                <ShellGlassIcon active={path === "/home/s/roles"}>
                  <Settings2 />
                </ShellGlassIcon>
                Roles and responsibilities
              </button>
            ) : null}
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
  const { loading, authUser, profile, signOut } = useApp();
  if (loading) return null;
  if (!authUser) return <Navigate to="/" search={{ panel: "signin" }} />;
  if (!isActiveMembership(profile)) {
    return <OrganizationAccessDenied onSignOut={signOut} />;
  }
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
