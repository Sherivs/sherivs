import { useEffect, useMemo, useState } from "react";
import { ChevronRight, MoveDown, MoveUp, Plus, Search, Settings2, X } from "lucide-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { composeActivity } from "@/lib/shell/activity";
import { shellIcon } from "@/lib/shell/icon-registry";
import { accentTone, formatWidgetMetric } from "@/lib/shell/metrics";
import { APP_SHELL_NOTIFICATIONS } from "@/lib/shell/paths";
import {
  allowedHrefsFrom,
  readRecentResources,
  rememberResource,
} from "@/lib/internal-console/recent";
import {
  permittedWidgetCatalog,
  reorderWidgetKeys,
  visibleWorkspaceWidgets,
} from "@/components/workspaces/workspace-shell";
import { ShellGlassIcon } from "./glass-icon";
import { useAppShell } from "./shell-context";

function matches(needle: string, label: string, key: string): boolean {
  if (!needle) return true;
  return `${label} ${key}`.toLowerCase().includes(needle);
}

export function AppHomeScreen() {
  const shell = useAppShell();
  const navigate = useNavigate();
  const [manageWidgets, setManageWidgets] = useState(false);
  const [savingWidgets, setSavingWidgets] = useState(false);
  const [widgetMessage, setWidgetMessage] = useState<string | null>(null);
  const needle = shell.query.trim().toLowerCase();
  const widgets = shell.home.widgets.filter((item) => matches(needle, item.label, item.key));
  const actions = shell.home.actions
    .filter((item) => matches(needle, item.label, item.key))
    .slice(0, 4);
  const news = shell.home.news.filter((item) => matches(needle, item.label, item.key));
  const cards = shell.home.cards
    .filter((item) => matches(needle, item.label, item.key))
    .slice(0, 8);
  const searchResults = shell.drawer
    .filter((item) => matches(needle, item.label, item.key))
    .slice(0, 10);
  const allowedHrefs = useMemo(
    () => allowedHrefsFrom([...shell.nav, ...shell.drawer]),
    [shell.nav, shell.drawer],
  );
  const [recent, setRecent] = useState<ReturnType<typeof readRecentResources>>([]);
  const widgetKeys = shell.manifest
    ? visibleWorkspaceWidgets(shell.manifest, shell.prefs.hidden).map((item) => item.key)
    : [];
  const widgetCatalog = shell.manifest ? permittedWidgetCatalog(shell.manifest) : [];
  const availableWidgets = widgetCatalog.filter((item) => !widgetKeys.includes(item.key));
  const newsLists = composeActivity({
    inbox: [],
    widgets:
      shell.manifest?.widgets?.filter((item) =>
        /announce|news/i.test(`${item.key} ${item.label}`),
      ) ?? [],
    cards: shell.cards,
  }).filter((item) => matches(needle, item.title, item.key));
  const showSearch = true;

  useEffect(() => {
    setRecent(readRecentResources(allowedHrefs));
  }, [allowedHrefs]);

  function remember(item: { key: string; label: string; href: string }) {
    shell.recordUsage(item.key);
    rememberResource({
      id: item.key,
      title: item.label,
      href: item.href,
      kind: "workspace-section",
      at: new Date().toISOString(),
    });
  }

  async function chooseScope(value: string) {
    const query = value ? `?scope=${encodeURIComponent(value)}` : "";
    await navigate({ to: `/home${query}` as never });
  }

  async function saveWidgetPrefs(prefs: typeof shell.prefs) {
    setSavingWidgets(true);
    setWidgetMessage(null);
    const saved = await shell.savePrefs(prefs);
    setSavingWidgets(false);
    setWidgetMessage(
      saved ? "Widget layout saved." : "Widget layout could not be saved. Try again.",
    );
  }

  async function addWidget(key: string) {
    const hidden = new Set(shell.prefs.hidden ?? []);
    const added = new Set(shell.prefs.added ?? []);
    hidden.delete(key);
    added.add(key);
    await saveWidgetPrefs({
      ...shell.prefs,
      hidden: [...hidden],
      added: [...added],
      order: [...widgetKeys, key],
    });
  }

  async function removeWidget(key: string) {
    const hidden = new Set(shell.prefs.hidden ?? []);
    const added = new Set(shell.prefs.added ?? []);
    hidden.add(key);
    added.delete(key);
    await saveWidgetPrefs({
      ...shell.prefs,
      hidden: [...hidden],
      added: [...added],
      order: widgetKeys.filter((item) => item !== key),
    });
  }

  async function moveWidget(key: string, direction: -1 | 1) {
    await saveWidgetPrefs({
      ...shell.prefs,
      order: reorderWidgetKeys(widgetKeys, key, direction),
    });
  }

  if (shell.manifestLoading) {
    return (
      <p className="app-shell-empty" role="status">
        Loading your authorized workspace…
      </p>
    );
  }

  if (shell.manifestError || !shell.manifest) {
    return (
      <section className="app-shell-section" role="alert">
        <h1>Workspace unavailable</h1>
        <p className="app-shell-empty">
          Your authorized workspace could not be loaded. Reconnect and try again; no local role
          fallback is shown.
        </p>
        <button type="button" className="app-shell-secondary" onClick={() => void shell.reload()}>
          Retry
        </button>
      </section>
    );
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
        {shell.availableScopes.length ? (
          <label className="app-shell-scope-switcher">
            Assigned scope
            <select
              aria-label="Assigned scope"
              value={shell.scopeFocus ? `${shell.scopeFocus.dim}:${shell.scopeFocus.ref}` : ""}
              onChange={(event) => void chooseScope(event.target.value)}
            >
              <option value="">All assigned scopes</option>
              {shell.availableScopes.map((scope) => (
                <option key={`${scope.dim}:${scope.ref}`} value={`${scope.dim}:${scope.ref}`}>
                  {scope.dim}: {shell.scopeLabels[scope.dim]?.[scope.ref] ?? scope.ref}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      {showSearch ? (
        <section className="app-shell-search-region" aria-label="Workspace search">
          <label className="app-shell-search">
            <Search size={16} aria-hidden="true" />
            <input
              value={shell.query}
              onChange={(event) => shell.setQuery(event.target.value)}
              placeholder="Search authorized workspace"
              aria-label="Search authorized workspace"
              type="search"
            />
          </label>
          {needle ? (
            <div className="app-shell-search-results" role="list" aria-label="Authorized results">
              {searchResults.length ? (
                searchResults.map((item) => (
                  <Link
                    key={item.key}
                    to={item.href as never}
                    role="listitem"
                    onClick={() => remember(item)}
                  >
                    {item.label}
                  </Link>
                ))
              ) : (
                <p className="app-shell-empty">No authorized workspace results.</p>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="app-shell-widget-section" aria-labelledby="daily-widgets-heading">
        <div className="app-shell-section-title">
          <h2 id="daily-widgets-heading">Daily activity</h2>
          <button
            type="button"
            className="app-shell-link-button"
            onClick={() => setManageWidgets((open) => !open)}
            aria-expanded={manageWidgets}
            aria-controls="app-shell-widget-catalog"
            disabled={!shell.manifest.canPersonalise || !shell.prefsReady}
          >
            <Settings2 size={15} aria-hidden="true" />
            Manage
          </button>
        </div>
        {!shell.manifest.canPersonalise ? (
          <p className="app-shell-empty">Widget changes are not enabled for this workspace.</p>
        ) : shell.prefsError ? (
          <p className="app-shell-empty" role="alert">
            Your saved widget preferences are unavailable.
          </p>
        ) : null}
        {shell.widgetsLoading ? (
          <p className="app-shell-empty" role="status">
            Loading workspace activity…
          </p>
        ) : shell.widgetsError ? (
          <p className="app-shell-empty" role="alert">
            Activity data could not be loaded. The widget links remain available.
            <button
              type="button"
              className="app-shell-link-button"
              onClick={() => void shell.reload()}
            >
              Retry
            </button>
          </p>
        ) : null}
        {widgets.length ? (
          <div className="app-shell-widgets" data-testid="app-shell-widgets">
            {widgets.map((widget, index) => {
              const Icon = shellIcon(widget.icon);
              const metric = formatWidgetMetric(shell.cards[widget.key]);
              const widgetIndex = widgetKeys.indexOf(widget.key);
              return (
                <article key={widget.key} className="app-shell-widget">
                  <Link
                    to={widget.href as never}
                    className="app-shell-widget-link"
                    onClick={() => remember(widget)}
                  >
                    <ShellGlassIcon className={`app-shell-tone-${accentTone(index)}`}>
                      <Icon />
                    </ShellGlassIcon>
                    <strong className={`app-shell-metric-${metric.tone}`}>{metric.text}</strong>
                    <span>{widget.label}</span>
                  </Link>
                  {manageWidgets ? (
                    <div className="app-shell-widget-tools" aria-label={`${widget.label} options`}>
                      <button
                        type="button"
                        aria-label={`Move ${widget.label} up`}
                        disabled={savingWidgets || widgetIndex === 0}
                        onClick={() => void moveWidget(widget.key, -1)}
                      >
                        <MoveUp size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${widget.label} down`}
                        disabled={savingWidgets || widgetIndex === widgetKeys.length - 1}
                        onClick={() => void moveWidget(widget.key, 1)}
                      >
                        <MoveDown size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove ${widget.label}`}
                        disabled={savingWidgets}
                        onClick={() => void removeWidget(widget.key)}
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="app-shell-empty">
            No daily activity widgets are selected. Add an authorized widget below.
          </p>
        )}
        {widgetMessage ? (
          <p className="app-shell-empty" role="status">
            {widgetMessage}
          </p>
        ) : null}
        {manageWidgets ? (
          <div
            className="app-shell-widget-catalog"
            id="app-shell-widget-catalog"
            aria-label="Authorized widget catalog"
          >
            {availableWidgets.length ? (
              availableWidgets.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  disabled={savingWidgets}
                  onClick={() => void addWidget(item.key)}
                >
                  <span>{item.label}</span>
                  <Plus size={16} aria-hidden="true" />
                </button>
              ))
            ) : (
              <p className="app-shell-empty">All authorized widgets are already selected.</p>
            )}
          </div>
        ) : null}
      </section>

      <section className="app-shell-recommendation" aria-labelledby="recommendation-heading">
        <strong id="recommendation-heading">Recommendation</strong>
        <p>
          Consider reviewing {shell.primaryNav[0]?.label ?? "your assigned work"}. This is a
          suggestion, not a decision or verified fact.
        </p>
      </section>

      <section aria-labelledby="quick-actions-heading">
        <div className="app-shell-section-title">
          <h2 id="quick-actions-heading">Quick actions</h2>
        </div>
        {actions.length ? (
          <div className="app-shell-actions" data-testid="app-shell-actions">
            {actions.map((action, index) => {
              const Icon = shellIcon(action.icon);
              return (
                <Link
                  key={action.key}
                  to={action.href as never}
                  className="app-shell-action"
                  onClick={() => remember(action)}
                >
                  <ShellGlassIcon className={`app-shell-tone-${accentTone(index + 1)}`}>
                    <Icon />
                  </ShellGlassIcon>
                  {action.label}
                </Link>
              );
            })}
          </div>
        ) : null}
        {actions.length < 4 ? (
          <p className="app-shell-empty" role="status">
            {needle
              ? "No more authorized quick actions match your search."
              : actions.length
                ? `Only ${actions.length} authorized quick action${actions.length === 1 ? "" : "s"} are available for this role.`
                : "No quick actions are currently authorized for this role."}
          </p>
        ) : null}
      </section>

      {news.length || newsLists.length ? (
        <>
          <div className="app-shell-section-title">
            <h2>News and announcements</h2>
          </div>
          <div className="app-shell-activity" data-testid="app-shell-news">
            {(newsLists.length
              ? newsLists
              : news.map((item) => ({
                  key: item.key,
                  title: item.label,
                  detail: "From your organization",
                  icon: item.icon,
                  href: item.href,
                }))
            ).map((item) => {
              const Icon = shellIcon(item.icon);
              return (
                <Link
                  key={item.key}
                  to={item.href as never}
                  className="app-shell-activity-item"
                  onClick={() => remember({ key: item.key, label: item.title, href: item.href })}
                >
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

      <section aria-labelledby="workspace-cards-heading">
        <div className="app-shell-section-title">
          <h2 id="workspace-cards-heading">Workspace</h2>
          <Link to={APP_SHELL_NOTIFICATIONS as never}>View all</Link>
        </div>
        {cards.length ? (
          <>
            <p className="app-shell-empty">
              {needle
                ? `Showing ${cards.length} matching authorized workspace section${cards.length === 1 ? "" : "s"}.`
                : cards.length < 8
                  ? `Only ${cards.length} additional authorized workspace section${cards.length === 1 ? "" : "s"} are available for this role.`
                  : "Showing up to 8 additional authorized workspace sections."}
            </p>
            <div className="app-shell-cards" data-testid="app-shell-cards">
              {cards.map((item) => {
                const Icon = shellIcon(item.icon);
                return (
                  <Link
                    key={item.key}
                    to={item.href as never}
                    className="app-shell-card"
                    onClick={() => shell.recordUsage(item.key)}
                  >
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
        ) : (
          <p className="app-shell-empty">
            {needle
              ? "No authorized workspace sections match your search."
              : "No additional authorized workspace sections are available for this role."}
          </p>
        )}
      </section>

      <section aria-labelledby="recent-heading">
        <div className="app-shell-section-title">
          <h2 id="recent-heading">Recent</h2>
        </div>
        {recent.length ? (
          <div className="app-shell-recent-list">
            {recent.slice(0, 5).map((item) => (
              <Link
                key={`${item.id}:${item.at}`}
                to={item.href as never}
                className="app-shell-card"
              >
                <div>
                  <p>{item.title}</p>
                  <small>{new Date(item.at).toLocaleString()}</small>
                </div>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            ))}
          </div>
        ) : (
          <p className="app-shell-empty">Your authorized recent activity will appear here.</p>
        )}
      </section>
    </div>
  );
}
