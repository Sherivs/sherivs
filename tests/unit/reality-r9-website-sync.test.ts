/**
 * SV1-REALITY R9 (#335) — approved school reality -> existing website generator inputs.
 * Pure module tests (seeded PRNG) plus source-level guards on the server boundary.
 * Synthetic data only; no database, network or AI.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TYPE_QUESTION_ID,
  applyAnswer,
  approveInterview,
  approvedSnapshot,
  emptyInterview,
  nextQuestion,
  type ApprovedAnswer,
  type DiscoveryAnswer,
  type DiscoveryQuestion,
  type InterviewState,
} from "../../frontend/src/lib/scholar/reality";
import { generateSite, orgKind, type Facts } from "../../frontend/src/lib/website/generator";
import { validateDocument } from "../../frontend/src/lib/website/validate";
import {
  SUPPORTED_WEBSITE_FIELDS,
  planRealitySync,
} from "../../frontend/src/lib/website/reality-sync";

const T0 = 1_800_000_000_000;
const H = (questionId: string, value: DiscoveryAnswer["value"]): DiscoveryAnswer => ({
  questionId,
  state: "confirmed",
  value,
  source: "human",
});
function must(state: InterviewState, a: DiscoveryAnswer): InterviewState {
  const r = applyAnswer(state, a, T0);
  if (!r.ok) throw new Error(`${a.questionId}: ${r.issues.map((i) => i.code).join(",")}`);
  return r.state;
}
function validValue(q: DiscoveryQuestion): DiscoveryAnswer["value"] {
  const v = q.validation;
  switch (q.answerType) {
    case "single":
      return v.options![0];
    case "multi":
      return [v.options![0]];
    case "bool":
      return true;
    case "number":
      return Math.min(Math.max(v.min ?? 1, 1), v.max ?? 1000);
    case "repeating_group":
    case "hierarchy":
      return ["Main campus"];
    case "date":
      return "2026-09-01";
    case "time":
      return "08:00";
    default:
      return "Head teacher";
  }
}
/** Approved interview for a type; `overrides` replace the generic answer for given question ids. */
function approved(type: string, overrides: Record<string, DiscoveryAnswer["value"]> = {}) {
  let s = must(emptyInterview(T0), H(TYPE_QUESTION_ID, type));
  for (let i = 0; i < 60; i++) {
    const q = nextQuestion(s);
    if (!q || !q.required) break;
    s = must(s, H(q.id, q.id in overrides ? overrides[q.id] : validValue(q)));
  }
  const r = approveInterview(s, "admin-1", T0);
  if (!r.ok) throw new Error("not approvable: " + JSON.stringify(r));
  return r.state;
}
const BASE: Facts = {
  data: { school: { name: "Demo Academy", slug: "demo-academy" } },
  onboarding: null,
};
const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
};

describe("R9: only approved, public-safe, supported answers reach the generator inputs", () => {
  it("an unapproved interview contributes nothing", () => {
    let s = must(emptyInterview(T0), H(TYPE_QUESTION_ID, "primary"));
    expect(approvedSnapshot(s)).toEqual([]);
    const plan = planRealitySync(approvedSnapshot(s), BASE);
    expect(plan.applied).toEqual([]);
    expect(plan.facts.onboarding).toEqual({});
    // an edit after approval withdraws it again
    s = approved("primary");
    expect(approvedSnapshot(s).length).toBeGreaterThan(0);
    const edited = must(s, H(TYPE_QUESTION_ID, "secondary"));
    expect(planRealitySync(approvedSnapshot(edited), BASE).applied).toEqual([]);
  });

  it("primary approves into the nursery & primary vocabulary through orgKind", () => {
    const plan = planRealitySync(approvedSnapshot(approved("primary")), BASE);
    expect(plan.applied.map((a) => a.websiteField)).toEqual(
      expect.arrayContaining(["institution_type", "levels_offered"]),
    );
    expect(orgKind(plan.facts)).toBe("nursery_primary");
    const doc = generateSite(plan.facts);
    expect(validateDocument(doc)).toEqual([]);
  });

  it("secondary approves into the secondary vocabulary", () => {
    const plan = planRealitySync(approvedSnapshot(approved("secondary")), BASE);
    expect(orgKind(plan.facts)).toBe("secondary");
    expect(plan.applied.map((a) => a.websiteField)).toContain("institution_type");
  });

  it("public-safe answers with no existing site field are reported, not published", () => {
    const snap = approvedSnapshot(approved("secondary"));
    const plan = planRealitySync(snap, BASE);
    const keys = plan.notSupported.map((n) => n.websiteField);
    expect(keys).toEqual(expect.arrayContaining(["campus_count"]));
    for (const k of keys) expect(SUPPORTED_WEBSITE_FIELDS).not.toContain(k);
    // the campus count value is nowhere in what the generator receives
    expect(JSON.stringify(plan.facts.onboarding)).not.toContain("campus");
  });

  it("private answers never reach the facts or the generated site", () => {
    const SENTINEL = "ZZ-PRIVATE-SENTINEL-9731";
    const snap = approvedSnapshot(approved("primary", { "core.human.leadership_title": SENTINEL }));
    // make sure the sentinel really is an approved answer that is simply not public-safe
    const priv = snap.filter((a) => JSON.stringify(a.value).includes(SENTINEL));
    const plan = planRealitySync(snap, BASE);
    if (priv.length > 0) {
      expect(priv.every((a) => !a.publicSafe)).toBe(true);
      expect(plan.withheldCount).toBeGreaterThan(0);
    }
    expect(JSON.stringify(plan)).not.toContain(SENTINEL);
    expect(JSON.stringify(generateSite(plan.facts))).not.toContain(SENTINEL);
    expect(plan.withheldCount).toBeGreaterThan(0);
  });

  it("withheld answers are only counted, never listed", () => {
    const plan = planRealitySync(approvedSnapshot(approved("primary")), BASE);
    expect(Object.keys(plan)).toEqual(
      expect.arrayContaining(["applied", "notSupported", "withheldCount"]),
    );
    const listed = [...plan.applied, ...plan.notSupported].map((x) => x.websiteField);
    const nonPublic = approvedSnapshot(approved("primary")).filter((a) => !a.publicSafe);
    expect(nonPublic.length).toBeGreaterThan(0);
    for (const a of nonPublic) expect(listed).not.toContain(a.questionId);
  });

  it("does not mutate the base facts", () => {
    const base = deepFreeze<Facts>({
      data: { school: { name: "Demo", slug: "demo" } },
      onboarding: { organisation: { state: "Lagos" }, institution: { bands: ["jss"] } },
    });
    const plan = planRealitySync(approvedSnapshot(approved("primary")), base);
    expect(base.onboarding).toEqual({
      organisation: { state: "Lagos" },
      institution: { bands: ["jss"] },
    });
    // unrelated base keys survive the overlay
    expect((plan.facts.onboarding as Record<string, { state?: string }>).organisation.state).toBe(
      "Lagos",
    );
  });

  it("a hostile website field key cannot reach Object.prototype or crash", () => {
    const evil: ApprovedAnswer[] = ["__proto__", "constructor", "toString", "hasOwnProperty"].map(
      (k, i) => ({
        questionId: `x.${i}`,
        value: "secondary",
        configPath: "x",
        entityType: "x",
        publicSafe: true,
        websiteField: k,
      }),
    );
    const plan = planRealitySync(evil, BASE);
    expect(plan.applied).toEqual([]);
    expect(plan.notSupported).toHaveLength(4);
    expect(({} as Record<string, unknown>).org_type).toBeUndefined();
  });

  it("answers flagged not public-safe are withheld even if they carry a field key", () => {
    const sneaky: ApprovedAnswer[] = [
      {
        questionId: "a.b",
        value: "secondary",
        configPath: "x",
        entityType: "x",
        publicSafe: false,
        websiteField: "institution_type",
      },
    ];
    const plan = planRealitySync(sneaky, BASE);
    expect(plan.applied).toEqual([]);
    expect(plan.withheldCount).toBe(1);
  });

  it("unusable values are not applied", () => {
    const mk = (field: string, value: ApprovedAnswer["value"]): ApprovedAnswer => ({
      questionId: "q." + field,
      value,
      configPath: "x",
      entityType: "x",
      publicSafe: true,
      websiteField: field,
    });
    const plan = planRealitySync(
      [
        mk("institution_type", "university"),
        mk("levels_offered", []),
        mk("levels_offered", ["nonsense"]),
      ],
      BASE,
    );
    expect(plan.applied).toEqual([]);
    expect(plan.facts.onboarding).toEqual({});
  });
});

describe("R9: plan hash binds the preview", () => {
  it("is independent of snapshot order and changes with the approved content", () => {
    const a = approvedSnapshot(approved("primary"));
    const h1 = planRealitySync(a, BASE).planHash;
    expect(planRealitySync([...a].reverse(), BASE).planHash).toBe(h1);
    expect(h1).toMatch(/^[0-9a-f]{8}$/);
    const b = approvedSnapshot(approved("secondary"));
    expect(planRealitySync(b, BASE).planHash).not.toBe(h1);
    const base2: Facts = { ...BASE, onboarding: { organisation: { state: "Kano" } } };
    expect(planRealitySync(a, base2).planHash).not.toBe(h1);
  });
});

describe("R9: seeded random subsets keep the invariants (2000 runs)", () => {
  it("applied fields are always supported, public-safe and never exceed the overlay keys", () => {
    let seed = 0x9e3779b9;
    const rnd = () => (seed = Math.imul(seed ^ (seed >>> 15), 0x85ebca6b) >>> 0) / 2 ** 32;
    const pools = [
      approvedSnapshot(approved("primary")),
      approvedSnapshot(approved("secondary")),
      approvedSnapshot(approved("creche")),
    ];
    for (let i = 0; i < 2000; i++) {
      const pool = pools[Math.floor(rnd() * pools.length)];
      const subset = pool
        .filter(() => rnd() < 0.6)
        .map((a) => (rnd() < 0.15 ? { ...a, publicSafe: false } : a));
      const plan = planRealitySync(subset, BASE);
      for (const x of plan.applied) {
        expect(SUPPORTED_WEBSITE_FIELDS).toContain(x.websiteField);
        const src = subset.find((s) => s.questionId === x.questionId)!;
        expect(src.publicSafe).toBe(true);
      }
      const keys = Object.keys(plan.facts.onboarding ?? {});
      for (const k of keys) expect(["organisation", "institution"]).toContain(k);
      expect(
        plan.applied.length + plan.notSupported.length + plan.withheldCount,
      ).toBeLessThanOrEqual(subset.length);
    }
  });
});

describe("R9 server boundary (source level)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../frontend/src/lib/runtime/scholar/reality-website.functions.ts"),
    "utf8",
  );
  it("both endpoints are behind the auth middleware and the school-admin scope", () => {
    expect((src.match(/createServerFn\(\{ method: "POST" \}\)/g) ?? []).length).toBe(2);
    expect((src.match(/\.middleware\(\[requireSupabaseAuth\]\)/g) ?? []).length).toBe(2);
    expect((src.match(/await scope\(context\)/g) ?? []).length).toBe(2);
  });
  it("input is strict and carries only the preview hash", () => {
    expect(src).toMatch(/z\.object\(\{\}\)\.strict\(\)/);
    expect(src).toMatch(/planHash: z\.string\(\)\.regex\(\/\^\[0-9a-f\]\{8\}\$\/\)/);
    const block = src.slice(src.indexOf("publishWebsiteFromReality"));
    for (const bad of ["tenant", "schoolId: z", "document", "facts", "approv"]) {
      expect(block.slice(0, block.indexOf(".handler")).toLowerCase()).not.toContain(bad);
    }
  });
  it("is create-only and uses just the four existing website RPCs", () => {
    expect(src).toContain("p_expected_rev: 0");
    const rpcs = [...src.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(rpcs)).toEqual(
      new Set(["website_get", "website_facts", "website_save_draft", "website_publish"]),
    );
    expect(src).not.toMatch(/website_rollback|\.from\(|service[_-]?role|SERVICE_ROLE/);
  });
  it("re-derives on the server and refuses a stale preview before writing", () => {
    const i = src.indexOf("plan.planHash !== data.planHash");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(src.indexOf('"website_save_draft"'));
    expect(src).toMatch(/derive\(db, schoolId\)/);
  });
  it("derive refuses when the interview is not approved or a site already exists", () => {
    const d = src.slice(
      src.indexOf("async function derive"),
      src.indexOf("export const previewWebsite"),
    );
    expect(d.indexOf("approvedSnapshot")).toBeLessThan(d.indexOf('"website_get"'));
    expect(d.indexOf('"website_get"')).toBeLessThan(d.indexOf('"website_facts"'));
    expect(d).toContain('status: "not_approved"');
    expect(d).toContain('status: "website_exists"');
  });
});
