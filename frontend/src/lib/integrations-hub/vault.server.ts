/**
 * Integration secrets live in the Sherivs Vault (org_credentials, SHERIVS-012) only.
 * This store reads/writes ciphertext rows with the service role; plaintext never touches a table.
 * KMS: AWS KMS (alias/sherivs-tenant) when SHERIVS_VAULT_KMS=aws; LocalKms only outside
 * production with SHERIVS_VAULT_DEV_MASTER_KEY. Otherwise null, and callers answer 503
 * instead of falling back to anything weaker.
 */
import {
  CredentialVault,
  LocalKms,
  type CredentialStore,
  type OrgCredentialRecord,
} from "@/lib/credential-vault";

type Row = {
  id: string;
  org_id: string;
  provider: string;
  name: string;
  ciphertext: string;
  wrapped_dek: string;
  key_version: string;
  created_by: string | null;
  created_at: string;
  rotated_at: string | null;
};
type Loose = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export class SupabaseCredentialStore implements CredentialStore {
  constructor(private readonly db: Loose) {}
  async get(orgId: string, provider: string, name: string): Promise<OrgCredentialRecord | null> {
    const { data, error } = await this.db
      .from("org_credentials")
      .select("*")
      .eq("org_id", orgId)
      .eq("provider", provider)
      .eq("name", name)
      .maybeSingle();
    if (error) throw new Error("vault: read failed");
    const r = data as Row | null;
    return r
      ? {
          id: r.id,
          orgId: r.org_id,
          provider: r.provider,
          name: r.name,
          ciphertext: r.ciphertext,
          wrappedDek: r.wrapped_dek,
          keyVersion: r.key_version,
          createdBy: r.created_by ?? "",
          createdAt: r.created_at,
          rotatedAt: r.rotated_at,
        }
      : null;
  }
  async put(r: OrgCredentialRecord): Promise<void> {
    const { error } = await this.db.from("org_credentials").upsert(
      {
        id: r.id,
        org_id: r.orgId,
        provider: r.provider,
        name: r.name,
        ciphertext: r.ciphertext,
        wrapped_dek: r.wrappedDek,
        key_version: r.keyVersion,
        created_by: r.createdBy || null,
        created_at: r.createdAt,
        rotated_at: r.rotatedAt,
      },
      { onConflict: "org_id,provider,name" },
    );
    if (error) throw new Error("vault: write failed");
  }
}

let cached: CredentialVault | null | undefined;
export async function getIntegrationVault(): Promise<CredentialVault | null> {
  if (cached !== undefined) return cached;
  const master = process.env.SHERIVS_VAULT_DEV_MASTER_KEY; // base64, non-production only
  if (process.env.NODE_ENV === "production" || !master) {
    cached = null;
    return cached;
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  cached = new CredentialVault(
    new LocalKms("local-v1", Buffer.from(master, "base64")),
    new SupabaseCredentialStore(supabaseAdmin as unknown as Loose),
  );
  return cached;
}
