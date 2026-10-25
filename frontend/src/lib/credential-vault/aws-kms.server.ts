/**
 * Sherivs Vault — AWS KMS adapter (production key management).
 *
 * Envelope encryption: KMS GenerateDataKey returns a fresh 256-bit DEK (plaintext + KMS
 * ciphertext). The DEK seals one credential with AES-256-GCM (vault.server.ts) and is zeroed;
 * only the KMS ciphertext is stored (org_credentials.wrapped_dek). Unwrap = KMS Decrypt.
 * The tenant id is bound as the KMS EncryptionContext, so a DEK wrapped for school A cannot
 * be unwrapped for school B (KMS refuses; CloudTrail logs both).
 *
 * Config (all env, nothing in git):
 *   SHERIVS_VAULT_KMS=aws               enable this adapter
 *   SHERIVS_KMS_KEY_ID=alias/sherivs-tenant
 *   SHERIVS_KMS_REGION=eu-north-1       (falls back to AWS_REGION)
 *   credentials: default AWS provider chain (Vercel OIDC role or AWS_ACCESS_KEY_ID/SECRET).
 * Required IAM (not created by this PR): see docs/integrations/KMS-IAM.md.
 */
import type { KmsAdapter, WrappedKey } from "./kms.server";

/** Minimal surface of @aws-sdk/client-kms used here, so tests can inject a fake. */
export interface KmsLikeClient {
  generateDataKey(i: {
    KeyId: string;
    KeySpec: "AES_256";
    EncryptionContext: Record<string, string>;
  }): Promise<{ Plaintext?: Uint8Array; CiphertextBlob?: Uint8Array; KeyId?: string }>;
  decrypt(i: {
    CiphertextBlob: Uint8Array;
    KeyId: string;
    EncryptionContext: Record<string, string>;
  }): Promise<{ Plaintext?: Uint8Array }>;
}

export const AWS_KMS_VERSION_PREFIX = "aws-kms:";

export class AwsKms implements KmsAdapter {
  readonly keyVersion: string;
  constructor(
    private readonly client: KmsLikeClient,
    private readonly keyId: string,
  ) {
    if (
      !/^(alias\/[\w/-]+|arn:aws:kms:[\w-]+:\d{12}:(key|alias)\/[\w/-]+|[0-9a-f-]{36})$/.test(keyId)
    )
      throw new Error("vault: invalid KMS key id");
    this.keyVersion = AWS_KMS_VERSION_PREFIX + keyId;
  }

  async generateDataKey(context: Record<string, string>) {
    const r = await this.client.generateDataKey({
      KeyId: this.keyId,
      KeySpec: "AES_256",
      EncryptionContext: context,
    });
    if (!r.Plaintext || !r.CiphertextBlob || r.Plaintext.length !== 32)
      throw new Error("vault: KMS returned no data key");
    const plaintext = Buffer.from(r.Plaintext);
    r.Plaintext.fill(0);
    return {
      plaintext,
      wrapped: {
        wrapped: Buffer.from(r.CiphertextBlob).toString("base64"),
        keyVersion: this.keyVersion,
      },
    };
  }

  async unwrapDataKey(w: WrappedKey, context: Record<string, string>) {
    if (!w.keyVersion.startsWith(AWS_KMS_VERSION_PREFIX))
      throw new Error(`vault: unknown key version ${w.keyVersion}`);
    const r = await this.client.decrypt({
      CiphertextBlob: Buffer.from(w.wrapped, "base64"),
      KeyId: w.keyVersion.slice(AWS_KMS_VERSION_PREFIX.length),
      EncryptionContext: context,
    });
    if (!r.Plaintext || r.Plaintext.length !== 32) throw new Error("vault: KMS decrypt failed");
    const out = Buffer.from(r.Plaintext);
    r.Plaintext.fill(0);
    return out;
  }
}

/** Build the adapter from env, or null when not configured (callers then fail closed with 503). */
export async function awsKmsFromEnv(
  env: Record<string, string | undefined> = process.env,
): Promise<AwsKms | null> {
  if (env.SHERIVS_VAULT_KMS !== "aws") return null;
  const keyId = env.SHERIVS_KMS_KEY_ID ?? "alias/sherivs-tenant";
  const region = env.SHERIVS_KMS_REGION ?? env.AWS_REGION ?? "eu-north-1";
  const { KMSClient, GenerateDataKeyCommand, DecryptCommand } = await import("@aws-sdk/client-kms");
  const kms = new KMSClient({ region, maxAttempts: 3 });
  const client: KmsLikeClient = {
    generateDataKey: (i) => kms.send(new GenerateDataKeyCommand(i)),
    decrypt: (i) => kms.send(new DecryptCommand(i)),
  };
  return new AwsKms(client, keyId);
}
