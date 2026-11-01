import { useState } from "react";
import { Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { catalogItem } from "@/lib/sherivs-ws/engine";
import { shellIcon } from "@/lib/shell/icon-registry";
import { formatWidgetMetric } from "@/lib/shell/metrics";
import { homeHrefForScope } from "@/lib/shell/chrome";
import { searchableSection } from "@/lib/shell/role-template";
import { ShellGlassIcon } from "./glass-icon";
import { useAppShell } from "./shell-context";
import { RoleManagementScreen } from "./role-management-screen";
import { CommunicationInboxScreen } from "./communication-inbox";

export function AppSectionScreen({ sectionKey }: { sectionKey: string }) {
  const shell = useAppShell();
  const [query, setQuery] = useState("");
  if (sectionKey === "roles") return <RoleManagementScreen />;
  if (sectionKey === "communications") return <CommunicationInboxScreen />;
  const item =
    shell.nav.find((row) => row.key === sectionKey) ??
    shell.manifest?.widgets.find((row) => row.key === sectionKey) ??
    shell.manifest?.actions.find((row) => row.key === sectionKey) ??
    catalogItem(sectionKey);
  const rawLabel = item && "label" in item ? item.label : sectionKey;
  const label = typeof rawLabel === "string" ? rawLabel : (rawLabel?.en ?? sectionKey);
  const icon = item && "icon" in item ? item.icon : "layout";
  const Icon = shellIcon(icon);
  const showSearch = searchableSection(sectionKey, String(label));
  const metric = formatWidgetMetric(shell.cards[sectionKey]);
  const homeHref = homeHrefForScope(shell.scopeFocus);

  return (
    <section className="app-shell-section" data-testid="app-shell-section">
      <Link to={homeHref as never} className="app-shell-back">
        ← Home
      </Link>
      <ShellGlassIcon size={44} tone="accent">
        <Icon />
      </ShellGlassIcon>
      <h1>{label}</h1>
      <p className="app-shell-org">
        {shell.roleTitle} in {shell.orgName}
      </p>
      {showSearch ? (
        <label className="app-shell-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${label}`}
            aria-label={`Search ${label}`}
          />
        </label>
      ) : null}
      {metric.text !== "—" ? (
        <div className="app-shell-widget">
          <strong className={`app-shell-metric-${metric.tone}`}>{metric.text}</strong>
          <span>{shell.cards[sectionKey]?.note ?? label}</span>
        </div>
      ) : (
        <p className="app-shell-empty">
          This section is open for your current role. Records stay tenant-scoped and only appear
          when your administration has granted the matching permission.
        </p>
      )}
    </section>
  );
}
