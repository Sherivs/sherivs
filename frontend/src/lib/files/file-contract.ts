/**
 * CoreGrid — file/document contract (MISSION-V1-012 files, V5.3 Part 22).
 *
 * Pure validation + sharing model for the V1-minimal files service. Every
 * non-allow path is an explicit DENY (fail closed): unknown purposes,
 * non-allowlisted content types, oversized payloads and hostile filenames
 * never produce a descriptor. This module grants nothing by itself — RLS and
 * the storage-adapter path convention remain the boundary.
 *
 * Vocabulary reuses the existing scholar domain: documents carry a `contentRef`
 * (scholar/documents.ts §99) and evidence an `artifactRef` (scholar/evidence.ts
 * §100); this contract is the storage-level descriptor both point at. No
 * duplicate authority: kind taxonomies stay in the scholar domain.
 */

export type FilePurpose = "attachment" | "evidence" | "document" | "avatar";

export const FILE_PURPOSES: readonly FilePurpose[] = [
  "attachment",
  "evidence",
  "document",
  "avatar",
] as const;

export type FileVisibility = "private" | "org" | "explicit";

/**
 * Sharing model: private (owner only), org (any principal of the same tenant)
 * or explicit (only principals holding an unexpired grant ref).
 */
export interface FileSharing {
  visibility: FileVisibility;
  /** Required when visibility is "explicit": grant ids issued to principals. */
  grantRefs?: readonly string[];
}

export interface FileDescriptor {
  /** Tenant the object belongs to — enforced again by the storage path prefix. */
  tenantId: string;
  /** Owner principal ref (user id); always allowed within its own tenant. */
  ownerRef: string;
  /** Stable file id explicit grants point at. */
  fileId: string;
  purpose: FilePurpose;
  contentType: string;
  sizeBytes: number;
  filename: string;
  sharing: FileSharing;
}

/** Allowlist per purpose — anything not listed is denied (fail closed). */
export const ALLOWED_CONTENT_TYPES: Readonly<Record<FilePurpose, readonly string[]>> = {
  attachment: [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/webp",
    "text/plain",
    "text/csv",
  ],
  evidence: ["application/pdf", "image/png", "image/jpeg", "image/webp"],
  document: ["application/pdf", "image/png", "image/jpeg", "image/webp", "text/csv"],
  avatar: ["image/png", "image/jpeg", "image/webp"],
};

const MB = 1024 * 1024;

/** Per-purpose upload ceilings (avatars small; documents/evidence bounded). */
export const MAX_SIZE_BYTES: Readonly<Record<FilePurpose, number>> = {
  attachment: 25 * MB,
  evidence: 25 * MB,
  document: 25 * MB,
  avatar: 5 * MB,
};

const FILENAME_MAX_LENGTH = 180;

export type FilenameSanitization =
  | { ok: true; filename: string; changed: boolean }
  | { ok: false; reason: "empty" };

/**
 * Sanitize a client-supplied filename: strip path components (traversal),
 * keep a conservative charset, collapse separators and cap length. A name
 * that sanitizes to nothing fails closed.
 */
export function sanitizeFilename(raw: string): FilenameSanitization {
  if (typeof raw !== "string") return { ok: false, reason: "empty" };
  const base = raw.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^A-Za-z0-9._ -]/g, "_")
    .replace(/^\.+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return { ok: false, reason: "empty" };
  const capped = cleaned.slice(0, FILENAME_MAX_LENGTH);
  return { ok: true, filename: capped, changed: capped !== raw };
}

export type FileValidationDenyCode =
  | "malformed"
  | "unknown_purpose"
  | "content_type_not_allowed"
  | "size_exceeded"
  | "invalid_filename"
  | "invalid_sharing";

export type FileValidationDecision =
  | { decision: "allow"; descriptor: FileDescriptor }
  | { decision: "deny"; code: FileValidationDenyCode; reason: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate an untrusted descriptor candidate. Every malformed field, unknown
 * purpose, non-allowlisted content type, oversized payload, hostile filename
 * or invalid sharing shape denies with an explicit reason.
 */
export function validateFileDescriptor(input: unknown): FileValidationDecision {
  if (typeof input !== "object" || input === null) {
    return { decision: "deny", code: "malformed", reason: "Descriptor must be an object" };
  }
  const candidate = input as Record<string, unknown>;

  if (!isNonEmptyString(candidate.tenantId)) {
    return { decision: "deny", code: "malformed", reason: "tenantId is required" };
  }
  if (!isNonEmptyString(candidate.ownerRef)) {
    return { decision: "deny", code: "malformed", reason: "ownerRef is required" };
  }
  if (!isNonEmptyString(candidate.fileId)) {
    return { decision: "deny", code: "malformed", reason: "fileId is required" };
  }

  const purpose = candidate.purpose;
  if (typeof purpose !== "string" || !FILE_PURPOSES.includes(purpose as FilePurpose)) {
    return {
      decision: "deny",
      code: "unknown_purpose",
      reason: `purpose must be one of ${FILE_PURPOSES.join(", ")}`,
    };
  }
  const purposeKey = purpose as FilePurpose;

  const contentType = candidate.contentType;
  if (
    !isNonEmptyString(contentType) ||
    !ALLOWED_CONTENT_TYPES[purposeKey].includes(contentType.trim().toLowerCase())
  ) {
    return {
      decision: "deny",
      code: "content_type_not_allowed",
      reason: `content type is not allowed for purpose "${purposeKey}"`,
    };
  }

  const sizeBytes = candidate.sizeBytes;
  if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return { decision: "deny", code: "malformed", reason: "sizeBytes must be a positive integer" };
  }
  if (sizeBytes > MAX_SIZE_BYTES[purposeKey]) {
    return {
      decision: "deny",
      code: "size_exceeded",
      reason: `size ${sizeBytes} exceeds the ${MAX_SIZE_BYTES[purposeKey]} byte limit for purpose "${purposeKey}"`,
    };
  }

  if (!isNonEmptyString(candidate.filename)) {
    return { decision: "deny", code: "invalid_filename", reason: "filename is required" };
  }
  const sanitized = sanitizeFilename(candidate.filename);
  if (!sanitized.ok) {
    return { decision: "deny", code: "invalid_filename", reason: "filename sanitizes to nothing" };
  }

  const sharing = candidate.sharing;
  if (typeof sharing !== "object" || sharing === null) {
    return { decision: "deny", code: "invalid_sharing", reason: "sharing is required" };
  }
  const visibility = (sharing as { visibility?: unknown }).visibility;
  if (visibility !== "private" && visibility !== "org" && visibility !== "explicit") {
    return {
      decision: "deny",
      code: "invalid_sharing",
      reason: 'visibility must be "private", "org" or "explicit"',
    };
  }
  let grantRefs: readonly string[] | undefined;
  if (visibility === "explicit") {
    const refs = (sharing as { grantRefs?: unknown }).grantRefs;
    if (!Array.isArray(refs) || refs.length === 0 || !refs.every((ref) => isNonEmptyString(ref))) {
      return {
        decision: "deny",
        code: "invalid_sharing",
        reason: "explicit sharing requires a non-empty grantRefs array of strings",
      };
    }
    grantRefs = refs as string[];
  }

  return {
    decision: "allow",
    descriptor: {
      tenantId: candidate.tenantId,
      ownerRef: candidate.ownerRef,
      fileId: candidate.fileId,
      purpose: purposeKey,
      contentType: contentType.trim().toLowerCase(),
      sizeBytes,
      filename: sanitized.filename,
      sharing: grantRefs ? { visibility, grantRefs } : { visibility },
    },
  };
}
