export interface SiteSearch {
  school?: string;
  lang?: string;
  /** App-entry splash expands Sign In when this is set. Ignored on tenant sites. */
  panel?: "signin";
}

export function parseSiteSearch(s: Record<string, unknown>): SiteSearch {
  const out: SiteSearch = {};
  if (typeof s.school === "string" && s.school) out.school = s.school.slice(0, 63);
  if (typeof s.lang === "string" && s.lang) out.lang = s.lang.slice(0, 8);
  if (s.panel === "signin") out.panel = "signin";
  return out;
}
