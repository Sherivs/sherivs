/**
 * SHERIVS-029: server check for a school's custom domain.
 * 1. The caller's own client must be able to read the row (RLS: admin of that school).
 * 2. The service role reads the expected TXT value (never trusted from the browser).
 * 3. DNS TXT lookup of _sherivs-verify.<host>; on success the host is added to Vercel (stubbed without a token).
 * 4. The result is recorded by school_domain_record_check (service role only, audited).
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Loose = { from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> } } };
  rpc: (f: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }> };

export async function txtRecordMatches(hostname: string, expected: string, resolveTxt?: (n: string) => Promise<string[][]>): Promise<boolean> {
  const resolver = resolveTxt ?? (await import("node:dns/promises")).resolveTxt;
  try {
    const records = await resolver(`_sherivs-verify.${hostname}`);
    return records.some((chunks) => chunks.join("") === expected);
  } catch {
    return false;
  }
}

export const verifySchoolDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => {
    const id = (i as { id?: unknown })?.id;
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("invalid domain id");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const user = context.supabase as unknown as Loose;
    const { data: mine } = await user.from("school_domains").select("id").eq("id", data.id).maybeSingle();
    if (!mine) throw new Error("not allowed");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as Loose;
    const { data: row, error } = await admin.rpc("school_domain_for_check", { p_id: data.id });
    if (error || !row) throw new Error("unknown domain");
    const r = row as { hostname: string; txt_value: string };
    const ok = await txtRecordMatches(r.hostname, r.txt_value);
    let vercel: string | null = null;
    if (ok) {
      const { addDomainToVercel } = await import("./vercel-domains.server");
      vercel = (await addDomainToVercel(r.hostname)).status;
    }
    const rec = await admin.rpc("school_domain_record_check", {
      p_id: data.id, p_txt_ok: ok, p_vercel_status: vercel, p_reason: ok ? null : `TXT _sherivs-verify.${r.hostname} not found yet (DNS can take up to 48h)`,
    });
    if (rec.error) throw new Error(rec.error.message);
    return { status: rec.data as string, txt_ok: ok, vercel_status: vercel };
  });
