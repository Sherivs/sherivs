/**
 * SHERIVS-090 server functions. Issue (or rotate) the inbound webhook signing secret for a
 * rest-webhook integration. The secret is shown to the admin ONCE and stored only in the vault.
 */
import { createServerFn } from "@tanstack/react-start";
import { randomBytes } from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getIntegrationVault } from "./vault.server";

type Loose = { from: (t: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export const issueWebhookSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => {
    const id = (i as { id?: unknown })?.id;
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
      throw new Error("invalid integration id");
    return { id };
  })
  .handler(async ({ data, context }) => {
    // RLS: the caller can only read the integration if they administer its school.
    const user = context.supabase as unknown as Loose;
    const { data: row } = await user
      .from("integrations")
      .select("id, school_id, connector_key, credential_provider, credential_name, webhook_id")
      .eq("id", data.id)
      .maybeSingle();
    const i = row as {
      id: string;
      school_id: string;
      connector_key: string;
      credential_provider: string | null;
      credential_name: string | null;
      webhook_id: string;
    } | null;
    if (!i) throw new Error("not allowed");
    if (i.connector_key !== "rest-webhook" || !i.credential_provider || !i.credential_name)
      throw new Error("this connector does not use a webhook secret");
    const vault = await getIntegrationVault();
    if (!vault) throw new Error("The Sherivs Vault is not configured on this deployment yet");
    const secret = "whsec_" + randomBytes(32).toString("base64url");
    await vault.put({
      orgId: i.school_id,
      provider: i.credential_provider,
      name: i.credential_name,
      secret,
      actor: String(context.userId ?? ""),
    });
    return { secret, webhookPath: `/api/public/webhooks/integrations/${i.webhook_id}` };
  });

const CREDENTIAL_FIELDS: Record<string, string[]> = {
  fedena: ["client_id", "client_secret", "username", "password", "redirect_uri"],
  moodle: ["token"],
  oneroster: ["client_id", "client_secret"],
};

/** Store a pull connector's credentials (Fedena, Moodle, OneRoster) in the vault. Never returned again. */
export const saveConnectorCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => {
    const v = i as { id?: unknown; fields?: unknown };
    if (typeof v?.id !== "string" || !/^[0-9a-f-]{36}$/i.test(v.id))
      throw new Error("invalid integration id");
    if (!v.fields || typeof v.fields !== "object") throw new Error("missing credentials");
    const fields: Record<string, string> = {};
    for (const [k, val] of Object.entries(v.fields as Record<string, unknown>)) {
      if (typeof val !== "string" || val.length > 2000 || !/^[a-z_]{2,30}$/.test(k))
        throw new Error("invalid credential field");
      fields[k] = val;
    }
    return { id: v.id, fields };
  })
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as Loose;
    const { data: row } = await user
      .from("integrations")
      .select("id, school_id, connector_key, credential_provider, credential_name")
      .eq("id", data.id)
      .maybeSingle();
    const i = row as {
      id: string;
      school_id: string;
      connector_key: string;
      credential_provider: string | null;
      credential_name: string | null;
    } | null;
    if (!i) throw new Error("not allowed");
    const allowed = CREDENTIAL_FIELDS[i.connector_key];
    if (!allowed || !i.credential_provider || !i.credential_name)
      throw new Error("this connector does not take credentials here");
    const clean = Object.fromEntries(
      allowed.filter((k) => data.fields[k]).map((k) => [k, data.fields[k]]),
    );
    const vault = await getIntegrationVault();
    if (!vault) throw new Error("The Sherivs Vault is not configured on this deployment yet");
    await vault.put({
      orgId: i.school_id,
      provider: i.credential_provider,
      name: i.credential_name,
      secret: JSON.stringify(clean),
      actor: String(context.userId ?? ""),
    });
    return { saved: Object.keys(clean) };
  });
