import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bell, ChevronDown, ChevronUp, EyeOff, Menu, Moon, Plus, Sun, WifiOff } from "lucide-react";
import {
  focusScope,
  scopeFocusOptions,
  type Locale,
  type ManifestItem,
  type ScopeFocus,
  type WorkspaceManifest,
  type WorkspacePrefs,
} from "@/lib/sherivs-ws/engine";
import { LOCALES, greeting, t } from "@/lib/sherivs-ws/i18n";
import { SdsIcon } from "./icons";
import { WidgetBody } from "./widget-body";
import type { CardData } from "@/lib/sherivs-ws/live";

export type LinkComp = (p: {
  to: string;
  className?: string;
  children: ReactNode;
  "aria-current"?: "page";
}) => ReactNode;
const A: LinkComp = ({ to, children, ...rest }) => (
  <a href={to} {...rest}>
    {children}
  </a>
);

export interface ShellProps {
  manifest: WorkspaceManifest;
  user: { name: string; title: string; roles: string[] };
  prefs: WorkspacePrefs;
  onPrefs: (p: WorkspacePrefs) => void;
  sample?: boolean;
  Link?: LinkComp;
  theme: "light" | "dark";
  onTheme: (t: "light" | "dark") => void;
  inboxCounts?: Record<string, number>;
  currentPath?: string;
  /** active scope focus (campus/shift/section/level...), presentation only */
  scope?: ScopeFocus | null;
  onScope?: (s: ScopeFocus | null) => void;
  /** live card data (workspace_widget_data) and human labels for scope refs */
  cards?: Record<string, CardData>;
  cardsLoading?: boolean;
  scopeLabels?: Record<string, Record<string, string>>;
}

export function WorkspaceShell({
  manifest: full,
  scope = null,
  onScope,
  cards,
  cardsLoading,
  scopeLabels,
  user,
  prefs,
  onPrefs,
  sample = false,
  Link = A,
  theme,
  onTheme,
  inboxCounts = {},
  currentPath = "/workspace",
}: ShellProps) {
  const m = useMemo(() => focusScope(full, scope), [full, scope]);
  const focusOpts = useMemo(() => scopeFocusOptions(full), [full]);
  const L = m.locale;
  const [editing, setEditing] = useState(false);
  const [more, setMore] = useState(false);
  const [online, setOnline] = useState(true);
  const [hour, setHour] = useState(9);
  useEffect(() => setHour(new Date().getHours()), []);
  useEffect(() => {
    const u = () => setOnline(navigator.onLine);
    u();
    window.addEventListener("online", u);
    window.addEventListener("offline", u);
    return () => {
      window.removeEventListener("online", u);
      window.removeEventListener("offline", u);
    };
  }, []);
  const order = m.widgets.map((w) => w.key);
  const move = (k: string, d: -1 | 1) => {
    const o = [...order];
    const i = o.indexOf(k);
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    onPrefs({ ...prefs, order: o });
  };
  const hide = (k: string) =>
    onPrefs({
      ...prefs,
      hidden: [...new Set([...(prefs.hidden ?? []), k])],
      added: (prefs.added ?? []).filter((x) => x !== k),
    });
  const add = (k: string) =>
    onPrefs({
      ...prefs,
      added: [...new Set([...(prefs.added ?? []), k])],
      hidden: (prefs.hidden ?? []).filter((x) => x !== k),
      order: [...order, k],
    });
  const totalInbox = Object.values(inboxCounts).reduce((a, b) => a + b, 0);
  const bottom = m.bottomNav.slice(0, 4);
  const navGroups = useMemo(() => m.nav, [m.nav]);

  return (
    <div
      className="sds sds-app"
      data-theme={theme}
      data-density={prefs.density ?? "comfortable"}
      lang={L === "pcm" ? "pcm" : L}
    >
      <a className="sds-skip" href="#sds-main">
        Skip to content
      </a>
      <header className="sds-top">
        <div className="sds-brand">
          <span className="sds-brand-mark" aria-hidden="true">
            {m.org.name.slice(0, 1)}
          </span>
          <span className="sds-brand-name">{m.org.name}</span>
        </div>
        <div className="sds-top-actions">
          <label className="sds-sr" htmlFor="sds-lang">
            {t(L, "language")}
          </label>
          <select
            id="sds-lang"
            className="sds-select"
            value={L}
            onChange={(e) => onPrefs({ ...prefs, locale: e.target.value as Locale })}
          >
            {LOCALES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
          <button
            className="sds-iconbtn"
            type="button"
            aria-label={t(L, "theme")}
            aria-pressed={theme === "dark"}
            onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={20} aria-hidden /> : <Moon size={20} aria-hidden />}
          </button>
          <Link to="/notifications" className="sds-iconbtn">
            <Bell size={20} aria-hidden />
            <span className="sds-sr">{t(L, "inbox")}</span>
            {totalInbox > 0 && <span className="sds-badge">{totalInbox}</span>}
          </Link>
        </div>
      </header>

      <nav className="sds-rail" aria-label={t(L, "your_workspace")}>
        <div className="sds-rail-label">{t(L, "your_workspace")}</div>
        {navGroups.map((n) => (
          <Link
            key={n.key}
            to={n.to}
            className="sds-navlink"
            aria-current={n.to === currentPath ? "page" : undefined}
          >
            <SdsIcon name={n.icon} />
            {n.label}
          </Link>
        ))}
      </nav>

      <main id="sds-main" className="sds-main">
        {!online && (
          <div className="sds-banner" role="status">
            <WifiOff size={16} aria-hidden />
            {t(L, "offline")}
          </div>
        )}
        <h1 className="sds-h1">
          {greeting(L, hour)},{" "}
          {user.name.split(" ").slice(-1)[0] === user.name
            ? user.name
            : user.name.replace(/^(Chief \(Mrs\)|Mrs|Mr|Miss|Dr|Nurse)\s+/, "").split(" ")[0]}
        </h1>
        <p className="sds-sub">
          {user.title} · {m.org.name}
        </p>
        <div className="sds-chips" style={{ marginTop: 8 }} aria-label={t(L, "roles")}>
          {user.roles.map((r) => (
            <span key={r} className="sds-chip">
              {r}
            </span>
          ))}
        </div>

        {focusOpts.length > 1 && onScope && (
          <div className="sds-scopebar" role="group" aria-label={t(L, "viewing")}>
            <span className="sds-muted">{t(L, "viewing")}:</span>
            <button
              type="button"
              className="sds-chip sds-chip-btn"
              aria-pressed={!scope}
              onClick={() => onScope(null)}
            >
              {t(L, "all_scopes")}
            </button>
            {focusOpts.map((o) => {
              const on = scope?.dim === o.dim && scope.ref === o.ref;
              return (
                <button
                  key={`${o.dim}:${o.ref}`}
                  type="button"
                  className="sds-chip sds-chip-btn"
                  aria-pressed={on}
                  onClick={() => onScope(on ? null : o)}
                >
                  {o.dim}: {scopeLabels?.[o.dim]?.[o.ref] ?? o.ref}
                </button>
              );
            })}
          </div>
        )}

        {m.actions.length > 0 && (
          <section className="sds-section" aria-labelledby="qa-h">
            <div className="sds-section-h">
              <h2 id="qa-h" className="sds-h2">
                {t(L, "quick_actions")}
              </h2>
            </div>
            <div className="sds-actions">
              {m.actions.map((a, i) => (
                <Link key={a.key} to={a.to} className={`sds-action${i === 0 ? " is-primary" : ""}`}>
                  <SdsIcon name={a.icon} size={18} />
                  {a.label}
                </Link>
              ))}
            </div>
          </section>
        )}

        {m.inbox.length > 0 && (
          <section className="sds-section" aria-labelledby="ib-h">
            <div className="sds-section-h">
              <h2 id="ib-h" className="sds-h2">
                {t(L, "inbox")}
              </h2>
            </div>
            <div className="sds-inbox">
              {m.inbox.map((i) => (
                <Link key={i.key} to={i.to}>
                  <SdsIcon name={i.icon} size={18} />
                  {i.label}
                  {(inboxCounts[i.key] ?? 0) > 0 && (
                    <span className="sds-count">{inboxCounts[i.key]}</span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="sds-section" aria-labelledby="w-h">
          <div className="sds-section-h">
            <h2 id="w-h" className="sds-h2">
              {t(L, "your_workspace")}
            </h2>
            {m.canPersonalise ? (
              <button
                type="button"
                className={`sds-btn${editing ? " is-primary" : ""}`}
                onClick={() => setEditing(!editing)}
                aria-pressed={editing}
              >
                {editing ? t(L, "done") : t(L, "customise")}
              </button>
            ) : (
              <span className="sds-muted" style={{ fontSize: 13 }}>
                {t(L, "locked")}
              </span>
            )}
          </div>
          {m.widgets.length === 0 && <p className="sds-sub">{t(L, "nothing_here")}</p>}
          <div className="sds-grid">
            {m.widgets.map((w, idx) => (
              <Widget
                key={w.key}
                w={w}
                L={L}
                sample={sample}
                live={cards?.[w.key]}
                loading={cardsLoading}
                labels={scopeLabels}
                Link={Link}
                editing={editing}
                onUp={idx > 0 ? () => move(w.key, -1) : undefined}
                onDown={idx < m.widgets.length - 1 ? () => move(w.key, 1) : undefined}
                onHide={() => hide(w.key)}
              />
            ))}
          </div>
          {editing && m.available.length > 0 && (
            <div className="sds-section">
              <h3 className="sds-h2">{t(L, "add_widget")}</h3>
              <div className="sds-actions" style={{ flexWrap: "wrap" }}>
                {m.available.map((w) => (
                  <button
                    key={w.key}
                    type="button"
                    className="sds-action"
                    onClick={() => add(w.key)}
                  >
                    <Plus size={16} aria-hidden />
                    {w.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="sds-btn"
                style={{ marginTop: 12 }}
                onClick={() => onPrefs({ locale: prefs.locale, density: prefs.density })}
              >
                {t(L, "reset")}
              </button>
            </div>
          )}
        </section>
      </main>

      <nav className="sds-bottom" aria-label="Primary">
        {bottom.map((n) => (
          <Link key={n.key} to={n.to} aria-current={n.to === currentPath ? "page" : undefined}>
            <SdsIcon name={n.icon} size={22} />
            <span>{n.label}</span>
          </Link>
        ))}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog">
          <Menu size={22} aria-hidden />
          <span>{t(L, "more")}</span>
        </button>
      </nav>
      {more && (
        <>
          <div className="sds-scrim" onClick={() => setMore(false)} />
          <div className="sds-sheet" role="dialog" aria-modal="true" aria-label={t(L, "more")}>
            {m.nav.slice(4).map((n) => (
              <Link key={n.key} to={n.to} className="sds-navlink">
                <SdsIcon name={n.icon} />
                {n.label}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Widget({
  w,
  L,
  sample,
  live,
  loading,
  labels,
  Link,
  editing,
  onUp,
  onDown,
  onHide,
}: {
  w: ManifestItem;
  L: Locale;
  sample: boolean;
  live?: CardData;
  loading?: boolean;
  labels?: Record<string, Record<string, string>>;
  Link: LinkComp;
  editing: boolean;
  onUp?: () => void;
  onDown?: () => void;
  onHide: () => void;
}) {
  return (
    <article className={`sds-card sds-size-${w.size}`} aria-labelledby={`h-${w.key}`}>
      <div className="sds-card-h">
        <span className="sds-card-ico">
          <SdsIcon name={w.icon} />
        </span>
        <h3 id={`h-${w.key}`} className="sds-card-title">
          {w.label}
        </h3>
        {!editing && (
          <Link to={w.to} className="sds-card-link">
            {t(L, "open")}
            <span className="sds-sr"> {w.label}</span>
          </Link>
        )}
      </div>
      <WidgetBody item={w} sample={sample} live={live} loading={loading} />
      {(() => {
        const chips = [
          ...w.scope,
          ...Object.entries(w.scopeDims ?? {}).map(
            ([d, v]) => `${d}: ${v.map((r) => labels?.[d]?.[r] ?? r).join(", ")}`,
          ),
        ];
        return (
          chips.length > 0 && (
            <div className="sds-chips" aria-label={t(L, "scope")}>
              {[...new Set(chips)].map((s) => (
                <span key={s} className="sds-chip">
                  {s}
                </span>
              ))}
            </div>
          )
        );
      })()}
      {editing && (
        <div className="sds-edit">
          <button
            type="button"
            className="sds-btn"
            onClick={onUp}
            disabled={!onUp}
            aria-label={`${t(L, "move_up")}: ${w.label}`}
          >
            <ChevronUp size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="sds-btn"
            onClick={onDown}
            disabled={!onDown}
            aria-label={`${t(L, "move_down")}: ${w.label}`}
          >
            <ChevronDown size={16} aria-hidden />
          </button>
          <button type="button" className="sds-btn" onClick={onHide}>
            <EyeOff size={16} aria-hidden /> {t(L, "hide")}
          </button>
        </div>
      )}
    </article>
  );
}
