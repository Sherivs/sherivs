/**
 * Permission-aware V1 console search. Results never include a record the
 * viewer is not authorized to see — including the name of a sensitive
 * record they searched for.
 */
import type { ConsoleNavItem } from "./roles";
import type { InternalWorkspace } from "./workspaces";
import type { ConsoleRuntimeContract } from "./runtime-contract";

export type ConsoleSearchKind =
  "staff" | "workspace" | "runtime" | "page" | "help" | "organization";

export interface ConsoleSearchHit {
  kind: ConsoleSearchKind;
  id: string;
  title: string;
  description: string;
  href: string;
}

export interface ConsoleSearchStaff {
  id: string;
  fullName: string;
  email: string;
  department: string | null;
  status: string;
}

export interface ConsoleHelpArticle {
  id: string;
  title: string;
  description: string;
  href: string;
  /** null = every console operator. */
  capability?: string | null;
  anyOf?: readonly string[];
}

function haystack(...parts: Array<string | null | undefined>): string {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function matches(query: string, ...parts: Array<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return haystack(...parts).includes(q);
}

export interface ConsoleSearchOrganization {
  id: string;
  displayName: string;
  lifecycleState: string;
}

export function searchConsole(input: {
  query: string;
  canReadStaff: boolean;
  staff: readonly ConsoleSearchStaff[];
  organizations?: readonly ConsoleSearchOrganization[];
  canReadOrganizations?: boolean;
  workspaces: readonly InternalWorkspace[];
  runtimes: readonly ConsoleRuntimeContract[];
  pages: readonly ConsoleNavItem[];
  help: readonly ConsoleHelpArticle[];
  limit?: number;
}): ConsoleSearchHit[] {
  const q = input.query.trim();
  if (q.length < 2) return [];
  const limit = input.limit ?? 12;
  const hits: ConsoleSearchHit[] = [];

  if (input.canReadStaff) {
    for (const staff of input.staff) {
      if (!matches(q, staff.fullName, staff.email, staff.department, staff.status)) continue;
      hits.push({
        kind: "staff",
        id: staff.id,
        title: staff.fullName,
        description: staff.email,
        href: `/console/team`,
      });
      if (hits.length >= limit) return hits;
    }
  }

  if (input.canReadOrganizations) {
    for (const organization of input.organizations ?? []) {
      if (!matches(q, organization.displayName, organization.lifecycleState)) continue;
      hits.push({
        kind: "organization",
        id: organization.id,
        title: organization.displayName,
        description: organization.lifecycleState,
        href: `/console/organizations/${encodeURIComponent(organization.id)}`,
      });
      if (hits.length >= limit) return hits;
    }
  }

  for (const ws of input.workspaces) {
    if (!matches(q, ws.name, ws.description, ws.team, ws.type)) continue;
    hits.push({
      kind: "workspace",
      id: ws.id,
      title: ws.name,
      description: ws.description,
      href: ws.href,
    });
    if (hits.length >= limit) return hits;
  }

  for (const runtime of input.runtimes) {
    if (!matches(q, runtime.name, runtime.description, runtime.id)) continue;
    hits.push({
      kind: "runtime",
      id: runtime.id,
      title: runtime.name,
      description: runtime.description,
      href: runtime.helpHref,
    });
    if (hits.length >= limit) return hits;
  }

  for (const page of input.pages) {
    if (!matches(q, page.label, page.key)) continue;
    hits.push({
      kind: "page",
      id: page.key,
      title: page.label,
      description: "Console page",
      href: page.href,
    });
    if (hits.length >= limit) return hits;
  }

  for (const article of input.help) {
    if (!matches(q, article.title, article.description)) continue;
    hits.push({
      kind: "help",
      id: article.id,
      title: article.title,
      description: article.description,
      href: article.href,
    });
    if (hits.length >= limit) return hits;
  }

  return hits;
}
