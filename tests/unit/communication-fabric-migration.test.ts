import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../database/supabase/migrations/20261101001000_sherivs_033_communication_scope_lock.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("V1 communication fabric scope lock", () => {
  it("binds each communications table to the existing organization identity and forces RLS", () => {
    for (const table of [
      "comms_templates",
      "comms_optins",
      "outbound_messages",
      "comms_sender_numbers",
      "inbound_messages",
    ]) {
      expect(migration).toMatch(new RegExp(`ALTER TABLE public\\.${table}[\\s\\S]*?org_id`));
      expect(migration).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY;`);
    }
  });

  it("resolves audience specifications only through active organization memberships", () => {
    expect(migration).toContain("comms_propose_send");
    expect(migration).toContain("'guardian_of_student'");
    expect(migration).toContain("om.school_id = p_org AND om.is_active");
    expect(migration).toContain("au.phone_confirmed_at IS NOT NULL");
    expect(migration).toContain("au.email_confirmed_at IS NOT NULL");
  });

  it("requires a different organization approver and a released proposal for every outbound send", () => {
    expect(migration).toContain("v.proposed_by = auth.uid()");
    expect(migration).toContain(
      "every outbound message must originate from an approved organization proposal",
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.comms_send\([\s\S]*?\) TO service_role;/,
    );
    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.comms_send\([^;]*TO authenticated/i,
    );
  });

  it("limits message reads to the active organization and recipient or broadcast permission", () => {
    expect(migration).toContain("recipient_user_id = auth.uid()");
    expect(migration).toContain("sender_user_id = auth.uid()");
    expect(migration).toContain("org_id = public.get_my_school_id()");
    expect(migration).toContain("public.scholar_can(org_id, 'comms.broadcast')");
  });
});
