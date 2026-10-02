/**
 * M-H2-01 — shared server-side write-audit hook (frontend/src/lib/server/write-audit.ts).
 *
 * Verifies the §27.6/§12/§29 contract of the hook itself:
 *   - the record persists WHO (actorId/actorEmail), WHICH tenant, WHAT
 *     (action/table/recordId), UNDER WHICH GATE, WHEN, and the OUTCOME;
 *   - FAIL-CLOSED: a rejected audit record throws — an audited write is
 *     never silently passed as unwritten;
 *   - unattributed writes (no actor identity signal) are refused;
 *   - control-plane scope (tenantId: null) is explicit and preserved;
 *   - adoption: every closed §27.6 family awaits the shared hook.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  writeAuditRecord,
  type WriteAuditClient,
  type WriteAuditEntry,
} from "@/lib/server/write-audit";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCHOLAR_DIR = join(ROOT, "frontend/src/lib/runtime/scholar");

type InsertPayload = Record<string, unknown>;

function mockClient(options: { errorMessage?: string } = {}) {
  const inserted: InsertPayload[] = [];
  const client: WriteAuditClient = {
    from(table: string) {
      if (table !== "audit_logs") throw new Error(`unexpected table: ${table}`);
      return {
        insert(payload: InsertPayload) {
          inserted.push(payload);
          return Promise.resolve({
            error: options.errorMessage ? { message: options.errorMessage } : null,
          });
        },
      };
    },
  };
  return { client, inserted };
}

function baseEntry(overrides: Partial<WriteAuditEntry> = {}): WriteAuditEntry {
  return {
    action: "school_settings.update",
    gate: "requireSchoolAdminScope",
    tenantId: "11111111-1111-1111-1111-111111111111",
    actorId: "22222222-2222-2222-2222-222222222222",
    table: "schools",
    recordId: "11111111-1111-1111-1111-111111111111",
    outcome: "succeeded",
    details: { tab: "branding" },
    ...overrides,
  };
}

describe("write-audit hook — record shape (§12 provenance)", () => {
  it("records WHO, WHICH tenant, WHAT, UNDER WHICH GATE, WHEN and OUTCOME", async () => {
    const { client, inserted } = mockClient();
    const before = new Date().toISOString();

    await writeAuditRecord(client, baseEntry());

    expect(inserted).toHaveLength(1);
    const row = inserted[0]!;
    expect(row.school_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(row.user_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(row.action).toBe("school_settings.update");
    expect(row.table_name).toBe("schools");
    expect(row.record_id).toBe("11111111-1111-1111-1111-111111111111");

    const record = row.new_value as Record<string, unknown>;
    expect(record.gate).toBe("requireSchoolAdminScope");
    expect(record.outcome).toBe("succeeded");
    expect(record.actor_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(record.actor_email).toBeNull();
    expect(record.tenant_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(record.details).toEqual({ tab: "branding" });
    const recordedAt = record.recorded_at as string;
    expect(typeof recordedAt).toBe("string");
    expect(new Date(recordedAt).toISOString()).toBe(recordedAt);
    expect(recordedAt >= before).toBe(true);
  });

  it("always writes into audit_logs (the canonical audit substrate)", async () => {
    const { client, inserted } = mockClient();
    await writeAuditRecord(client, baseEntry());
    expect(inserted).toHaveLength(1);
  });

  it("carries the actor email claim for control-plane actors without a canonical user row", async () => {
    const { client, inserted } = mockClient();
    await writeAuditRecord(
      client,
      baseEntry({
        action: "bootstrap.claim_first_super_admin",
        gate: "bootstrap-closed-precondition",
        tenantId: null,
        actorId: null,
        actorEmail: "founder@example.com",
        table: "super_admins",
        details: { actor_user_id: "22222222-2222-2222-2222-222222222222" },
      }),
    );
    const row = inserted[0]!;
    expect(row.school_id).toBeNull();
    expect(row.user_id).toBeNull();
    const record = row.new_value as Record<string, unknown>;
    expect(record.actor_email).toBe("founder@example.com");
    expect(record.tenant_id).toBeNull();
    expect(record.gate).toBe("bootstrap-closed-precondition");
  });
});

describe("write-audit hook — fail-closed enforcement", () => {
  it("THROWS when the substrate rejects the audit record (never silently passes)", async () => {
    const { client, inserted } = mockClient({ errorMessage: "row-level security violation" });
    await expect(writeAuditRecord(client, baseEntry())).rejects.toThrow(
      /audit record rejected for "school_settings\.update".*row-level security violation/,
    );
    expect(inserted).toHaveLength(1);
  });

  it("refuses to persist an unattributed write — WHO is mandatory", async () => {
    const { client, inserted } = mockClient();
    await expect(
      writeAuditRecord(client, baseEntry({ actorId: null, actorEmail: null })),
    ).rejects.toThrow(/unattributed write/);
    expect(inserted).toHaveLength(0);
  });

  it("refuses an undeclared tenant scope — WHICH tenant must be explicit", async () => {
    const { client, inserted } = mockClient();
    await expect(
      writeAuditRecord(client, baseEntry({ tenantId: undefined as unknown as string | null })),
    ).rejects.toThrow(/tenant scope must be declared explicitly/);
    expect(inserted).toHaveLength(0);
  });
});

describe("write-audit hook — call-site discipline (§27.6 adoption)", () => {
  it("every closed family awaits the shared hook after its canonical write", () => {
    const expectations: Readonly<Record<string, readonly RegExp[]>> = {
      "school-settings.functions.ts": [
        /await writeAuditRecord\(/,
        /action:\s*"school_settings\.update"/,
        /gate:\s*"requireSchoolAdminScope"/,
      ],
      "teachers.functions.ts": [
        /await writeAuditRecord\(/,
        /action:\s*"teacher\.invite"/,
        /action:\s*"teacher\.set_active"/,
      ],
      "facilities.functions.ts": [
        /await writeAuditRecord\(/,
        /action:\s*"facilities\.meals_upsert"/,
        /action:\s*"facilities\.transport_upsert"/,
      ],
      "staff-accounts.functions.ts": [
        /await writeAuditRecord\(/,
        /action:\s*"staff_account\.reset_password"/,
        /gate:\s*"decideAccountAdministration"/,
      ],
      "provisioning.functions.ts": [
        /await writeAuditRecord\(/,
        /action:\s*"bootstrap\.claim_first_super_admin"/,
        /gate:\s*"bootstrap-closed-precondition"/,
      ],
    };
    for (const [file, markers] of Object.entries(expectations)) {
      const src = readFileSync(join(SCHOLAR_DIR, file), "utf8");
      for (const marker of markers) {
        expect(src, `${file} must adopt the shared write-audit hook`).toMatch(marker);
      }
    }
  });

  it("no audited credential path ever records the credential itself (§29)", () => {
    for (const file of ["teachers.functions.ts", "staff-accounts.functions.ts"]) {
      const src = readFileSync(join(SCHOLAR_DIR, file), "utf8");
      expect(src, `${file}: write-audit details must not carry password fields`).not.toMatch(
        /details:\s*\{[^}]*password/i,
      );
    }
  });
});
