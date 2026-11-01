import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const scopeLock = readFileSync(
  new URL(
    "database/supabase/migrations/20261101001000_sherivs_033_communication_scope_lock.sql",
    root,
  ),
  "utf8",
);
const sharedGateway = readFileSync(
  new URL("database/supabase/migrations/20261101000020_sherivs_whatsapp_cloud.sql", root),
  "utf8",
);
const localIsolation = readFileSync(
  new URL("tests/integration/sherivs-033-communication-isolation.local.sql", root),
  "utf8",
);

describe("cross-school communications isolation", () => {
  it("binds inbox reads and outbox delivery to the authenticated organization and exact member", () => {
    expect(scopeLock).toContain("org_id = public.get_my_school_id()");
    expect(scopeLock).toContain("recipient_user_id = auth.uid()");
    expect(scopeLock).toContain("sender_user_id = auth.uid()");
    expect(scopeLock).toContain("NEW.org_id IS DISTINCT FROM NEW.school_id");
    expect(scopeLock).toContain("m.school_id = NEW.org_id AND m.is_active");
    expect(scopeLock).toContain("outbound address does not match the organization member");
    expect(scopeLock).toContain("outbound phone is not verified for the organization member");
  });

  it("resolves AI audience members and student guardians only inside the requested school", () => {
    expect(scopeLock).toContain("om.school_id = p_org AND om.is_active");
    expect(scopeLock).toContain("s.school_id = p_org AND s.class_id = v_class");
    expect(scopeLock).toContain("s.school_id = p_org AND s.id = v_student");
    expect(scopeLock).toContain("pm.school_id = p_org AND pm.student_id = s.id");
    expect(scopeLock).toContain("v.proposed_by = auth.uid()");
    expect(localIsolation).toContain("AI audience cannot draft for a student in org B from org A");
  });

  it("routes WhatsApp replies by the registered sender and current verified phone context", () => {
    expect(sharedGateway).toContain("s.provider_sender_ref = p_provider_sender_ref");
    expect(sharedGateway).toContain(
      "r.tenant_id = v_sender.tenant_id AND r.org_ref = v_sender.org_ref",
    );
    expect(sharedGateway).toContain(
      "VALUES (v_sender.tenant_id, v_sender.org_ref, 'whatsapp', p_from, v_principal)",
    );
    expect(scopeLock).toContain("au.phone_confirmed_at IS NOT NULL");
    expect(scopeLock).toContain("v_context.state = 'selected' AND m.school_id = v_context.org_id");
    expect(scopeLock).toContain("v_context.channel IS NOT NULL");
    expect(localIsolation).toContain("stale phone context fails closed");
    expect(localIsolation).toContain("shared guardian must choose organization");
    expect(localIsolation).toContain("spoofed phone for the shared parent");
  });

  it("keeps database negative tests for list, search, inbound, draft, outbox, and replies", () => {
    for (const evidence of [
      "shared guardian cannot list org B outbound",
      "shared guardian cannot search org B outbound",
      "shared guardian cannot list or search org B inbound",
      "authenticated user cannot call provider inbound router",
      "outbox rejects a spoofed phone for the shared parent",
      "stale phone cannot append an inbound message",
    ]) {
      expect(localIsolation).toContain(evidence);
    }
  });
});
