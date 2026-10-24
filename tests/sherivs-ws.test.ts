import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { CATALOG, FAMILIES, computeWorkspace, denialReason, sanitizePrefs } from "@/lib/sherivs-ws/engine";
import { PERSONAS, manifestFor, persona, inputFor } from "@/lib/sherivs-ws/personas";
import { fromServer, type ServerManifest } from "@/lib/sherivs-ws/server-adapter";
import { LOCALES, t } from "@/lib/sherivs-ws/i18n";

const MIG = "database/supabase/migrations/";
const s017 = fs.readFileSync(MIG + fs.readdirSync(MIG).find((f) => f.includes("sherivs_017_role_permission_catalog"))!, "utf8");
const ux1 = fs.readFileSync(MIG + "20261024000500_sherivs_ux1_workspace_manifest.sql", "utf8");
const PERMS = new Set([...s017.matchAll(/^\s*\('([a-z_]+\.[a-z_]+)','[a-z_]+','/gm)].map((m) => m[1]));
const TEMPLATES = new Set([...s017.slice(s017.indexOf("INSERT INTO public.role_templates")).matchAll(/^\s*\('([a-z_]+)','(org|campus|faculty|department|class|self)'/gm)].map((m) => m[1]));

describe("workspace catalog", () => {
  it("references only real permissions and role templates", () => {
    expect(PERMS.size).toBeGreaterThan(80);
    for (const i of CATALOG) for (const p of [...i.any, ...i.all]) expect(PERMS.has(p), `${i.key} -> ${p}`).toBe(true);
    for (const f of FAMILIES) for (const tpl of f.templates) expect(TEMPLATES.has(tpl), `${f.family} -> ${tpl}`).toBe(true);
  });
  it("covers every role template with a family (no template falls to the generic layout by accident)", () => {
    const mapped = new Set(FAMILIES.flatMap((f) => f.templates));
    const unmapped = [...TEMPLATES].filter((x) => !mapped.has(x));
    expect(unmapped.sort()).toEqual(["catering", "ict_head", "ict_staff", "legal", "pr", "support_staff", "works"].filter((x) => TEMPLATES.has(x)).sort());
  });
  it("SQL seed in the migration matches the generator output", () => {
    const gen = fs.readFileSync("tools/workspace/seed.generated.sql", "utf8").trim();
    expect(ux1).toContain(gen);
  });
  it("has labels in all five languages", () => {
    for (const i of CATALOG) for (const l of LOCALES) expect(i.label[l.code], `${i.key}/${l.code}`).toBeTruthy();
    for (const l of LOCALES) expect(t(l.code, "quick_actions")).toBeTruthy();
  });
});

describe("workspace engine", () => {
  it("hides every item whose permission is missing", () => {
    for (const p of PERSONAS) {
      const inp = inputFor(p); const have = new Set(inp.permissions.map((x) => x.code)); const m = computeWorkspace(inp);
      for (const w of [...m.widgets, ...m.nav, ...m.actions, ...m.inbox, ...m.available]) {
        const c = CATALOG.find((x) => x.key === w.key)!;
        expect(!c.any.length || c.any.some((x) => have.has(x)), `${p.id} ${w.key}`).toBe(true);
        expect(c.all.every((x) => have.has(x))).toBe(true);
        if (c.feature) expect(inp.org.features).toContain(c.feature);
      }
    }
  });
  it("gives each major role family its own default home", () => {
    const fam: Record<string, string> = { proprietor: "proprietor", principal: "principal", bursar: "bursar", registrar: "registrar", hod: "hod", "teacher-a": "teacher",
      "teacher-b": "form_teacher", "form-teacher": "form_teacher", exams: "exams", hr: "hr", nurse: "nurse", librarian: "librarian", hostel: "hostel",
      transport: "transport", security: "security", parent: "parent", student: "student", gov: "gov" };
    for (const p of PERSONAS) { const m = manifestFor(p); expect(m.primaryFamily, p.id).toBe(fam[p.id]); expect(m.widgets.length, p.id).toBeGreaterThan(1); }
  });
  it("two maths teachers in different schools see different workspaces", () => {
    const a = manifestFor(persona("teacher-a")), b = manifestFor(persona("teacher-b"));
    const ka = a.widgets.map((w) => w.key), kb = b.widgets.map((w) => w.key);
    expect(ka).toContain("w.cbt_sessions"); expect(kb).not.toContain("w.cbt_sessions");          // school B switched off optional cbt.manage
    expect(ka).toContain("w.ai_lesson_helper"); expect(kb).not.toContain("w.ai_lesson_helper");  // AI only on growth plan
    expect(kb[0]).toBe("w.form_class"); expect(ka).not.toContain("w.form_class");                // B also holds the form-teacher role
    expect(a.actions.map((x) => x.key)).toContain("a.new_cbt"); expect(b.actions.map((x) => x.key)).not.toContain("a.new_cbt"); expect(b.actions.map((x) => x.key)).toContain("a.message_parents");
    expect(a.widgets.find((w) => w.key === "w.today_classes")!.scope).toEqual(["level: JSS2", "subject: Mathematics"]);
  });
  it("never lets a teacher see finance or payroll approval", () => {
    const m = manifestFor(persona("teacher-a"));
    for (const k of ["w.fee_collection", "w.payroll_run", "a.approve_payroll", "nav.roles"]) expect([...m.widgets, ...m.actions, ...m.nav, ...m.available].some((x) => x.key === k)).toBe(false);
    expect(denialReason(CATALOG.find((c) => c.key === "a.approve_payroll")!, new Set(["grades.enter"]), new Set(["payroll"]))).toBe("permission");
  });
  it("personalises only within the allowed set", () => {
    const p = persona("teacher-b"); const m = manifestFor(p);
    const clean = sanitizePrefs({ added: ["w.payroll_run", "w.announcements"], hidden: ["w.today_classes"], actions: ["a.approve_payroll", "a.take_attendance"] }, m);
    expect(clean.added).toEqual(["w.announcements"]); expect(clean.actions).toEqual(["a.take_attendance"]);
    const m2 = manifestFor(p, { ...clean, order: ["w.grading_queue"] });
    expect(m2.widgets[0].key).toBe("w.grading_queue"); expect(m2.widgets.some((w) => w.key === "w.today_classes")).toBe(false);
    const m3 = manifestFor(p, { added: ["w.payroll_run"] }); expect(m3.widgets.some((w) => w.key === "w.payroll_run")).toBe(false);
  });
  it("localises labels", () => {
    const m = manifestFor(persona("parent"), { locale: "ha" });
    expect(m.actions[0].label).toBe("Biya kuɗin makaranta");
  });
  it("live adapter keeps the server's decision and drops unknown keys", () => {
    const s: ServerManifest = { version: 1, org_id: "o", families: ["teacher"], primary_family: "teacher", features: [], locale: "yo", density: "comfortable", scopes: [],
      nav: [{ key: "nav.attendance" }, { key: "nav.home" }], widgets: [{ key: "w.today_classes" }, { key: "w.does_not_exist" }], available: [], actions: [{ key: "a.take_attendance" }], inbox: [], hidden_by_policy: 0 };
    const m = fromServer(s, { name: "X", plan: "starter" });
    expect(m.widgets.map((w) => w.key)).toEqual(["w.today_classes"]); expect(m.nav[0].key).toBe("nav.home"); expect(m.actions[0].label).toBe("Pe orúkọ");
  });
});

// WCAG 2.x relative luminance contrast for the design tokens
const css = fs.readFileSync("frontend/src/components/sds/sds.css", "utf8");
function tokens(block: string) { return Object.fromEntries([...block.matchAll(/--sds-([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]])); }
const lum = (hex: string) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
describe("design tokens meet WCAG AA", () => {
  const light = tokens(css.slice(css.indexOf(".sds {"), css.indexOf(".sds[data-theme")));
  const dark = { ...light, ...tokens(css.slice(css.indexOf('.sds[data-theme="dark"]'), css.indexOf(".sds[data-density"))) };
  for (const [name, T] of [["light", light], ["dark", dark]] as const) {
    it(`${name}: text pairs >= 4.5:1`, () => {
      for (const [fg, bg] of [["text", "bg"], ["text", "surface"], ["text-2", "surface"], ["text-2", "bg"], ["primary-text", "primary"], ["primary", "surface"], ["primary", "primary-soft"],
        ["warn", "warn-bg"], ["chip-text", "chip"], ["danger", "surface"], ["info", "surface"]]) expect(ratio(T[fg], T[bg]), `${name} ${fg}/${bg}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});
