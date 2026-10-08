/**
 * Sherivs component system — server-rendered markup contracts (no DOM env in
 * this repository, so components render through react-dom/server).
 * Covers the trust model (no fake AI activity), state semantics, a11y roles.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SherivsLockup, SherivsSymbol } from "@/components/sherivs/brand";
import { LayerStack, MissionFlow, PlaneStack } from "@/components/sherivs/diagrams";
import { AiStatement, ConfidenceMeter, StatementBadge, VerificationState } from "@/components/sherivs/evidence";
import { Section, DefinitionRows, PlaneRail } from "@/components/sherivs/primitives";
import { SYSTEM_STATE_KINDS, SYSTEM_STATE_META, SystemState } from "@/components/sherivs/states";
import {
  STATEMENT_KINDS,
  VERIFICATION_STATES,
  VERIFICATION_STATE_META,
  confidenceBand,
  confidencePercent,
} from "@/lib/experience-system/evidence-model";

const html = (el: ReactElement) => renderToStaticMarkup(el);

describe("evidence model", () => {
  it("bands confidence and rejects invalid scores", () => {
    expect(confidenceBand(0.95)).toBe("high");
    expect(confidenceBand(0.8)).toBe("high");
    expect(confidenceBand(0.6)).toBe("moderate");
    expect(confidenceBand(0.1)).toBe("low");
    for (const bad of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      expect(confidenceBand(bad as number | null | undefined)).toBeNull();
    }
    expect(confidencePercent(0.456)).toBe("46%");
  });

  it("only marks pending verification as live activity", () => {
    const live = VERIFICATION_STATES.filter((s) => VERIFICATION_STATE_META[s].live);
    expect(live).toEqual(["pending"]);
  });
});

describe("evidence components", () => {
  it.each(STATEMENT_KINDS)("labels a %s statement for assistive technology", (kind) => {
    const out = html(createElement(AiStatement, { kind, children: "Text" }));
    expect(out).toContain("<article");
    expect(out).toMatch(/aria-label="[A-Za-z]+: /);
  });

  it("renders no confidence meter without a valid score", () => {
    expect(html(createElement(ConfidenceMeter, { score: null }))).toBe("");
    expect(html(createElement(ConfidenceMeter, { score: 7 }))).toBe("");
  });

  it("renders an accessible meter for a valid score", () => {
    const out = html(createElement(ConfidenceMeter, { score: 0.82 }));
    expect(out).toContain('role="meter"');
    expect(out).toContain('aria-valuenow="82"');
    expect(out).toContain("high");
  });

  it("does not claim verification that was not given", () => {
    const out = html(createElement(AiStatement, { kind: "inference", confidence: 0.4, children: "x" }));
    expect(out).not.toMatch(/verified/i);
    const unverified = html(createElement(VerificationState, { state: "unverified" }));
    expect(unverified).toContain("Not verified");
  });

  it("distinguishes inference from observation in plain language", () => {
    expect(html(createElement(StatementBadge, { kind: "inference" }))).toContain("Inference");
    expect(html(createElement(StatementBadge, { kind: "observation" }))).toContain("Observation");
  });
});

describe("system states", () => {
  it("defines a distinct, non-empty meaning for every state", () => {
    const titles = SYSTEM_STATE_KINDS.map((k) => SYSTEM_STATE_META[k].title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const k of SYSTEM_STATE_KINDS) expect(SYSTEM_STATE_META[k].description.length).toBeGreaterThan(10);
  });

  it("announces errors assertively and loading politely, never the reverse", () => {
    expect(html(createElement(SystemState, { kind: "error" }))).toContain('role="alert"');
    const loading = html(createElement(SystemState, { kind: "loading" }));
    expect(loading).toContain('role="status"');
    expect(loading).toContain('aria-busy="true"');
  });

  it("shows busy only for the loading state", () => {
    for (const k of SYSTEM_STATE_KINDS.filter((x) => x !== "loading")) {
      expect(html(createElement(SystemState, { kind: k })), k).not.toContain("aria-busy");
    }
  });

  it("lets callers supply an action and honest copy", () => {
    const out = html(createElement(SystemState, { kind: "empty", title: "No guides", description: "Nothing published." }));
    expect(out).toContain("No guides");
    expect(out).toContain("Nothing published.");
  });
});

describe("brand and diagrams", () => {
  it("renders the symbol decorative unless titled", () => {
    expect(html(createElement(SherivsSymbol))).toContain('aria-hidden="true"');
    const titled = html(createElement(SherivsSymbol, { title: "Sherivs" }));
    expect(titled).toContain('role="img"');
    expect(titled).toContain('aria-label="Sherivs"');
  });

  it("renders the lockup with the brand name", () => {
    expect(html(createElement(SherivsLockup))).toContain("Sherivs");
  });

  it("exposes diagrams with text alternatives", () => {
    const planes = html(createElement(PlaneStack));
    expect(planes).toContain("<title");
    expect(planes).toMatch(/Reality[\s\S]*Intelligence[\s\S]*Action[\s\S]*Evidence/);
    expect(html(createElement(LayerStack))).toContain("<ol");
  });

  it("renders the mission flow as an accessible tablist in order", () => {
    const out = html(createElement(MissionFlow));
    expect(out).toContain('role="tablist"');
    expect(out.indexOf("Mission")).toBeLessThan(out.indexOf("Verification"));
    expect(out.indexOf("Verification")).toBeLessThan(out.indexOf("Outcome"));
  });
});

describe("layout primitives", () => {
  it("renders exactly one heading per Section at the requested level", () => {
    const h1 = html(createElement(Section, { id: "a", title: "T", headingLevel: 1 }));
    expect(h1.match(/<h1/g)).toHaveLength(1);
    const h2 = html(createElement(Section, { id: "b", title: "T" }));
    expect(h2).toContain("<h2");
    expect(h2).toContain('aria-labelledby="b-title"');
  });

  it("marks decorative plane rails hidden from assistive technology", () => {
    expect(html(createElement(PlaneRail))).toContain('aria-hidden="true"');
  });

  it("renders definition rows as a list with a term heading each", () => {
    const out = html(
      createElement(DefinitionRows, {
        rows: [
          { key: "a", term: "A", detail: "da" },
          { key: "b", term: "B", detail: "db" },
        ],
      }),
    );
    expect(out.match(/<li/g)).toHaveLength(2);
    expect(out.match(/<h3/g)).toHaveLength(2);
  });
});
