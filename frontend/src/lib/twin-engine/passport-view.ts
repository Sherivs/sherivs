/**
 * Sherivs Entity Engine — passport view builder (ENGINE-01, ADR-077).
 *
 * Turns the rows a person is allowed to read (their twin, contexts and trust
 * records, filtered by row-level security) plus the Role Pack definitions into
 * the view the shell renders. The effective autonomy of every capability is
 * computed here from the pack and the earned trust, never stored or trusted
 * from a client.
 *
 * Pure: no I/O. A pack that fails validation yields a context with no
 * capabilities (fail closed) rather than an error or a guess.
 */
import {
  effectiveAutonomy,
  type EffectiveAutonomy,
  type TrustRecord,
  type TrustState,
} from "./autonomy-ladder";
import { parseRolePack, type RolePack, type RolePackTier } from "./role-pack";

export interface TwinPersonRow {
  readonly id: string;
  readonly identity_id: string;
  readonly status: string;
}

export interface TwinContextRow {
  readonly id: string;
  readonly context_kind: string;
  readonly tenant_ref: string;
  readonly role_code: string;
  readonly status: string;
  readonly pack_code: string | null;
  readonly pack_version: string | null;
}

export interface TwinTrustRow {
  readonly context_id: string;
  readonly capability_id: string;
  readonly state: string;
  readonly sheriff_promotion_id: string | null;
}

export interface PackRow {
  readonly code: string;
  readonly version: string;
  readonly definition: unknown;
}

export interface PassportCapabilityView {
  readonly id: string;
  readonly title: string;
  readonly tier: RolePackTier;
  readonly packAutonomy: string;
  readonly effective: EffectiveAutonomy;
  readonly trustState: TrustState;
}

export interface PassportContextView {
  readonly contextId: string;
  readonly kind: string;
  readonly roleCode: string;
  readonly status: string;
  readonly packCode: string | null;
  readonly packVersion: string | null;
  readonly capabilities: readonly PassportCapabilityView[];
}

export interface PassportView {
  readonly twinId: string;
  readonly identityId: string;
  readonly status: string;
  readonly contexts: readonly PassportContextView[];
}

const STATES: readonly TrustState[] = ["shadow", "propose", "assist", "autonomous"];
const asState = (s: string): TrustState => STATES.find((x) => x === s) ?? "shadow";

export function buildPassportView(input: {
  readonly person: TwinPersonRow;
  readonly contexts: readonly TwinContextRow[];
  readonly trust: readonly TwinTrustRow[];
  readonly packs: readonly PackRow[];
}): PassportView {
  const packs = new Map<string, RolePack>();
  for (const row of input.packs) {
    const parsed = parseRolePack(row.definition);
    if (parsed.ok) packs.set(`${row.code}@${row.version}`, parsed.pack);
  }
  const contexts = input.contexts.map((c): PassportContextView => {
    const pack =
      c.pack_code && c.pack_version ? packs.get(`${c.pack_code}@${c.pack_version}`) : undefined;
    const trustById = new Map(
      input.trust.filter((t) => t.context_id === c.id).map((t) => [t.capability_id, t] as const),
    );
    // A suspended context exposes no capabilities; an invalid or missing pack
    // exposes none either (fail closed).
    const capabilities =
      c.status === "active" && pack
        ? pack.capabilities.map((cap): PassportCapabilityView => {
            const row = trustById.get(cap.id);
            const record: TrustRecord | undefined = row
              ? row.sheriff_promotion_id === null
                ? { capabilityId: cap.id, state: asState(row.state) }
                : {
                    capabilityId: cap.id,
                    state: asState(row.state),
                    sheriffPromotionId: row.sheriff_promotion_id,
                  }
              : undefined;
            return {
              id: cap.id,
              title: cap.title,
              tier: cap.tier,
              packAutonomy: cap.autonomy,
              effective: effectiveAutonomy(cap, record),
              trustState: record?.state ?? "shadow",
            };
          })
        : [];
    return {
      contextId: c.id,
      kind: c.context_kind,
      roleCode: c.role_code,
      status: c.status,
      packCode: c.pack_code,
      packVersion: c.pack_version,
      capabilities,
    };
  });
  return {
    twinId: input.person.id,
    identityId: input.person.identity_id,
    status: input.person.status,
    contexts,
  };
}
