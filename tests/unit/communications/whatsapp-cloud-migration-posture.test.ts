import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../database/supabase/migrations/20261101000020_sherivs_whatsapp_cloud.sql",
    import.meta.url,
  ),
  "utf8",
);
const rollback = readFileSync(
  new URL(
    "../../../database/supabase/rollbacks/20261101000020_sherivs_whatsapp_cloud.sql",
    import.meta.url,
  ),
  "utf8",
);

const fix = readFileSync(
  new URL(
    "../../../database/supabase/migrations/20261101100100_sherivs_whatsapp_receive_phone_regex_fix.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("WhatsApp receive phone regex fix", () => {
  it("uses a single-backslash E.164 regex that accepts +2349015056201", () => {
    expect(fix).not.toContain("\\\\+");
    const match = fix.match(/p_from !~ '([^']+)'/);
    expect(match?.[1]).toBe("^\\+[1-9][0-9]{7,14}$");
    expect(new RegExp(match![1]).test("+2349015056201")).toBe(true);
    expect(new RegExp(match![1]).test("2349015056201")).toBe(false);
  });

  it("keeps the receive function service-role only and adds a service-role sender mapping RPC", () => {
    expect(fix).toContain("CREATE OR REPLACE FUNCTION public.cg_whatsapp_receive");
    expect(fix).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(fix).toContain("CREATE OR REPLACE FUNCTION public.cg_whatsapp_map_sender");
    expect(fix).toContain("GRANT EXECUTE ON FUNCTION public.cg_whatsapp_map_sender");
    expect(fix).toContain("TO service_role");
    expect(fix).not.toContain("school_id");
  });
});

describe("WhatsApp Cloud migration posture", () => {
  it("uses the shared tenant/org keys and sender registry", () => {
    expect(migration).toContain("tenant_id text NOT NULL");
    expect(migration).toContain("org_ref text NOT NULL");
    expect(migration).toContain("public.cg_org_communication_sender");
    expect(migration).toContain("public.cg_org_membership");
    expect(migration).toContain("s.provider_sender_ref = p_provider_sender_ref");
    expect(migration).not.toContain("school_id");
  });

  it("forces RLS and prevents direct client access to communication records", () => {
    expect(migration.match(/ FORCE ROW LEVEL SECURITY/g)).toHaveLength(5);
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).toMatch(
      /ALTER TABLE public\.cg_communication_message ENABLE ROW LEVEL SECURITY;\s*ALTER TABLE public\.cg_communication_message FORCE ROW LEVEL SECURITY;/,
    );
    expect(migration).toMatch(
      /ALTER TABLE public\.cg_communication_conversation ENABLE ROW LEVEL SECURITY;\s*ALTER TABLE public\.cg_communication_conversation FORCE ROW LEVEL SECURITY;/,
    );
  });

  it("resolves inbound participants only from an active tenant/org membership", () => {
    expect(migration).toContain("m.tenant_id = r.tenant_id AND m.org_unit_id = r.org_ref");
    expect(migration).toContain("m.principal_ref = r.principal_ref AND m.state = 'active'");
    expect(migration).toContain("ON CONFLICT (tenant_id, org_ref, channel, address)");
  });

  it("resolves outbound destinations from active membership and explicit opt-in", () => {
    expect(migration).toContain("public.cg_whatsapp_prepare_send");
    expect(migration).toContain("p_principal_ref");
    expect(migration).toContain("c.status = 'opted_in'");
    expect(migration).toContain("provider_sender_ref text, recipient_address text");
    expect(migration).not.toContain("p_to text");
  });

  it("audits message and consent changes in the append-only audit chain", () => {
    expect(migration).toContain("INSERT INTO public.audit_chain");
    expect(migration).toContain("public.audit_chain_canonical_hash");
    expect(migration).toContain("CREATE TRIGGER cg_communication_message_audit");
    expect(migration).toContain("CREATE TRIGGER cg_communication_optin_audit");
    expect(migration).not.toMatch(/'body'\s*,\s*to_jsonb/);
  });

  it("restricts provider callbacks to service-role RPCs and has a matching rollback", () => {
    expect(migration).toContain("coalesce(auth.role(), '') <> 'service_role'");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.cg_whatsapp_status");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.cg_whatsapp_receive");
    expect(rollback).toContain("DROP FUNCTION IF EXISTS public.cg_whatsapp_status");
    expect(rollback).toContain("DROP TABLE IF EXISTS public.cg_communication_message");
    expect(rollback).toContain("DROP COLUMN IF EXISTS provider_sender_ref");
    expect(rollback).toContain("CHECK (channel = 'sms')");
  });
});
