import { useState } from "react";
import {
  DEMO_WORKSPACE_MANIFESTS,
  DEMO_WORKSPACE_NOTIFICATIONS,
  DEMO_WORKSPACE_RECENT,
  DEMO_WORKSPACE_ROLES,
} from "./demo-workspaces";
import {
  additionalResponsibilities,
  primarySections,
  visibleWorkspaceWidgets,
  workspaceResponsibilityIcon,
} from "../workspace-shell";
import { ConnectionStatus } from "@/components/app-shell/connection-status";
import { ShellGlassIcon } from "@/components/app-shell/glass-icon";
import { shellIcon } from "@/lib/shell/icon-registry";
import "@/components/app-shell/app-shell.css";

export function WorkspaceFixturePreview() {
  const [roleKey, setRoleKey] = useState<(typeof DEMO_WORKSPACE_ROLES)[number]["key"]>("teacher");
  const [query, setQuery] = useState("");
  const [notificationFilter, setNotificationFilter] = useState<"all" | "unread" | "read">("all");
  const [scope, setScope] = useState("");
  const role = DEMO_WORKSPACE_ROLES.find((item) => item.key === roleKey)!;
  const manifest = DEMO_WORKSPACE_MANIFESTS[roleKey];
  const primary = primarySections(manifest);
  const addOns = additionalResponsibilities(manifest, primary);
  const widgets = visibleWorkspaceWidgets(manifest);
  const permittedItems = [
    ...manifest.nav,
    ...manifest.widgets,
    ...manifest.actions,
    ...manifest.inbox,
  ];
  const results = permittedItems.filter((item) =>
    `${item.label} ${item.key}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const notifications = DEMO_WORKSPACE_NOTIFICATIONS.filter(
    (item) => notificationFilter === "all" || item.unread === (notificationFilter === "unread"),
  );
  const scopeOptions = Object.entries(manifest.scopeOptions).flatMap(([dim, refs]) =>
    refs.map((ref) => ({ dim, ref })),
  );
  const renderResponsibility = (item: (typeof primary)[number], group: string) => {
    const Icon = shellIcon(workspaceResponsibilityIcon(item));
    return (
      <article
        key={item.key}
        role="listitem"
        className="app-shell-card workspace-preview-responsibility-card"
      >
        <ShellGlassIcon tone="accent">
          <Icon />
        </ShellGlassIcon>
        <div>
          <p>{item.label}</p>
          <small>{group}</small>
        </div>
      </article>
    );
  };

  return (
    <div className="app-shell workspace-preview" data-testid="workspace-preview">
      <header className="app-shell-header workspace-preview-header">
        <strong>Demo data · local workspace preview</strong>
        <ConnectionStatus />
        <label>
          Role fixture
          <select
            aria-label="Role fixture"
            value={roleKey}
            onChange={(event) => setRoleKey(event.target.value as typeof roleKey)}
          >
            {DEMO_WORKSPACE_ROLES.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </header>
      <main className="app-shell-main">
        <div className="app-shell-sheet app-shell-home">
          <header className="app-shell-greeting">
            <p>Demo School A · synthetic fixture only</p>
            <h1>{role.label} workspace</h1>
          </header>

          <label className="app-shell-search">
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              aria-label="Search authorized workspace"
              placeholder="Search authorized workspace"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {query ? (
            <ul className="workspace-preview-search" aria-label="Authorized search results">
              {results.map((item) => (
                <li key={`${item.kind}:${item.key}`}>{item.label}</li>
              ))}
              {!results.length ? <li>No authorized workspace results.</li> : null}
            </ul>
          ) : null}

          {scopeOptions.length ? (
            <label className="app-shell-scope-switcher">
              Assigned scope
              <select
                aria-label="Assigned scope"
                value={scope}
                onChange={(event) => setScope(event.target.value)}
              >
                <option value="">All assigned scopes</option>
                {scopeOptions.map((item) => (
                  <option key={`${item.dim}:${item.ref}`} value={`${item.dim}:${item.ref}`}>
                    {item.dim}: {item.ref.replace("demo-", "Demo ")}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <nav className="workspace-preview-primary-nav" aria-label="Primary sections">
            {primary.map((item) => (
              <a key={item.key} href={`#${item.key}`}>
                {item.label}
              </a>
            ))}
          </nav>

          <section aria-labelledby="workspace-preview-core">
            <div className="app-shell-section-title">
              <h2 id="workspace-preview-core">Core responsibilities</h2>
              <span className="workspace-preview-count">{primary.length} sections</span>
            </div>
            <div className="app-shell-cards" role="list" aria-label="Core responsibility cards">
              {primary.map((item) => renderResponsibility(item, "Core responsibility"))}
            </div>
          </section>
          <section aria-labelledby="workspace-preview-addon">
            <div className="app-shell-section-title">
              <h2 id="workspace-preview-addon">Add-on responsibilities</h2>
              <span className="workspace-preview-count">{addOns.length} available</span>
            </div>
            <div className="app-shell-cards" role="list" aria-label="Add-on responsibility cards">
              {addOns.map((item) => renderResponsibility(item, "Additional responsibility"))}
            </div>
          </section>

          <section aria-labelledby="workspace-preview-widgets">
            <h2 id="workspace-preview-widgets">Daily activity</h2>
            <div className="app-shell-widgets">
              {widgets.map((item) => (
                <article key={item.key} className="app-shell-widget">
                  <strong>{item.label}</strong>
                  <span>Demo preview — no live records</span>
                </article>
              ))}
            </div>
          </section>

          <section
            className="app-shell-recommendation"
            aria-labelledby="workspace-preview-recommendation"
          >
            <strong id="workspace-preview-recommendation">Recommendation</strong>
            <p>
              Consider reviewing your assigned work. This is a suggestion, not a decision or
              verified fact.
            </p>
          </section>

          <section aria-labelledby="workspace-preview-notifications">
            <h2 id="workspace-preview-notifications">Notifications</h2>
            <div
              className="app-shell-notification-filters"
              role="group"
              aria-label="Filter notifications"
            >
              {(["all", "unread", "read"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={notificationFilter === value}
                  onClick={() => setNotificationFilter(value)}
                >
                  {value === "all" ? "All" : value === "unread" ? "Unread" : "Read"}
                </button>
              ))}
            </div>
            <div className="app-shell-notification-list">
              {notifications.map((item) => (
                <article
                  key={item.title}
                  className={`app-shell-notification-card${item.unread ? " is-unread" : " is-read"}`}
                >
                  <div className="app-shell-notification-copy">
                    <strong>{item.title}</strong>
                    <p>{item.message}</p>
                  </div>
                  <span>{item.unread ? "Unread" : "Read"}</span>
                </article>
              ))}
            </div>
          </section>

          <section aria-labelledby="workspace-preview-recent">
            <h2 id="workspace-preview-recent">Recent</h2>
            <div className="app-shell-recent-list">
              {DEMO_WORKSPACE_RECENT.map((item) => (
                <article key={item.title} className="app-shell-card">
                  <p>{item.title}</p>
                  <small>{item.label}</small>
                </article>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
