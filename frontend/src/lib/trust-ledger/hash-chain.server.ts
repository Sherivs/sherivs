/**
 * Sherivs — universal tamper-evident audit trail (hash chain).
 *
 * Every entry records time, actor (user / agent / system), organization,
 * action, target, IP/device, and SHA-256 hashes of the before/after state
 * (never the raw state). entry_hash = SHA-256(prev_hash || canonical(entry)),
 * chained per organization, so any edit, deletion or reorder breaks
 * verification from that point on. Backing table: public.audit_chain
 * (append-only, migration sherivs_013). Periodically anchor the latest head
 * hash outside the database (e.g. S3 Object Lock) for external proof.
 */
import { createHash } from "node:crypto";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";

const timeAuthority = new TimeAuthority(new SystemClock());
export const GENESIS_HASH = "0".repeat(64);

export type ActorKind = "user" | "agent" | "system";
export interface AuditInput {
  orgId: string; actorKind: ActorKind; actorId: string; action: string; targetType: string; targetId: string;
  ip?: string | null; device?: string | null; before?: unknown; after?: unknown;
}
export interface ChainEntry {
  seq: number; at: string; orgId: string; actorKind: ActorKind; actorId: string; action: string;
  targetType: string; targetId: string; ip: string | null; device: string | null;
  beforeHash: string | null; afterHash: string | null; prevHash: string; entryHash: string;
}
export interface ChainStore { head(orgId: string): Promise<ChainEntry | null>; append(e: ChainEntry): Promise<void>; list(orgId: string): Promise<ChainEntry[]> }

/** Stable JSON: object keys sorted recursively. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
export const stateHash = (v: unknown): string | null => (v === undefined ? null : sha(stableStringify(v)));

function body(e: Omit<ChainEntry, "entryHash">): string {
  return stableStringify([e.seq, e.at, e.orgId, e.actorKind, e.actorId, e.action, e.targetType, e.targetId, e.ip, e.device, e.beforeHash, e.afterHash, e.prevHash]);
}
export const computeEntryHash = (e: Omit<ChainEntry, "entryHash">): string => sha(e.prevHash + body(e));

const ACTION = /^[a-z][a-z0-9_.:-]{1,99}$/;

export class AuditChain {
  private tail = new Map<string, Promise<unknown>>();
  constructor(private readonly store: ChainStore, private readonly now: () => string = () => timeAuthority.now().at) {}

  /** Append serially per org so concurrent writers cannot fork the chain. */
  record(input: AuditInput): Promise<ChainEntry> {
    const prev = this.tail.get(input.orgId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(() => this.appendNow(input));
    this.tail.set(input.orgId, next);
    return next;
  }

  private async appendNow(i: AuditInput): Promise<ChainEntry> {
    if (!i.orgId || !i.actorId || !ACTION.test(i.action)) throw new Error("audit: invalid entry");
    const head = await this.store.head(i.orgId);
    const partial = { seq: (head?.seq ?? 0) + 1, at: this.now(), orgId: i.orgId, actorKind: i.actorKind, actorId: i.actorId,
      action: i.action, targetType: i.targetType, targetId: i.targetId, ip: i.ip ?? null, device: i.device ?? null,
      beforeHash: stateHash(i.before), afterHash: stateHash(i.after), prevHash: head?.entryHash ?? GENESIS_HASH };
    const entry: ChainEntry = { ...partial, entryHash: computeEntryHash(partial) };
    await this.store.append(entry);
    return entry;
  }

  /** Verify an organization's chain; returns the first broken seq, if any. */
  static verify(entries: ChainEntry[]): { ok: true; head: string } | { ok: false; brokenAt: number; reason: string } {
    let prev = GENESIS_HASH;
    const sorted = [...entries].sort((a, b) => a.seq - b.seq);
    for (let k = 0; k < sorted.length; k++) {
      const e = sorted[k];
      if (e.seq !== k + 1) return { ok: false, brokenAt: k + 1, reason: "missing or reordered entry" };
      if (e.prevHash !== prev) return { ok: false, brokenAt: e.seq, reason: "prev hash mismatch" };
      const { entryHash, ...rest } = e;
      if (computeEntryHash(rest) !== entryHash) return { ok: false, brokenAt: e.seq, reason: "entry altered" };
      prev = entryHash;
    }
    return { ok: true, head: prev };
  }
}

export class InMemoryChainStore implements ChainStore {
  rows: ChainEntry[] = [];
  async head(o: string) { const r = this.rows.filter((x) => x.orgId === o); return r[r.length - 1] ?? null; }
  async append(e: ChainEntry) {
    if (this.rows.some((x) => x.orgId === e.orgId && x.seq === e.seq)) throw new Error("audit: seq conflict");
    this.rows.push({ ...e });
  }
  async list(o: string) { return this.rows.filter((x) => x.orgId === o).map((x) => ({ ...x })); }
}
