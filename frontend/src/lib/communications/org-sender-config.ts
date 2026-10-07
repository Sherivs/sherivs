/**
 * CoreGrid — organization communication sender identity (V1, PLATFORM-019).
 *
 * Every organization that connects to CoreGrid can carry its OWN sender
 * identity per channel (SMS today: which E.164 number messages go out
 * under). Platform credentials (Twilio account SID + auth token) remain
 * platform-level environment facts (§19 minimization — they are shared
 * secrets and never per-tenant data); an organization sender selects the
 * FROM identity used on the platform account. When an organization has no
 * active sender, resolution falls back to the platform default number, and
 * when neither exists the result is an explicit unresolved decision — the
 * caller delivers nothing (fail closed), never guesses a number.
 *
 * PURE module: no I/O, no provider imports, no environment reads. Storage
 * lives in `cg_org_communication_sender` (zero-policy, service-role only —
 * see the migration) and is consumed through `org-sender-store.server.ts`.
 *
 * Laws honored here:
 * - §30: a sender record carries a credential REFERENCE (env:// pointer) —
 *   never a secret value; secret-shaped material fails validation.
 * - §13: records from another tenant are excluded AND counted, never mixed.
 * - §65: malformed records are excluded with reasons, never repaired; an
 *   unresolved org reports an explicit reason instead of a guessed sender.
 */

/** Channels an organization sender identity can cover (V1: SMS). */
export const ORG_SENDER_CHANNELS = ["sms"] as const;
export type OrgSenderChannel = (typeof ORG_SENDER_CHANNELS)[number];

/** Providers an organization sender identity can ride on (V1: Twilio). */
export const ORG_SENDER_PROVIDERS = ["twilio"] as const;
export type OrgSenderProvider = (typeof ORG_SENDER_PROVIDERS)[number];

/** Lifecycle statuses. Only `active` senders are ever resolved. */
export const ORG_SENDER_STATUSES = ["active", "suspended", "pending_provision"] as const;
export type OrgSenderStatus = (typeof ORG_SENDER_STATUSES)[number];

/** E.164 shape — kept in lockstep with the Twilio adapter's contract. */
const E164_SHAPE = /^\+[1-9][0-9]{1,14}$/;

export function isE164(value: string): boolean {
  return E164_SHAPE.test(value);
}

/**
 * Credential REFERENCE shapes allowed on a sender record: a pointer into
 * the platform environment (env://NAME). Raw key material of any kind is a
 * construction-time failure (§30 — same hygiene as the provider registry).
 */
const CREDENTIAL_REF_SHAPE = /^env:\/\/[A-Z][A-Z0-9_]{2,127}$/;

/** One stored sender identity of an organization. */
export interface OrgCommunicationSender {
  /** Primary key (opaque text ref, stable across edits). */
  senderRef: string;
  tenantId: string;
  /** The org unit this identity belongs to (cg_org_unit.id within tenant). */
  orgRef: string;
  channel: OrgSenderChannel;
  provider: OrgSenderProvider;
  /** E.164 FROM identity used for outbound messages of this org. */
  fromNumber: string;
  /** env:// pointer to the credential surface — never a secret value. */
  credentialRef: string;
  status: OrgSenderStatus;
  provenance: {
    createdBy: string;
    createdAt: string;
    /** Governance authority for this identity (e.g. DECISIONS.md#210). */
    authorityRef: string | null;
    note: string | null;
  };
}

/** Attribution-completeness validation. Empty list = well-formed record. */
export function validateOrgCommunicationSender(record: OrgCommunicationSender): string[] {
  const problems: string[] = [];
  const isNonEmptyTrimmed = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0;
  if (!isNonEmptyTrimmed(record.senderRef) || record.senderRef.length > 160) {
    problems.push("senderRef is required (1..160 chars)");
  }
  if (!isNonEmptyTrimmed(record.tenantId) || record.tenantId.length > 128) {
    problems.push("tenantId is required (1..128 chars)");
  }
  if (!isNonEmptyTrimmed(record.orgRef) || record.orgRef.length > 160) {
    problems.push("orgRef is required (1..160 chars)");
  }
  if (!(ORG_SENDER_CHANNELS as readonly string[]).includes(record.channel)) {
    problems.push(`channel "${String(record.channel)}" is not a V1 sender channel`);
  }
  if (!(ORG_SENDER_PROVIDERS as readonly string[]).includes(record.provider)) {
    problems.push(`provider "${String(record.provider)}" is not a V1 sender provider`);
  }
  if (!isE164(record.fromNumber)) {
    problems.push("fromNumber must be an E.164 phone number");
  }
  if (!CREDENTIAL_REF_SHAPE.test(record.credentialRef)) {
    problems.push("credentialRef must be an env:// pointer (never a secret value)");
  }
  if (!(ORG_SENDER_STATUSES as readonly string[]).includes(record.status)) {
    problems.push(`status "${String(record.status)}" is not a sender lifecycle status`);
  }
  if (!isNonEmptyTrimmed(record.provenance?.createdBy)) {
    problems.push("provenance.createdBy is required");
  }
  if (typeof record.provenance?.createdAt !== "string" || Number.isNaN(Date.parse(record.provenance.createdAt))) {
    problems.push("provenance.createdAt must be a parseable ISO instant");
  }
  if (record.provenance?.authorityRef !== null && record.provenance?.authorityRef !== undefined && !isNonEmptyTrimmed(record.provenance.authorityRef)) {
    problems.push("provenance.authorityRef must be null or a non-empty string");
  }
  if (record.provenance?.note !== null && record.provenance?.note !== undefined && !isNonEmptyTrimmed(record.provenance.note)) {
    problems.push("provenance.note must be null or a non-empty string");
  }
  return problems;
}

/* ─────────────────────────────────────────────────────────────
 * Resolution (§13 tenant-partitioned, §65 explicit)
 * ────────────────────────────────────────────────────────────*/

export type OrgSenderResolution =
  | {
      resolved: true;
      /** "org_sender" = the organization's own active identity; "platform_default" = the platform env number. */
      source: "org_sender" | "platform_default";
      /** The active org sender, or null when the platform default supplied the identity. */
      sender: OrgCommunicationSender | null;
      fromNumber: string;
      /** Malformed records supplied but excluded (counted, never mixed, never repaired). */
      excludedMalformed: number;
      /** Cross-tenant records supplied but excluded (counted, never mixed). */
      excludedCrossTenant: number;
    }
  | {
      resolved: false;
      source: "none";
      /** Fail-closed reason naming exactly what is missing (no secret values). */
      reason: string;
      excludedMalformed: number;
      excludedCrossTenant: number;
    };

/**
 * Resolve the outbound sender identity for one organization.
 *
 * Deterministic precedence: the org's own ACTIVE sender wins (ties break by
 * createdAt desc then senderRef asc — stable, never input-order dependent);
 * otherwise the platform default env number; otherwise unresolved with an
 * explicit fail-closed reason. Malformed and cross-tenant records are
 * excluded and counted — never repaired, never mixed (§13/§65).
 */
export function resolveSenderForOrg(input: {
  orgRef: string;
  tenantId: string;
  senders: readonly OrgCommunicationSender[];
  /** Platform default FROM number (env TWILIO_FROM_NUMBER) or null. */
  platformFromNumber: string | null;
}): OrgSenderResolution {
  const orgRef = input.orgRef.trim();
  const tenantId = input.tenantId.trim();
  if (orgRef.length === 0 || tenantId.length === 0) {
    throw new Error("org sender resolution rejected: orgRef and tenantId are required");
  }

  let excludedMalformed = 0;
  let excludedCrossTenant = 0;
  const candidates: OrgCommunicationSender[] = [];
  for (const sender of input.senders) {
    const problems = validateOrgCommunicationSender(sender);
    if (problems.length > 0) {
      excludedMalformed += 1;
      continue;
    }
    if (sender.tenantId !== tenantId || sender.orgRef !== orgRef) {
      excludedCrossTenant += 1;
      continue;
    }
    candidates.push(sender);
  }

  const active = candidates
    .filter((sender) => sender.status === "active")
    .sort((a, b) => {
      const atDiff = Date.parse(b.provenance.createdAt) - Date.parse(a.provenance.createdAt);
      if (atDiff !== 0) return atDiff;
      return a.senderRef.localeCompare(b.senderRef);
    });

  if (active.length > 0) {
    const sender = active[0];
    return {
      resolved: true,
      source: "org_sender",
      sender,
      fromNumber: sender.fromNumber,
      excludedMalformed,
      excludedCrossTenant,
    };
  }

  const platformNumber = input.platformFromNumber?.trim() ?? "";
  if (platformNumber.length > 0) {
    if (!isE164(platformNumber)) {
      return {
        resolved: false,
        source: "none",
        reason: "platform default sender is configured but not a well-formed E.164 number — refusing to send (fix TWILIO_FROM_NUMBER or provision an org sender)",
        excludedMalformed,
        excludedCrossTenant,
      };
    }
    return {
      resolved: true,
      source: "platform_default",
      sender: null,
      fromNumber: platformNumber,
      excludedMalformed,
      excludedCrossTenant,
    };
  }

  return {
    resolved: false,
    source: "none",
    reason: `no active sender for org ${orgRef} and no platform default TWILIO_FROM_NUMBER — no message was sent (fail closed)`,
    excludedMalformed,
    excludedCrossTenant,
  };
}