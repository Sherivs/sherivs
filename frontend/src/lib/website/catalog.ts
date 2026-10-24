/**
 * Block catalog v1: the single source of truth for block types (SPEC §5). Each block has a schema (fields),
 * variants, a data source and a guard. The SQL catalog seed (website_block_types) must match BLOCK_TYPES;
 * tests/unit/website-engine.test.ts checks parity against the migration.
 */
import { tx } from "./i18n";
import type { Block, Locale, SiteData } from "./types";

export type FieldType =
  "text" | "textarea" | "richtext" | "url" | "image" | "select" | "boolean" | "number" | "list";
export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  localized?: boolean;
  options?: string[];
  /** For type "list": fields of each item. */
  item?: FieldDef[];
  max?: number;
  help?: string;
}
export type BlockCategory =
  | "identity"
  | "academics"
  | "admissions"
  | "campus_life"
  | "community"
  | "updates"
  | "contact"
  | "content";
export interface BlockDef {
  type: string;
  label: string;
  category: BlockCategory;
  /** Live Sherivs data the block is bound to; null = content typed by the school. */
  dataSource: string | null;
  variants: string[];
  fields: FieldDef[];
  /** Opt-in blocks publish personal data and are never generated automatically. */
  optIn?: boolean;
  description: string;
  /** Guard: false means the block is hidden on the public site (never an empty placeholder). */
  hasContent: (b: Block, d: SiteData, locale: Locale) => boolean;
}

const heading: FieldDef = {
  key: "heading",
  label: "Heading",
  type: "text",
  localized: true,
  max: 120,
};
const intro: FieldDef = {
  key: "intro",
  label: "Intro",
  type: "textarea",
  localized: true,
  max: 600,
};
const txt = (b: Block, k: string, l: Locale) => tx(b.props[k], l).length > 0;
const list = (b: Block, k: string) => (Array.isArray(b.props[k]) ? (b.props[k] as unknown[]) : []);
const n = (a: unknown[] | null | undefined) => (Array.isArray(a) ? a.length : 0);

export const BLOCKS: BlockDef[] = [
  {
    type: "hero",
    label: "Hero",
    category: "identity",
    dataSource: "school",
    variants: ["centered", "split", "minimal"],
    description: "School name, motto or tagline, a photo and the main call to action.",
    fields: [
      heading,
      { key: "tagline", label: "Tagline", type: "text", localized: true, max: 200 },
      { key: "image", label: "Background photo", type: "image" },
      { key: "cta_label", label: "Button label", type: "text", localized: true, max: 40 },
      { key: "cta_href", label: "Button link", type: "url" },
    ],
    hasContent: (_b, d) => !!d.school?.name,
  },
  {
    type: "about",
    label: "About",
    category: "identity",
    dataSource: "school",
    variants: ["prose", "pillars"],
    description:
      "Who you are: story, mission, vision and motto from your school profile, plus your own text.",
    fields: [
      heading,
      { key: "body", label: "Story", type: "richtext", localized: true, max: 5000 },
      { key: "show_mission", label: "Show mission/vision/motto", type: "boolean" },
    ],
    hasContent: (b, d, l) =>
      txt(b, "body", l) || !!(d.school?.about || d.school?.mission || d.school?.vision),
  },
  {
    type: "leadership",
    label: "Leadership",
    category: "identity",
    dataSource: null,
    variants: ["grid", "list"],
    description: "Proprietor, principal, head teacher, VC, registrar, board.",
    fields: [
      heading,
      {
        key: "people",
        label: "People",
        type: "list",
        max: 30,
        item: [
          { key: "name", label: "Name", type: "text" },
          { key: "title", label: "Title", type: "text", localized: true },
          { key: "photo", label: "Photo", type: "image" },
          { key: "bio", label: "Short bio", type: "textarea", localized: true },
        ],
      },
    ],
    hasContent: (b) => list(b, "people").length > 0,
  },
  {
    type: "stats",
    label: "At a glance",
    category: "identity",
    dataSource: "stats",
    variants: ["band"],
    description: "Live counts: students, teachers, programmes, campuses, year founded.",
    fields: [heading],
    hasContent: (_b, d) =>
      [
        d.stats?.students,
        d.stats?.teachers,
        d.stats?.programmes,
        d.stats?.campuses,
        d.stats?.founded_year,
      ].filter((x) => (x ?? 0) > 0).length >= 2,
  },
  {
    type: "sections_offered",
    label: "Schools & sections",
    category: "academics",
    dataSource: "school_sections",
    variants: ["cards", "list"],
    description:
      "Nursery, primary, JSS, SSS, technical: live from your school structure, with day/boarding and gender.",
    fields: [heading, intro],
    hasContent: (_b, d) => n(d.sections) > 0,
  },
  {
    type: "programmes",
    label: "Programmes",
    category: "academics",
    dataSource: "academic_programs",
    variants: ["cards", "list", "table"],
    description: "Published programmes or courses of study.",
    fields: [heading, intro],
    hasContent: (_b, d) => n(d.programmes) > 0,
  },
  {
    type: "departments",
    label: "Faculties & departments",
    category: "academics",
    dataSource: null,
    variants: ["grouped", "list"],
    description: "Faculties, schools or departments and what each offers.",
    fields: [
      heading,
      intro,
      {
        key: "groups",
        label: "Groups",
        type: "list",
        max: 60,
        item: [
          { key: "name", label: "Faculty / school", type: "text", localized: true },
          { key: "items", label: "Departments (one per line)", type: "textarea", localized: true },
        ],
      },
    ],
    hasContent: (b) => list(b, "groups").length > 0,
  },
  {
    type: "admissions",
    label: "Admissions",
    category: "admissions",
    dataSource: "admissions",
    variants: ["panel", "banner"],
    description:
      "Live requirements, closing date and timeline from your admissions settings, with an Apply button.",
    fields: [
      heading,
      intro,
      { key: "cta_label", label: "Button label", type: "text", localized: true },
    ],
    hasContent: (_b, d) =>
      !!(
        d.admissions &&
        (d.admissions.requirements ||
          d.admissions.deadline ||
          n(d.admissions.timeline as unknown[]) > 0)
      ),
  },
  {
    type: "fees_summary",
    label: "Fees summary",
    category: "admissions",
    dataSource: null,
    variants: ["table"],
    description: "Only the fee figures you choose to publish (nothing is read from student bills).",
    fields: [
      heading,
      intro,
      {
        key: "items",
        label: "Items",
        type: "list",
        max: 40,
        item: [
          { key: "label", label: "Item", type: "text", localized: true },
          { key: "amount", label: "Amount (₦)", type: "number" },
          { key: "note", label: "Note", type: "text", localized: true },
        ],
      },
    ],
    hasContent: (b) => list(b, "items").length > 0,
  },
  {
    type: "facilities",
    label: "Facilities",
    category: "campus_life",
    dataSource: "school_facilities",
    variants: ["grid", "list"],
    description: "Labs, library, sports, ICT and more: published facilities.",
    fields: [heading, intro],
    hasContent: (_b, d) => n(d.facilities) > 0,
  },
  {
    type: "boarding",
    label: "Boarding & hostels",
    category: "campus_life",
    dataSource: "hostels",
    variants: ["panel"],
    description: "Boarding sections and hostel capacity (totals only, never room lists).",
    fields: [heading, { key: "body", label: "Boarding life", type: "richtext", localized: true }],
    hasContent: (b, d, l) =>
      n(d.hostels) > 0 ||
      (d.sections ?? []).some(
        (s) => s.residency === "boarding" || s.residency === "both" || s.kind === "boarding",
      ) ||
      txt(b, "body", l),
  },
  {
    type: "transport",
    label: "School bus",
    category: "campus_life",
    dataSource: "school_transport",
    variants: ["panel"],
    description: "Routes, times and safety, shown only when transport is enabled.",
    fields: [heading],
    hasContent: (_b, d) => !!d.transport,
  },
  {
    type: "news",
    label: "News",
    category: "updates",
    dataSource: "news",
    variants: ["cards", "list"],
    description: "Latest published news from Sherivs.",
    fields: [heading, { key: "limit", label: "How many", type: "number" }],
    hasContent: (_b, d) => n(d.news) > 0,
  },
  {
    type: "events",
    label: "Events & calendar",
    category: "updates",
    dataSource: "events",
    variants: ["list", "cards"],
    description: "Upcoming published events and public calendar dates.",
    fields: [heading, { key: "limit", label: "How many", type: "number" }],
    hasContent: (_b, d) => n(d.events) > 0,
  },
  {
    type: "gallery",
    label: "Gallery",
    category: "campus_life",
    dataSource: "school_gallery",
    variants: ["grid", "strip"],
    description: "Published photos (lazy-loaded for slow networks).",
    fields: [heading, { key: "limit", label: "How many", type: "number" }],
    hasContent: (_b, d) => n(d.gallery) > 0,
  },
  {
    type: "staff_directory",
    label: "Staff directory",
    category: "community",
    dataSource: "school_staff",
    variants: ["grid", "list"],
    optIn: true,
    description:
      "Published staff profiles. Opt-in: personal data appears only when you add this block.",
    fields: [heading, intro],
    hasContent: (_b, d) => n(d.staff) > 0,
  },
  {
    type: "results_checker",
    label: "Result checker",
    category: "admissions",
    dataSource: "result_pins",
    variants: ["panel"],
    description: "Lets parents check published results with a PIN.",
    fields: [heading],
    hasContent: (_b, d) => !!d.results_checker,
  },
  {
    type: "alumni",
    label: "Alumni",
    category: "community",
    dataSource: "alumni_profiles",
    variants: ["panel"],
    description: "Alumni network size and how to join (counts only, never names).",
    fields: [
      heading,
      { key: "body", label: "Message", type: "richtext", localized: true },
      { key: "cta_href", label: "Join link", type: "url" },
    ],
    hasContent: (b, d, l) => (d.alumni?.verified ?? 0) > 0 || txt(b, "body", l),
  },
  {
    type: "donations",
    label: "Give / donations",
    category: "community",
    dataSource: "donation_campaigns",
    variants: ["cards"],
    description: "Open fundraising campaigns.",
    fields: [heading, intro],
    hasContent: (_b, d) => n(d.donations) > 0,
  },
  {
    type: "campuses",
    label: "Campuses",
    category: "contact",
    dataSource: "campuses",
    variants: ["list", "cards"],
    description: "All your campuses with addresses and map links.",
    fields: [heading],
    hasContent: (_b, d) => n(d.campuses) > 0,
  },
  {
    type: "contact",
    label: "Contact",
    category: "contact",
    dataSource: "school",
    variants: ["panel", "split"],
    description: "Phone, email, address, office hours and social links from your profile.",
    fields: [heading],
    hasContent: (_b, d) => !!(d.school?.phone || d.school?.email || d.school?.address),
  },
  {
    type: "map",
    label: "Map",
    category: "contact",
    dataSource: "school",
    variants: ["links"],
    description: "Map links per campus (no heavy map download until tapped).",
    fields: [heading],
    hasContent: (_b, d) =>
      !!(
        d.school?.map?.lat ||
        d.school?.map?.embed_url ||
        (d.campuses ?? []).some((c) => c.address) ||
        d.school?.address
      ),
  },
  {
    type: "faqs",
    label: "FAQs",
    category: "contact",
    dataSource: "faqs",
    variants: ["accordion"],
    description: "Published frequently asked questions.",
    fields: [heading],
    hasContent: (_b, d) => n(d.faqs) > 0,
  },
  {
    type: "testimonials",
    label: "Testimonials",
    category: "community",
    dataSource: "testimonials",
    variants: ["quotes", "cards"],
    description: "Published testimonials from parents, students and alumni.",
    fields: [heading],
    hasContent: (_b, d) => n(d.testimonials) > 0,
  },
  {
    type: "accreditation",
    label: "Accreditation",
    category: "identity",
    dataSource: null,
    variants: ["badges"],
    description: "Approvals and memberships (e.g. WAEC/NECO centre, NUC, NBTE, state ministry).",
    fields: [
      heading,
      {
        key: "badges",
        label: "Badges",
        type: "list",
        max: 20,
        item: [
          { key: "name", label: "Body", type: "text" },
          { key: "detail", label: "Detail", type: "text", localized: true },
          { key: "logo", label: "Logo", type: "image" },
        ],
      },
    ],
    hasContent: (b) => list(b, "badges").length > 0,
  },
  {
    type: "rich_text",
    label: "Text",
    category: "content",
    dataSource: null,
    variants: ["prose", "callout"],
    description: "Your own text: paragraphs, lists, bold and links (no HTML).",
    fields: [
      heading,
      { key: "body", label: "Text", type: "richtext", localized: true, max: 20000 },
    ],
    hasContent: (b, _d, l) => txt(b, "body", l),
  },
  {
    type: "cta",
    label: "Call to action",
    category: "content",
    dataSource: null,
    variants: ["banner"],
    description: "A highlighted message with one button.",
    fields: [
      heading,
      { key: "body", label: "Text", type: "textarea", localized: true },
      { key: "cta_label", label: "Button label", type: "text", localized: true },
      { key: "cta_href", label: "Button link", type: "url" },
    ],
    hasContent: (b, _d, l) =>
      txt(b, "cta_label", l) && typeof b.props.cta_href === "string" && b.props.cta_href.length > 0,
  },
  {
    type: "links",
    label: "Links & downloads",
    category: "content",
    dataSource: null,
    variants: ["list", "buttons"],
    description: "Prospectus, forms, portals, handbooks.",
    fields: [
      heading,
      {
        key: "items",
        label: "Links",
        type: "list",
        max: 40,
        item: [
          { key: "label", label: "Label", type: "text", localized: true },
          { key: "href", label: "Link", type: "url" },
        ],
      },
    ],
    hasContent: (b) => list(b, "items").length > 0,
  },
  {
    type: "agencies",
    label: "Agencies & services",
    category: "content",
    dataSource: null,
    variants: ["cards"],
    description:
      "For government and group landing pages: agencies, boards, member schools or services.",
    fields: [
      heading,
      intro,
      {
        key: "items",
        label: "Items",
        type: "list",
        max: 60,
        item: [
          { key: "name", label: "Name", type: "text", localized: true },
          { key: "detail", label: "Detail", type: "textarea", localized: true },
          { key: "href", label: "Link", type: "url" },
        ],
      },
    ],
    hasContent: (b) => list(b, "items").length > 0,
  },
  {
    type: "video",
    label: "Video",
    category: "content",
    dataSource: null,
    variants: ["lite"],
    description: "A YouTube or Vimeo video that loads only when tapped.",
    fields: [heading, { key: "url", label: "YouTube or Vimeo link", type: "url" }],
    hasContent: (b) =>
      typeof b.props.url === "string" &&
      /^https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com)\//.test(b.props.url),
  },
];

export const BLOCK_MAP: Record<string, BlockDef> = Object.fromEntries(
  BLOCKS.map((b) => [b.type, b]),
);
export const BLOCK_TYPES = BLOCKS.map((b) => b.type);

export function blockVisible(b: Block, d: SiteData, locale: Locale): boolean {
  const def = BLOCK_MAP[b.type];
  if (!def || b.hidden) return false;
  try {
    return def.hasContent(b, d, locale);
  } catch {
    return false;
  }
}
