/**
 * CoreGrid — MISSION-R-103 LIVE storage verification (credential-gated).
 *
 * Executes the tenant-scoped adapter against the canonical project's real
 * Supabase Storage through the service-role client factory: ensure bucket →
 * put → get (byte-identical) → signed URL → cross-tenant denial → cleanup.
 *
 * Gating law: the suite is SKIPPED unless SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY are injected (credential-free runs never see it,
 * so `npm run verify` stays hermetic where secrets are absent). The probe
 * object lives under a dedicated probe tenant and is removed in a finally
 * block; no secret value is ever printed (failure messages from the adapter
 * carry provider text only).
 */
import { describe, expect, it } from "vitest";
import {
  FILE_BUCKET,
  putTenantObject,
  getTenantObject,
  createTenantSignedUrl,
} from "../../frontend/src/lib/files/storage-adapter.server";
import { serviceStorageFromEnv } from "../../frontend/src/lib/files/storage-service.server";

const LIVE_CREDENTIALS = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const PROBE_TENANT = "cg-probe-mr103";
const PROBE_BODY = "coregrid mr103 live probe — safe to delete";

describe.skipIf(!LIVE_CREDENTIALS)(
  "live: service-role storage through the adapter (MISSION-R-103)",
  () => {
    it(
      "puts, reads, signs and removes a probe object with tenant-path enforcement",
      { timeout: 60_000 },
      async () => {
        const composed = serviceStorageFromEnv();
        if (!composed.ok) throw new Error(`service storage composition denied: ${composed.reason}`);
        const deps = composed.client;

        // Ensure the single V1 bucket exists (idempotent; service role may create it).
        const bucket = deps.bucket ?? FILE_BUCKET;
        const ensured = await deps.client.storage.createBucket(bucket, { public: false });
        if (ensured.error) {
          const message = ensured.error.message.toLowerCase();
          const alreadyExists =
            message.includes("exist") || message.includes("duplicate") || message.includes("409");
          if (!alreadyExists) {
            throw new Error(`bucket provisioning failed closed: ${ensured.error.message}`);
          }
        }

        let objectPath: string | null = null;
        try {
          const put = await putTenantObject(deps, {
            tenantId: PROBE_TENANT,
            purpose: "evidence",
            filename: "mr103-live-probe.txt",
            body: PROBE_BODY,
            contentType: "text/plain",
          });
          if (!put.ok) throw new Error(`live put denied: ${put.code} ${put.reason}`);
          expect(put.objectPath).toBe(`${PROBE_TENANT}/evidence/mr103-live-probe.txt`);
          objectPath = put.objectPath;

          const get = await getTenantObject(deps, PROBE_TENANT, objectPath);
          if (!get.ok) throw new Error(`live get denied: ${get.code} ${get.reason}`);
          expect(await get.data.text()).toBe(PROBE_BODY);

          const signed = await createTenantSignedUrl(deps, PROBE_TENANT, objectPath, 60);
          if (!signed.ok) throw new Error(`live signed url denied: ${signed.code} ${signed.reason}`);
          expect(signed.signedUrl).toContain(bucket);
          expect(signed.expiresInSeconds).toBe(60);

          // The path convention holds live: another tenant's path is denied
          // BEFORE any storage I/O, even under service role.
          const crossTenant = await getTenantObject(deps, "cg-probe-other-tenant", objectPath);
          expect(crossTenant).toMatchObject({ ok: false, code: "tenant_path_required" });
        } finally {
          if (objectPath) {
            await deps.client.storage.from(bucket).remove([objectPath]);
          }
        }
      },
    );
  },
);
