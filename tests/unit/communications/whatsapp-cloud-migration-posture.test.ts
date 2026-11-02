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
const e2eMigration = readFileSync(
  new URL(
    "../../../database/supabase/migrations/20261103000100_sherivs_whatsapp_e2e_durable.sql",
    import.meta.url,
  ),
  "utf8",
);
const e2eRollback = readFileSync(
  new URL(
    "../../../database/supabase/rollbacks/20261103000100_sherivs_whatsapp_e2e_durable.sql",
    import.meta.url,
  ),
  "utf8",
);
const tenantBindingMigration = readFileSync(
  new URL(
    "../../../database/supabase/migrations/20261103000200_sherivs_whatsapp_tenant_binding_n8n.sql",
    import.meta.url,
  ),
  "utf8",
);
const tenantBindingRollback = readFileSync(
  new URL(
    "../../../database/supabase/rollbacks/20261103000200_sherivs_whatsapp_tenant_binding_n8n.sql",
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

  describe("durable WhatsApp automation migration", () => {
    it("uses forced RLS and service-role-only durable event and dead-letter storage", () => {
      expect(e2eMigration).toContain("CREATE TABLE public.cg_whatsapp_inbound_event");
      expect(e2eMigration).toContain("PRIMARY KEY (provider_sender_ref, provider_ref)");
      expect(e2eMigration).toContain("CREATE TABLE public.cg_whatsapp_dead_letter");
      expect(e2eMigration).toContain("FORCE ROW LEVEL SECURITY");
      expect(e2eMigration).toContain("REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated");
      expect(e2eMigration).toContain("GRANT ALL ON public.%I TO service_role");
      expect(e2eMigration).toContain(
        "tenant_id = public.get_my_tenant_id() AND public.is_tenant_admin(tenant_id)",
      );
      expect(e2eMigration.match(/CREATE POLICY cg_whatsapp_.*_tenant_select/g)).toHaveLength(5);
      expect(e2eMigration).toContain("CREATE OR REPLACE FUNCTION public.cg_whatsapp_receive(");
      expect(e2eMigration).toContain(
        "REVOKE ALL ON FUNCTION public.cg_whatsapp_receive(text, text, text, text)",
      );
      expect(e2eMigration).not.toContain(
        "DROP FUNCTION public.cg_whatsapp_receive(text, text, text, text)",
      );
    });

    describe("tenant binding and signed n8n forwarding migration", () => {
      it("binds every send to an inbound event, origin sender, conversation and canonical recipient", () => {
        expect(tenantBindingMigration).toContain("CHECK (channel IN ('sms', 'whatsapp', 'voice'))");
        expect(tenantBindingMigration).toContain(
          "(channel = 'whatsapp' AND provider = 'meta_cloud')",
        );
        expect(tenantBindingMigration).toContain(
          "cg_whatsapp_prepare_send(text, text, text, text, text, uuid, text, text)",
        );
        expect(tenantBindingMigration).toContain("e.provider_sender_ref = p_provider_sender_ref");
        expect(tenantBindingMigration).toContain("m.conversation_id = p_conversation_id");
        expect(tenantBindingMigration).toContain("c.status = 'opted_in'");
        expect(tenantBindingMigration).toContain("recipient_hash");
        expect(tenantBindingMigration).toContain(
          "encode(sha256(convert_to(v_recipient, 'UTF8')), 'hex')",
        );
        expect(tenantBindingMigration).toContain("body_hash text NOT NULL");
        expect(tenantBindingMigration).toContain(
          "CREATE OR REPLACE FUNCTION public.cg_whatsapp_prepare_send(",
        );
        expect(tenantBindingMigration).toContain(
          "REVOKE ALL ON FUNCTION public.cg_whatsapp_prepare_send(text, text, text, text, text)",
        );
        expect(tenantBindingMigration).not.toContain(
          "DROP FUNCTION public.cg_whatsapp_prepare_send(text, text, text, text, text)",
        );
        expect(tenantBindingMigration).toContain("lease_until <= now()");
        expect(tenantBindingMigration).toContain(
          "cg_whatsapp_n8n_reply.body_hash = EXCLUDED.body_hash",
        );
        expect(tenantBindingMigration).toContain(
          "cg_whatsapp_n8n_reply_result(text, text, text, uuid, uuid, text)",
        );
        expect(tenantBindingMigration).toContain(
          "CREATE TRIGGER cg_whatsapp_send_audit_append_only",
        );
        expect(tenantBindingMigration).toContain("WhatsApp send audit is append-only");
        expect(tenantBindingRollback).toContain(
          "DROP FUNCTION IF EXISTS public.cg_whatsapp_send_audit_immutable()",
        );
        expect(tenantBindingRollback).toContain(
          "DROP FUNCTION IF EXISTS public.cg_whatsapp_n8n_reply_result(text, text, text, uuid, uuid, text)",
        );
      });

      it("stores inbound forwarding in a tenant/org/conversation scoped forced-RLS outbox", () => {
        expect(tenantBindingMigration).toContain("CREATE TABLE public.cg_whatsapp_n8n_outbox");
        expect(tenantBindingMigration).toContain("CREATE TABLE public.cg_whatsapp_n8n_dead_letter");
        expect(tenantBindingMigration).toContain("UNIQUE (tenant_id, message_id)");
        expect(tenantBindingMigration).toContain("FOR UPDATE SKIP LOCKED");
        expect(tenantBindingMigration).toContain("attempt_count < 8");
        expect(tenantBindingMigration).toContain(
          "CREATE POLICY cg_whatsapp_n8n_outbox_tenant_select",
        );
        expect(tenantBindingMigration).toContain(
          "CREATE POLICY cg_whatsapp_n8n_dead_letter_tenant_select",
        );
        expect(tenantBindingMigration).toContain("ALTER TABLE public.%I FORCE ROW LEVEL SECURITY");
        expect(tenantBindingRollback).toContain(
          "DROP TABLE IF EXISTS public.cg_whatsapp_n8n_outbox",
        );
        expect(tenantBindingRollback).toContain(
          "DROP TABLE IF EXISTS public.cg_whatsapp_n8n_dead_letter",
        );
      });

      it("does not add function-level custom GUC settings and requires server-only reply RPCs", () => {
        expect(tenantBindingMigration).not.toMatch(/ALTER FUNCTION[^;]*SET\s+coregrid\./i);
        expect(tenantBindingMigration).toContain("public.cg_whatsapp_prepare_n8n_reply");
        expect(tenantBindingMigration).toContain(
          "GRANT EXECUTE ON FUNCTION public.cg_whatsapp_prepare_n8n_reply",
        );
        expect(tenantBindingMigration).toContain("FROM PUBLIC, anon, authenticated");
        expect(tenantBindingMigration).toContain("PRIMARY KEY (tenant_id, reply_id)");
      });
    });

    it("dedupes provider message IDs and applies an atomic per-sender one-minute limit", () => {
      expect(e2eMigration).toContain("ON CONFLICT (provider_sender_ref, provider_ref) DO NOTHING");
      expect(e2eMigration).toContain("v_rate_count > 30");
      expect(e2eMigration).toContain("interval '1 minute'");
      expect(e2eMigration).toContain(
        "VALUES (p_provider_sender_ref, p_provider_ref, 'message', 'rate_limited')",
      );
    });

    it("claims automatic replies once and checks the 24-hour window and current opt-in", () => {
      expect(e2eMigration).toContain("CREATE FUNCTION public.cg_whatsapp_prepare_auto_ack");
      expect(e2eMigration).toContain("m.provider_created_at >= now() - interval '24 hours'");
      expect(e2eMigration).toContain("m.provider_created_at <= now()");
      expect(e2eMigration).toContain("c.status = 'opted_in'");
      expect(e2eMigration).toContain("recipient_address text");
      expect(e2eMigration).toContain("ON CONFLICT (inbound_provider_ref) DO NOTHING");
      expect(tenantBindingMigration).toContain(
        "ON CONFLICT ON CONSTRAINT cg_whatsapp_auto_ack_pkey DO NOTHING",
      );
      expect(e2eMigration).toContain("requested_by = p_reviewer_ref");
      expect(e2eMigration).toContain("provider_status_at = now()");
    });

    it("supports reviewed existing-member links and exposes only aggregate health data", () => {
      expect(e2eMigration).toContain("public.is_tenant_admin(p_tenant_id)");
      expect(e2eMigration).toContain("m.principal_ref = p_principal_ref AND m.state = 'active'");
      expect(e2eMigration).toContain("public.cg_whatsapp_review_recipient_link");
      expect(e2eMigration).toContain("public.cg_whatsapp_request_recipient_link_internal");
      expect(e2eMigration).toContain("CREATE OR REPLACE FUNCTION public.cg_whatsapp_health()");
      expect(e2eMigration).toContain("mapped_sender_count bigint");
      expect(e2eMigration).toContain("unmapped_sender_count bigint");
      expect(e2eRollback).toContain("DROP TABLE IF EXISTS public.cg_whatsapp_inbound_event");
    });

    it("scopes recipient-link listing to a single tenant", () => {
      expect(e2eMigration).toContain(
        "CREATE OR REPLACE FUNCTION public.cg_whatsapp_list_recipient_link_requests(p_tenant_id text)",
      );
      expect(e2eMigration).toContain("WHERE r.tenant_id = p_tenant_id");
    });

    it("has a rollback that restores the prior receiver and removes only new WhatsApp objects", () => {
      expect(e2eRollback).toContain("CREATE OR REPLACE FUNCTION public.cg_whatsapp_receive");
      expect(e2eRollback).toContain(
        "DROP TABLE IF EXISTS public.cg_whatsapp_recipient_link_request",
      );
      expect(e2eRollback).toContain("DROP TABLE IF EXISTS public.cg_whatsapp_auto_ack");
      expect(e2eRollback).toContain("DROP TABLE IF EXISTS public.cg_whatsapp_dead_letter");
      expect(e2eRollback).toContain("DROP COLUMN IF EXISTS provider_status_at");
    });
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
