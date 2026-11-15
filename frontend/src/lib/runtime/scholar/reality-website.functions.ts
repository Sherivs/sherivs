/**
 * SV1-REALITY R9 (#335) — start the public website from approved school reality (school-admin scope).
 *
 * Reuses the existing website path (#135): `website_facts` -> `generateSite` -> `website_save_draft`
 * -> `website_publish`, all as the signed-in admin, so the existing `website.manage` guard, the
 * website audit trail and the 60/hour publish limit still apply. Two separate steps:
 *
 *   1. preview  — read-only. Says exactly which approved, public-safe answers will be used.
 *   2. publish  — an explicit second action. Re-derives everything on the server and refuses
 *                 if the preview is stale. Interview approval alone never publishes anything.
 *
 * It only ever CREATES a website when none exists; it never overwrites an existing draft or
 * published site (same rule as `ensureWebsite`). The tenant comes from the verified actor and
 * the client sends only the preview hash. See ADR-054.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { asKernelAdmin } from "@/lib/kernel-admin-client";
import { generateSite, type Facts } from "@/lib/website/generator";
import { validateDocument } from "@/lib/website/validate";
import {
  planRealitySync,
  type AppliedField,
  type RealitySyncPlan,
  type UnsupportedField,
} from "@/lib/website/reality-sync";
import { approvedSnapshot } from "@/lib/scholar/reality";
import { load, scope } from "./reality-interview.functions";

export type WebsiteSyncPreview =
  | { readonly status: "not_approved" }
  | { readonly status: "website_exists" }
  | { readonly status: "invalid" }
  | { readonly status: "not_allowed" }
  | {
      readonly status: "ready";
      readonly applied: readonly AppliedField[];
      readonly notSupported: readonly UnsupportedField[];
      readonly withheldCount: number;
      readonly pages: readonly string[];
      readonly planHash: string;
    };

export type WebsiteSyncPublish =
  | { readonly status: "published"; readonly version: number }
  | { readonly status: "saved_not_published" }
  | { readonly status: "stale" }
  | { readonly status: Exclude<WebsiteSyncPreview["status"], "ready"> };

type Db = ReturnType<typeof asKernelAdmin>;

interface Derived {
  readonly plan: RealitySyncPlan;
  readonly pages: readonly string[];
  readonly document: ReturnType<typeof generateSite>;
}
type DeriveResult =
  | { readonly ok: true; readonly derived: Derived }
  | {
      readonly ok: false;
      readonly status: "not_approved" | "website_exists" | "invalid" | "not_allowed";
    };

const NOT_ALLOWED = "42501";

async function derive(db: Db, schoolId: string): Promise<DeriveResult> {
  const { state } = await load(db, schoolId, Date.now());
  const snapshot = approvedSnapshot(state);
  if (snapshot.length === 0) return { ok: false, status: "not_approved" };

  const existing = await db.rpc("website_get", { p_school: schoolId });
  if (existing.error) {
    if (existing.error.code === NOT_ALLOWED) return { ok: false, status: "not_allowed" };
    throw new Error(existing.error.message);
  }
  if ((existing.data as { exists?: boolean } | null)?.exists)
    return { ok: false, status: "website_exists" };

  const factsRes = await db.rpc("website_facts", { p_school: schoolId });
  if (factsRes.error) {
    if (factsRes.error.code === NOT_ALLOWED) return { ok: false, status: "not_allowed" };
    throw new Error(factsRes.error.message);
  }

  const plan = planRealitySync(snapshot, factsRes.data as Facts);
  const document = generateSite(plan.facts);
  if (validateDocument(document).length > 0) return { ok: false, status: "invalid" };
  const pages = document.pages
    .filter((p) => p.nav)
    .map((p) => p.title[document.locales[0]] ?? p.title.en ?? p.slug)
    .slice(0, 20);
  return { ok: true, derived: { plan, pages, document } };
}

export const previewWebsiteFromReality = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({}).strict().parse(input))
  .handler(async ({ context }): Promise<WebsiteSyncPreview> => {
    const schoolId = await scope(context);
    const r = await derive(asKernelAdmin(context.supabase), schoolId);
    if (!r.ok) return { status: r.status };
    const { plan, pages } = r.derived;
    return {
      status: "ready",
      applied: plan.applied,
      notSupported: plan.notSupported,
      withheldCount: plan.withheldCount,
      pages,
      planHash: plan.planHash,
    };
  });

export const publishWebsiteFromReality = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ planHash: z.string().regex(/^[0-9a-f]{8}$/) })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<WebsiteSyncPublish> => {
    const schoolId = await scope(context);
    const db = asKernelAdmin(context.supabase);
    const r = await derive(db, schoolId);
    if (!r.ok) return { status: r.status };
    const { plan, document } = r.derived;
    // The admin approved a specific preview; anything that changed since then needs a fresh look.
    if (plan.planHash !== data.planHash) return { status: "stale" };

    const saved = await db.rpc("website_save_draft", {
      p_school: schoolId,
      p_document: document,
      p_expected_rev: 0, // create-only: a site created meanwhile makes this fail instead of overwrite
    });
    if (saved.error) {
      if (saved.error.code === NOT_ALLOWED) return { status: "not_allowed" };
      if (saved.error.code === "40001") return { status: "website_exists" };
      throw new Error(saved.error.message);
    }
    const published = await db.rpc("website_publish", {
      p_school: schoolId,
      p_note: `Generated from approved school reality (${plan.planHash})`,
    });
    if (published.error) return { status: "saved_not_published" };
    return { status: "published", version: Number(published.data) };
  });
