/**
 * Compact given + family name for the home greeting.
 * Middle names are dropped so two names fit the greeting card.
 */

export interface CompactPersonName {
  first: string;
  last: string;
  display: string;
}

const MAX_PART = 16;

function titleCase(part: string): string {
  const trimmed = part.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function clip(part: string): string {
  if (part.length <= MAX_PART) return part;
  return `${part.slice(0, MAX_PART - 1)}…`;
}

export function compactPersonName(fullName: string | null | undefined): CompactPersonName {
  const parts = (fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(titleCase);
  if (parts.length === 0) {
    return { first: "there", last: "", display: "there" };
  }
  const first = clip(parts[0]);
  if (parts.length === 1) {
    return { first, last: "", display: first };
  }
  const last = clip(parts[parts.length - 1]);
  return { first, last, display: `${first} ${last}` };
}
