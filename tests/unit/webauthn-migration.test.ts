import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const sql = readFileSync(
  join(ROOT, "database/supabase/migrations/20261028001000_sherivs_webauthn_passkeys.sql"),
  "utf8",
);
const prefsSql = readFileSync(
  join(ROOT, "database/supabase/migrations/20261028002000_sherivs_webauthn_preferences.sql"),
  "utf8",
);
const rpSql = readFileSync(
  join(ROOT, "database/supabase/migrations/20261028003000_sherivs_webauthn_credential_rp.sql"),
  "utf8",
);
const functions = readFileSync(join(ROOT, "frontend/src/lib/auth/webauthn.functions.ts"), "utf8");
const client = readFileSync(join(ROOT, "frontend/src/lib/auth/webauthn-client.ts"), "utf8");
const envExample = readFileSync(join(ROOT, ".env.example"), "utf8");

describe("WebAuthn migration and wiring", () => {
  it("keys credentials to auth.users, not public.users", () => {
    expect(sql).toMatch(/user_id\s+uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
    expect(sql).not.toMatch(/REFERENCES public\.users/);
  });

  it("stores only public-key credential metadata and never biometrics", () => {
    expect(sql).toMatch(/credential_id\s+text NOT NULL/);
    expect(sql).toMatch(/public_key\s+text NOT NULL/);
    expect(sql).toMatch(/Never stores biometric/);
    expect(sql).not.toMatch(/fingerprint_image|face_template|private_key/);
  });

  it("makes challenges unique, expiring, and single-use via SECURITY DEFINER consume", () => {
    expect(sql).toMatch(/CONSTRAINT webauthn_challenges_challenge_key UNIQUE \(challenge\)/);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.webauthn_consume_challenge/);
    expect(sql).toMatch(/consumed_at IS NULL/);
    expect(sql).toMatch(/expires_at > now\(\)/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.webauthn_consume_challenge/);
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.webauthn_consume_challenge\(text, text\)\s+TO service_role/,
    );
  });

  it("revokes table access from anon and authenticated", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.webauthn_credentials, public\.webauthn_challenges\s+FROM PUBLIC, anon, authenticated/,
    );
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/);
  });

  it("keeps registration behind requireSupabaseAuth and authentication public", () => {
    expect(functions).toMatch(/export const getPasskeyRegistrationOptions = createServerFn/);
    expect(functions).toMatch(/export const verifyPasskeyRegistration = createServerFn/);
    expect(functions).toMatch(/export const getPasskeyAuthenticationOptions = createServerFn/);
    expect(functions).toMatch(/export const verifyPasskeyAuthentication = createServerFn/);
    const registerBlock = functions.slice(
      functions.indexOf("export const getPasskeyRegistrationOptions"),
      functions.indexOf("export const getPasskeyAuthenticationOptions"),
    );
    expect(registerBlock).toMatch(/middleware\(\[requireSupabaseAuth\]\)/);
    const authBlock = functions.slice(
      functions.indexOf("export const getPasskeyAuthenticationOptions"),
    );
    expect(authBlock).toMatch(
      /export const getPasskeyAuthenticationOptions = createServerFn\(\{ method: "POST" \}\)\.handler/,
    );
    expect(client).toMatch(/supabase\.auth\.setSession/);
    expect(client).toMatch(/device's supported verification method/);
    expect(client.toLowerCase()).not.toMatch(/fingerprint authentication confirmed/);
  });

  it("keeps passkey preferences distinct from credentials and service-role only", () => {
    expect(prefsSql).toMatch(/CREATE TABLE IF NOT EXISTS public\.webauthn_preferences/);
    expect(prefsSql).toMatch(/onboarding_status\s+text NOT NULL DEFAULT 'pending'/);
    expect(prefsSql).toMatch(/passkey_first\s+boolean NOT NULL DEFAULT true/);
    expect(prefsSql).toMatch(/REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
    expect(prefsSql).not.toMatch(/REFERENCES public\.users/);
    expect(prefsSql).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(prefsSql).toMatch(
      /REVOKE ALL ON TABLE public\.webauthn_preferences\s+FROM PUBLIC, anon, authenticated/,
    );
    expect(prefsSql).toMatch(/Not proof of a registered credential/);
  });

  it("scopes credentials to the RP ID they were registered under without rewriting existing keys", () => {
    expect(rpSql).toMatch(/ADD COLUMN IF NOT EXISTS rp_id text NOT NULL DEFAULT 'sherivs\.com'/);
    expect(rpSql).toMatch(/webauthn_credentials_user_rp_idx/);
    expect(rpSql).not.toMatch(/UPDATE public\.webauthn_credentials SET credential_id/);
  });

  it("documents server-only WebAuthn env vars without client prefixes", () => {
    expect(envExample).toMatch(/WEBAUTHN_RP_NAME=Sherivs/);
    expect(envExample).toMatch(/WEBAUTHN_RP_ID=localhost/);
    expect(envExample).toMatch(/WEBAUTHN_RP_ID=sherivs\.com/);
    expect(envExample).toMatch(/WEBAUTHN_ORIGIN=https:\/\/app\.sherivs\.com/);
    expect(envExample).not.toMatch(/VITE_WEBAUTHN_/);
    expect(envExample).not.toMatch(/NEXT_PUBLIC_WEBAUTHN_/);
  });

  it("keeps email confirmation as an invite-time property, not a passkey side effect", () => {
    const session = readFileSync(
      join(ROOT, "frontend/src/lib/auth/webauthn-session.server.ts"),
      "utf8",
    );
    const service = readFileSync(join(ROOT, "frontend/src/lib/auth/webauthn.server.ts"), "utf8");
    expect(session).not.toMatch(/\bemail_confirm\b/);
    expect(session).not.toMatch(/updateUserById/);
    expect(service).not.toMatch(/\bemail_confirm\b/);
    expect(session).toMatch(/email_confirmed_at/);
  });
});

