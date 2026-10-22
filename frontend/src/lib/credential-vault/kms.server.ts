/**
 * Sherivs Vault — key-wrapping interface (envelope encryption).
 *
 * A KMS adapter wraps / unwraps per-organization data keys (DEKs). The master
 * key never leaves the adapter. Production uses AWS KMS (adapter to be added in
 * the next phase, behind this same interface); tests and local dev use
 * LocalKms, which keeps an in-process master key and must never run in prod.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface WrappedKey {
  /** Opaque wrapped DEK (base64). */
  wrapped: string;
  /** Identifier of the master key / version that wrapped it. */
  keyVersion: string;
}

export interface KmsAdapter {
  /** Generate a new 256-bit DEK; returns plaintext (caller must zero it) and wrapped form. */
  generateDataKey(context: Record<string, string>): Promise<{ plaintext: Buffer; wrapped: WrappedKey }>;
  /** Unwrap a DEK. `context` must match the one used at generation (AAD binding). */
  unwrapDataKey(wrapped: WrappedKey, context: Record<string, string>): Promise<Buffer>;
}

function aad(context: Record<string, string>): Buffer {
  const keys = Object.keys(context).sort();
  return Buffer.from(JSON.stringify(keys.map((k) => [k, context[k]])), "utf8");
}

/** AES-256-GCM seal: iv(12) | tag(16) | ciphertext, base64. */
export function seal(key: Buffer, plaintext: Buffer, additional: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(additional);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function open(key: Buffer, sealed: string, additional: Buffer): Buffer {
  const raw = Buffer.from(sealed, "base64");
  if (raw.length < 29) throw new Error("vault: malformed ciphertext");
  const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  d.setAAD(additional);
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
}

export { aad as encryptionContextAad };

/** Local / test adapter. Refuses to construct when NODE_ENV=production. */
export class LocalKms implements KmsAdapter {
  private readonly master: Buffer;
  constructor(readonly keyVersion = "local-v1", master?: Buffer) {
    if (process.env.NODE_ENV === "production" && !master) {
      throw new Error("LocalKms must not be used in production");
    }
    this.master = master ?? randomBytes(32);
  }
  async generateDataKey(context: Record<string, string>) {
    const plaintext = randomBytes(32);
    const wrapped = { wrapped: seal(this.master, plaintext, aad(context)), keyVersion: this.keyVersion };
    return { plaintext, wrapped };
  }
  async unwrapDataKey(w: WrappedKey, context: Record<string, string>) {
    if (w.keyVersion !== this.keyVersion) throw new Error(`vault: unknown key version ${w.keyVersion}`);
    return open(this.master, w.wrapped, aad(context));
  }
}
