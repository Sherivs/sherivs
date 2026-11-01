/**
 * Brand and typography panel (SHERIVS-101): colours (read from and saved to the school's branding fields),
 * font pairing with a live specimen, dark scheme, corners, crest/logo, favicon, social image and footer credit.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rpc } from "@/lib/scholar/rpc";
import * as ed from "@/lib/website/editor";
import { LOCALE_NAMES } from "@/lib/website/i18n";
import {
  contrast,
  derivePalette,
  FAMILY,
  PAIRING_KEYS,
  PAIRINGS,
  resolvePairing,
} from "@/lib/website/theme";
import { LOCALES, type SiteDocument, type Theme } from "@/lib/website/types";
import { fontFaceCss } from "../fonts";

export function BrandPanel({
  doc,
  onChange,
  org,
  kind,
}: {
  doc: SiteDocument;
  onChange: (d: SiteDocument) => void;
  org: string;
  kind: string;
}) {
  const t = doc.theme;
  const set = (p: Partial<Theme>) => onChange(ed.setTheme(doc, p));
  const pal = useMemo(() => derivePalette(t.primary, t.secondary).light, [t.primary, t.secondary]);
  const pairing = resolvePairing(t, kind);
  const [saving, setSaving] = useState(false);
  const adjusted =
    pal["--sw-primary"] !== t.primary.toLowerCase() || contrast(t.primary, "#ffffff") < 4.5;
  async function saveBrand() {
    setSaving(true);
    try {
      await rpc("website_set_brand", {
        p_school: org,
        p_primary: t.primary,
        p_secondary: t.secondary,
      });
      toast.success("Saved as your school's brand colours");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="rounded-lg border p-3 space-y-3 text-sm">
      <style
        dangerouslySetInnerHTML={{
          __html: PAIRING_KEYS.map((k) => fontFaceCss({ pairing: k }, kind)).join(""),
        }}
      />
      <h3 className="font-semibold">Brand and typography</h3>
      <div className="flex items-end gap-3">
        <label className="text-xs text-muted-foreground">
          Primary
          <input
            aria-label="Primary colour"
            type="color"
            className="block h-9 w-16"
            value={t.primary}
            onChange={(e) => set({ primary: e.target.value })}
          />
        </label>
        <label className="text-xs text-muted-foreground">
          Secondary
          <input
            aria-label="Secondary colour"
            type="color"
            className="block h-9 w-16"
            value={t.secondary}
            onChange={(e) => set({ secondary: e.target.value })}
          />
        </label>
        <Button size="sm" variant="outline" disabled={saving} onClick={saveBrand}>
          Save as school colours
        </Button>
      </div>
      <div className="flex overflow-hidden rounded-md border" aria-label="Palette preview">
        {[
          "--sw-p50",
          "--sw-p100",
          "--sw-p200",
          "--sw-primary",
          "--sw-p700",
          "--sw-p900",
          "--sw-secondary",
          "--sw-footer-bg",
        ].map((k) => (
          <span
            key={k}
            title={`${k.replace("--sw-", "")} ${pal[k]}`}
            className="h-6 flex-1"
            style={{ background: pal[k] }}
          />
        ))}
      </div>
      {adjusted ? (
        <p className="text-xs text-muted-foreground">
          Text on your colours is adjusted automatically to stay readable (WCAG AA): buttons use{" "}
          {pal["--sw-on-primary"] === "#ffffff" ? "white" : "dark"} text and links use{" "}
          {pal["--sw-link"]}.
        </p>
      ) : null}
      <fieldset className="space-y-1">
        <legend className="text-xs text-muted-foreground">Fonts</legend>
        <div className="grid grid-cols-2 gap-2">
          {PAIRING_KEYS.map((k) => {
            const pr = PAIRINGS[k];
            return (
              <button
                key={k}
                type="button"
                aria-pressed={pairing === k}
                onClick={() => set({ pairing: k })}
                className={`rounded-md border p-2 text-left ${pairing === k ? "ring-2 ring-primary" : ""}`}
              >
                <span
                  className="block text-base leading-tight"
                  style={{ fontFamily: `"${FAMILY[pr.heading]}"`, fontWeight: pr.weight }}
                >
                  {pr.label}
                </span>
                <span
                  className="block text-xs text-muted-foreground"
                  style={{ fontFamily: `"${FAMILY[pr.body]}"` }}
                >
                  Ɗalibai · Ọmọ ilé-ìwé · Ụmụ akwụkwọ
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-muted-foreground">
          Dark mode
          <select
            className="w-full rounded-md border bg-background p-1"
            value={t.dark ?? "auto"}
            onChange={(e) => set({ dark: e.target.value as Theme["dark"] })}
          >
            <option value="auto">Follow visitor's device</option>
            <option value="light">Always light</option>
            <option value="dark">Always dark</option>
          </select>
        </label>
        <label className="block text-xs text-muted-foreground">
          Corners
          <select
            className="w-full rounded-md border bg-background p-1"
            value={t.radius}
            onChange={(e) => set({ radius: e.target.value as Theme["radius"] })}
          >
            <option value="square">Square</option>
            <option value="soft">Soft</option>
            <option value="round">Round</option>
          </select>
        </label>
      </div>
      <label className="block text-xs text-muted-foreground">
        Logo link
        <Input
          type="url"
          value={t.logo ?? ""}
          placeholder="Uses your school logo"
          onChange={(e) => set({ logo: e.target.value })}
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        Crest / emblem link (hero "crest" style and footer)
        <Input
          type="url"
          value={t.crest ?? ""}
          placeholder="Uses the logo"
          onChange={(e) => set({ crest: e.target.value })}
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        Browser icon (favicon) link
        <Input
          type="url"
          value={doc.seo?.favicon ?? ""}
          placeholder="Uses the logo, or your initials in your colours"
          onChange={(e) => onChange(ed.setSeo(doc, { favicon: e.target.value }))}
        />
      </label>
      <label className="block text-xs text-muted-foreground">
        Social sharing image link (1200×630)
        <Input
          type="url"
          value={doc.seo?.og_image ?? ""}
          placeholder="Uses the hero photo or logo"
          onChange={(e) => onChange(ed.setSeo(doc, { og_image: e.target.value }))}
        />
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={t.credit !== false}
          onChange={(e) => set({ credit: e.target.checked })}
        />
        Show a small "Website by Sherivs" credit in the footer
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
    </section>
  );
}
