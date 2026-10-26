/** SHERIVS-100 phase 3: builder editing operations keep documents valid and never write fake translations. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCK_TYPES } from "@/lib/website/catalog";
import * as ed from "@/lib/website/editor";
import { generateSite } from "@/lib/website/generator";
import { validateDocument } from "@/lib/website/validate";
import { DEMO_FACTS } from "../fixtures/website/demo-facts";

const base = () => generateSite(DEMO_FACTS.bornoSecondary);

describe("editor operations", () => {
  it("add/rename/reorder/remove pages; home stays first and undeletable", () => {
    let d = base();
    const home = d.pages[0];
    const r = ed.addPage(d, "Sports & Clubs", "en");
    d = r.doc;
    const p = d.pages.find((x) => x.id === r.pageId)!;
    expect(p.slug).toBe("sports-clubs");
    expect(ed.addPage(d, "Sports & Clubs", "en").doc.pages.at(-1)!.slug).toBe("sports-clubs-2");
    d = ed.movePage(d, p.id, -1);
    expect(d.pages[0].id).toBe(home.id);
    expect(ed.movePage(d, d.pages[1].id, -1).pages[0].id).toBe(home.id);
    expect(ed.removePage(d, home.id).pages[0].id).toBe(home.id);
    expect(ed.removePage(d, p.id).pages.some((x) => x.id === p.id)).toBe(false);
    expect(ed.updatePage(d, home.id, { slug: "x" }).pages[0].slug).toBe("home");
    expect(ed.updatePage(d, p.id, { slug: "about" }).pages.find((x) => x.id === p.id)!.slug).toBe(
      "sports-clubs",
    ); // taken
  });

  it("every catalog block can be added, edited, toggled and still validates", () => {
    let d = base();
    const pid = d.pages[0].id;
    for (const t of BLOCK_TYPES) {
      const r = ed.addBlock(d, pid, t);
      d = ed.toggleBlock(ed.toggleBlock(r.doc, r.blockId), r.blockId);
      expect(ed.findBlock(d, r.blockId)!.block.hidden).toBeUndefined();
    }
    expect(validateDocument(d)).toEqual([]);
    const ids = d.pages.flatMap((p) => [
      p.id,
      ...p.sections.flatMap((s) => [s.id, ...s.blocks.map((b) => b.id)]),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("localized props write only the active locale and empty values are removed", () => {
    let d = base();
    const r = ed.addBlock(d, d.pages[0].id, "rich_text");
    d = ed.setProp(r.doc, r.blockId, "heading", "Sports", "en");
    d = ed.setProp(d, r.blockId, "heading", "Wasanni", "ha");
    expect(ed.findBlock(d, r.blockId)!.block.props.heading).toEqual({
      en: "Sports",
      ha: "Wasanni",
    });
    d = ed.setProp(d, r.blockId, "heading", "", "ha");
    expect(ed.findBlock(d, r.blockId)!.block.props.heading).toEqual({ en: "Sports" });
    d = ed.setProp(d, r.blockId, "heading", "", "en");
    expect("heading" in ed.findBlock(d, r.blockId)!.block.props).toBe(false);
  });

  it("variants are limited to the catalog; sections reorder", () => {
    let d = base();
    const pid = d.pages[0].id;
    const r = ed.addBlock(d, pid, "news");
    d = ed.setVariant(r.doc, r.blockId, "nonsense");
    expect(ed.findBlock(d, r.blockId)!.block.variant).not.toBe("nonsense");
    const secs = d.pages[0].sections.map((s) => s.id);
    d = ed.moveSection(d, pid, secs.at(-1)!, -1);
    expect(d.pages[0].sections.at(-2)!.id).toBe(secs.at(-1));
  });

  it("theme/locales: default locale kept, at least one locale", () => {
    const d = base();
    expect(ed.setLocales(d, []).locales).toEqual(d.locales);
    expect(ed.setTheme(d, { logo: "" }).theme.logo).toBeUndefined();
    expect(ed.setTheme(d, { primary: "#123456" }).theme.primary).toBe("#123456");
  });

  it("editing never mutates the input document", () => {
    const d = base();
    const snap = JSON.stringify(d);
    ed.addBlock(d, d.pages[0].id, "faqs");
    ed.toggleBlock(d, d.pages[0].sections[0].blocks[0].id);
    ed.updatePage(d, d.pages[0].id, { title: ["en", "X"] });
    expect(JSON.stringify(d)).toBe(snap);
  });
});

describe("builder wiring", () => {
  const ROOT = join(__dirname, "../..");
  it("keeps website engine RPCs in the domain layer after the admin builder UI was removed", () => {
    expect(
      existsSync(join(ROOT, "frontend/src/routes/_authenticated/admin/website.tsx")),
    ).toBe(false);
    expect(
      existsSync(join(ROOT, "frontend/src/routes/_authenticated/admin/onboarding-interview.tsx")),
    ).toBe(false);
    const boot = readFileSync(join(ROOT, "frontend/src/lib/website/bootstrap.ts"), "utf8");
    expect(boot).toMatch(/if \(state\.exists\) return "exists"/);
    const fns = readFileSync(join(ROOT, "frontend/src/lib/website/public-site.functions.ts"), "utf8");
    expect(fns.length).toBeGreaterThan(0);
  });
});
