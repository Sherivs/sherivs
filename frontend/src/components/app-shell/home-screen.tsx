import { ChevronRight, Search } from "lucide-react";
import { shellIcon } from "@/lib/shell/icon-registry";
import { searchableSection } from "@/lib/shell/role-template";
import { naira } from "@/lib/sherivs-ws/live";
import { ShellGlassIcon } from "./glass-icon";
import { useAppShell } from "./shell-context";
import { appShellSectionPath } from "@/lib/shell/paths";
import { toShellNavItem } from "@/lib/shell/chrome";
import { switchActiveOrganization } from "@/lib/identity/memberships.functions";
import { useState } from "react";

export function AppHomeScreen() {
  const shell = useAppShell();
  const [openSwitcher, setOpenSwitcher] = useState(false);
  const widgets = (shell.manifest?.widgets ?? []).slice(0, 4);
  const cards = (
    shell.manifest?.inbox?.length
      ? shell.manifest.inbox.map(toShellNavItem)
      : shell.drawer
  ).slice(0, 8);
  const showSearch = shell.drawer.some((item) => searchableSection(item.key, item.label));

  async function chooseContext(organizationId: string, role: string) {
    setOpenSwitcher(false);
    await switchActiveOrganization({ data: { organizationId, role } });
    await shell.app.refresh();
    await shell.reload();
  }

  return (
    <div className="app-shell-home" data-testid="app-shell-home">
      <header className="app-shell-greeting">
        <p>{shell.greeting},</p>
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
              <span>
                {shell.roleTitle}
              </span>
              <ChevronRight size={16} />
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
          {widgets.map((widget) => {
            const Icon = shellIcon(widget.icon);
            const data = shell.cards[widget.key];
            const metric = data?.money && typeof data.metric === "number" ? naira(data.metric) : data?.metric ?? "—";
            return (
              <a key={widget.key} href={appShellSectionPath(widget.key)} className="app-shell-widget">
                <ShellGlassIcon>
                  <Icon />
                </ShellGlassIcon>
                <strong>{String(metric)}</strong>
                <span>{widget.label}</span>
              </a>
            );
          })}
        </div>
      ) : (
        <p className="app-shell-empty">This role has no home widgets yet. Open a section from the menu.</p>
      )}

      <div className="app-shell-section-title">
        <h2>Workspace</h2>
      </div>
      <div className="app-shell-cards">
        {cards.map((item) => {
          const Icon = shellIcon(item.icon);
          return (
            <a key={item.key} href={item.href} className="app-shell-card">
              <ShellGlassIcon>
                <Icon />
              </ShellGlassIcon>
              <div>
                <p>{item.label}</p>
                <small>Open section</small>
              </div>
              <ChevronRight size={16} style={{ marginLeft: "auto", opacity: 0.45 }} />
            </a>
          );
        })}
      </div>
    </div>
  );
}
