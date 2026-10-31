import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../database/supabase/migrations/20261101000010_sherivs_whatsapp_cloud.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL(
    "../../../database/supabase/rollbacks/20261101000010_sherivs_whatsapp_cloud.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("WhatsApp Cloud migration posture", () => {
  it("binds conversations and message rows to the same organization", () => {
    expect(migration).toContain("UNIQUE (school_id, channel, phone)");
    expect(migration).toContain("FOREIGN KEY (school_id, conversation_id)");
    expect(migration).toContain("u.school_id = v_school");
    expect(migration).toContain("IF v_user_count = 1 THEN");
    expect(migration).toContain("comms_whatsapp_sender_school");
  });

  it("restricts provider status updates to the verified service webhook", () => {
    expect(migration).toContain("'sent', 'delivered', 'read', 'failed'");
    expect(migration).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(migration).toContain("m.school_id = p_school AND m.channel = 'whatsapp'");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.comms_whatsapp_status");
  });

  it("audits message changes without copying phone numbers or message bodies", () => {
    expect(migration).toContain("INSERT INTO public.audit_logs");
    expect(migration).toContain("CREATE TRIGGER trg_inbound_messages_whatsapp_audit");
    expect(migration).toContain("CREATE TRIGGER trg_outbound_messages_whatsapp_audit");
    expect(migration).not.toContain("to_jsonb(NEW) ||");
    expect(migration).not.toMatch(/'body'\s*,\s*to_jsonb/);
  });

  it("has a rollback for every WhatsApp-specific object and status constraint", () => {
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.comms_whatsapp_status");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.comms_conversations");
    expect(rollback).toContain("DROP COLUMN IF EXISTS conversation_id");
    expect(rollback).toContain("'queued','sent_stub','sent','delivered','failed'");
  });
});
