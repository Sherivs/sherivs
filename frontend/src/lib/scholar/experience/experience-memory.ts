import { SystemClock, TimeAuthority } from "../../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/**
 * CoreGrid Scholar — experience memory (WAVE-R38, directive §23).
 *
 * The experience engine may remember user and organization preferences — but
 * only under privacy law: a declared purpose, explicit consent, a tenant and
 * subject scope, a bounded retention window, and a real way to forget.
 *
 * Boundary: this module is pure policy + records. It never reads or writes
 * storage, and AI systems never receive a record unless consent allows it.
 */

export const MEMORY_PURPOSES = [
  "workspace_personalisation",
  "navigation_preferences",
  "service_improvement",
] as const;
export type MemoryPurpose = (typeof MEMORY_PURPOSES)[number];

/** Retention ceiling in days (bounded memory, no indefinite profile). */
export const MAX_RETENTION_DAYS = 400;

export interface ExperienceMemoryRecord {
  id: string;
  tenantId: string;
  subjectId: string;
  purpose: MemoryPurpose;
  key: string;
  value: string;
  consentGranted: boolean;
  containsPersonalData: boolean;
  recordedAt: string;
  expiresAt: string;
}

export interface RecordMemoryRequest {
  id: string;
  tenantId: string | null;
  subjectId: string | null;
  purpose: MemoryPurpose;
  key: string;
  value: string;
  consentGranted: boolean;
  containsPersonalData?: boolean;
  recordedAt?: string;
  retentionDays?: number;
}

export interface RecordMemoryResult {
  ok: boolean;
  reasons: readonly string[];
  record?: ExperienceMemoryRecord;
}

export function recordExperienceMemory(request: RecordMemoryRequest): RecordMemoryResult {
  const reasons: string[] = [];
  if (!request.tenantId) reasons.push("no tenant context — memory is tenant-scoped");
  if (!request.subjectId)
    reasons.push("no subject — memory is never anonymous-about-unknown-people");
  if (!MEMORY_PURPOSES.includes(request.purpose))
    reasons.push(`unknown purpose "${request.purpose}"`);
  if (request.key.trim().length === 0) reasons.push("memory key is required");

  const retentionDays = request.retentionDays ?? 180;
  if (retentionDays <= 0 || retentionDays > MAX_RETENTION_DAYS) {
    reasons.push(`retentionDays must be 1–${MAX_RETENTION_DAYS}`);
  }

  if (request.containsPersonalData && !request.consentGranted) {
    reasons.push("personal data requires explicit consent");
  }
  if (!request.consentGranted) reasons.push("no consent — preference memory is opt-in");

  if (reasons.length > 0) return { ok: false, reasons };

  const recordedAt = request.recordedAt ?? timeAuthority.now().at;
  const expiresAt = new Date(
    Date.parse(recordedAt) + retentionDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  return {
    ok: true,
    reasons: ["consented, purpose-scoped and time-bounded"],
    record: {
      id: request.id,
      tenantId: request.tenantId as string,
      subjectId: request.subjectId as string,
      purpose: request.purpose,
      key: request.key,
      value: request.value,
      consentGranted: true,
      containsPersonalData: request.containsPersonalData ?? false,
      recordedAt,
      expiresAt,
    },
  };
}

export interface MemoryQuery {
  tenantId: string;
  subjectId: string;
  purpose?: MemoryPurpose;
  now?: string;
}

/** Readable memory: consent + tenant + subject + retention + purpose scoped. */
export function readExperienceMemory(
  records: readonly ExperienceMemoryRecord[],
  query: MemoryQuery,
): readonly ExperienceMemoryRecord[] {
  const now = Date.parse(query.now ?? timeAuthority.now().at);
  return records
    .filter((record) => record.consentGranted)
    .filter((record) => record.tenantId === query.tenantId)
    .filter((record) => record.subjectId === query.subjectId)
    .filter((record) => (query.purpose ? record.purpose === query.purpose : true))
    .filter((record) => Date.parse(record.expiresAt) > now)
    .sort((left, right) => left.key.localeCompare(right.key));
}

/** Forget: every record for a subject (optionally narrowed to a tenant). */
export function forgetExperienceMemory(
  records: readonly ExperienceMemoryRecord[],
  target: { subjectId: string; tenantId?: string },
): { kept: readonly ExperienceMemoryRecord[]; forgotten: readonly string[] } {
  const kept: ExperienceMemoryRecord[] = [];
  const forgotten: string[] = [];
  for (const record of records) {
    const matches =
      record.subjectId === target.subjectId &&
      (target.tenantId ? record.tenantId === target.tenantId : true);
    if (matches) forgotten.push(record.id);
    else kept.push(record);
  }
  return { kept, forgotten };
}

/** Audit: consent, retention and shape laws over the stored records. */
export function auditExperienceMemory(
  records: readonly ExperienceMemoryRecord[],
  now: string = timeAuthority.now().at,
): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  const nowMs = Date.parse(now);
  for (const record of records) {
    if (seen.has(record.id)) issues.push(`${record.id}: duplicate memory record`);
    seen.add(record.id);
    if (!record.consentGranted) issues.push(`${record.id}: stored without consent`);
    if (!MEMORY_PURPOSES.includes(record.purpose)) issues.push(`${record.id}: unknown purpose`);
    if (record.containsPersonalData && !record.consentGranted) {
      issues.push(`${record.id}: personal data without consent`);
    }
    const retentionDays =
      (Date.parse(record.expiresAt) - Date.parse(record.recordedAt)) / 86_400_000;
    if (retentionDays > MAX_RETENTION_DAYS)
      issues.push(`${record.id}: retention exceeds the ceiling`);
    if (Date.parse(record.expiresAt) <= nowMs) issues.push(`${record.id}: expired record retained`);
  }
  return issues;
}
