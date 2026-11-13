import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261101000050_sherivs_108_org_voice_agent_addon.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261101000050_sherivs_108_org_voice_agent_addon.sql"),
  "utf8",
);
const SERVER_FUNCTIONS = readFileSync(
  join(ROOT, "frontend/src/lib/communications/voice-agent.functions.ts"),
  "utf8",
);
const CONSENT_HELPER = readFileSync(
  join(ROOT, "frontend/src/lib/communications/voice-consent.server.ts"),
  "utf8",
);

describe("organization voice-agent migration posture", () => {
  it("uses only the tenant-neutral organization key in the migration", () => {
    expect(MIGRATION).toContain("tenant_ref text PRIMARY KEY");
    expect(MIGRATION).toContain("ALTER TABLE public.voice_call_sessions");
    expect(MIGRATION).toContain("ADD COLUMN IF NOT EXISTS tenant_ref text");
    expect(MIGRATION).not.toMatch(/\bschool_id\b/i);
    expect(MIGRATION).not.toMatch(/\b(?:scholar|attendance|fee)\b/i);
  });

  it("defaults the add-on off and forces RLS with no client table grants", () => {
    expect(MIGRATION).toContain("enabled boolean NOT NULL DEFAULT false");
    expect(MIGRATION).toContain("ALTER TABLE public.cg_org_voice_agent FORCE ROW LEVEL SECURITY;");
    expect(MIGRATION).toContain(
      "ALTER TABLE public.cg_voice_call_approvals FORCE ROW LEVEL SECURITY;",
    );
    expect(MIGRATION).toContain(
      "REVOKE ALL ON public.cg_org_voice_agent, public.cg_voice_call_approvals",
    );
    expect(MIGRATION).toContain("FROM PUBLIC, anon, authenticated, service_role;");
  });

  it("uses only the existing Africa's Talking voice provider", () => {
    expect(MIGRATION).toContain("channel = 'voice' AND provider = 'africas_talking'");
    expect(MIGRATION).toContain("provider = 'africas_talking'");
    expect(SERVER_FUNCTIONS).toContain('provider: z.literal("africas_talking")');
    expect(SERVER_FUNCTIONS).not.toContain("twilio-voice.server");
    const voiceProviderCheck = MIGRATION.match(
      /ADD CONSTRAINT cg_org_communication_sender_provider_check([\s\S]*?),\s*ADD COLUMN/s,
    )?.[1];
    expect(voiceProviderCheck).toContain("channel = 'voice' AND provider = 'africas_talking'");
    expect(voiceProviderCheck).not.toContain("channel = 'voice' AND provider = 'twilio'");
  });

  it("checks consent in the server boundary and requires a different admin for approval", () => {
    expect(SERVER_FUNCTIONS).toContain("assertVoiceRecipientConsent");
    expect(CONSENT_HELPER).toContain("voice_agent_assert_recipient_consent");
    expect(CONSENT_HELPER).not.toContain("phoneConfirmed: true");
    expect(CONSENT_HELPER).not.toContain("users.school_id");
    expect(MIGRATION).toContain(
      "GRANT EXECUTE ON FUNCTION public.voice_agent_request_call(text, text, text, text, text)",
    );
    expect(MIGRATION).toContain("FROM PUBLIC, anon, authenticated;");
    const authenticatedGrant = MIGRATION.match(
      /GRANT EXECUTE ON FUNCTION ([\s\S]*?) TO authenticated;/,
    )?.[1];
    expect(authenticatedGrant).toBeDefined();
    expect(authenticatedGrant).not.toContain("voice_agent_request_call");
    expect(MIGRATION).toContain("the requester cannot approve or reject their own call");
  });

  it("keeps live dispatch separately gated, organization-rate-limited, and metered", () => {
    expect(MIGRATION).toContain("public.flag_on('voice_live', v_tenant::uuid)");
    expect(MIGRATION).toContain("public.flag_on('voice_live', v_tenant)");
    expect(MIGRATION).toContain(">= 20 THEN");
    expect(MIGRATION).toContain(">= 10 THEN");
    expect(MIGRATION).toContain("public.meter_consume(v_tenant, 'voice_minutes'");
    expect(MIGRATION).toContain("period_key = v_call.usage_period");
    const finishCall = MIGRATION.split(
      "CREATE OR REPLACE FUNCTION public.voice_agent_finish_call",
    )[1];
    expect([...finishCall.matchAll(/UPDATE public\.usage_counters/g)]).toHaveLength(1);
  });

  it("appends canonical audit-chain entries and provides a symmetric rollback", () => {
    expect(MIGRATION).toContain("public.audit_chain_canonical_hash(");
    expect(MIGRATION).toContain("CREATE TRIGGER cg_voice_call_approvals_audit");
    expect(ROLLBACK).toContain("DROP TABLE IF EXISTS public.cg_voice_call_approvals;");
    expect(ROLLBACK).toContain(
      "ALTER TABLE public.voice_call_sessions DROP COLUMN IF EXISTS tenant_ref;",
    );
    expect(ROLLBACK).toContain("audit_chain entries are retained as immutable evidence.");
    expect(ROLLBACK).toContain("BEGIN;");
    expect(ROLLBACK).toContain("COMMIT;");
  });
});
