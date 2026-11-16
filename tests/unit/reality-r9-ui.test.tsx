/**
 * SV1-REALITY R9 (#335) — the "Start your public website" panel. Rendered to static markup
 * (no jsdom); wording is checked for an administrator audience and for honest claims.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  WebsiteSyncPanelView,
  type PanelState,
} from "../../frontend/src/components/app-shell/website-sync-panel";

const READY = {
  status: "ready" as const,
  applied: [
    {
      websiteField: "institution_type",
      questionId: "core.type.institution_type",
      summary: "Nursery & primary school",
    },
    {
      websiteField: "levels_offered",
      questionId: "primary.academics.levels",
      summary: "nursery, primary",
    },
  ],
  notSupported: [{ websiteField: "campus_count", questionId: "core.layout.campus_count" }],
  withheldCount: 3,
  pages: ["Home", "About us", "Contact"],
  planHash: "a1b2c3d4",
};

function render(state: PanelState, confirming = false, busy = false): string {
  return renderToStaticMarkup(
    createElement(WebsiteSyncPanelView, {
      state,
      confirming,
      busy,
      onAsk: () => {},
      onConfirm: () => {},
      onCancel: () => {},
      onRefresh: () => {},
    }),
  );
}
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe("R9 panel: preview", () => {
  const html = render({ kind: "preview", preview: READY });
  const t = text(html);
  it("says approving did not publish, and nothing is published until confirmed", () => {
    expect(t).toContain("Approving your answers did not publish anything");
    expect(t).toContain("nothing is published until you confirm");
    expect(html).not.toMatch(/Yes, publish my website/);
  });
  it("lists what will be used with plain labels and the summary", () => {
    expect(t).toContain("Type of school: Nursery & primary school");
    expect(t).toContain("Levels offered: nursery, primary");
  });
  it("lists approved answers with no place on the site as not published", () => {
    expect(t).toContain("Number of campuses");
    expect(t).toContain("These are not published");
  });
  it("counts private answers without naming them", () => {
    expect(t).toContain("3 approved answers are not marked public-safe and stay private.");
  });
  it("shows the pages that would be created", () => {
    expect(t).toContain("Home, About us, Contact");
  });
  it("never shows internal identifiers", () => {
    for (const bad of [
      "a1b2c3d4",
      "institution_type",
      "levels_offered",
      "core.type",
      "planHash",
      "RPC",
    ]) {
      expect(html).not.toContain(bad);
    }
  });
  it("singular private count", () => {
    expect(text(render({ kind: "preview", preview: { ...READY, withheldCount: 1 } }))).toContain(
      "1 approved answer is not marked public-safe and stays private.",
    );
  });
  it("omits empty sections and explains when no approved answer changes the site", () => {
    const t2 = text(
      render({
        kind: "preview",
        preview: { ...READY, applied: [], notSupported: [], withheldCount: 0, pages: [] },
      }),
    );
    expect(t2).toContain("None of your approved answers change the website yet");
    expect(t2).not.toContain("stay private");
    expect(t2).not.toContain("Pages that will be created");
    expect(t2).not.toContain("Approved, but no place");
  });
  it("an unknown field key is shown generically, never as a raw key", () => {
    const h = render({
      kind: "preview",
      preview: { ...READY, notSupported: [{ websiteField: "__proto__", questionId: "x" }] },
    });
    expect(text(h)).toContain("Another approved answer");
    expect(h).not.toContain("__proto__");
  });
  it("escapes text from approved summaries", () => {
    const h = render({
      kind: "preview",
      preview: {
        ...READY,
        applied: [
          {
            websiteField: "levels_offered",
            questionId: "q",
            summary: "<img src=x onerror=alert(1)>",
          },
        ],
      },
    });
    expect(h).not.toMatch(/<img/);
    expect(h).toContain("&lt;img");
  });
});

describe("R9 panel: explicit confirmation", () => {
  it("asking opens a labelled confirm group that says the site becomes public", () => {
    const html = render({ kind: "preview", preview: READY }, true);
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Confirm publishing"');
    expect(text(html)).toContain("This makes your website public");
    expect(html).toContain("Yes, publish my website");
    expect(html).toContain("Cancel");
    expect(html).not.toContain("Create and publish my website");
  });
  it("busy disables every action", () => {
    const html = render({ kind: "preview", preview: READY }, true, true);
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
    expect(html).toContain('aria-busy="true"');
  });
});

describe("R9 panel: other states", () => {
  it("loading is announced", () => {
    const html = render({ kind: "loading" });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
  });
  it("error is an alert that says nothing was changed and offers a retry", () => {
    const html = render({ kind: "error" });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain("Nothing was changed");
    expect(html).toContain("Try again");
  });
  it.each([
    ["not_approved", "Approve your answers first"],
    ["website_exists", "never replaces an existing website"],
    ["invalid", "Nothing was published"],
    ["not_allowed", "not allowed to manage the website"],
  ] as const)("blocked: %s", (status, needle) => {
    const html = render({ kind: "blocked", status });
    expect(text(html)).toContain(needle);
    expect(html).not.toContain("Create and publish my website");
  });
  it("published reports the version and does not claim more", () => {
    const html = render({ kind: "done", result: { status: "published", version: 4 } });
    expect(text(html)).toContain("created and published (version 4)");
    expect(html).toContain("is-ok");
  });
  it("saved-but-not-published is an error that tells the admin the next step", () => {
    const html = render({ kind: "done", result: { status: "saved_not_published" } });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain("could not be published");
    expect(text(html)).toContain("website builder");
  });
  it("stale says nothing was published and offers a fresh check", () => {
    const html = render({ kind: "done", result: { status: "stale" } });
    expect(text(html)).toContain("Nothing was published");
    expect(html).toContain("Check again");
  });
});

describe("R9 screen wiring (source level)", () => {
  const screen = readFileSync(
    resolve(__dirname, "../../frontend/src/components/app-shell/institution-interview-screen.tsx"),
    "utf8",
  );
  it("the panel is mounted only for a valid approval and resets on re-approval", () => {
    expect(screen).toMatch(
      /view\.approvalValid\s*\?\s*\(\s*<div[^>]*>\s*<WebsiteSyncPanel key=\{view\.approvedAtMs \?\? 0\}/,
    );
  });
  it("approving itself never calls the website endpoints", () => {
    expect(screen).not.toMatch(/publishWebsiteFromReality|previewWebsiteFromReality/);
  });
});
