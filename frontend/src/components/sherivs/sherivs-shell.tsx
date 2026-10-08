import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { SherivsLockup } from "@/components/sherivs/sherivs-logo";
import {
  Bell,
  Command,
  Inbox,
  PanelLeft,
  Search,
  Sparkles,
  User2,
} from "@/components/sherivs/sherivs-icons";

/**
 * Universal Sherivs application shell (V1 foundation).
 *
 * The shared authenticated experience layer: global header (identity,
 * organization/workspace switchers, search, command interface, Jarvis
 * access, notifications, profile), contextual sidebar, content area with
 * breadcrumbs and contextual actions, and slots for the notification
 * center and AI interface.
 *
 * Capability-driven: navigation entries arrive as props from the host
 * (projected from role + permissions + installed runtimes), so the shell
 * never hardcodes what an organization sees.
 */

export interface SherivsNavEntry {
  label: string;
  to: string;
  icon?: ReactNode;
  badge?: string | number;
}

export interface SherivsShellProps {
  organizationName: string;
  workspaceName?: string;
  userName: string;
  navigation: readonly SherivsNavEntry[];
  breadcrumbs?: readonly { label: string; to?: string }[];
  title?: string;
  description?: string;
  actions?: ReactNode;
  onCommandPalette?: () => void;
  onSearch?: () => void;
  onJarvis?: () => void;
  onNotifications?: () => void;
  unreadNotifications?: number;
  sidebarFooter?: ReactNode;
  notificationCenter?: ReactNode;
  aiPanel?: ReactNode;
  children: ReactNode;
}

export function SherivsAppShell({
  organizationName,
  workspaceName,
  userName,
  navigation,
  breadcrumbs,
  title,
  description,
  actions,
  onCommandPalette,
  onSearch,
  onJarvis,
  onNotifications,
  unreadNotifications = 0,
  sidebarFooter,
  notificationCenter,
  aiPanel,
  children,
}: SherivsShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="sherivs-app-shell flex min-h-dvh flex-col bg-background text-foreground">
      <a
        href="#sherivs-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-semibold focus:text-black"
      >
        Skip to content
      </a>

      {/* Global header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
        <div className="flex items-center gap-2 px-3 py-2.5 sm:px-4">
          <button
            type="button"
            className="grid size-9 shrink-0 place-items-center rounded-md hover:bg-accent lg:hidden"
            aria-expanded={sidebarOpen}
            aria-controls="sherivs-sidebar"
            aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <PanelLeft className="size-5" />
          </button>
          <Link
            to="/"
            aria-label="Sherivs home"
            className="hidden shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:block"
          >
            <SherivsLockup compact />
          </Link>

          {/* Organization / workspace switchers (host-provided) */}
          <div className="ml-1 hidden min-w-0 items-center gap-1.5 md:flex" aria-label="Context">
            <span className="truncate rounded-md bg-muted/40 px-2.5 py-1.5 text-xs font-semibold">
              {organizationName}
            </span>
            {workspaceName && (
              <span className="truncate px-1 text-xs text-muted-foreground">/ {workspaceName}</span>
            )}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ShellIconButton label="Search" onClick={onSearch}>
              <Search className="size-[18px]" />
            </ShellIconButton>
            <ShellIconButton label="Command palette" onClick={onCommandPalette}>
              <Command className="size-[18px]" />
            </ShellIconButton>
            <ShellIconButton label="Ask Jarvis" onClick={onJarvis} accent>
              <Sparkles className="size-[18px]" />
            </ShellIconButton>
            <ShellIconButton
              label={`Notifications${unreadNotifications > 0 ? `, ${unreadNotifications} unread` : ""}`}
              onClick={onNotifications}
            >
              <span className="relative">
                <Bell className="size-[18px]" />
                {unreadNotifications > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-1 -right-1 size-2 rounded-full bg-destructive"
                  />
                )}
              </span>
            </ShellIconButton>
            <span
              className="ml-1 hidden size-8 place-items-center rounded-full bg-muted text-xs font-bold sm:grid"
              role="img"
              aria-label={`Signed in as ${userName}`}
              title={userName}
            >
              <User2 className="size-4" aria-hidden="true" />
            </span>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Sidebar scrim (mobile) */}
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-40 bg-black/40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Global sidebar */}
        <aside
          id="sherivs-sidebar"
          aria-label="Workspace navigation"
          className={cn(
            "fixed z-50 flex max-h-dvh w-72 shrink-0 flex-col border-r border-border bg-background transition-transform lg:sticky lg:top-[57px] lg:max-h-[calc(100dvh-57px)] lg:translate-x-0",
            sidebarOpen ? "translate-x-0" : "-translate-x-full",
            collapsed && "lg:w-16",
          )}
        >
          <nav aria-label="Contextual" className="min-h-0 flex-1 overflow-y-auto p-3">
            <ul className="grid gap-0.5">
              {navigation.map((entry) => (
                <li key={`${entry.label}${entry.to}`}>
                  <Link
                    to={entry.to}
                    onClick={() => setSidebarOpen(false)}
                    activeProps={{ "aria-current": "page" }}
                    className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    title={collapsed ? entry.label : undefined}
                  >
                    {entry.icon ?? <Inbox className="size-4 shrink-0" aria-hidden="true" />}
                    {!collapsed && <span className="min-w-0 flex-1 truncate">{entry.label}</span>}
                    {!collapsed && entry.badge !== undefined && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">
                        {entry.badge}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {sidebarFooter && !collapsed && (
            <div className="border-t border-border p-3">{sidebarFooter}</div>
          )}
          <div className="hidden border-t border-border p-2 lg:block">
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="grid w-full place-items-center rounded-md py-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <PanelLeft className="size-4" />
            </button>
          </div>
        </aside>

        {/* Content area */}
        <div className="min-w-0 flex-1">
          <main id="sherivs-content" className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
            {breadcrumbs && breadcrumbs.length > 0 && (
              <nav aria-label="Breadcrumb" className="mb-3">
                <ol className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {breadcrumbs.map((crumb, index) => (
                    <li key={crumb.label} className="flex items-center gap-1.5">
                      {index > 0 && <span aria-hidden="true">/</span>}
                      {crumb.to ? (
                        <Link to={crumb.to} className="hover:text-foreground hover:underline">
                          {crumb.label}
                        </Link>
                      ) : (
                        <span aria-current="page" className="text-foreground">
                          {crumb.label}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>
            )}
            {(title || actions) && (
              <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
                <div className="min-w-0">
                  {title && (
                    <h1 className="font-display text-xl font-bold tracking-tight break-words sm:text-2xl">
                      {title}
                    </h1>
                  )}
                  {description && (
                    <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                  )}
                </div>
                {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
              </header>
            )}
            {children}
          </main>
        </div>

        {/* Secondary panel slots */}
        {notificationCenter}
        {aiPanel}
      </div>
    </div>
  );
}

function ShellIconButton({
  label,
  onClick,
  accent = false,
  children,
}: {
  label: string;
  onClick?: () => void;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-9 place-items-center rounded-md transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        accent && "text-primary",
      )}
    >
      {children}
    </button>
  );
}
