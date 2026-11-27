/**
 * Sherivs — authority link candidates in a provisioning plan (domain-neutral;
 * ADR-107).
 *
 * A plan may NAME external authorities an organization says it answers to
 * (a regulator, a supervising body, a jurisdiction). A plan can never VERIFY
 * one: verification needs evidence and a human reviewer, and happens after
 * provisioning through the existing authority-link records. So the status of
 * every candidate is the literal 'unverified', by type and at runtime.
 *
 * Pure. No domain vocabulary.
 */
import { canonicalize } from "./canonical";

export type AuthorityRelation =
  | "regulated_by"
  | "supervised_by"
  | "reports_to"
  | "registered_with"
  | "candidate_centre_of"
  | "jurisdiction_over";

export interface AuthorityLinkCandidate {
  /** Code of the external authority as the domain names it. */
  readonly authority: string;
  readonly relation: AuthorityRelation;
  /** Optional area qualifier (for example a state code); null when national. */
  readonly scope: string | null;
  readonly status: "unverified";
}

export function unverifiedLink(
  authority: string,
  relation: AuthorityRelation,
  scope: string | null = null,
): AuthorityLinkCandidate {
  return { authority, relation, scope, status: "unverified" };
}

/** De-duplicated and sorted by authority, relation, then scope. */
export function normalizeAuthorityLinks(
  links: readonly AuthorityLinkCandidate[],
): AuthorityLinkCandidate[] {
  const seen = new Map<string, AuthorityLinkCandidate>();
  for (const l of links) {
    const key = `${l.authority}\u0000${l.relation}\u0000${l.scope ?? ""}`;
    if (!seen.has(key)) seen.set(key, unverifiedLink(l.authority, l.relation, l.scope));
  }
  return [...seen.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, v]) => canonicalize(v) as unknown as AuthorityLinkCandidate);
}

/** True only when every candidate is still 'unverified' (a plan never asserts more). */
export function allLinksUnverified(links: readonly { readonly status: string }[]): boolean {
  return links.every((l) => l.status === "unverified");
}
