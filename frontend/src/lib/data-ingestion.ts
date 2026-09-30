/**
 * CoreGrid — data ingestion boundary (Phase 14, domain-neutral).
 *
 * Everything that enters the platform from outside arrives through a declared boundary.
 * The boundary is where an untrusted record becomes a governed one, so this engine makes
 * the following non-negotiable:
 *
 *   - an endpoint declares its source, its purpose, its classification, its schema version
 *     and the natural key that identifies a record; an external source must be signed;
 *   - ingestion requires authority: an endpoint that is not declared authorised refuses
 *     the batch rather than accepting it quietly;
 *   - a record that cannot be understood is REJECTED WITH A REASON, never dropped: silent
 *     loss is the failure mode that makes data platforms untrustworthy;
 *   - a record already seen under the same natural key is reported as a duplicate and
 *     ingested once, because a replayed feed must not double-count;
 *   - every accepted record carries provenance (source, endpoint, batch, correlation,
 *     classification, purpose), so "where did this come from?" has an answer;
 *   - a batch may not claim a LOWER classification than its endpoint declares.
 *
 * A domain phase asked for exactly this when it recorded that nothing arrives from real
 * systems through an authorised boundary yet; the boundary is the platform's, the meaning
 * of the records is the domain's.
 */
import { classificationRank, type DataClassification } from "./data-core";

export type IngestionSourceKind =
  | "internal-service"
  | "external-provider"
  | "file"
  | "webhook"
  | "database"
  | "meter"
  | "manual-entry";

export interface IngestionSource {
  readonly sourceId: string;
  readonly kind: IngestionSourceKind;
  /** An external source must prove itself: unsigned external input is refused. */
  readonly signed: boolean;
}

export interface IngestionEndpoint {
  readonly endpointId: string;
  readonly name: string;
  /** The phase that owns the meaning of what arrives here. */
  readonly ownerPhase: string;
  readonly source: IngestionSource;
  readonly authorised: boolean;
  readonly classification: DataClassification;
  /** Why this data may be held at all. */
  readonly purpose: string;
  /** The fields that identify a record, used for duplicate detection. */
  readonly naturalKey: readonly string[];
  readonly schemaVersion: string;
  readonly rejectsOnUnknownFields?: boolean;
}

export type EndpointVerdict =
  | { readonly ok: true; readonly endpoint: IngestionEndpoint }
  | { readonly ok: false; readonly refusals: readonly string[] };

/** Declare an ingestion endpoint. Anything missing here is a hole in the boundary. */
export function declareIngestionEndpoint(endpoint: IngestionEndpoint): EndpointVerdict {
  const refusals: string[] = [];
  if (!endpoint.endpointId?.trim()) refusals.push("an endpoint must be identified");
  if (!endpoint.ownerPhase?.trim())
    refusals.push("an endpoint must name the phase that owns the data's meaning");
  if (!endpoint.purpose?.trim())
    refusals.push("an endpoint must declare why the data is held at all");
  if (!endpoint.authorised)
    refusals.push("an endpoint must be declared authorised before it may accept anything");
  if (endpoint.naturalKey.length === 0) {
    refusals.push(
      "an endpoint must declare the fields that identify a record, or duplicates cannot be detected",
    );
  }
  if (!endpoint.schemaVersion?.trim())
    refusals.push("an endpoint must name the schema version it expects");
  if (!endpoint.source.signed && endpoint.source.kind === "external-provider") {
    refusals.push(
      "an external provider feed must be signed: unsigned external input is not evidence",
    );
  }
  return refusals.length === 0 ? { ok: true, endpoint } : { ok: false, refusals };
}

export interface IngestionBatch {
  readonly batchId: string;
  readonly endpointId: string;
  readonly receivedAt: string;
  readonly correlationId: string;
  /** The classification the sender believes the payload carries. */
  readonly declaredClassification: DataClassification;
  readonly records: readonly Readonly<Record<string, unknown>>[];
}

export interface RejectedRecord {
  readonly index: number;
  readonly reason: string;
  /** The natural key when it could be read, so the sender can correct the record. */
  readonly naturalKey: string | null;
}

export interface IngestionProvenance {
  readonly sourceId: string;
  readonly endpointId: string;
  readonly batchId: string;
  readonly receivedAt: string;
  readonly correlationId: string;
  readonly classification: DataClassification;
  readonly purpose: string;
  readonly schemaVersion: string;
  readonly accepted: number;
  readonly rejected: number;
  readonly duplicates: number;
}

export type IngestionOutcome =
  | {
      readonly ok: true;
      readonly accepted: readonly Readonly<Record<string, unknown>>[];
      readonly rejected: readonly RejectedRecord[];
      readonly duplicates: readonly string[];
      readonly provenance: IngestionProvenance;
    }
  | { readonly ok: false; readonly error: string };

/**
 * Ingest a batch through a declared endpoint. Nothing is dropped silently: every record
 * is either accepted with provenance, rejected with a reason, or reported as a duplicate.
 */
export function ingestBatch(input: {
  readonly endpoint: IngestionEndpoint;
  readonly batch: IngestionBatch;
  /** Natural keys already held, so a replay cannot double-count. */
  readonly seenNaturalKeys?: readonly string[];
  /** Fields the endpoint's schema version defines, when unknown fields must be refused. */
  readonly knownFields?: readonly string[];
}): IngestionOutcome {
  const { endpoint, batch } = input;

  if (!endpoint.authorised) {
    return {
      ok: false,
      error: `endpoint ${endpoint.endpointId} is not authorised: ingestion is refused`,
    };
  }
  if (batch.endpointId !== endpoint.endpointId) {
    return {
      ok: false,
      error: `batch claims endpoint ${batch.endpointId} but was offered to ${endpoint.endpointId}`,
    };
  }
  if (!batch.correlationId?.trim()) {
    return {
      ok: false,
      error: "a batch must carry the correlation that ties it to the operation that sent it",
    };
  }
  if (
    classificationRank(batch.declaredClassification) < classificationRank(endpoint.classification)
  ) {
    return {
      ok: false,
      error: `batch declares ${batch.declaredClassification} while the endpoint holds ${endpoint.classification}: a payload is never re-classified downwards`,
    };
  }

  const seen = new Set(input.seenNaturalKeys ?? []);
  const accepted: Readonly<Record<string, unknown>>[] = [];
  const rejected: RejectedRecord[] = [];
  const duplicates: string[] = [];

  batch.records.forEach((record, index) => {
    const keyParts: string[] = [];
    let keyComplete = true;
    for (const field of endpoint.naturalKey) {
      const value = record[field];
      if (value === undefined || value === null || value === "") {
        keyComplete = false;
        break;
      }
      keyParts.push(`${field}=${String(value)}`);
    }
    const naturalKey = keyComplete ? `${endpoint.endpointId}:${keyParts.join("|")}` : null;

    if (!keyComplete) {
      rejected.push({
        index,
        reason: `record does not carry its natural key (${endpoint.naturalKey.join(", ")}), so it cannot be identified`,
        naturalKey: null,
      });
      return;
    }
    if (input.knownFields && endpoint.rejectsOnUnknownFields) {
      const unknown = Object.keys(record).filter((field) => !input.knownFields?.includes(field));
      if (unknown.length > 0) {
        rejected.push({
          index,
          reason: `record carries field(s) the declared schema version does not define: ${unknown.join(", ")}`,
          naturalKey,
        });
        return;
      }
    }
    if (seen.has(naturalKey as string)) {
      duplicates.push(naturalKey as string);
      return;
    }
    seen.add(naturalKey as string);
    accepted.push(record);
  });

  return {
    ok: true,
    accepted,
    rejected,
    duplicates,
    provenance: {
      sourceId: endpoint.source.sourceId,
      endpointId: endpoint.endpointId,
      batchId: batch.batchId,
      receivedAt: batch.receivedAt,
      correlationId: batch.correlationId,
      classification: endpoint.classification,
      purpose: endpoint.purpose,
      schemaVersion: endpoint.schemaVersion,
      accepted: accepted.length,
      rejected: rejected.length,
      duplicates: duplicates.length,
    },
  };
}

/** Explain an outcome in words a sending system can act on. */
export function explainIngestion(outcome: IngestionOutcome): string {
  if (!outcome.ok) return `refused: ${outcome.error}`;
  const { provenance, rejected } = outcome;
  const parts = [
    `${provenance.accepted} of ${provenance.accepted + provenance.rejected + provenance.duplicates} records accepted from ${provenance.sourceId} under purpose "${provenance.purpose}"`,
  ];
  if (provenance.duplicates > 0)
    parts.push(`${provenance.duplicates} already held (replay ignored)`);
  for (const record of rejected) parts.push(`record ${record.index} rejected: ${record.reason}`);
  return parts.join("; ");
}
