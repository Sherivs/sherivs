import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import readXlsxFile from "read-excel-file/node";
import { sheetToRows } from "@/lib/integrations-hub/connectors/xlsx";
import { previewImport } from "@/lib/integrations-hub/connectors/csv";
import { suggestMappings } from "@/lib/integrations-hub/sdk";
import { AwsKms, awsKmsFromEnv, type KmsLikeClient } from "@/lib/credential-vault/aws-kms.server";
import { CredentialVault, InMemoryCredentialStore } from "@/lib/credential-vault/vault.server";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

describe("xlsx import", () => {
  it("reads every sheet, converts dates, numbers and Excel-stripped phone zeros", async () => {
    const sheets = await readXlsxFile(readFileSync("tests/fixtures/integrations/students.xlsx"));
    expect(sheets.map((s) => s.sheet)).toEqual(["Students", "Staff"]);
    const { headers, rows } = sheetToRows(sheets[0].data as never);
    expect(rows).toHaveLength(2);
    const pv = previewImport(rows, suggestMappings(headers, "student"));
    expect(pv.records[0].data.date_of_birth).toBe("2012-09-05");
    expect(pv.records[1].data.date_of_birth).toBe("2013-02-01");
    expect(pv.records[1].data.guardian_phone).toBe("+2348051234567");
  });
});

/** Fake KMS: wraps DEKs with a local key, bound to the encryption context like AWS does. */
function fakeKms(): KmsLikeClient & { calls: string[] } {
  const master = randomBytes(32);
  const calls: string[] = [];
  const ctx = (c: Record<string, string>) => Buffer.from(JSON.stringify(Object.entries(c).sort()));
  return {
    calls,
    async generateDataKey(i) {
      calls.push(`gdk:${i.KeyId}:${i.EncryptionContext.org_id}`);
      const pt = randomBytes(32);
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", master, iv);
      c.setAAD(ctx(i.EncryptionContext));
      const ct = Buffer.concat([c.update(pt), c.final()]);
      return {
        Plaintext: Uint8Array.from(pt),
        CiphertextBlob: Buffer.concat([iv, c.getAuthTag(), ct]),
      };
    },
    async decrypt(i) {
      calls.push(`dec:${i.KeyId}:${i.EncryptionContext.org_id}`);
      const b = Buffer.from(i.CiphertextBlob);
      const d = createDecipheriv("aes-256-gcm", master, b.subarray(0, 12));
      d.setAAD(ctx(i.EncryptionContext));
      d.setAuthTag(b.subarray(12, 28));
      return { Plaintext: Uint8Array.from(Buffer.concat([d.update(b.subarray(28)), d.final()])) };
    },
  };
}

describe("AWS KMS adapter", () => {
  it("round-trips a credential through the vault with alias/sherivs-tenant", async () => {
    const k = fakeKms();
    const store = new InMemoryCredentialStore();
    const vault = new CredentialVault(new AwsKms(k, "alias/sherivs-tenant"), store);
    await vault.put({
      orgId: "school-a",
      provider: "integration.rest-webhook",
      name: "abc",
      secret: "whsec_x",
      actor: "u",
    });
    const rec = await store.get("school-a", "integration.rest-webhook", "abc");
    expect(rec?.keyVersion).toBe("aws-kms:alias/sherivs-tenant");
    expect(rec?.ciphertext).not.toContain("whsec_x");
    expect(
      await vault.withCredential("school-a", "integration.rest-webhook", "abc", async (s) => s),
    ).toBe("whsec_x");
    expect(k.calls).toEqual([
      "gdk:alias/sherivs-tenant:school-a",
      "dec:alias/sherivs-tenant:school-a",
    ]);
  });
  it("a data key wrapped for school A cannot be unwrapped for school B", async () => {
    const kms = new AwsKms(fakeKms(), "alias/sherivs-tenant");
    const { wrapped } = await kms.generateDataKey({
      purpose: "sherivs-org-credential",
      org_id: "A",
    });
    await expect(
      kms.unwrapDataKey(wrapped, { purpose: "sherivs-org-credential", org_id: "B" }),
    ).rejects.toThrow();
    await expect(
      kms.unwrapDataKey({ ...wrapped, keyVersion: "local-v1" }, { org_id: "A" }),
    ).rejects.toThrow(/unknown key version/);
  });
  it("is off unless configured, and rejects bad key ids", async () => {
    expect(await awsKmsFromEnv({})).toBeNull();
    expect(() => new AwsKms(fakeKms(), "not a key")).toThrow();
    const real = await awsKmsFromEnv({
      SHERIVS_VAULT_KMS: "aws",
      SHERIVS_KMS_REGION: "eu-north-1",
    });
    expect(real?.keyVersion).toBe("aws-kms:alias/sherivs-tenant");
  });
});
