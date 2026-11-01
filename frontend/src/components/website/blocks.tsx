/**
 * Block components (SPEC §5). One component per catalog type; each renders only what its guard allowed.
 * Copy here is chrome (labels from lib/website/i18n); all content is the organization's data or text.
 */
import { useState, type ReactNode } from "react";
import { BLOCK_HEADINGS, tx, ui, type UiKey } from "@/lib/website/i18n";
import { safeUrl } from "@/lib/website/sanitize";
import { openVacancies } from "@/lib/website/catalog";
import type { Block, Locale, SiteData } from "@/lib/website/types";
import type { OrgKind } from "@/lib/website/generator";
import { Rich } from "./rich";

export interface BlockCtx {
  locale: Locale;
  def: Locale;
  data: SiteData;
  kind: OrgKind;
  /** Builds an internal link that keeps preview (?school=) and language context. */
  link: (path: string) => string;
  /** v2: school logo / crest for hero "crest" style. */
  logo?: string | null;
  crest?: string | null;
}
type P = { b: Block; c: BlockCtx };

const T = (c: BlockCtx, v: unknown) => tx(v, c.locale, c.def);
const L = (c: BlockCtx, k: UiKey) => ui(k, c.locale);
const arr = <X,>(v: unknown): X[] => (Array.isArray(v) ? (v as X[]) : []);
const num = (v: unknown, d: number) => (typeof v === "number" && v > 0 ? Math.min(v, 50) : d);
const ngn = (n: number) => `₦${new Intl.NumberFormat("en-NG").format(n)}`;
const day = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return {
    d: d.getUTCDate(),
    m: d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }),
    full: d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
  };
};
const href = (c: BlockCtx, raw: unknown) => {
  const u = safeUrl(raw);
  return u ? (u.startsWith("/") ? c.link(u) : u) : null;
};
const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w) && !/^(mr|mrs|ms|dr|prof|mal|haj|alh)\.?$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

function Head({ b, c, fallback, intro }: P & { fallback?: string; intro?: boolean }) {
  const h = T(c, b.props.heading) || fallback || BLOCK_HEADINGS[b.type]?.[c.locale];
  const i = intro ? T(c, b.props.intro) : "";
  return (
    <>
      {h ? <h2 className="sw-h2">{h}</h2> : null}
      {i ? <p className="sw-sub">{i}</p> : null}
    </>
  );
}
const Img = ({ src, alt, className }: { src?: string | null; alt: string; className?: string }) => {
  const u = safeUrl(src);
  return u ? <img src={u} alt={alt} loading="lazy" decoding="async" className={className} /> : null;
};

/** Facts derived from live data, shown as chips under the hero (gender mix, day/boarding, campuses). */
function factChips(c: BlockCtx): string[] {
  const s = c.data.sections ?? [];
  const out: string[] = [];
  const g = new Set(s.map((x) => x.gender).filter(Boolean));
  const r = new Set(s.map((x) => x.residency).filter(Boolean));
  if (g.size === 1 && g.has("boys")) out.push(L(c, "boys"));
  else if (g.size === 1 && g.has("girls")) out.push(L(c, "girls"));
  if (r.has("both") || (r.has("day") && r.has("boarding")))
    out.push(`${L(c, "day")} & ${L(c, "boarding")}`);
  else if (r.has("boarding")) out.push(L(c, "boarding"));
  const n = c.data.campuses?.length ?? 0;
  if (n > 1) out.push(`${n} ${L(c, "campuses").toLowerCase()}`);
  if (c.data.school.founded_year) out.push(`${L(c, "founded")} ${c.data.school.founded_year}`);
  return out;
}

function Hero({ b, c }: P) {
  const s = c.data.school;
  const cta = href(c, b.props.cta_href);
  const label = T(c, b.props.cta_label);
  const v = b.variant ?? "centered";
  const img = v === "split" || v === "banner" ? safeUrl(b.props.image) : null;
  const crest = v === "crest" ? safeUrl(c.crest ?? c.logo) : null;
  const chips = factChips(c);
  const tagline = T(c, b.props.tagline);
  const motto = s.motto && tagline !== s.motto ? s.motto : "";
  return (
    <>
      {img && v === "banner" ? (
        <img className="sw-hero-bg" src={img} alt="" fetchPriority="high" />
      ) : null}
      <div className="sw-wrap">
        <div className="sw-hero-copy">
          {crest ? <img className="sw-crest" src={crest} alt="" width={112} height={112} /> : null}
          {v === "crest" && motto ? <p className="sw-eyebrow">{motto}</p> : null}
          <h1 className="sw-h1">{T(c, b.props.heading) || s.name}</h1>
          {tagline ? <p className="sw-lede">{tagline}</p> : null}
          {chips.length ? (
            <div className="sw-facts">
              {chips.map((x) => (
                <span key={x} className="sw-chip">
                  {x}
                </span>
              ))}
            </div>
          ) : null}
          {cta && label ? (
            <div className="sw-actions">
              <a className="sw-btn" href={cta}>
                {label}
              </a>
            </div>
          ) : null}
        </div>
        {img && v === "split" ? (
          <img className="sw-hero-img" src={img} alt="" fetchPriority="high" />
        ) : null}
      </div>
    </>
  );
}
function About({ b, c }: P) {
  const s = c.data.school;
  const body = T(c, b.props.body) || s.about || "";
  const pillars =
    b.props.show_mission !== false
      ? (
          [
            ["mission", s.mission],
            ["vision", s.vision],
            ["motto", s.motto],
          ] as [UiKey, string | null | undefined][]
        ).filter(([, v]) => v)
      : [];
  return (
    <>
      <Head b={b} c={c} fallback={undefined} />
      {body ? <Rich text={body} /> : null}
      {pillars.length ? (
        <div className="sw-grid" style={{ marginTop: 20 }}>
          {pillars.map(([k, v]) => (
            <div key={k} className="sw-card">
              <h3 className="sw-h3">{L(c, k)}</h3>
              <p>{v}</p>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
function Leadership({ b, c }: P) {
  const people = arr<Record<string, unknown>>(b.props.people);
  return (
    <>
      <Head b={b} c={c} />
      <div className={b.variant === "list" ? "sw-list" : "sw-grid"}>
        {people.map((p, i) => (
          <div key={i} className="sw-card sw-person">
            {safeUrl(p.photo) ? (
              <Img src={p.photo as string} alt={String(p.name ?? "")} className="sw-avatar" />
            ) : (
              <div className="sw-avatar" aria-hidden>
                {initials(String(p.name ?? ""))}
              </div>
            )}
            <div>
              <h3 className="sw-h3">{String(p.name ?? "")}</h3>
              <p>{T(c, p.title)}</p>
              {T(c, p.bio) ? <p style={{ marginTop: 6 }}>{T(c, p.bio)}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
function Stats({ b, c }: P) {
  const s = c.data.stats ?? {};
  const learners: UiKey = c.kind === "nursery_primary" ? "pupils" : "students";
  const items = (
    [
      [s.students, learners, true],
      [s.teachers, "teachers", false],
      [s.programmes, "programmes", false],
      [s.campuses, "campuses", false],
      [s.founded_year, "founded", false],
    ] as [number | null | undefined, UiKey, boolean][]
  ).filter(([v]) => (v ?? 0) > 0);
  return (
    <>
      <Head b={b} c={c} />
      <div className="sw-stats">
        {items.map(([v, k, plus]) => (
          <div key={k} className="sw-stat">
            <b>
              {k === "founded" ? v : new Intl.NumberFormat("en-NG").format(v!)}
              {plus ? "+" : ""}
            </b>
            <span>{L(c, k)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
const RES: Record<string, UiKey> = { day: "day", boarding: "boarding" };
function SectionsOffered({ b, c }: P) {
  const s = c.data.sections ?? [];
  const tag = (x: (typeof s)[number]) =>
    [
      x.gender && x.gender !== "mixed" ? L(c, x.gender as UiKey) : null,
      x.residency === "both"
        ? `${L(c, "day")} & ${L(c, "boarding")}`
        : x.residency
          ? L(c, RES[x.residency] ?? "day")
          : null,
      (c.data.campuses?.length ?? 0) > 1 ? x.campus : null,
    ].filter(Boolean) as string[];
  return (
    <>
      <Head b={b} c={c} intro />
      <div className={b.variant === "list" ? "sw-list" : "sw-grid"}>
        {s.map((x, i) => (
          <div key={i} className="sw-card">
            <h3 className="sw-h3">{x.name}</h3>
            <div>
              {tag(x).map((t) => (
                <span key={t} className="sw-chip">
                  {t}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
function Programmes({ b, c }: P) {
  const p = c.data.programmes ?? [];
  if (b.variant === "table")
    return (
      <>
        <Head b={b} c={c} intro />
        <div className="sw-scroll">
          <table className="sw-table">
            <thead>
              <tr>
                <th>{L(c, "programmes")}</th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {p.map((x, i) => (
                <tr key={i}>
                  <td>
                    <strong>{x.name}</strong>
                  </td>
                  <td>{x.description}</td>
                  <td>{x.duration ?? x.age_range}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  return (
    <>
      <Head b={b} c={c} intro />
      <div className={b.variant === "list" ? "sw-list" : "sw-grid"}>
        {p.map((x, i) => (
          <div key={i} className="sw-card">
            <h3 className="sw-h3">{x.name}</h3>
            {x.age_range || x.duration ? (
              <span className="sw-chip">{x.age_range ?? x.duration}</span>
            ) : null}
            {x.description ? <p>{x.description}</p> : null}
          </div>
        ))}
      </div>
    </>
  );
}
function Departments({ b, c }: P) {
  const g = arr<Record<string, unknown>>(b.props.groups);
  return (
    <>
      <Head b={b} c={c} intro />
      <div className="sw-grid">
        {g.map((x, i) => (
          <div key={i} className="sw-card">
            <h3 className="sw-h3">{T(c, x.name)}</h3>
            <ul className="sw-bullets">
              {T(c, x.items)
                .split("\n")
                .filter(Boolean)
                .map((d) => (
                  <li key={d}>{d}</li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
function Admissions({ b, c }: P) {
  const a = c.data.admissions!;
  const tl = arr<Record<string, unknown>>(a.timeline).filter((x) => x && (x.label || x.title));
  const head =
    T(c, b.props.heading) || (a.open ? L(c, "admissions_open") : L(c, "admissions_closed"));
  const cta = (
    <a className="sw-btn" href={c.link("/admissions")}>
      {T(c, b.props.cta_label) || L(c, "apply_now")}
    </a>
  );
  if (b.variant === "banner")
    return (
      <div
        className="sw-card"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h2 className="sw-h2" style={{ margin: 0 }}>
            {head}
          </h2>
          {a.deadline ? (
            <p className="sw-meta">
              {L(c, "deadline")}: {day(a.deadline).full}
            </p>
          ) : null}
        </div>
        {a.open ? cta : null}
      </div>
    );
  return (
    <>
      <h2 className="sw-h2">{head}</h2>
      {T(c, b.props.intro) ? <p className="sw-sub">{T(c, b.props.intro)}</p> : null}
      {a.requirements ? (
        <div className="sw-card">
          <h3 className="sw-h3">{L(c, "requirements")}</h3>
          <Rich text={a.requirements} />
        </div>
      ) : null}
      {a.deadline ? (
        <p className="sw-meta" style={{ marginTop: 12 }}>
          <strong>{L(c, "deadline")}:</strong> {day(a.deadline).full}
        </p>
      ) : null}
      {tl.length ? (
        <ul className="sw-list" style={{ marginTop: 12 }}>
          {tl.map((x, i) => (
            <li key={i}>
              <strong>{String(x.label ?? x.title)}</strong>
              {x.date ? <span className="sw-meta"> · {day(String(x.date)).full}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {a.open ? <div className="sw-actions">{cta}</div> : null}
    </>
  );
}
function Fees({ b, c }: P) {
  const items = arr<Record<string, unknown>>(b.props.items);
  return (
    <>
      <Head b={b} c={c} intro />
      <div className="sw-scroll">
        <table className="sw-table">
          <tbody>
            {items.map((x, i) => (
              <tr key={i}>
                <td>
                  {T(c, x.label)}
                  {T(c, x.note) ? <div className="sw-meta">{T(c, x.note)}</div> : null}
                </td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>
                  {typeof x.amount === "number" ? ngn(x.amount) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
function Facilities({ b, c }: P) {
  const f = c.data.facilities ?? [];
  return (
    <>
      <Head b={b} c={c} intro />
      <div className={b.variant === "list" ? "sw-list" : "sw-grid"}>
        {f.map((x, i) => (
          <div key={i} className="sw-card">
            <Img src={x.image_url} alt={x.name} className="sw-cover" />
            <h3 className="sw-h3">{x.name}</h3>
            {x.description ? <p>{x.description}</p> : null}
          </div>
        ))}
      </div>
    </>
  );
}
function Boarding({ b, c }: P) {
  const h = c.data.hostels ?? [];
  const body = T(c, b.props.body);
  const gl = (g: string | null) =>
    g === "male" ? L(c, "boys") : g === "female" ? L(c, "girls") : L(c, "mixed");
  return (
    <>
      <Head b={b} c={c} fallback={L(c, "boarding")} />
      {body ? <Rich text={body} /> : null}
      {h.length ? (
        <div className="sw-grid sw-grid-sm">
          {h.map((x, i) => (
            <div key={i} className="sw-card">
              <h3 className="sw-h3">{gl(x.gender)}</h3>
              <p>
                {x.rooms} {L(c, "rooms")} · {x.capacity} {L(c, "beds")}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
function Transport({ b, c }: P) {
  const t = c.data.transport!;
  const rows = [
    [L(c, "coverage"), t.coverage_areas],
    [L(c, "pickup"), t.morning_pickup_start],
    [L(c, "departure"), t.afternoon_departure_time],
    [L(c, "per_month"), t.monthly_fee ? ngn(t.monthly_fee) : null],
  ].filter(([, v]) => v) as [string, string][];
  return (
    <>
      <Head b={b} c={c} fallback={L(c, "school_bus")} />
      <div className="sw-card">
        {rows.map(([k, v]) => (
          <p key={k} style={{ marginBottom: 6 }}>
            <strong>{k}:</strong> {v}
          </p>
        ))}
        {t.live_tracking_enabled ? <span className="sw-chip">{L(c, "live_tracking")}</span> : null}
        {t.safety_features ? <p>{t.safety_features}</p> : null}
      </div>
    </>
  );
}
function News({ b, c }: P) {
  const n = (c.data.news ?? []).slice(0, num(b.props.limit, 6));
  return (
    <>
      <Head b={b} c={c} fallback={L(c, "latest_news")} />
      <div className={b.variant === "list" ? "sw-list" : "sw-grid"}>
        {n.map((x) => (
          <article key={x.id} className="sw-card">
            <Img src={x.cover_image_url} alt="" className="sw-cover" />
            {x.published_at ? <p className="sw-meta">{day(x.published_at).full}</p> : null}
            <h3 className="sw-h3" style={{ marginTop: 4 }}>
              <a href={c.link(`/posts/${x.id}`)}>{x.title}</a>
            </h3>
            {x.excerpt ? <p>{x.excerpt}</p> : null}
          </article>
        ))}
      </div>
    </>
  );
}
function Events({ b, c }: P) {
  const e = (c.data.events ?? []).slice(0, num(b.props.limit, 6));
  return (
    <>
      <Head b={b} c={c} fallback={L(c, "upcoming_events")} />
      <div className={b.variant === "cards" ? "sw-grid" : "sw-list"}>
        {e.map((x) => {
          const d = day(x.date);
          return (
            <div key={x.id} className={b.variant === "cards" ? "sw-card sw-row" : "sw-row"}>
              <div className="sw-date">
                {d.d}
                <small>{d.m}</small>
              </div>
              <div>
                <h3 className="sw-h3">{x.title}</h3>
                <p className="sw-meta">
                  {[d.full, x.time?.slice(0, 5), x.location].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
function Gallery({ b, c }: P) {
  const g = (c.data.gallery ?? []).slice(0, num(b.props.limit, 12));
  return (
    <>
      <Head b={b} c={c} />
      <div className="sw-gallery" data-variant={b.variant ?? "grid"}>
        {g.map((x, i) => (
          <figure key={i} style={{ margin: 0 }}>
            <Img src={x.image_url} alt={x.caption ?? x.title ?? ""} />
          </figure>
        ))}
      </div>
    </>
  );
}
function Staff({ b, c }: P) {
  const s = c.data.staff ?? [];
  return (
    <>
      <Head b={b} c={c} intro />
      <div className={b.variant === "list" ? "sw-list" : "sw-grid sw-grid-sm"}>
        {s.map((x, i) => (
          <div key={i} className="sw-card sw-person">
            {safeUrl(x.avatar_url) ? (
              <Img src={x.avatar_url} alt={x.full_name} className="sw-avatar" />
            ) : (
              <div className="sw-avatar" aria-hidden>
                {initials(x.full_name)}
              </div>
            )}
            <div>
              <h3 className="sw-h3">{x.full_name}</h3>
              <p>{[x.role, x.subject_specialty].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
function ResultsChecker({ b, c }: P) {
  return (
    <div
      className="sw-card"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div>
        <h2 className="sw-h2" style={{ margin: 0 }}>
          {T(c, b.props.heading) || L(c, "check_result")}
        </h2>
        <p>{L(c, "check_result_body")}</p>
      </div>
      <a className="sw-btn" href={c.link("/check-result")}>
        {L(c, "check_result")}
      </a>
    </div>
  );
}
function Alumni({ b, c }: P) {
  const a = c.data.alumni;
  const body = T(c, b.props.body);
  const join = href(c, b.props.cta_href);
  return (
    <>
      <Head b={b} c={c} />
      {a && a.verified > 0 ? (
        <p style={{ fontSize: "1.2rem" }}>
          <strong>{new Intl.NumberFormat("en-NG").format(a.verified)}</strong>{" "}
          {L(c, "alumni_verified")}
          {a.first_year ? ` · ${a.first_year}–${a.last_year}` : ""}
        </p>
      ) : null}
      {body ? <Rich text={body} /> : null}
      {join ? (
        <div className="sw-actions">
          <a className="sw-btn sw-btn-alt" href={join}>
            {L(c, "learn_more")}
          </a>
        </div>
      ) : null}
    </>
  );
}
function Donations({ b, c }: P) {
  const d = c.data.donations ?? [];
  const s = c.data.school;
  // No public payment page yet: route givers to the school's own contact (never a dead link).
  const give = (t: string) =>
    s.email
      ? `mailto:${s.email}?subject=${encodeURIComponent(t)}`
      : s.phone
        ? `tel:${s.phone.replace(/\s+/g, "")}`
        : null;
  return (
    <>
      <Head b={b} c={c} intro />
      <div className="sw-grid">
        {d.map((x) => (
          <div key={x.id} className="sw-card">
            <h3 className="sw-h3">{x.title}</h3>
            <p>
              {L(c, "goal")}: {ngn(x.goal)}
              {x.ends_on ? ` · ${day(x.ends_on).full}` : ""}
            </p>
            {give(x.title) ? (
              <div className="sw-actions">
                <a className="sw-btn" href={give(x.title)!}>
                  {L(c, "donate")}
                </a>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
const mapLink = (q: string) =>
  `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`;
function Campuses({ b, c }: P) {
  const k = c.data.campuses ?? [];
  return (
    <>
      <Head b={b} c={c} fallback={L(c, "campuses")} />
      <div className={b.variant === "cards" ? "sw-grid" : "sw-list"}>
        {k.map((x, i) => (
          <div key={i} className={b.variant === "cards" ? "sw-card" : undefined}>
            <h3 className="sw-h3">{x.name}</h3>
            {x.address ? (
              <p>
                {x.address} ·{" "}
                <a href={mapLink(x.address)} rel="noopener">
                  {L(c, "open_map")}
                </a>
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
function Contact({ b, c }: P) {
  const s = c.data.school;
  const rows = (
    [
      ["phone", s.phone, s.phone ? `tel:${s.phone.replace(/\s+/g, "")}` : null],
      ["email", s.email, s.email ? `mailto:${s.email}` : null],
      ["address", s.address, null],
      ["office_hours", s.office_hours, null],
    ] as [UiKey, string | null | undefined, string | null][]
  ).filter(([, v]) => v);
  const socials = Object.entries(s.socials ?? {}).filter(([, u]) => safeUrl(u));
  return (
    <>
      <Head b={b} c={c} fallback={L(c, "contact_us")} />
      <div className={b.variant === "split" ? "sw-grid" : "sw-card"}>
        {rows.map(([k, v, h]) => (
          <div
            key={k}
            className={b.variant === "split" ? "sw-card" : undefined}
            style={{ marginBottom: 8 }}
          >
            <div className="sw-meta">{L(c, k)}</div>
            <div style={{ fontWeight: 650 }}>{h ? <a href={h}>{v}</a> : v}</div>
          </div>
        ))}
      </div>
      {socials.length ? (
        <div className="sw-actions">
          {socials.map(([k, u]) => (
            <a key={k} className="sw-btn sw-btn-alt" href={safeUrl(u)!} rel="noopener">
              {k[0].toUpperCase() + k.slice(1)}
            </a>
          ))}
        </div>
      ) : null}
    </>
  );
}
function MapBlock({ b, c }: P) {
  const s = c.data.school;
  const links: [string, string][] = [];
  if (s.map?.lat && s.map?.lng)
    links.push([
      s.name,
      `https://www.openstreetmap.org/?mlat=${s.map.lat}&mlon=${s.map.lng}#map=17/${s.map.lat}/${s.map.lng}`,
    ]);
  for (const k of c.data.campuses ?? []) if (k.address) links.push([k.name, mapLink(k.address)]);
  if (!links.length && s.address) links.push([s.name, mapLink(s.address)]);
  return (
    <>
      <Head b={b} c={c} />
      <div className="sw-actions">
        {links.map(([n, u]) => (
          <a key={n + u} className="sw-btn sw-btn-alt" href={u} rel="noopener">
            {L(c, "open_map")}: {n}
          </a>
        ))}
      </div>
    </>
  );
}
function Faqs({ b, c }: P) {
  return (
    <>
      <Head b={b} c={c} fallback={L(c, "faqs")} />
      <div className="sw-faq">
        {(c.data.faqs ?? []).map((x, i) => (
          <details key={i}>
            <summary>{x.question}</summary>
            <div>
              <Rich text={x.answer} />
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
function Testimonials({ b, c }: P) {
  return (
    <>
      <Head b={b} c={c} />
      <div className="sw-grid">
        {(c.data.testimonials ?? []).map((x, i) => (
          <blockquote key={i} className="sw-card sw-quote">
            <p>“{x.content}”</p>
            <footer>
              <strong>{x.name}</strong> · {x.role}
            </footer>
          </blockquote>
        ))}
      </div>
    </>
  );
}
function Accreditation({ b, c }: P) {
  return (
    <>
      <Head b={b} c={c} />
      <div className="sw-badges">
        {arr<Record<string, unknown>>(b.props.badges).map((x, i) => (
          <div key={i} className="sw-badge">
            <Img src={x.logo as string} alt="" />
            <div>
              <b>{String(x.name ?? "")}</b>
              {T(c, x.detail) ? <div className="sw-meta">{T(c, x.detail)}</div> : null}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
function RichText({ b, c }: P) {
  return (
    <div className={b.variant === "callout" ? "sw-callout" : undefined}>
      <Head b={b} c={c} />
      <Rich text={T(c, b.props.body)} />
    </div>
  );
}
function Cta({ b, c }: P) {
  return (
    <div style={{ textAlign: "center" }}>
      <Head b={b} c={c} />
      {T(c, b.props.body) ? (
        <p className="sw-sub" style={{ margin: "0 auto 8px" }}>
          {T(c, b.props.body)}
        </p>
      ) : null}
      <div className="sw-actions" style={{ justifyContent: "center" }}>
        <a className="sw-btn" href={href(c, b.props.cta_href) ?? "#"}>
          {T(c, b.props.cta_label)}
        </a>
      </div>
    </div>
  );
}
function Links({ b, c }: P) {
  const items = arr<Record<string, unknown>>(b.props.items)
    .map((x) => [T(c, x.label), href(c, x.href)] as const)
    .filter(([l, h]) => l && h);
  return (
    <>
      <Head b={b} c={c} />
      {b.variant === "buttons" ? (
        <div className="sw-actions">
          {items.map(([l, h]) => (
            <a key={l} className="sw-btn sw-btn-alt" href={h!}>
              {l}
            </a>
          ))}
        </div>
      ) : (
        <ul className="sw-list">
          {items.map(([l, h]) => (
            <li key={l}>
              <a href={h!}>{l}</a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
function Agencies({ b, c }: P) {
  return (
    <>
      <Head b={b} c={c} intro />
      <div className="sw-grid">
        {arr<Record<string, unknown>>(b.props.items).map((x, i) => {
          const h = href(c, x.href);
          return (
            <div key={i} className="sw-card">
              <h3 className="sw-h3">{h ? <a href={h}>{T(c, x.name)}</a> : T(c, x.name)}</h3>
              {T(c, x.detail) ? <p>{T(c, x.detail)}</p> : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
/** Click-to-load: no third-party bytes until the visitor asks (low-bandwidth). */
function Video({ b, c }: P) {
  const [on, setOn] = useState(false);
  const u = String(b.props.url);
  const yt = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,20})/)?.[1];
  const vm = u.match(/vimeo\.com\/(\d+)/)?.[1];
  const src = yt
    ? `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1`
    : vm
      ? `https://player.vimeo.com/video/${vm}?autoplay=1`
      : null;
  return (
    <>
      <Head b={b} c={c} />
      {on && src ? (
        <iframe
          className="sw-video"
          src={src}
          title={T(c, b.props.heading) || "video"}
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation"
        />
      ) : (
        <button type="button" className="sw-video" onClick={() => setOn(true)}>
          ▶ {L(c, "play_video")}
        </button>
      )}
    </>
  );
}

/* ---------- v2 content types ---------- */
function postHref(c: BlockCtx, slug: string) {
  return c.link(`/posts/${slug}`);
}
export function PostCard({
  p,
  c,
  big,
}: {
  p: NonNullable<SiteData["posts"]>[number];
  c: BlockCtx;
  big?: boolean;
}) {
  const title = T(c, p.title);
  const ex = T(c, p.excerpt);
  return (
    <article className={big ? "sw-card sw-post sw-post-big" : "sw-card sw-post"}>
      <Img src={p.cover_url} alt="" className="sw-cover" />
      <p className="sw-meta">
        {[p.category, day(p.published_at).full].filter(Boolean).join(" · ")}
      </p>
      <h3 className={big ? "sw-h2" : "sw-h3"}>
        <a href={postHref(c, p.slug)}>{title}</a>
      </h3>
      {ex ? <p>{ex}</p> : null}
      {p.author_name ? (
        <p className="sw-meta">
          {L(c, "by")} {p.author_name}
        </p>
      ) : null}
    </article>
  );
}
function Blog({ b, c }: P) {
  const cat = typeof b.props.category === "string" ? b.props.category.toLowerCase() : "";
  const posts = (c.data.posts ?? [])
    .filter((p) => !cat || (p.category ?? "").toLowerCase() === cat)
    .slice(0, num(b.props.limit, 6));
  const v = b.variant ?? "grid";
  const [first, ...rest] = posts;
  return (
    <>
      <Head b={b} c={c} intro />
      {v === "featured" && first ? (
        <div className="sw-featured">
          <PostCard p={first} c={c} big />
          {rest.length ? (
            <div className="sw-list">
              {rest.map((p) => (
                <PostCard key={p.id} p={p} c={c} />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <div className={v === "list" ? "sw-list" : "sw-grid"}>
          {posts.map((p) => (
            <PostCard key={p.id} p={p} c={c} />
          ))}
        </div>
      )}
    </>
  );
}
type Rec = Record<string, unknown>;
function Policies({ b, c }: P) {
  const items = arr<Rec>(b.props.items).filter((x) => T(c, x.title));
  const cards = b.variant === "cards";
  return (
    <>
      <Head b={b} c={c} intro />
      <div className={cards ? "sw-grid" : "sw-faq"}>
        {items.map((x, i) => {
          const file = href(c, x.file);
          const body = T(c, x.body);
          const meta = (
            <>
              {T(c, x.summary) ? <p>{T(c, x.summary)}</p> : null}
              {body ? <Rich text={body} className="sw-prose" /> : null}
              <div className="sw-actions">
                {file ? (
                  <a className="sw-btn sw-btn-alt" href={file}>
                    {L(c, "download")}
                  </a>
                ) : null}
                {typeof x.reviewed === "string" && x.reviewed ? (
                  <span className="sw-meta">
                    {L(c, "reviewed")}: {x.reviewed}
                  </span>
                ) : null}
              </div>
            </>
          );
          const id = `policy-${typeof x.kind === "string" ? x.kind : i}`;
          return cards ? (
            <div key={i} className="sw-card" id={id}>
              <h3 className="sw-h3">{T(c, x.title)}</h3>
              {meta}
            </div>
          ) : (
            <details key={i} id={id}>
              <summary>{T(c, x.title)}</summary>
              <div>{meta}</div>
            </details>
          );
        })}
      </div>
    </>
  );
}
function Rules({ b, c }: P) {
  const groups = arr<Rec>(b.props.groups)
    .map((g) => ({
      title: T(c, g.title),
      rules: T(c, g.rules)
        .split("\n")
        .map((r) => r.replace(/^[-*\d.)\s]+/, "").trim())
        .filter(Boolean),
    }))
    .filter((g) => g.rules.length);
  const numbered = b.variant === "numbered";
  let n = 0;
  return (
    <>
      <Head b={b} c={c} intro />
      <div className="sw-rules">
        {groups.map((g, i) => (
          <section key={i} className="sw-card">
            {g.title ? <h3 className="sw-h3">{g.title}</h3> : null}
            <ol
              className={numbered ? "sw-ol" : "sw-ol sw-ol-plain"}
              start={numbered ? n + 1 : undefined}
            >
              {g.rules.map((r, j) => {
                n++;
                return <li key={j}>{r}</li>;
              })}
            </ol>
          </section>
        ))}
      </div>
    </>
  );
}
function Calendar({ b, c }: P) {
  const items = arr<Rec>(b.props.items)
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x.starts ?? "")))
    .sort((x, y) => String(x.starts).localeCompare(String(y.starts)));
  const range = (x: Rec) =>
    [
      day(String(x.starts)).full,
      /^\d{4}-\d{2}-\d{2}$/.test(String(x.ends ?? "")) ? day(String(x.ends)).full : "",
    ]
      .filter(Boolean)
      .join(" – ");
  return (
    <>
      <Head b={b} c={c} intro />
      {b.variant === "timeline" ? (
        <ol className="sw-timeline">
          {items.map((x, i) => (
            <li key={i}>
              <b>{T(c, x.label)}</b>
              <span className="sw-meta">{range(x)}</span>
              {T(c, x.note) ? <span>{T(c, x.note)}</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        <div className="sw-scroll">
          <table className="sw-table">
            <tbody>
              {items.map((x, i) => (
                <tr key={i}>
                  <th scope="row">{T(c, x.label)}</th>
                  <td>{range(x)}</td>
                  <td>{T(c, x.note)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
function Downloads({ b, c }: P) {
  const items = arr<Rec>(b.props.items).filter((x) => href(c, x.href) && T(c, x.label));
  const groups = [...new Set(items.map((x) => String(x.group ?? "")))];
  return (
    <>
      <Head b={b} c={c} />
      {groups.map((g) => (
        <div key={g} className="sw-dl-group">
          {g ? <h3 className="sw-h3">{g}</h3> : null}
          <ul className={b.variant === "grid" ? "sw-grid sw-grid-sm sw-dl" : "sw-list sw-dl"}>
            {items
              .filter((x) => String(x.group ?? "") === g)
              .map((x, i) => (
                <li key={i} className={b.variant === "grid" ? "sw-card" : undefined}>
                  <a href={href(c, x.href) as string}>
                    <span aria-hidden className="sw-dl-icon">
                      ↓
                    </span>
                    {T(c, x.label)}
                  </a>
                  {typeof x.detail === "string" && x.detail ? (
                    <span className="sw-meta"> · {x.detail}</span>
                  ) : null}
                </li>
              ))}
          </ul>
        </div>
      ))}
    </>
  );
}
function Careers({ b, c }: P) {
  const jobs = openVacancies(b, c.locale) as Rec[];
  return (
    <>
      <Head b={b} c={c} intro />
      <div className={b.variant === "cards" ? "sw-grid" : "sw-list"}>
        {jobs.map((x, i) => {
          const apply = href(c, x.apply_href);
          return (
            <article key={i} className="sw-card">
              <h3 className="sw-h3">{T(c, x.title)}</h3>
              <p className="sw-meta">
                {[
                  typeof x.type === "string" ? x.type : "",
                  /^\d{4}-\d{2}-\d{2}$/.test(String(x.closes ?? ""))
                    ? `${L(c, "closes")} ${day(String(x.closes)).full}`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {T(c, x.summary) ? <Rich text={T(c, x.summary)} /> : null}
              {apply ? (
                <div className="sw-actions">
                  <a className="sw-btn" href={apply}>
                    {L(c, "apply")}
                  </a>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
}
function Pta({ b, c }: P) {
  const ex = arr<Rec>(b.props.executives).filter((x) => typeof x.name === "string" && x.name);
  const contact = href(c, b.props.contact);
  return (
    <>
      <Head b={b} c={c} intro />
      <div className={b.variant === "split" ? "sw-split" : undefined}>
        <div>
          {T(c, b.props.meetings) ? (
            <div className="sw-callout">
              <h3 className="sw-h3">{L(c, "meetings")}</h3>
              <Rich text={T(c, b.props.meetings)} />
            </div>
          ) : null}
          {contact ? (
            <div className="sw-actions">
              <a className="sw-btn" href={contact}>
                {L(c, "get_in_touch")}
              </a>
            </div>
          ) : null}
        </div>
        {ex.length ? (
          <div>
            <h3 className="sw-h3">{L(c, "executives")}</h3>
            <ul className="sw-list">
              {ex.map((x, i) => (
                <li key={i} className="sw-person">
                  <span className="sw-avatar" aria-hidden>
                    {initials(String(x.name))}
                  </span>
                  <span>
                    <b>{String(x.name)}</b>
                    <br />
                    <span className="sw-meta">{T(c, x.role)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </>
  );
}

const R: Record<string, (p: P) => ReactNode> = {
  hero: Hero,
  about: About,
  leadership: Leadership,
  stats: Stats,
  sections_offered: SectionsOffered,
  programmes: Programmes,
  departments: Departments,
  admissions: Admissions,
  fees_summary: Fees,
  facilities: Facilities,
  boarding: Boarding,
  transport: Transport,
  news: News,
  events: Events,
  gallery: Gallery,
  staff_directory: Staff,
  results_checker: ResultsChecker,
  alumni: Alumni,
  donations: Donations,
  campuses: Campuses,
  contact: Contact,
  map: MapBlock,
  faqs: Faqs,
  testimonials: Testimonials,
  accreditation: Accreditation,
  rich_text: RichText,
  cta: Cta,
  links: Links,
  agencies: Agencies,
  video: Video,
  blog: Blog,
  policies: Policies,
  rules: Rules,
  calendar: Calendar,
  downloads: Downloads,
  careers: Careers,
  pta: Pta,
};
export const RENDERED_TYPES = Object.keys(R);
export function BlockView({ b, c }: P) {
  const C = R[b.type];
  return C ? (
    <div className="sw-block" data-block={b.type} data-variant={b.variant} id={b.id}>
      <C b={b} c={c} />
    </div>
  ) : null;
}
