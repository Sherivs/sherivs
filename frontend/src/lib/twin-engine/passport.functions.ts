import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildPassportView,
  type PackRow,
  type PassportView,
  type TwinContextRow,
  type TwinPersonRow,
  type TwinTrustRow,
} from "./passport-view";

const emptyInput = z.object({}).strict();

type Query = PromiseLike<{ data: unknown; error: { message: string } | null }> & {
  in(column: string, values: readonly string[]): Query;
};
type Reader = { from(table: string): { select(columns: string): Query } };

const rows = <T>(res: { data: unknown; error: { message: string } | null }): T[] => {
  if (res.error) throw new Error(res.error.message);
  return Array.isArray(res.data) ? (res.data as T[]) : [];
};

/**
 * The caller's Person Passport: their one twin, every membership context, and
 * the effective autonomy of each capability. Row-level security limits every
 * read to the caller's own rows; Role Pack definitions are read server-side
 * only for the packs the caller's own contexts are bound to.
 */
export const getMyPassport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => emptyInput.parse(input ?? {}))
  .handler(async ({ context }): Promise<PassportView | null> => {
    const db = context.supabase as unknown as Reader;
    const [person] = rows<TwinPersonRow>(
      await db.from("cg_twin_person").select("id, identity_id, status"),
    );
    if (!person || person.identity_id !== context.userId) return null;

    const contexts = rows<TwinContextRow>(
      await db
        .from("cg_twin_context")
        .select("id, context_kind, tenant_ref, role_code, status, pack_code, pack_version"),
    );
    const trust = rows<TwinTrustRow>(
      await db
        .from("cg_twin_trust")
        .select("context_id, capability_id, state, sheriff_promotion_id"),
    );

    const codes = [...new Set(contexts.map((c) => c.pack_code).filter((c): c is string => !!c))];
    let packs: PackRow[] = [];
    if (codes.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const admin = supabaseAdmin as unknown as Reader;
      packs = rows<PackRow>(
        await admin.from("cg_role_pack").select("code, version, definition").in("code", codes),
      );
    }
    return buildPassportView({ person, contexts, trust, packs });
  });
