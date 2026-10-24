/** URL allow-listing and a tiny rich-text format (no HTML ever). */
export function safeUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 2048) return null;
  if (s.startsWith("/") && !s.startsWith("//")) return s;
  if (s.startsWith("#")) return s;
  try {
    const u = new URL(s);
    if (u.protocol === "https:" || u.protocol === "mailto:" || u.protocol === "tel:")
      return u.toString();
    if (u.protocol === "http:") return u.toString().replace(/^http:/, "https:");
  } catch {
    /* not a URL */
  }
  return null;
}

export type Inline =
  { t: "text"; v: string } | { t: "b"; v: string } | { t: "a"; v: string; href: string };
export type RichNode =
  { t: "p"; c: Inline[] } | { t: "ul"; items: Inline[][] } | { t: "h"; c: Inline[] };

/** Rich text: blank-line paragraphs, "- " bullets, "## " sub-headings, **bold**, [label](url). */
export function parseRich(src: string): RichNode[] {
  const out: RichNode[] = [];
  for (const block of src.replace(/\r/g, "").split(/\n{2,}/)) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    if (lines.every((l) => /^[-*•]\s+/.test(l)))
      out.push({ t: "ul", items: lines.map((l) => inline(l.replace(/^[-*•]\s+/, ""))) });
    else if (lines.length === 1 && lines[0].startsWith("## "))
      out.push({ t: "h", c: inline(lines[0].slice(3)) });
    else out.push({ t: "p", c: inline(lines.join(" ")) });
  }
  return out;
}
function inline(s: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ t: "text", v: s.slice(last, m.index) });
    if (m[1]) out.push({ t: "b", v: m[1] });
    else {
      const href = safeUrl(m[3]);
      out.push(href ? { t: "a", v: m[2], href } : { t: "text", v: m[2] });
    }
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  return out;
}
