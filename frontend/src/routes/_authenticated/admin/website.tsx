/**
 * Website builder (SHERIVS-100, SPEC §7). Pages > sections > blocks: add, reorder, show/hide, edit through the
 * block's schema, choose variants, switch editing language, preview with live data, publish, roll back.
 * Data-bound blocks with no data are flagged "hidden on the site" instead of rendering empty placeholders.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rpc } from "@/lib/scholar/rpc";
import siteCss from "@/components/website/website.css?url";
import { SiteView } from "@/components/website/site-view";
import { FieldEditor } from "@/components/website/builder/field-editor";
import { BLOCK_MAP, BLOCKS, blockVisible, type BlockCategory } from "@/lib/website/catalog";
import { generateSite, type Facts } from "@/lib/website/generator";
import { LOCALE_NAMES, tx } from "@/lib/website/i18n";
import { validateDocument } from "@/lib/website/validate";
import * as ed from "@/lib/website/editor";
import { LOCALES, type Locale, type SiteData, type SiteDocument } from "@/lib/website/types";

export const Route = createFileRoute("/_authenticated/admin/website")({
  ssr: false,
  head: () => ({ links: [{ rel: "stylesheet", href: siteCss }] }),
  component: WebsiteBuilder,
});

interface WebsiteState {
  exists: boolean;
  draft: SiteDocument | null;
  draft_rev: number;
  published_version: number | null;
  versions: { version: number; source: string; note: string | null; created_at: string }[];
}
const CATEGORY_LABEL: Record<BlockCategory, string> = {
  identity: "About the organization",
  academics: "Academics",
  admissions: "Admissions",
  campus_life: "Campus life",
  community: "Community",
  updates: "News and updates",
  contact: "Contact",
  content: "Content",
};

function WebsiteBuilder() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ["website", org],
    enabled: !!org,
    queryFn: () => rpc<WebsiteState>("website_get", { p_school: org }),
  });
  const facts = useQuery({
    queryKey: ["website-facts", org],
    enabled: !!org,
    queryFn: () => rpc<Facts>("website_facts", { p_school: org }),
  });

  const [doc, setDoc] = useState<SiteDocument | null>(null);
  const [rev, setRev] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pageId, setPageId] = useState<string>("");
  const [blockId, setBlockId] = useState<string>("");
  const [locale, setLocale] = useState<Locale>("en");
  const [busy, setBusy] = useState<string | null>(null);
  const [newPage, setNewPage] = useState("");
  const [note, setNote] = useState("");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");

  // Load the draft once (or after a reload); never clobber unsaved edits.
  useEffect(() => {
    if (!state.data || dirty) return;
    const d = state.data.draft;
    setDoc(d);
    setRev(state.data.draft_rev);
    if (d) {
      setLocale((l) => (d.locales.includes(l) ? l : d.locales[0]));
      setPageId((p) => (d.pages.some((x) => x.id === p) ? p : (d.pages[0]?.id ?? "")));
    }
  }, [state.data, dirty]);

  const types = useMemo(
    () =>
      doc
        ? [
            ...new Set(
              doc.pages.flatMap((p) => p.sections.flatMap((s) => s.blocks.map((b) => b.type))),
            ),
          ]
            .sort()
            .join(",")
        : "",
    [doc],
  );
  const preview = useQuery({
    queryKey: ["website-preview", org, types],
    enabled: !!org && !!doc,
    queryFn: () => rpc<SiteData>("website_preview_data", { p_school: org, p_document: doc }),
  });
  const data: SiteData | undefined = preview.data ?? facts.data?.data;

  const edit = (next: SiteDocument) => {
    setDoc(next);
    setDirty(true);
  };
  const page = doc?.pages.find((p) => p.id === pageId) ?? doc?.pages[0];
  const sel = doc && blockId ? ed.findBlock(doc, blockId) : null;
  const errors = useMemo(() => (doc ? validateDocument(doc) : []), [doc]);
  const def = doc?.locales[0] ?? "en";

  async function run<T>(key: string, fn: () => Promise<T>, ok: string): Promise<T | undefined> {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      return r;
    } catch (e) {
      const m = (e as Error).message;
      toast.error(
        /40001|changed by someone|conflict/i.test(m)
          ? "Someone else saved the website meanwhile. Reload to see their changes (your edits are kept until you reload)."
          : m,
      );
      return undefined;
    } finally {
      setBusy(null);
    }
  }
  async function save(): Promise<boolean> {
    if (!doc) return false;
    if (errors.length) {
      toast.error(`Fix before saving: ${errors[0]}`);
      return false;
    }
    const r = await run(
      "save",
      () =>
        rpc<number>("website_save_draft", { p_school: org, p_document: doc, p_expected_rev: rev }),
      "Draft saved",
    );
    if (r === undefined) return false;
    setRev(r);
    setDirty(false);
    await qc.invalidateQueries({ queryKey: ["website", org] });
    return true;
  }
  async function publish() {
    if (dirty && !(await save())) return;
    const v = await run(
      "publish",
      () => rpc<number>("website_publish", { p_school: org, p_note: note || null }),
      "",
    );
    if (v !== undefined) {
      toast.success(`Published version ${v}. The public site updates within a minute.`);
      setNote("");
      await qc.invalidateQueries({ queryKey: ["website", org] });
    }
  }
  async function rollback(version: number) {
    if (!confirm(`Publish version ${version} again and replace the current draft with it?`)) return;
    const v = await run(
      "rollback",
      () => rpc<number>("website_rollback", { p_school: org, p_version: version }),
      "",
    );
    if (v !== undefined) {
      toast.success(`Version ${version} is live again (as version ${v}).`);
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ["website", org] });
    }
  }
  function regenerate() {
    if (!facts.data) return;
    if (
      doc &&
      !confirm(
        "Rebuild the whole website from your onboarding answers and live data? Your unsaved and saved draft edits will be replaced (published versions are kept).",
      )
    )
      return;
    const next = generateSite(facts.data);
    edit(next);
    setPageId(next.pages[0]?.id ?? "");
    setBlockId("");
    setLocale(next.locales[0]);
  }

  if (!org)
    return (
      <PortalPage title="Website" subtitle="Select an organization first.">
        {null}
      </PortalPage>
    );
  if (state.isLoading || facts.isLoading)
    return (
      <PortalPage title="Website" subtitle="Loading…">
        {null}
      </PortalPage>
    );
  if (state.error)
    return (
      <PortalPage title="Website" subtitle={(state.error as Error).message}>
        {null}
      </PortalPage>
    );

  if (!doc) {
    return (
      <PortalPage
        title="Website"
        subtitle="Your public website is built from your onboarding answers and live data. Nothing is published until you choose to."
      >
        <div className="rounded-lg border p-6 space-y-3 max-w-xl">
          <h2 className="font-semibold">Create your website</h2>
          <p className="text-sm text-muted-foreground">
            We add only the pages and blocks you have information for (programmes, admissions, news,
            contact and more). Empty sections are never shown.
          </p>
          <Button onClick={regenerate} disabled={!facts.data}>
            Generate my website
          </Button>
        </div>
      </PortalPage>
    );
  }

  const published = state.data?.published_version;
  return (
    <PortalPage
      title="Website"
      subtitle={
        published
          ? `Live: version ${published}${dirty ? " · unsaved changes" : ""}`
          : "Not published yet: visitors see an automatic site built from your public data."
      }
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
        <label className="text-sm">
          Editing language{" "}
          <select
            aria-label="Editing language"
            className="rounded-md border bg-background p-1 text-sm"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {doc.locales.map((l) => (
              <option key={l} value={l}>
                {LOCALE_NAMES[l]}
                {l === def ? " (default)" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewport(viewport === "desktop" ? "mobile" : "desktop")}
          >
            Preview: {viewport}
          </Button>
          <Button variant="outline" size="sm" onClick={regenerate} disabled={!facts.data}>
            Rebuild from onboarding
          </Button>
          <Button variant="outline" size="sm" onClick={save} disabled={!dirty || busy === "save"}>
            {busy === "save" ? "Saving…" : "Save draft"}
          </Button>
          <Input
            className="h-8 w-48"
            placeholder="Publish note (optional)"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Publish note"
          />
          <Button size="sm" onClick={publish} disabled={busy === "publish" || errors.length > 0}>
            {busy === "publish" ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </div>
      {errors.length ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.length} problem(s): {errors.slice(0, 3).join("; ")}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        {/* Pages */}
        <aside className="space-y-3">
          <section className="rounded-lg border p-3 space-y-2">
            <h3 className="text-sm font-semibold">Pages</h3>
            <ul className="space-y-1">
              {doc.pages.map((p, i) => (
                <li
                  key={p.id}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-sm ${p.id === page?.id ? "bg-muted" : ""}`}
                >
                  <button
                    className="flex-1 text-left truncate"
                    onClick={() => {
                      setPageId(p.id);
                      setBlockId("");
                    }}
                  >
                    {tx(p.title, locale, def) || p.slug}
                  </button>
                  {!p.nav ? (
                    <span className="text-[10px] text-muted-foreground">not in menu</span>
                  ) : null}
                  {p.slug !== "home" ? (
                    <>
                      <button
                        aria-label="Move page up"
                        disabled={i <= 1}
                        onClick={() => edit(ed.movePage(doc, p.id, -1))}
                      >
                        ↑
                      </button>
                      <button
                        aria-label="Move page down"
                        disabled={i === doc.pages.length - 1}
                        onClick={() => edit(ed.movePage(doc, p.id, 1))}
                      >
                        ↓
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newPage.trim()) return;
                const r = ed.addPage(doc, newPage, locale);
                edit(r.doc);
                setPageId(r.pageId);
                setNewPage("");
              }}
            >
              <Input
                className="h-8"
                placeholder="New page title"
                value={newPage}
                onChange={(e) => setNewPage(e.target.value)}
                aria-label="New page title"
              />
              <Button size="sm" type="submit">
                Add
              </Button>
            </form>
          </section>
          {page ? (
            <section className="rounded-lg border p-3 space-y-2 text-sm">
              <h3 className="font-semibold">This page</h3>
              <label className="block text-xs text-muted-foreground">
                Title ({locale})
                <Input
                  value={page.title[locale] ?? ""}
                  onChange={(e) =>
                    edit(ed.updatePage(doc, page.id, { title: [locale, e.target.value] }))
                  }
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Address
                <Input
                  value={page.slug}
                  disabled={page.slug === "home"}
                  onChange={(e) =>
                    edit(ed.updatePage(doc, page.id, { slug: e.target.value.toLowerCase() }))
                  }
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={page.nav}
                  onChange={(e) => edit(ed.updatePage(doc, page.id, { nav: e.target.checked }))}
                />{" "}
                Show in menu
              </label>
              {page.slug !== "home" ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive"
                  onClick={() => {
                    if (confirm("Delete this page?")) {
                      edit(ed.removePage(doc, page.id));
                      setPageId(doc.pages[0].id);
                    }
                  }}
                >
                  Delete page
                </Button>
              ) : null}
            </section>
          ) : null}
          <ThemePanel doc={doc} onChange={edit} />
        </aside>

        {/* Sections + blocks of the page, then preview */}
        <main className="space-y-3 min-w-0">
          {page ? (
            <section className="rounded-lg border p-3 space-y-2">
              <h3 className="text-sm font-semibold">Blocks on “{tx(page.title, locale, def)}”</h3>
              {page.sections.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No blocks yet. Add one from the list on the right.
                </p>
              ) : null}
              <ol className="space-y-1">
                {page.sections.map((s, i) =>
                  s.blocks.map((b) => {
                    const bd = BLOCK_MAP[b.type];
                    const shows = data ? blockVisible(b, data, locale) : true;
                    return (
                      <li
                        key={b.id}
                        className={`flex flex-wrap items-center gap-2 rounded-md border px-2 py-1 text-sm ${b.id === blockId ? "ring-2 ring-primary" : ""}`}
                      >
                        <button className="flex-1 text-left" onClick={() => setBlockId(b.id)}>
                          <span className="font-medium">{bd?.label ?? b.type}</span>
                          {b.variant ? (
                            <span className="text-muted-foreground"> · {b.variant}</span>
                          ) : null}
                          {bd?.dataSource ? (
                            <span className="ml-2 rounded bg-muted px-1 text-[10px]">
                              live: {bd.dataSource}
                            </span>
                          ) : null}
                        </button>
                        {b.hidden ? (
                          <span className="rounded bg-muted px-1 text-[10px]">turned off</span>
                        ) : !shows ? (
                          <span
                            className="rounded bg-amber-100 px-1 text-[10px] text-amber-900"
                            title="Hidden automatically until there is data or content"
                          >
                            hidden: nothing to show yet
                          </span>
                        ) : null}
                        <button
                          aria-label="Move up"
                          disabled={i === 0}
                          onClick={() => edit(ed.moveSection(doc, page.id, s.id, -1))}
                        >
                          ↑
                        </button>
                        <button
                          aria-label="Move down"
                          disabled={i === page.sections.length - 1}
                          onClick={() => edit(ed.moveSection(doc, page.id, s.id, 1))}
                        >
                          ↓
                        </button>
                        <button
                          className="text-xs underline"
                          onClick={() => edit(ed.toggleBlock(doc, b.id))}
                        >
                          {b.hidden ? "Turn on" : "Turn off"}
                        </button>
                        <button
                          className="text-xs underline text-destructive"
                          onClick={() => {
                            edit(ed.removeSection(doc, page.id, s.id));
                            if (blockId === b.id) setBlockId("");
                          }}
                        >
                          Remove
                        </button>
                      </li>
                    );
                  }),
                )}
              </ol>
            </section>
          ) : null}
          <section aria-label="Preview" className="rounded-lg border overflow-hidden">
            <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-muted-foreground">
              <span>
                Preview ({LOCALE_NAMES[locale]}) {preview.isFetching ? "· refreshing data…" : ""}
              </span>
              <span>Links are disabled in preview</span>
            </div>
            <div
              className="max-h-[75vh] overflow-auto bg-muted/30"
              onClickCapture={(e) => {
                if ((e.target as HTMLElement).closest("a")) e.preventDefault();
              }}
            >
              <div style={{ width: viewport === "mobile" ? 390 : "100%", margin: "0 auto" }}>
                {data && page ? (
                  <SiteView
                    site={{
                      school_id: org,
                      version: null,
                      canonical_host: null,
                      document: doc,
                      data,
                    }}
                    documentOverride={doc}
                    slug={page.slug}
                    lang={locale}
                  />
                ) : (
                  <p className="p-6 text-sm">Loading preview…</p>
                )}
              </div>
            </div>
          </section>
        </main>

        {/* Block editor / catalog / versions */}
        <aside className="space-y-3">
          {sel ? (
            <section className="rounded-lg border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{BLOCK_MAP[sel.block.type]?.label}</h3>
                <button className="text-xs underline" onClick={() => setBlockId("")}>
                  Close
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {BLOCK_MAP[sel.block.type]?.description}
              </p>
              {(BLOCK_MAP[sel.block.type]?.variants.length ?? 0) > 1 ? (
                <label className="block text-xs text-muted-foreground">
                  Style
                  <select
                    className="w-full rounded-md border bg-background p-2 text-sm"
                    value={sel.block.variant ?? ""}
                    onChange={(e) => edit(ed.setVariant(doc, sel.block.id, e.target.value))}
                  >
                    {BLOCK_MAP[sel.block.type].variants.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block text-xs text-muted-foreground">
                Background
                <select
                  className="w-full rounded-md border bg-background p-2 text-sm"
                  value={sel.section.background}
                  onChange={(e) =>
                    edit(
                      ed.updateSection(doc, sel.page.id, sel.section.id, {
                        background: e.target.value as "default" | "muted" | "brand",
                      }),
                    )
                  }
                >
                  <option value="default">Plain</option>
                  <option value="muted">Soft grey</option>
                  <option value="brand">Brand colour</option>
                </select>
              </label>
              <FieldEditor
                fields={BLOCK_MAP[sel.block.type]?.fields ?? []}
                value={sel.block.props}
                locale={locale}
                onChange={(k, v, localized) =>
                  edit(ed.setProp(doc, sel.block.id, k, v, localized ? locale : undefined))
                }
              />
            </section>
          ) : page ? (
            <section className="rounded-lg border p-3 space-y-2">
              <h3 className="text-sm font-semibold">Add a block</h3>
              {(Object.keys(CATEGORY_LABEL) as BlockCategory[]).map((cat) => {
                const list = BLOCKS.filter((b) => b.category === cat);
                if (!list.length) return null;
                return (
                  <div key={cat}>
                    <p className="text-xs font-medium text-muted-foreground">
                      {CATEGORY_LABEL[cat]}
                    </p>
                    <div className="flex flex-wrap gap-1 py-1">
                      {list.map((b) => (
                        <button
                          key={b.type}
                          title={b.description}
                          className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted"
                          onClick={() => {
                            if (
                              b.optIn &&
                              !confirm(
                                `${b.label} publishes names and photos of people. Only add it if they agreed. Continue?`,
                              )
                            )
                              return;
                            const r = ed.addBlock(doc, page.id, b.type);
                            edit(r.doc);
                            setBlockId(r.blockId);
                          }}
                        >
                          {b.label}
                          {b.optIn ? " (opt-in)" : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          ) : null}
          <section className="rounded-lg border p-3 space-y-2">
            <h3 className="text-sm font-semibold">Published versions</h3>
            {state.data?.versions.length ? (
              <ul className="space-y-1 text-sm">
                {state.data.versions.slice(0, 12).map((v) => (
                  <li key={v.version} className="flex items-center gap-2">
                    <span className="font-medium">v{v.version}</span>
                    <span className="flex-1 truncate text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleString("en-NG")}
                      {v.source === "rollback" ? " · restore" : ""}
                      {v.note ? ` · ${v.note}` : ""}
                    </span>
                    {v.version === published ? (
                      <span className="text-[10px] rounded bg-emerald-100 px-1 text-emerald-900">
                        live
                      </span>
                    ) : (
                      <button
                        className="text-xs underline"
                        disabled={busy === "rollback"}
                        onClick={() => rollback(v.version)}
                      >
                        Restore
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing published yet.</p>
            )}
          </section>
        </aside>
      </div>
    </PortalPage>
  );
}

function ThemePanel({ doc, onChange }: { doc: SiteDocument; onChange: (d: SiteDocument) => void }) {
  const t = doc.theme;
  return (
    <section className="rounded-lg border p-3 space-y-2 text-sm">
      <h3 className="font-semibold">Look and languages</h3>
      <div className="flex gap-2">
        <label className="text-xs text-muted-foreground">
          Main colour
          <input
            aria-label="Main colour"
            type="color"
            className="block h-8 w-16"
            value={t.primary}
            onChange={(e) => onChange(ed.setTheme(doc, { primary: e.target.value }))}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Accent
          <input
            aria-label="Accent colour"
            type="color"
            className="block h-8 w-16"
            value={t.secondary}
            onChange={(e) => onChange(ed.setTheme(doc, { secondary: e.target.value }))}
          />
        </label>
      </div>
      <label className="block text-xs text-muted-foreground">
        Font
        <select
          className="w-full rounded-md border bg-background p-1"
          value={t.font}
          onChange={(e) => onChange(ed.setTheme(doc, { font: e.target.value as typeof t.font }))}
        >
          <option value="system">Clean</option>
          <option value="serif">Classic</option>
          <option value="rounded">Friendly</option>
        </select>
      </label>
      <label className="block text-xs text-muted-foreground">
        Corners
        <select
          className="w-full rounded-md border bg-background p-1"
          value={t.radius}
          onChange={(e) =>
            onChange(ed.setTheme(doc, { radius: e.target.value as typeof t.radius }))
          }
        >
          <option value="square">Square</option>
          <option value="soft">Soft</option>
          <option value="round">Round</option>
        </select>
      </label>
      <label className="block text-xs text-muted-foreground">
        Logo link
        <Input
          type="url"
          value={t.logo ?? ""}
          placeholder="Uses your school logo"
          onChange={(e) => onChange(ed.setTheme(doc, { logo: e.target.value }))}
        />
      </label>
      <fieldset className="space-y-1">
        <legend className="text-xs text-muted-foreground">Languages (first is the default)</legend>
        {LOCALES.map((l) => (
          <label key={l} className="mr-3 inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={doc.locales.includes(l)}
              disabled={doc.locales[0] === l}
              onChange={(e) =>
                onChange(
                  ed.setLocales(
                    doc,
                    e.target.checked ? [...doc.locales, l] : doc.locales.filter((x) => x !== l),
                  ),
                )
              }
            />
            {LOCALE_NAMES[l]}
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        Colours are adjusted automatically to stay readable (WCAG AA).
      </p>
    </section>
  );
}
