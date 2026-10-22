/**
 * Sherivs Vault — per-organization credential vault.
 *
 * Each organization (tenant) has its own data key, wrapped by the KMS master
 * key and bound to the org id via encryption context. Credentials are stored
 * only as AES-256-GCM ciphertext bound to (org, provider, name). Plaintext
 * exists only in memory inside `withCredential` and is zeroed afterwards.
 * Maps to table public.org_credentials (migration sherivs_012).
 */
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import { encryptionContextAad, open, seal, type KmsAdapter } from "./kms.server";

export interface OrgCredentialRecord {
  id: string;
  orgId: string;
  provider: string; // e.g. "paystack", "whatsapp", "bulksms"
  name: string; // e.g. "secret_key"
  ciphertext: string;
  wrappedDek: string;
  keyVersion: string;
  createdBy: string;
  createdAt: string;
  rotatedAt: string | null;
}

export interface CredentialStore {
  get(orgId: string, provider: string, name: string): Promise<OrgCredentialRecord | null>;
  put(record: OrgCredentialRecord): Promise<void>;
}

export class InMemoryCredentialStore implements CredentialStore {
  private rows = new Map<string, OrgCredentialRecord>();
  private k(o: string, p: string, n: string) { return `${o}|${p}|${n}`; }
  async get(o: string, p: string, n: string) { return this.rows.get(this.k(o, p, n)) ?? null; }
  async put(r: OrgCredentialRecord) { this.rows.set(this.k(r.orgId, r.provider, r.name), { ...r }); }
}

const timeAuthority = new TimeAuthority(new SystemClock());
const systemNow = (): Date => new Date(timeAuthority.now().atMs);

const SLUG = /^[a-z0-9][a-z0-9_.-]{0,62}$/;

export class CredentialVault {
  constructor(private readonly kms: KmsAdapter, private readonly store: CredentialStore,
    private readonly now: () => Date = systemNow) {}

  private ctx(orgId: string) { return { purpose: "sherivs-org-credential", org_id: orgId }; }
  private aad(orgId: string, provider: string, name: string) {
    return encryptionContextAad({ org_id: orgId, provider, name });
  }

  /** Store or rotate a credential. A fresh DEK is generated on every write. */
  async put(input: { orgId: string; provider: string; name: string; secret: string; actor: string }): Promise<void> {
    const { orgId, provider, name, secret, actor } = input;
    if (!orgId || !SLUG.test(provider) || !SLUG.test(name)) throw new Error("vault: invalid credential address");
    if (!secret) throw new Error("vault: empty secret");
    const existing = await this.store.get(orgId, provider, name);
    const { plaintext: dek, wrapped } = await this.kms.generateDataKey(this.ctx(orgId));
    const pt = Buffer.from(secret, "utf8");
    try {
      const ts = this.now().toISOString();
      await this.store.put({
        id: existing?.id ?? crypto.randomUUID(), orgId, provider, name,
        ciphertext: seal(dek, pt, this.aad(orgId, provider, name)),
        wrappedDek: wrapped.wrapped, keyVersion: wrapped.keyVersion,
        createdBy: existing?.createdBy ?? actor, createdAt: existing?.createdAt ?? ts,
        rotatedAt: existing ? ts : null,
      });
    } finally { dek.fill(0); pt.fill(0); }
  }

  async exists(orgId: string, provider: string, name: string): Promise<boolean> {
    return (await this.store.get(orgId, provider, name)) !== null;
  }

  /** Decrypt, hand the value to `fn`, then zero it. The value is never returned. */
  async withCredential<T>(orgId: string, provider: string, name: string, fn: (secret: string) => Promise<T>): Promise<T> {
    const rec = await this.store.get(orgId, provider, name);
    if (!rec) throw new Error("vault: credential not found");
    const dek = await this.kms.unwrapDataKey({ wrapped: rec.wrappedDek, keyVersion: rec.keyVersion }, this.ctx(orgId));
    let pt: Buffer | null = null;
    try {
      pt = open(dek, rec.ciphertext, this.aad(orgId, provider, name));
      return await fn(pt.toString("utf8"));
    } finally { dek.fill(0); pt?.fill(0); }
  }
}
