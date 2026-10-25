import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  CATALOG,
  FAMILIES,
  computeWorkspace,
  denialReason,
  sanitizePrefs,
} from "@/lib/sherivs-ws/engine";
import { PERSONAS, manifestFor, persona, inputFor } from "@/lib/sherivs-ws/personas";
import { fromServer, type ServerManifest } from "@/lib/sherivs-ws/server-adapter";
import { LOCALES, t } from "@/lib/sherivs-ws/i18n";

const MIG = "database/supabase/migrations/";
const s017 = fs.readFileSync(
  MIG + fs.readdirSync(MIG).find((f) => f.includes("sherivs_017_role_permission_catalog"))!,
  "utf8",
);
const ux1 = fs.readFileSync(MIG + "20261025100210_sherivs_ux1_workspace_manifest.sql", "utf8");
const PERMS = new Set(
  [...s017.matchAll(/^\s*\('([a-z_]+\.[a-z_]+)','[a-z_]+','/gm)].map((m) => m[1]),
);
const TEMPLATES = new Set(
  [
    ...s017
      .slice(s017.indexOf("INSERT INTO public.role_templates"))
      .matchAll(/^\s*\('([a-z_]+)','(org|campus|faculty|department|class|self)'/gm),
  ].map((m) => m[1]),
);

describe("workspace catalog", () => {
  it("references only real permissions and role templates", () => {
    expect(PERMS.size).toBeGreaterThan(80);
    for (const i of CATALOG)
      for (const p of [...i.any, ...i.all]) expect(PERMS.has(p), `${i.key} -> ${p}`).toBe(true);
    for (const f of FAMILIES)
      for (const tpl of f.templates) expect(TEMPLATES.has(tpl), `${f.family} -> ${tpl}`).toBe(true);
  });
  it("covers every role template with a family (no template falls to the generic layout by accident)", () => {
    const mapped = new Set(FAMILIES.flatMap((f) => f.templates));
    const unmapped = [...TEMPLATES].filter((x) => !mapped.has(x));
    expect(unmapped.sort()).toEqual(
      ["catering", "ict_head", "ict_staff", "legal", "pr", "support_staff", "works"]
        .filter((x) => TEMPLATES.has(x))
        .sort(),
    );
  });
  it("SQL seed in the migration matches the generator output", () => {
    const gen = fs.readFileSync("tools/workspace/seed.generated.sql", "utf8").trim();
    expect(ux1).toContain(gen);
  });
  it("has labels in all five languages", () => {
    for (const i of CATALOG)
      for (const l of LOCALES) expect(i.label[l.code], `${i.key}/${l.code}`).toBeTruthy();
    for (const l of LOCALES) expect(t(l.code, "quick_actions")).toBeTruthy();
  });
});

describe("workspace engine", () => {
  it("hides every item whose permission is missing", () => {
    for (const p of PERSONAS) {
      const inp = inputFor(p);
      const have = new Set(inp.permissions.map((x) => x.code));
      const m = computeWorkspace(inp);
      for (const w of [...m.widgets, ...m.nav, ...m.actions, ...m.inbox, ...m.available]) {
        const c = CATALOG.find((x) => x.key === w.key)!;
        expect(!c.any.length || c.any.some((x) => have.has(x)), `${p.id} ${w.key}`).toBe(true);
        expect(c.all.every((x) => have.has(x))).toBe(true);
        if (c.feature) expect(inp.org.features).toContain(c.feature);
      }
    }
  });
  it("gives each major role family its own default home", () => {
    const fam: Record<string, string> = {
      proprietor: "proprietor",
      principal: "principal",
      bursar: "bursar",
      registrar: "registrar",
      hod: "hod",
      "teacher-a": "teacher",
      "teacher-b": "form_teacher",
      "form-teacher": "form_teacher",
      exams: "exams",
      hr: "hr",
      nurse: "nurse",
      librarian: "librarian",
      hostel: "hostel",
      transport: "transport",
      security: "security",
      parent: "parent",
      student: "student",
      gov: "gov",
    };
    for (const p of PERSONAS) {
      const m = manifestFor(p);
      expect(m.primaryFamily, p.id).toBe(fam[p.id]);
      expect(m.widgets.length, p.id).toBeGreaterThan(1);
    }
  });
  it("two maths teachers in different schools see different workspaces", () => {
    const a = manifestFor(persona("teacher-a")),
      b = manifestFor(persona("teacher-b"));
    const ka = a.widgets.map((w) => w.key),
      kb = b.widgets.map((w) => w.key);
    expect(ka).toContain("w.cbt_sessions");
    expect(kb).not.toContain("w.cbt_sessions"); // school B switched off optional cbt.manage
    expect(ka).toContain("w.ai_lesson_helper");
    expect(kb).not.toContain("w.ai_lesson_helper"); // AI only on growth plan
    expect(kb[0]).toBe("w.form_class");
    expect(ka).not.toContain("w.form_class"); // B also holds the form-teacher role
    expect(a.actions.map((x) => x.key)).toContain("a.new_cbt");
    expect(b.actions.map((x) => x.key)).not.toContain("a.new_cbt");
    expect(b.actions.map((x) => x.key)).toContain("a.message_parents");
    expect(a.widgets.find((w) => w.key === "w.today_classes")!.scope).toEqual([
      "level: JSS2",
      "subject: Mathematics",
    ]);
  });
  it("never lets a teacher see finance or payroll approval", () => {
    const m = manifestFor(persona("teacher-a"));
    for (const k of ["w.fee_collection", "w.payroll_run", "a.approve_payroll", "nav.roles"])
      expect([...m.widgets, ...m.actions, ...m.nav, ...m.available].some((x) => x.key === k)).toBe(
        false,
      );
    expect(
      denialReason(
        CATALOG.find((c) => c.key === "a.approve_payroll")!,
        new Set(["grades.enter"]),
        new Set(["payroll"]),
      ),
    ).toBe("permission");
  });
  it("personalises only within the allowed set", () => {
    const p = persona("teacher-b");
    const m = manifestFor(p);
    const clean = sanitizePrefs(
      {
        added: ["w.payroll_run", "w.announcements"],
        hidden: ["w.today_classes"],
        actions: ["a.approve_payroll", "a.take_attendance"],
      },
      m,
    );
    expect(clean.added).toEqual(["w.announcements"]);
    expect(clean.actions).toEqual(["a.take_attendance"]);
    const m2 = manifestFor(p, { ...clean, order: ["w.grading_queue"] });
    expect(m2.widgets[0].key).toBe("w.grading_queue");
    expect(m2.widgets.some((w) => w.key === "w.today_classes")).toBe(false);
    const m3 = manifestFor(p, { added: ["w.payroll_run"] });
    expect(m3.widgets.some((w) => w.key === "w.payroll_run")).toBe(false);
  });
  it("localises labels", () => {
    const m = manifestFor(persona("parent"), { locale: "ha" });
    expect(m.actions[0].label).toBe("Biya kuɗin makaranta");
  });
  it("live adapter keeps the server's decision and drops unknown keys", () => {
    const s: ServerManifest = {
      version: 1,
      org_id: "o",
      families: ["teacher"],
      primary_family: "teacher",
      features: [],
      locale: "yo",
      density: "comfortable",
      scopes: [],
      nav: [{ key: "nav.attendance" }, { key: "nav.home" }],
      widgets: [{ key: "w.today_classes" }, { key: "w.does_not_exist" }],
      available: [],
      actions: [{ key: "a.take_attendance" }],
      inbox: [],
      hidden_by_policy: 0,
    };
    const m = fromServer(s, { name: "X", plan: "starter" });
    expect(m.widgets.map((w) => w.key)).toEqual(["w.today_classes"]);
    expect(m.nav[0].key).toBe("nav.home");
    expect(m.actions[0].label).toBe("Pe orúkọ");
  });
});

// WCAG 2.x relative luminance contrast for the design tokens
const css = fs.readFileSync("frontend/src/components/sds/sds.css", "utf8");
function tokens(block: string) {
  return Object.fromEntries(
    [...block.matchAll(/--sds-([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
  );
}
const lum = (hex: string) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
describe("design tokens meet WCAG AA", () => {
  const light = tokens(css.slice(css.indexOf(".sds {"), css.indexOf(".sds[data-theme")));
  const dark = {
    ...light,
    ...tokens(css.slice(css.indexOf('.sds[data-theme="dark"]'), css.indexOf(".sds[data-density"))),
  };
  for (const [name, T] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    it(`${name}: text pairs >= 4.5:1`, () => {
      for (const [fg, bg] of [
        ["text", "bg"],
        ["text", "surface"],
        ["text-2", "surface"],
        ["text-2", "bg"],
        ["primary-text", "primary"],
        ["primary", "surface"],
        ["primary", "primary-soft"],
        ["warn", "warn-bg"],
        ["chip-text", "chip"],
        ["danger", "surface"],
        ["info", "surface"],
      ])
        expect(ratio(T[fg], T[bg]), `${name} ${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

// ---- SHERIVS-UX2: scope- and policy-aware workspaces -------------------------------------------------
import { POLICIES, focusScope, scopeFocusOptions } from "@/lib/sherivs-ws/engine";
const ux2 = fs.readFileSync(MIG + "20261025100220_sherivs_ux2_scope_policy_workspace.sql", "utf8");
const DIMS = [
  "campus",
  "shift",
  "section",
  "gender",
  "level",
  "class",
  "subject",
  "house",
  "hostel",
];
describe("UX2 scope and policy layer", () => {
  it("UX2 SQL block matches the generator and every gate is real", () => {
    expect(ux2).toContain(fs.readFileSync("tools/workspace/seed-ux2.generated.sql", "utf8").trim());
    const pol = new Set(POLICIES.map((p) => p.key));
    for (const i of CATALOG) {
      if (i.policy) expect(pol.has(i.policy), i.key).toBe(true);
      for (const d of i.scopeDims) expect(DIMS, i.key).toContain(d);
    }
  });
  it("same role, different scopes -> different homes, scope cards right after the lead card", () => {
    const a = manifestFor(persona("teacher-a")); // level + subject
    const b = manifestFor(persona("teacher-b")); // level + subject + shift + class
    expect(a.widgets[1].key).toBe("w.level_overview");
    expect(b.widgets.map((w) => w.key)).toContain("w.shift_overview");
    expect(a.widgets.map((w) => w.key)).not.toContain("w.shift_overview");
    expect(b.scopeOptions.shift).toEqual(["Morning"]);
    const principal = manifestFor(persona("principal")); // whole-school, no scope sets
    expect(
      principal.widgets.some((w) => CATALOG.find((c) => c.key === w.key)!.scopeDims.length > 0),
    ).toBe(false);
    expect(principal.hiddenByPolicy.find((h) => h.key === "w.campus_overview")?.reason).toBe(
      "scope",
    );
  });
  it("school policies hide items (never grant) and can lock personalisation", () => {
    const p = persona("student");
    const on = computeWorkspace(inputFor(p));
    expect(on.widgets.map((w) => w.key)).toContain("w.ai_tutor");
    const inp = inputFor(p);
    const off = computeWorkspace({
      ...inp,
      org: {
        ...inp.org,
        policies: POLICIES.filter(
          (x) => x.key !== "students.ai_tutor" && x.key !== "workspace.personalise",
        ).map((x) => x.key),
      },
      prefs: { hidden: ["w.announcements"], locale: "yo" },
    });
    expect(
      [...off.widgets, ...off.nav, ...off.actions, ...off.available].some(
        (w) => w.key.includes("ai_tutor") || w.key === "a.ask_tutor",
      ),
    ).toBe(false);
    expect(off.hiddenByPolicy.find((h) => h.key === "w.ai_tutor")?.reason).toBe("policy");
    expect(off.canPersonalise).toBe(false);
    expect(off.widgets.map((w) => w.key)).toContain("w.announcements"); // stored "hide" ignored when locked
    expect(off.locale).toBe("yo");
    expect(sanitizePrefs({ hidden: ["w.my_cbt"], locale: "ha" }, off)).toEqual({
      locale: "ha",
      density: undefined,
    });
    // a policy can never add something the permissions do not allow
    const teacher = computeWorkspace(inputFor(persona("teacher-a")));
    expect(teacher.widgets.map((w) => w.key)).not.toContain("w.ai_tutor");
  });
  it("scope focus narrows scope cards and tags links, ignores scopes the user does not hold", () => {
    const m = manifestFor(persona("teacher-b"));
    const opts = scopeFocusOptions(m);
    expect(opts).toContainEqual({ dim: "shift", ref: "Morning" });
    const f = focusScope(m, { dim: "shift", ref: "Morning" });
    expect(f.widgets.some((w) => w.key === "w.level_overview")).toBe(false);
    expect(f.widgets.find((w) => w.key === "w.shift_overview")!.to).toContain(
      "scope=shift%3AMorning",
    );
    expect(focusScope(m, { dim: "campus", ref: "Elsewhere" })).toBe(m);
  });
  it("server v2 manifest maps scope, policies and lock flag", () => {
    const s: ServerManifest = {
      version: 2,
      org_id: "o",
      families: ["teacher"],
      primary_family: "teacher",
      features: [],
      locale: "en",
      density: "comfortable",
      scopes: [],
      nav: [{ key: "nav.home" }],
      widgets: [
        { key: "w.level_overview", scope: { level: ["JSS2"] } },
        { key: "w.today_classes" },
      ],
      available: [],
      actions: [],
      inbox: [],
      hidden_by_policy: 0,
      policies: ["staff.ai_helper"],
      can_personalise: false,
      scope_options: { level: ["JSS2"] },
    };
    const m = fromServer(s, { name: "X", plan: "starter" });
    expect(m.widgets[0].scopeDims).toEqual({ level: ["JSS2"] });
    expect(m.canPersonalise).toBe(false);
    expect(m.scopeOptions).toEqual({ level: ["JSS2"] });
  });
});

// ---- SHERIVS-UX3: live card data + ?scope= on target pages ---------------------------------------------
import { filterByScope, parseScopeParam, scopeLabel } from "@/lib/sherivs-ws/live";
const ux3 = fs.readFileSync(MIG + "20261025100230_sherivs_ux3_workspace_live_data.sql", "utf8");
describe("UX3 live data and scope links", () => {
  it("migrations sort after Track E (#120)", () => {
    const files = fs
      .readdirSync(MIG)
      .filter((f) => /sherivs_(ux\d|e_)/.test(f))
      .sort();
    expect(files.slice(-3).map((f) => f.slice(0, 14))).toEqual([
      "20261025100210",
      "20261025100220",
      "20261025100230",
    ]);
    expect(files.indexOf("20261024000920_sherivs_e_load_indexes.sql")).toBeLessThan(
      files.indexOf("20261025100210_sherivs_ux1_workspace_manifest.sql"),
    );
  });
  it("card data and scope resolution run under the caller's RLS (SECURITY INVOKER)", () => {
    for (const fn of [
      "workspace_widget_data",
      "workspace_scope_resolve",
      "workspace_scope_class_ids",
    ]) {
      const body = ux3.slice(ux3.indexOf(`FUNCTION public.${fn}(`));
      const head = body.slice(0, body.indexOf("AS $$"));
      expect(head, fn).toContain("SECURITY INVOKER");
    }
    expect(ux3).toContain("workspace_item_allowed(p_org, v_k)");
    expect(ux3).not.toMatch(/GRANT EXECUTE[^;]*TO[^;]*\banon\b/);
  });
  it("every card key the server wires exists in the catalog", () => {
    const wired = [...ux3.matchAll(/'(w\.[a-z_]+)'/g)].map((m) => m[1]);
    for (const k of wired)
      expect(
        CATALOG.some((c) => c.key === k),
        k,
      ).toBe(true);
    expect(new Set(wired).size).toBeGreaterThanOrEqual(25);
  });
  it("parses ?scope= strictly and filters rows by resolved classes", () => {
    expect(parseScopeParam("campus:abc-1")).toEqual({ dim: "campus", ref: "abc-1" });
    for (const bad of ["", "campus", ":x", "campus:", "Campus;drop:1", 5, null])
      expect(parseScopeParam(bad)).toBeNull();
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(
      filterByScope(
        rows,
        { focused: true, class_ids: ["b"], scope: { campus: ["x"] }, subjects: null, labels: {} },
        (r) => r.id,
      ),
    ).toEqual([{ id: "b" }]);
    expect(
      filterByScope(
        rows,
        { focused: false, class_ids: null, scope: null, subjects: null, labels: {} },
        (r) => r.id,
      ),
    ).toBe(rows);
    expect(scopeLabel({ campus: { x: "Ajah Annex" } }, { dim: "campus", ref: "x" })).toBe(
      "campus: Ajah Annex",
    );
  });
});
