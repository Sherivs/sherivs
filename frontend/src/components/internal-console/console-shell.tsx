import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bell,
  Boxes,
  Gauge,
  HelpCircle,
  Home,
  LayoutGrid,
  LifeBuoy,
  LogOut,
  Menu,
  PanelLeft,
  Plus,
  ScrollText,
  Search,
  Settings,
  UserCircle,
  Users,
  Building2,
} from "lucide-react";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import { useApp } from "@/contexts/app-context";
import {
  consoleSignInSearch,
  currentEffectiveHostKind,
  decideHostRoute,
  isConsoleOperator,
} from "@/lib/experience/console-host-routing";
import { getConsoleOverview } from "@/lib/internal-console/overview.functions";
import type { ConsoleOverview } from "@/lib/internal-console/overview";
import {
  CONSOLE_ACCOUNT_NAV,
  CONSOLE_NAV,
  CONSOLE_PLATFORM_NAV,
  filterNav,
  quickActionsFor,
  type ConsoleNavItem,
} from "@/lib/internal-console/roles";
import { CONSOLE_PATHS } from "@/lib/internal-console/paths";
import { searchConsole } from "@/lib/internal-console/search";
import { CONSOLE_HELP_ARTICLES } from "@/lib/internal-console/help-catalog";
import { REGISTERED_RUNTIMES } from "@/lib/internal-console/runtime-contract";
import { rememberResource, type RecentResource } from "@/lib/internal-console/recent";
import { rememberConsoleResource } from "@/lib/internal-console/workspace.functions";
import { workspaceIdFromPath, workspaceTypeLabel } from "@/lib/internal-console/workspaces";
import {
  buildConsoleVisualFixtureOverview,
  consoleVisualFixtureActive,
} from "@/lib/internal-console/visual-fixture";
import { ConsoleLoadingState, ConsoleNotice } from "./console-primitives";
import { ConsoleNotAuthorised, ConsoleElsewhere } from "./not-authorised";
import "./console.css";

type ConsoleState = {
  overview: ConsoleOverview | null;
  error: string | null;
  reload: () => Promise<void>;
};

const ConsoleCtx = createContext<ConsoleState | undefined>(undefined);

export function useConsole() {
  const value = useContext(ConsoleCtx);
  if (!value) throw new Error("useConsole must be used inside the Internal Console");
  return value;
}

function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function envClass(label: string): string {
  const value = label.toLowerCase();
  if (value === "production") return "is-production";
  if (value === "preview" || value === "development") return "is-preview";
  return "is-unknown";
}

function navActive(href: string, path: string): boolean {
  if (href === CONSOLE_PATHS.home) return path === href;
  return path === href || path.startsWith(`${href}/`);
}

function remember(entry: RecentResource) {
  rememberResource(entry);
  void rememberConsoleResource({ data: entry }).catch(() => undefined);
}

const NAV_ICONS: Record<string, LucideIcon> = {
  home: Home,
  organizations: Building2,
  team: Users,
  workspaces: LayoutGrid,
  runtimes: Boxes,
  activity: Activity,
  account: UserCircle,
  settings: Settings,
  help: LifeBuoy,
  metrics: Gauge,
  logs: ScrollText,
};

function NavGroup({
  label,
  items,
  path,
  collapsed,
}: {
  label: string;
  items: ConsoleNavItem[];
  path: string;
  collapsed: boolean;
}) {
  if (!items.length) return null;
  return (
    <>
      <p className="sherivs-console-kicker">{label}</p>
      <nav className="sherivs-console-nav" aria-label={label}>
        {items.map((item) => {
          const Icon = NAV_ICONS[item.key] ?? LayoutGrid;
          const active = navActive(item.href, path);
          const parent =
            item.navigable === false ? (
              <span
                className={`sherivs-console-nav-label${active ? " is-active" : ""}`}
                title={item.label}
              >
                <Icon size={16} aria-hidden="true" />
                {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
              </span>
            ) : (
              <Link
                to={item.href as never}
                className={active ? "is-active" : undefined}
                title={item.label}
                aria-current={active ? "page" : undefined}
                onClick={() =>
                  remember({
                    id: item.key,
                    title: item.label,
                    href: item.href,
                    kind: "page",
                    at: new Date().toISOString(),
                  })
                }
              >
                <Icon size={16} aria-hidden="true" />
                {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
              </Link>
            );
          return (
            <span key={item.key}>
              {parent}
              {!collapsed &&
                item.children?.map((child) => (
                  <Link
                    key={child.key}
                    to={child.href as never}
                    className={`is-child${navActive(child.href, path) ? " is-active" : ""}`}
                    aria-current={navActive(child.href, path) ? "page" : undefined}
                  >
                    {child.label}
                  </Link>
                ))}
            </span>
          );
        })}
      </nav>
    </>
  );
}

function ConsoleChrome({ children }: { children: ReactNode }) {
  const app = useApp();
  const console = useConsole();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [openSearch, setOpenSearch] = useState(false);
  const [openQuick, setOpenQuick] = useState(false);
  const [openWorkspace, setOpenWorkspace] = useState(false);
  const [openRuntime, setOpenRuntime] = useState(false);
  const [openProfile, setOpenProfile] = useState(false);
  const [openNotice, setOpenNotice] = useState(false);
  const [mobileSearch, setMobileSearch] = useState(false);
  const overview = console.overview;
  const capabilities = useMemo(() => new Set(overview?.viewer.capabilities ?? []), [overview]);
  const viewer = {
    isSuperAdmin: overview?.viewer.isSuperAdmin ?? Boolean(app.superAdmin),
    capabilities,
  };
  const mainNav = filterNav(CONSOLE_NAV, viewer);
  const accountNav = filterNav(CONSOLE_ACCOUNT_NAV, viewer);
  const platformNav = filterNav(CONSOLE_PLATFORM_NAV, viewer);
  const actions = quickActionsFor(viewer);
  const path = location.pathname;
  const hits = searchConsole({
    query,
    canReadStaff: viewer.capabilities.has("platform.staff.read"),
    staff: (overview?.staff ?? []).map((row) => ({
      id: row.id,
      fullName: row.fullName,
      email: row.email,
      department: row.department,
      status: row.status,
    })),
    canReadOrganizations: viewer.capabilities.has("platform.tenants.read"),
    organizations: (overview?.organizations ?? []).map((row) => ({
      id: row.id,
      displayName: row.displayName,
      lifecycleState: row.lifecycleState,
    })),
    workspaces: overview?.workspaces ?? [],
    runtimes: overview?.runtimes?.length ? overview.runtimes : REGISTERED_RUNTIMES,
    pages: [...mainNav, ...accountNav, ...platformNav],
    help: CONSOLE_HELP_ARTICLES,
  });

  useEffect(() => {
    setDrawer(false);
    setOpenQuick(false);
    setOpenWorkspace(false);
    setOpenRuntime(false);
    setOpenProfile(false);
    setOpenNotice(false);
  }, [path]);

  const display = overview?.viewer.name ?? app.authUser?.email ?? "Staff";
  const workspaces = overview?.workspaces ?? [];
  const activeWorkspaceId = workspaceIdFromPath(path) ?? workspaces[0]?.id ?? "me";
  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0];
  const workspaceName = activeWorkspace?.name ?? "My Workspace";
  const runtimes = overview?.runtimes?.length ? overview.runtimes : REGISTERED_RUNTIMES;
  const activeRuntime =
    runtimes.find(
      (runtime) => path === runtime.helpHref || path.startsWith(`${runtime.helpHref}/`),
    ) ?? runtimes[0];
  const runtimeName = activeRuntime?.name ?? "Sherivs Scholar";

  return (
    <div
      className={`sherivs-console${drawer ? " is-drawer" : ""}${collapsed ? " is-collapsed" : ""}`}
      data-testid="internal-console"
    >
      <div className="sherivs-console-orbs" aria-hidden="true">
        <span className="sherivs-console-orb sherivs-console-orb-cyan" />
        <span className="sherivs-console-orb sherivs-console-orb-blue" />
        <span className="sherivs-console-orb sherivs-console-orb-violet" />
      </div>
      <div className="sherivs-console-frame">
        <header className="sherivs-console-top">
          <button
            type="button"
            className="sherivs-console-icon-btn sherivs-console-menu"
            aria-label="Open menu"
            onClick={() => setDrawer(true)}
          >
            <Menu size={18} />
          </button>
          <Link to={CONSOLE_PATHS.home as never} className="sherivs-console-brand">
            <SherivsLogo size={28} wordmark={false} />
            <span className="sherivs-console-brand-copy">
              <strong>Sherivs</strong>
              <small>Internal Console</small>
            </span>
          </Link>
          <div className="sherivs-console-switchers">
            <div className="sherivs-console-switcher">
              <button
                type="button"
                className="sherivs-console-chip"
                aria-haspopup="listbox"
                aria-expanded={openWorkspace}
                aria-label="Switch workspace"
                onClick={() => {
                  setOpenWorkspace((open) => !open);
                  setOpenRuntime(false);
                  setOpenQuick(false);
                }}
              >
                <span className="sherivs-console-chip-kind">Workspace </span>
                <strong>{workspaceName}</strong>
                {activeWorkspace ? (
                  <small> · {workspaceTypeLabel(activeWorkspace.type)}</small>
                ) : null}
              </button>
              {openWorkspace ? (
                <div
                  className="sherivs-console-search-panel sherivs-console-switcher-panel"
                  role="listbox"
                >
                  {workspaces.map((workspace) => (
                    <Link
                      key={workspace.id}
                      to={workspace.href as never}
                      onClick={() => {
                        setOpenWorkspace(false);
                        void console.reload();
                      }}
                    >
                      <strong>{workspace.name}</strong>
                      <small>
                        {" "}
                        · {workspaceTypeLabel(workspace.type)} · {workspace.access}
                        {workspace.source === "derived" ? " · compatibility" : ""}
                      </small>
                    </Link>
                  ))}
                  {workspaces.length === 0 ? (
                    <p className="sherivs-console-empty" style={{ padding: "0.7rem" }}>
                      No authorized workspaces.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="sherivs-console-switcher">
              <button
                type="button"
                className="sherivs-console-chip"
                aria-haspopup="listbox"
                aria-expanded={openRuntime}
                aria-label="Switch runtime"
                onClick={() => {
                  setOpenRuntime((open) => !open);
                  setOpenWorkspace(false);
                  setOpenQuick(false);
                }}
              >
                <span className="sherivs-console-chip-kind">Runtime </span>
                <strong>{runtimeName}</strong>
              </button>
              {openRuntime ? (
                <div
                  className="sherivs-console-search-panel sherivs-console-switcher-panel"
                  role="listbox"
                >
                  {runtimes
                    .filter((runtime) => runtime.status === "operational_product")
                    .map((runtime) => (
                      <Link
                        key={runtime.id}
                        to={runtime.helpHref as never}
                        onClick={() => setOpenRuntime(false)}
                      >
                        <strong>{runtime.name}</strong>
                        <small> · operational product</small>
                      </Link>
                    ))}
                </div>
              ) : null}
            </div>
            <span
              className={`sherivs-console-env ${envClass(overview?.context.environment ?? "Unknown")}`}
            >
              {overview?.context.environment ?? "Unknown"}
            </span>
          </div>
          <div className={`sherivs-console-search-wrap${mobileSearch ? " is-open" : ""}`}>
            <label className="sherivs-console-search">
              <Search size={16} />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOpenSearch(true);
                }}
                onFocus={() => setOpenSearch(true)}
                placeholder="Search authorized resources"
                aria-label="Search authorized resources"
              />
            </label>
            {openSearch && query.trim().length >= 2 ? (
              <div className="sherivs-console-search-panel" role="listbox">
                {hits.length ? (
                  hits.map((hit) => (
                    <Link
                      key={`${hit.kind}:${hit.id}`}
                      to={hit.href as never}
                      onClick={() => {
                        setOpenSearch(false);
                        remember({
                          id: hit.id,
                          title: hit.title,
                          href: hit.href,
                          kind: hit.kind,
                          at: new Date().toISOString(),
                        });
                      }}
                    >
                      <strong>{hit.title}</strong>
                      <small> · {hit.kind}</small>
                    </Link>
                  ))
                ) : (
                  <p className="sherivs-console-empty" style={{ padding: "0.7rem" }}>
                    No authorized matches.
                  </p>
                )}
              </div>
            ) : null}
          </div>
          <div className="sherivs-console-top-actions">
            <button
              type="button"
              className="sherivs-console-icon-btn sherivs-console-search-toggle"
              aria-label="Search"
              onClick={() => setMobileSearch((open) => !open)}
            >
              <Search size={18} />
            </button>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="sherivs-console-icon-btn"
                aria-label="Quick actions"
                aria-expanded={openQuick}
                onClick={() => {
                  setOpenQuick((open) => !open);
                  setOpenNotice(false);
                  setOpenProfile(false);
                }}
              >
                <Plus size={18} />
              </button>
              {openQuick ? (
                <div
                  className="sherivs-console-search-panel"
                  style={{ width: "16rem", right: 0, left: "auto" }}
                >
                  {actions.map((action) => (
                    <Link
                      key={action.key}
                      to={action.href as never}
                      onClick={() => setOpenQuick(false)}
                    >
                      {action.label}
                    </Link>
                  ))}
                  {actions.length === 0 ? (
                    <p className="sherivs-console-empty" style={{ padding: "0.7rem" }}>
                      No permitted actions.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="sherivs-console-icon-btn"
                aria-label="Notifications"
                aria-expanded={openNotice}
                onClick={() => {
                  setOpenNotice((open) => !open);
                  setOpenQuick(false);
                  setOpenProfile(false);
                }}
              >
                <Bell size={18} />
              </button>
              {openNotice ? (
                <div
                  className="sherivs-console-search-panel"
                  style={{ width: "18rem", right: 0, left: "auto" }}
                >
                  {(overview?.attention ?? []).length ? (
                    overview?.attention.map((item) => (
                      <Link
                        key={item.id}
                        to={item.href as never}
                        onClick={() => setOpenNotice(false)}
                      >
                        <strong>{item.title}</strong>
                        <small> · {item.severity}</small>
                      </Link>
                    ))
                  ) : (
                    <p className="sherivs-console-empty" style={{ padding: "0.7rem" }}>
                      There is no notification inbox. Verified attention items appear on Home.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="sherivs-console-icon-btn"
              aria-label="Help"
              onClick={() => void navigate({ to: CONSOLE_PATHS.help as never })}
            >
              <HelpCircle size={18} />
            </button>
            <div style={{ position: "relative" }}>
              <button
                type="button"
                className="sherivs-console-icon-btn"
                aria-label="Account menu"
                aria-expanded={openProfile}
                onClick={() => {
                  setOpenProfile((open) => !open);
                  setOpenQuick(false);
                  setOpenNotice(false);
                }}
              >
                <span className="sherivs-console-avatar">{initials(display)}</span>
              </button>
              {openProfile ? (
                <div
                  className="sherivs-console-search-panel"
                  style={{ width: "16rem", right: 0, left: "auto" }}
                >
                  <Link to={CONSOLE_PATHS.account as never} onClick={() => setOpenProfile(false)}>
                    Account & Preferences
                  </Link>
                  <Link to={CONSOLE_PATHS.help as never} onClick={() => setOpenProfile(false)}>
                    Help
                  </Link>
                  <button type="button" onClick={() => void app.signOut()}>
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {drawer ? (
          <button
            type="button"
            className="sherivs-console-drawer-scrim"
            aria-label="Close menu"
            onClick={() => setDrawer(false)}
          />
        ) : null}

        <aside className="sherivs-console-side">
          <button
            type="button"
            className="sherivs-console-icon-btn"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed((value) => !value)}
          >
            <PanelLeft size={16} />
          </button>
          <NavGroup label="Internal Console" items={mainNav} path={path} collapsed={collapsed} />
          <NavGroup label="Account" items={accountNav} path={path} collapsed={collapsed} />
          <NavGroup label="Platform" items={platformNav} path={path} collapsed={collapsed} />
          <nav className="sherivs-console-nav" style={{ marginTop: "auto" }}>
            <button type="button" onClick={() => void app.signOut()}>
              <LogOut size={16} />
              {collapsed ? "" : "Sign out"}
            </button>
          </nav>
        </aside>

        <main className="sherivs-console-main">
          <div className="sherivs-console-sheet">
            {consoleVisualFixtureActive() ? (
              <ConsoleNotice tone="warning">
                Local visual fixture. This is not a production identity. Persistent workspace
                storage is not connected.
              </ConsoleNotice>
            ) : null}
            {overview?.workspaceStore === "derived-fallback" ? (
              <ConsoleNotice tone="warning">
                Persistent workspace storage is not configured in this environment. Compatibility
                workspaces are shown from role membership and cannot hold custom members.
              </ConsoleNotice>
            ) : null}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

export function InternalConsoleLayout() {
  const app = useApp();
  const location = useLocation();
  const [overview, setOverview] = useState<ConsoleOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostKind = currentEffectiveHostKind();
  const operator = isConsoleOperator(app);

  async function reload() {
    try {
      const next = consoleVisualFixtureActive()
        ? buildConsoleVisualFixtureOverview()
        : await getConsoleOverview();
      setOverview(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the console.");
    }
  }

  useEffect(() => {
    if (app.loading || !app.authUser || !operator) return;
    void reload();
  }, [app.loading, app.authUser, operator, location.pathname]);

  if (app.loading) {
    return <ConsoleLoadingState message="Loading the Internal Console…" />;
  }

  const decision = decideHostRoute({
    hostKind,
    pathname: location.pathname,
    signedIn: Boolean(app.authUser),
    isConsoleOperator: operator,
  });
  if (decision.kind === "redirect") {
    if (decision.to === "/auth") {
      return <Navigate to="/auth" search={consoleSignInSearch(location.pathname) as never} />;
    }
    return <Navigate to={decision.to as never} />;
  }
  if (decision.kind === "not_authorised") return <ConsoleNotAuthorised />;
  if (decision.kind === "console_elsewhere") return <ConsoleElsewhere />;
  if (!app.authUser) {
    return <Navigate to="/auth" search={consoleSignInSearch(location.pathname) as never} />;
  }
  if (!operator) return <ConsoleNotAuthorised />;

  return (
    <ConsoleCtx.Provider value={{ overview, error, reload }}>
      <ConsoleChrome>
        {error && !overview ? (
          <section className="sherivs-console-card">
            <h1>Console unavailable</h1>
            <p className="sherivs-console-error">{error}</p>
          </section>
        ) : (
          <Outlet />
        )}
      </ConsoleChrome>
    </ConsoleCtx.Provider>
  );
}
