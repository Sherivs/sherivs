/** Sherivs Website Engine (SHERIVS-100): document model. See docs/website-engine/SPEC.md §3. */
export const LOCALES = ["en", "ha", "yo", "ig", "pcm"] as const;
export type Locale = (typeof LOCALES)[number];
export type Localized = Partial<Record<Locale, string>>;

export interface Theme {
  primary: string;
  secondary: string;
  font: "system" | "serif" | "rounded";
  radius: "square" | "soft" | "round";
  logo?: string;
  /** v2: curated self-hosted font pairing (lib/website/theme.ts PAIRINGS). */
  pairing?: "classic" | "scholarly" | "modern" | "friendly" | "civic" | "heritage";
  /** v2: dark scheme follows the visitor's device ("auto"), or is off/forced. */
  dark?: "auto" | "light" | "dark";
  /** v2: small "Website by Sherivs" credit in the footer; the school can hide it. */
  credit?: boolean;
  /** v2: crest/emblem image shown in the hero "crest" style and footer (falls back to the logo). */
  crest?: string;
}
/** v2: per-site head metadata. */
export interface SiteSeo {
  favicon?: string;
  og_image?: string;
  description?: Localized;
  title_suffix?: string;
}

export interface Block {
  id: string;
  type: string;
  variant?: string;
  hidden?: boolean;
  props: Record<string, unknown>;
}
export interface Section {
  id: string;
  background: "default" | "muted" | "brand";
  layout: "stack" | "split";
  blocks: Block[];
}
export interface Page {
  id: string;
  slug: string;
  title: Localized;
  description?: Localized;
  nav: boolean;
  sections: Section[];
}
export interface SiteDocument {
  schema: 1;
  locales: Locale[];
  theme: Theme;
  pages: Page[];
  seo?: SiteSeo;
}

/** Public data bundle returned by website_public / website_facts (only public columns). */
export interface SchoolPublic {
  name: string;
  slug: string;
  motto?: string | null;
  about?: string | null;
  vision?: string | null;
  mission?: string | null;
  founded_year?: number | null;
  logo_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  office_hours?: string | null;
  institution_category?: string | null;
  socials?: Record<string, string | null>;
  map?: { embed_url?: string | null; lat?: number | null; lng?: number | null } | null;
}
export interface SiteData {
  school: SchoolPublic;
  campuses?: { name: string; code?: string | null; address?: string | null }[];
  sections?: {
    name: string;
    kind: string;
    gender?: string | null;
    residency?: string | null;
    campus?: string | null;
  }[];
  programmes?: {
    name: string;
    description?: string | null;
    age_range?: string | null;
    duration?: string | null;
    subjects?: unknown;
    features?: unknown;
  }[];
  facilities?: { name: string; description?: string | null; image_url?: string | null }[];
  news?: {
    id: string;
    title: string;
    excerpt?: string | null;
    cover_image_url?: string | null;
    published_at?: string | null;
    category?: string | null;
  }[];
  events?: {
    id: string;
    title: string;
    description?: string | null;
    location?: string | null;
    date: string;
    end_date?: string | null;
    time?: string | null;
  }[];
  gallery?: { title?: string | null; caption?: string | null; image_url: string }[];
  staff?: {
    full_name: string;
    role?: string | null;
    avatar_url?: string | null;
    qualification?: string | null;
    subject_specialty?: string | null;
  }[];
  testimonials?: { name: string; role: string; content: string; avatar_url?: string | null }[];
  faqs?: { question: string; answer: string; category?: string | null }[];
  transport?: {
    coverage_areas?: string | null;
    morning_pickup_start?: string | null;
    afternoon_departure_time?: string | null;
    live_tracking_enabled?: boolean | null;
    buses_air_conditioned?: boolean | null;
    safety_features?: string | null;
    monthly_fee?: number | null;
  } | null;
  hostels?: { gender: string | null; rooms: number; capacity: number }[];
  alumni?: { verified: number; first_year?: number | null; last_year?: number | null } | null;
  donations?: { id: string; title: string; goal: number; ends_on?: string | null }[];
  admissions?: {
    requirements?: string | null;
    deadline?: string | null;
    timeline?: unknown;
    open: boolean;
  } | null;
  results_checker?: boolean;
  stats?: {
    students?: number | null;
    teachers?: number | null;
    programmes?: number | null;
    campuses?: number | null;
    founded_year?: number | null;
  } | null;
  /** v2: published blog posts (newest first, no body). */
  posts?: PostSummary[];
}

/** v2 blog post (website_posts). Localized title/excerpt/body; body is the safe rich-text subset. */
export interface PostSummary {
  id: string;
  slug: string;
  title: Localized;
  excerpt?: Localized | null;
  category?: string | null;
  cover_url?: string | null;
  author_name?: string | null;
  published_at: string;
}
export interface Post extends PostSummary {
  body?: Localized | null;
  seo?: { title?: string | null; description?: string | null } | null;
}

export interface PublicSite {
  school_id: string;
  version: number | null;
  canonical_host: string | null;
  document: SiteDocument | null;
  data: SiteData;
  /** v2: present on website_public_post responses. */
  post?: Post | null;
}
