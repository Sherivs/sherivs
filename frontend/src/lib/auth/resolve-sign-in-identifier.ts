/**
 * Resolve email / phone / organization-issued ID to a password sign-in target.
 *
 * ID numbers are unique per school, not globally. When several accounts match
 * and no verified school origin is in scope, the resolver returns ambiguous
 * rather than picking an account. Callers must show the same generic error.
 */
import { classifySignInIdentifier, type ClassifiedSignInIdentifier } from "./sign-in-identifier";

export type IdentifierDirectoryMatch = {
  schoolId: string;
  userId: string;
  email: string;
  active: boolean;
};

export type IdentifierResolution =
  | { status: "direct"; identifier: ClassifiedSignInIdentifier }
  | { status: "resolved"; identifier: { kind: "email"; value: string } }
  | { status: "ambiguous" }
  | { status: "none" };

export function pickIdentifierMatch(input: {
  matches: readonly IdentifierDirectoryMatch[];
  schoolId: string | null;
}): IdentifierResolution {
  const scoped = input.schoolId
    ? input.matches.filter((row) => row.schoolId === input.schoolId)
    : input.matches;
  const live = scoped.filter((row) => row.active && row.email.includes("@"));
  if (live.length === 0) return { status: "none" };
  const userIds = new Set(live.map((row) => row.userId));
  if (userIds.size > 1) return { status: "ambiguous" };
  const match = live[0];
  return {
    status: "resolved",
    identifier: { kind: "email", value: match.email.trim().toLowerCase() },
  };
}

export function hostnameFromOriginHeader(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function resolveSignInIdentifier(input: {
  raw: string;
  schoolId: string | null;
  matches: readonly IdentifierDirectoryMatch[];
}): IdentifierResolution {
  const identifier = classifySignInIdentifier(input.raw);
  if (identifier.kind === "email" || identifier.kind === "phone") {
    return { status: "direct", identifier };
  }
  return pickIdentifierMatch({ matches: input.matches, schoolId: input.schoolId });
}
