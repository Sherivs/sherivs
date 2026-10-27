import { useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { composeActivity } from "@/lib/shell/activity";
import { shellIcon } from "@/lib/shell/icon-registry";
import { accentTone, formatWidgetMetric } from "@/lib/shell/metrics";
import { APP_SHELL_NOTIFICATIONS } from "@/lib/shell/paths";
import { searchableSection } from "@/lib/shell/role-template";
import { switchActiveOrganization } from "@/lib/identity/memberships.functions";
import { ShellGlassIcon } from "./glass-icon";
import { useAppShell } from "./shell-context";

function matches(needle: string, label: string, key: string): boolean {
  if (!needle) return true;
  return `${label} ${key}`.toLowerCase().includes(needle);
}

export function AppHomeScreen() {
  const shell = useAppShell();
  const [openSwitcher, setOpenSwitcher] = useState(false);
  const needle = shell.query.trim().toLowerCase();
  const widgets = shell.home.widgets.filter((item) => matches(needle, item.label, item.key)).slice(0, 8);
  const actions = shell.home.actions.filter((item) => matches(needle, item.label, item.key)).slice(0, 8);
  const news = shell.home.news.filter((item) => matches(needle, item.label, item.key));
  const cards = shell.home.cards.filter((item) => matches(needle, item.label, item.key)).slice(0, 8);
  const newsLists = composeActivity({
    inbox: [],
    widgets: shell.manifest?.widgets?.filter((item) => /announce|news/i.test(`${item.key} ${item.label}`)) ?? [],
    cards: shell.cards,
  }).filter((item) => matches(needle, item.title, item.key));
  const showSearch =
    shell.drawer.some((item) => searchableSection(item.key, item.label)) ||
    widgets.length > 3 ||
    actions.length > 0;

  async function chooseContext(organizationId: string, role: string) {
    setOpenSwitcher(false);
    await switchActiveOrganization({ data: { organizationId, role } });
    await shell.app.refresh();
    await shell.reload();
  }

  return (
    <div className="app-shell-home" data-testid="app-shell-home">
      <header className="app-shell-greeting">
        <p>
          {shell.greeting}
          <span className="app-shell-greeting-time"> · {shell.clock}</span>
        </p>
        <h1>{shell.name.display}</h1>
        <p className="app-shell-org">{shell.orgName}</p>
        {shell.showSwitcher ? (
          <div>
            <button
              type="button"
              className="app-shell-switcher"
              data-testid="app-shell-switcher"
              onClick={() => setOpenSwitcher((open) => !open)}
            >
              <span>{shell.roleTitle}</span>
              <ChevronDown size={16} />
            </button>
            {openSwitcher ? (
              <div className="app-shell-switcher-menu" role="listbox">
                {shell.affiliations.map((row) => (
                  <button
                    key={`${row.organizationId}:${row.role}`}
                    type="button"
                    className={row.active ? "is-active" : undefined}
                    onClick={() => void chooseContext(row.organizationId, row.role)}
                  >
                    <strong>{row.organizationName}</strong>
                    <small>{row.role}</small>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {showSearch ? (
        <label className="app-shell-search">
          <Search size={16} />
          <input
            value={shell.query}
            onChange={(event) => shell.setQuery(event.target.value)}
            placeholder="Search this workspace"
            aria-label="Search this workspace"
          />
        </label>
      ) : null}

      {widgets.length ? (
        <div className="app-shell-widgets" data-testid="app-shell-widgets">
          {widgets.map((widget, index) => {
            const Icon = shellIcon(widget.icon);
            const metric = formatWidgetMetric(shell.cards[widget.key]);
            return (
              <Link key={widget.key} to={widget.href as never} className="app-shell-widget">
                <ShellGlassIcon className={`app-shell-tone-${accentTone(index)}`}>
                  <Icon />
                </ShellGlassIcon>
                <strong className={`app-shell-metric-${metric.tone}`}>{metric.text}</strong>
                <span>{widget.label}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <p className="app-shell-empty">This role has no home widgets yet. Open a section from the menu.</p>
      )}

      {actions.length ? (
        <>
          <div className="app-shell-section-title">
            <h2>Quick actions</h2>
          </div>
          <div className="app-shell-actions" data-testid="app-shell-actions">
            {actions.map((action, index) => {
              const Icon = shellIcon(action.icon);
              return (
                <Link key={action.key} to={action.href as never} className="app-shell-action">
                  <ShellGlassIcon className={`app-shell-tone-${accentTone(index + 1)}`}>
                    <Icon />
                  </ShellGlassIcon>
                  {action.label}
                </Link>
              );
            })}
          </div>
        </>
      ) : null}

      {news.length || newsLists.length ? (
        <>
          <div className="app-shell-section-title">
            <h2>News and announcements</h2>
          </div>
          <div className="app-shell-activity" data-testid="app-shell-news">
            {(newsLists.length ? newsLists : news.map((item) => ({
              key: item.key,
              title: item.label,
              detail: "From your organization",
              icon: item.icon,
              href: item.href,
            }))).map((item) => {
              const Icon = shellIcon(item.icon);
              return (
                <Link key={item.key} to={item.href as never} className="app-shell-activity-item">
                  <ShellGlassIcon>
                    <Icon />
                  </ShellGlassIcon>
                  <div>
                    <p>{item.title}</p>
                    <small>{item.detail}</small>
                  </div>
                  <ChevronRight size={16} style={{ marginLeft: "auto", opacity: 0.45 }} />
                </Link>
              );
            })}
          </div>
        </>
      ) : null}

      {cards.length ? (
        <>
          <div className="app-shell-section-title">
            <h2>Workspace</h2>
            <Link to={APP_SHELL_NOTIFICATIONS as never}>View all</Link>
          </div>
          <div className="app-shell-cards">
            {cards.map((item) => {
              const Icon = shellIcon(item.icon);
              return (
                <Link key={item.key} to={item.href as never} className="app-shell-card">
                  <ShellGlassIcon>
                    <Icon />
                  </ShellGlassIcon>
                  <div>
                    <p>{item.label}</p>
                    <small>Open section</small>
                  </div>
                  <ChevronRight size={16} style={{ marginLeft: "auto", opacity: 0.45 }} />
                </Link>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
