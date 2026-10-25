/**
 * Site generator (SPEC §6): organization reality → SiteDocument. Pure and deterministic.
 * Emits a block only when its guard passes on the facts, and a page only when it has blocks:
 * no placeholders, no invented claims. Nothing here is a per-school branch; vocabulary varies by kind.
 */
import { BLOCK_MAP } from "./catalog";
import { UI_STRINGS } from "./i18n";
import { themeFromBrand } from "./theme";
import {
  seedCalendar,
  seedCareers,
  seedDownloads,
  seedPolicies,
  seedPta,
  seedRules,
} from "./seed-content";
import type { Block, Locale, Localized, Page, Section, SiteData, SiteDocument } from "./types";

export type OrgKind =
  | "nursery_primary"
  | "secondary"
  | "k12"
  | "polytechnic"
  | "university"
  | "group"
  | "government"
  | "other";
export interface Facts {
  data: SiteData;
  /** onboarding_sessions.answers (latest). Optional: public fallback rendering has no answers. */
  onboarding?: Record<string, unknown> | null;
}

const PAGE_TITLES: Record<string, Record<Locale, string>> = {
  home: { en: "Home", ha: "Gida", yo: "Ilé", ig: "Ụlọ", pcm: "Home" },
  about: { en: "About us", ha: "Game da mu", yo: "Nípa wa", ig: "Maka anyị", pcm: "About us" },
  classes: {
    en: "Our classes",
    ha: "Azuzuwanmu",
    yo: "Àwọn kíláàsì wa",
    ig: "Klas anyị",
    pcm: "Our classes",
  },
  academics: { en: "Academics", ha: "Karatu", yo: "Ẹ̀kọ́", ig: "Agụmakwụkwọ", pcm: "Academics" },
  faculties: {
    en: "Faculties & programmes",
    ha: "Tsangayu da shirye-shirye",
    yo: "Àwọn ẹ̀ka àti ètò",
    ig: "Ngalaba na mmemme",
    pcm: "Faculties & programmes",
  },
  schools: {
    en: "Our schools",
    ha: "Makarantunmu",
    yo: "Àwọn ilé-ìwé wa",
    ig: "Ụlọ akwụkwọ anyị",
    pcm: "Our schools",
  },
  services: {
    en: "Agencies & services",
    ha: "Hukumomi da ayyuka",
    yo: "Àwọn ilé-iṣẹ́ àti iṣẹ́",
    ig: "Ụlọ ọrụ na ọrụ",
    pcm: "Agencies & services",
  },
  admissions: {
    en: "Admissions",
    ha: "Shiga makaranta",
    yo: "Ìgbàwọlé",
    ig: "Nnabata",
    pcm: "Admission",
  },
  life: {
    en: "School life",
    ha: "Rayuwar makaranta",
    yo: "Ìgbésí ayé ilé-ìwé",
    ig: "Ndụ ụlọ akwụkwọ",
    pcm: "School life",
  },
  campus_life: {
    en: "Campus life",
    ha: "Rayuwar harabar",
    yo: "Ìgbésí ayé ọgbà",
    ig: "Ndụ ogige",
    pcm: "Campus life",
  },
  news: {
    en: "News & events",
    ha: "Labarai da abubuwan da ke faruwa",
    yo: "Ìròyìn àti ìṣẹ̀lẹ̀",
    ig: "Akụkọ na mmemme",
    pcm: "News & events",
  },
  community: {
    en: "Alumni & giving",
    ha: "Tsofaffin ɗalibai da tallafi",
    yo: "Akẹ́kọ̀ọ́ àtijọ́ àti ẹ̀bùn",
    ig: "Ụmụ akwụkwọ mbụ na onyinye",
    pcm: "Old students & giving",
  },
  contact: { en: "Contact", ha: "Tuntuɓa", yo: "Ìkànsí", ig: "Kpọtụrụ", pcm: "Contact" },
  policies: {
    en: "Rules & policies",
    ha: "Dokoki da manufofi",
    yo: "Òfin àti ìlànà",
    ig: "Iwu na usoro",
    pcm: "Rules & policies",
  },
  parents: { en: "Parents", ha: "Iyaye", yo: "Òbí", ig: "Ndị nne na nna", pcm: "Parents" },
  resources: {
    en: "Resources",
    ha: "Albarkatu",
    yo: "Àwọn ohun èlò",
    ig: "Akụrụngwa",
    pcm: "Resources",
  },
  careers: { en: "Careers", ha: "Ayyuka", yo: "Iṣẹ́", ig: "Ọrụ", pcm: "Work with us" },
};
const KIND_LABEL: Record<OrgKind, Localized> = {
  nursery_primary: {
    en: "Nursery & primary school",
    ha: "Makarantar reno da firamare",
    yo: "Ilé-ìwé jẹ́lé-ó-sinmi àti alákọ̀ọ́bẹ̀rẹ̀",
    ig: "Ụlọ akwụkwọ ọta akara na praịmarị",
    pcm: "Nursery & primary school",
  },
  secondary: {
    en: "Secondary school",
    ha: "Makarantar sakandare",
    yo: "Ilé-ìwé girama",
    ig: "Ụlọ akwụkwọ sekọndrị",
    pcm: "Secondary school",
  },
  k12: {
    en: "Nursery, primary & secondary school",
    ha: "Makarantar reno, firamare da sakandare",
    yo: "Ilé-ìwé jẹ́lé-ó-sinmi, alákọ̀ọ́bẹ̀rẹ̀ àti girama",
    ig: "Ụlọ akwụkwọ ọta akara, praịmarị na sekọndrị",
    pcm: "Nursery, primary & secondary school",
  },
  polytechnic: {
    en: "Polytechnic",
    ha: "Kwalejin fasaha",
    yo: "Ilé-ẹ̀kọ́ gíga polytechnic",
    ig: "Polytechnic",
    pcm: "Polytechnic",
  },
  university: {
    en: "University",
    ha: "Jami'a",
    yo: "Yunifásítì",
    ig: "Mahadum",
    pcm: "University",
  },
  group: {
    en: "Group of schools",
    ha: "Rukunin makarantu",
    yo: "Ẹgbẹ́ ilé-ìwé",
    ig: "Otu ụlọ akwụkwọ",
    pcm: "Group of schools",
  },
  government: {
    en: "Government agency",
    ha: "Hukumar gwamnati",
    yo: "Ilé-iṣẹ́ ìjọba",
    ig: "Ụlọ ọrụ gọọmentị",
    pcm: "Government agency",
  },
  other: {
    en: "Educational institution",
    ha: "Cibiyar ilimi",
    yo: "Ilé-ẹ̀kọ́",
    ig: "Ụlọ ọrụ agụmakwụkwọ",
    pcm: "School",
  },
};

const NORTH =
  /\b(borno|yobe|adamawa|bauchi|gombe|taraba|kano|kaduna|katsina|jigawa|kebbi|sokoto|zamfara|niger|kwara|kogi|nasarawa|plateau|benue|maiduguri|abuja|fct)\b/i;
const SOUTHWEST = /\b(lagos|ogun|oyo|osun|ondo|ekiti|ibadan|ikeja|lekki|abeokuta)\b/i;
const SOUTHEAST = /\b(anambra|enugu|imo|abia|ebonyi|onitsha|owerri|awka|aba)\b/i;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function orgKind(f: Facts): OrgKind {
  const o = obj(f.onboarding?.organisation);
  const declared = str(o.org_type || o.kind);
  if (
    [
      "nursery_primary",
      "secondary",
      "k12",
      "polytechnic",
      "university",
      "group",
      "government",
      "other",
    ].includes(declared)
  )
    return declared as OrgKind;
  const cat = str(f.data.school?.institution_category);
  if (cat === "university" || cat === "polytechnic") return cat;
  if (o.is_group === true) return "group";
  const kinds = new Set((f.data.sections ?? []).map((s) => s.kind));
  const bands = arr(obj(f.onboarding?.institution).bands).map(String);
  for (const b of bands)
    kinds.add(b === "jss" ? "junior_secondary" : b === "sss" ? "senior_secondary" : b);
  if (kinds.has("tertiary")) return "university";
  const early = ["early_years", "nursery", "primary"].some((k) => kinds.has(k));
  const sec = ["junior_secondary", "senior_secondary", "technical"].some((k) => kinds.has(k));
  if (early && sec) return "k12";
  if (early) return "nursery_primary";
  if (sec) return "secondary";
  return "other";
}

export function siteLocales(f: Facts): Locale[] {
  const declared = arr(f.onboarding?.languages ?? obj(f.onboarding?.comms).languages)
    .map(String)
    .filter((l) => ["ha", "yo", "ig", "pcm"].includes(l)) as Locale[];
  if (declared.length) return ["en", ...declared.filter((l, i, a) => a.indexOf(l) === i)];
  const where = `${f.data.school?.address ?? ""} ${(f.data.campuses ?? []).map((c) => c.address ?? "").join(" ")} ${str(obj(f.onboarding?.organisation).state)}`;
  if (NORTH.test(where)) return ["en", "ha"];
  if (SOUTHWEST.test(where)) return ["en", "yo"];
  if (SOUTHEAST.test(where)) return ["en", "ig"];
  return ["en"];
}

function L(locales: Locale[], m: Record<Locale, string>): Localized {
  return Object.fromEntries(locales.map((l) => [l, m[l] ?? m.en]));
}
function joinL(locales: Locale[], parts: Localized[]): Localized {
  return Object.fromEntries(
    locales.map((l) => [
      l,
      parts
        .map((p) => p[l] ?? p.en ?? "")
        .filter(Boolean)
        .join(" · "),
    ]),
  );
}

/** Factual one-liner from the organization's reality (kind, gender, residency, campuses, faith). */
export function summaryLine(f: Facts, kind: OrgKind, locales: Locale[]): Localized {
  const parts: Localized[] = [KIND_LABEL[kind]];
  const secs = f.data.sections ?? [];
  const genders = new Set(secs.map((s) => s.gender).filter(Boolean));
  if (genders.size === 1 && genders.has("boys")) parts.push(L(locales, UI_STRINGS.boys));
  else if (genders.size === 1 && genders.has("girls")) parts.push(L(locales, UI_STRINGS.girls));
  const res = new Set(secs.map((s) => s.residency).filter(Boolean));
  const boarding =
    res.has("boarding") || res.has("both") || obj(f.onboarding?.organisation).boarding === true;
  const day = res.has("day") || res.has("both");
  if (boarding && day)
    parts.push(joinL(locales, [L(locales, UI_STRINGS.day), L(locales, UI_STRINGS.boarding)]));
  else if (boarding) parts.push(L(locales, UI_STRINGS.boarding));
  const nc = (f.data.campuses ?? []).length;
  if (nc > 1)
    parts.push(
      Object.fromEntries(
        locales.map((l) => [l, `${nc} ${(UI_STRINGS.campuses[l] ?? "campuses").toLowerCase()}`]),
      ),
    );
  const faith = str(obj(f.onboarding?.organisation).religion);
  const FAITH: Record<string, Record<Locale, string>> = {
    islamic: { en: "Islamic", ha: "Islamiyya", yo: "Ẹ̀sìn Islam", ig: "Islam", pcm: "Islamic" },
    christian: {
      en: "Christian",
      ha: "Kirista",
      yo: "Kìrìstẹ́nì",
      ig: "Ndị Kraịst",
      pcm: "Christian",
    },
  };
  if (FAITH[faith]) parts.push(L(locales, FAITH[faith]));
  if (f.data.school?.founded_year)
    parts.push(
      Object.fromEntries(
        locales.map((l) => [l, `${UI_STRINGS.founded[l]} ${f.data.school.founded_year}`]),
      ),
    );
  return joinL(locales, parts);
}

export function generateSite(f: Facts): SiteDocument {
  const kind = orgKind(f);
  const locales = siteLocales(f);
  const d = f.data;
  const ob = f.onboarding ?? {};
  const T = (k: string) => L(locales, PAGE_TITLES[k]);
  /** School-entered text is stored once, in the default language; other languages fall back to it (never fake translations). */
  const own = (text: string): Localized => ({ [locales[0]]: text });
  const pages: Page[] = [];
  let bg = 0;

  const ok = (b: Block) => BLOCK_MAP[b.type]?.hasContent(b, d, locales[0]) ?? false;
  // Blog blocks are kept before the first post (posts are written after onboarding; the block stays hidden
  // until one is published), but only on a page that has other real content, so no empty page is created.
  const KEEP_EMPTY = new Set(["blog"]);
  function page(
    slug: string,
    titleKey: string,
    specs: Omit<Block, "id">[],
    opts: { nav?: boolean; description?: Localized } = {},
  ) {
    const sections: Section[] = [];
    const real = specs.some((spec, i) => ok({ id: `${slug}-${spec.type}-${i}`, ...spec }));
    specs.forEach((spec, i) => {
      const b: Block = { id: `${slug}-${spec.type}-${i}`, ...spec };
      if (!ok(b) && !(real && KEEP_EMPTY.has(b.type))) return;
      const background =
        b.type === "stats" || b.type === "cta" ? "brand" : bg++ % 2 ? "muted" : "default";
      sections.push({ id: `${slug}-s${i}`, background, layout: "stack", blocks: [b] });
    });
    if (real)
      pages.push({
        id: `p-${slug}`,
        slug,
        title: T(titleKey),
        nav: opts.nav ?? true,
        sections,
        ...(opts.description ? { description: opts.description } : {}),
      });
  }

  const summary = summaryLine(f, kind, locales);
  const apply = d.admissions?.open && (d.admissions.requirements || d.admissions.deadline);
  const contactable = !!(d.school.phone || d.school.email || d.school.address);
  const hero: Omit<Block, "id"> = {
    type: "hero",
    variant: d.gallery?.length
      ? kind === "university" || kind === "polytechnic" || kind === "government"
        ? "banner"
        : "split"
      : d.school.logo_url
        ? "crest"
        : "centered",
    props: {
      heading: own(d.school.name),
      tagline: d.school.motto ? own(d.school.motto as string) : summary,
      ...(d.gallery?.[0] ? { image: d.gallery[0].image_url } : {}),
      ...(apply
        ? { cta_label: L(locales, UI_STRINGS.apply_now), cta_href: "/admissions" }
        : contactable
          ? { cta_label: L(locales, UI_STRINGS.contact_us), cta_href: "/pages/contact" }
          : {}),
    },
  };

  // Leadership / faculties / agencies / accreditation / facilities come from interview answers when given.
  const people = arr(obj(ob.people).leaders ?? ob.leadership)
    .map(obj)
    .filter((p) => str(p.name))
    .map((p) => ({
      name: str(p.name),
      title: own(str(p.title)),
      ...(str(p.photo) ? { photo: str(p.photo) } : {}),
    }));
  const faculties = arr(ob.faculties)
    .map(obj)
    .filter((g) => str(g.name))
    .map((g) => ({
      name: own(str(g.name)),
      items: own(arr(g.departments).map(String).join("\n")),
    }));
  const agencies = arr(ob.agencies)
    .map(obj)
    .filter((a) => str(a.name))
    .map((a) => ({
      name: own(str(a.name)),
      detail: own(str(a.detail)),
      ...(str(a.href) ? { href: str(a.href) } : {}),
    }));
  const badges = arr(ob.accreditation)
    .map(obj)
    .filter((b) => str(b.name))
    .map((b) => ({ name: str(b.name), detail: own(str(b.detail)) }));
  const facilityNames = arr(ob.facilities).map(String).filter(Boolean);
  const facilitiesFromAnswers: Omit<Block, "id"> | null =
    !d.facilities?.length && facilityNames.length
      ? {
          type: "rich_text",
          props: {
            heading: L(locales, {
              en: "Facilities",
              ha: "Kayayyakin more rayuwa",
              yo: "Ohun èlò",
              ig: "Ngwa ọrụ",
              pcm: "Facilities",
            }),
            body: own(facilityNames.map((x) => `- ${x}`).join("\n")),
          },
        }
      : null;

  const residency = new Set((d.sections ?? []).map((x) => x.residency));
  const boardingSchool =
    residency.has("boarding") || residency.has("both") || obj(ob.organisation).boarding === true;
  const rules = seedRules(kind, own, boardingSchool);
  const policies = seedPolicies(d, kind, own, ob);
  const calendar = seedCalendar(ob, own);
  const pta = seedPta(ob, own);
  const downloads = seedDownloads(ob, own);
  const careers = seedCareers(ob, own);

  const academicsKey =
    kind === "university" || kind === "polytechnic"
      ? "faculties"
      : kind === "nursery_primary"
        ? "classes"
        : kind === "group"
          ? "schools"
          : "academics";
  const lifeKey = kind === "university" || kind === "polytechnic" ? "campus_life" : "life";

  if (kind === "government") {
    page("home", "home", [
      hero,
      { type: "about", variant: "prose", props: { show_mission: true } },
      { type: "agencies", props: { heading: T("services"), items: agencies } },
      { type: "news", variant: "cards", props: { limit: 3 } },
      { type: "events", props: { limit: 4 } },
      { type: "contact", props: {} },
    ]);
    page("about", "about", [
      { type: "about", variant: "pillars", props: { show_mission: true } },
      { type: "leadership", props: { people } },
    ]);
    page("services", "services", [
      { type: "agencies", props: { items: agencies } },
      { type: "links", props: { items: [] } },
    ]);
    page("news", "news", [
      { type: "news", variant: "list", props: { limit: 12 } },
      { type: "events", variant: "cards", props: { limit: 12 } },
    ]);
    page("contact", "contact", [
      { type: "contact", variant: "split", props: {} },
      { type: "map", props: {} },
      { type: "faqs", props: {} },
    ]);
    page(
      "policies",
      "policies",
      [{ type: "policies", variant: "accordion", props: { items: policies } }],
      {
        nav: false,
      },
    );
  } else {
    page("home", "home", [
      hero,
      { type: "stats", props: {} },
      kind === "university" || kind === "polytechnic"
        ? { type: "programmes", variant: "cards", props: {} }
        : { type: "sections_offered", variant: "cards", props: {} },
      { type: "admissions", variant: "banner", props: {} },
      { type: "blog", variant: "featured", props: { limit: 3 } },
      { type: "news", variant: "cards", props: { limit: 3 } },
      { type: "events", variant: "list", props: { limit: 4 } },
      { type: "testimonials", variant: "quotes", props: {} },
      { type: "contact", variant: "panel", props: {} },
    ]);
    page("about", "about", [
      { type: "about", variant: "pillars", props: { show_mission: true } },
      { type: "leadership", variant: "grid", props: { people } },
      { type: "accreditation", props: { badges } },
      { type: "campuses", variant: "cards", props: {} },
    ]);
    page(academicsKey, academicsKey, [
      { type: "sections_offered", variant: "list", props: {} },
      { type: "departments", variant: "grouped", props: { groups: faculties } },
      {
        type: "programmes",
        variant: kind === "university" || kind === "polytechnic" ? "table" : "cards",
        props: {},
      },
      { type: "results_checker", props: {} },
    ]);
    page("admissions", "admissions", [
      { type: "admissions", variant: "panel", props: {} },
      { type: "faqs", props: {} },
    ]);
    page(lifeKey === "life" ? "school-life" : "campus-life", lifeKey, [
      { type: "facilities", variant: "grid", props: {} },
      ...(facilitiesFromAnswers ? [facilitiesFromAnswers] : []),
      { type: "boarding", props: {} },
      { type: "transport", props: {} },
      { type: "gallery", variant: "grid", props: { limit: 12 } },
    ]);
    page("news", "news", [
      { type: "blog", variant: "grid", props: { limit: 12 } },
      { type: "news", variant: "list", props: { limit: 12 } },
      { type: "events", variant: "cards", props: { limit: 12 } },
      { type: "calendar", variant: "table", props: { items: calendar } },
    ]);
    const tert = kind === "university" || kind === "polytechnic";
    page(tert ? "resources" : "parents", tert ? "resources" : "parents", [
      { type: "pta", variant: "split", props: pta },
      { type: "calendar", variant: "timeline", props: { items: calendar } },
      { type: "downloads", variant: "list", props: { items: downloads } },
      { type: "faqs", variant: "columns", props: {} },
    ]);
    page(
      "policies",
      "policies",
      [
        { type: "rules", variant: "grouped", props: { groups: rules } },
        { type: "policies", variant: "accordion", props: { items: policies } },
      ],
      { nav: false },
    );
    page("careers", "careers", [{ type: "careers", variant: "list", props: { items: careers } }], {
      nav: false,
    });
    page("community", "community", [
      { type: "alumni", props: {} },
      { type: "donations", props: {} },
    ]);
    page("contact", "contact", [
      { type: "contact", variant: "split", props: {} },
      { type: "map", props: {} },
      { type: "campuses", variant: "list", props: {} },
    ]);
  }

  // The academics page slug is stable per kind; fix the home page if the generator produced nothing at all.
  if (!pages.some((p) => p.slug === "home"))
    pages.unshift({
      id: "p-home",
      slug: "home",
      title: T("home"),
      nav: true,
      sections: [
        {
          id: "home-s0",
          background: "default",
          layout: "stack",
          blocks: [{ id: "home-hero-0", ...hero }],
        },
      ],
    });

  return { schema: 1, locales, theme: themeFromBrand(d.school, kind), pages };
}
