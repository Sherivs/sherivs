/**
 * After onboarding (SPEC §6): compose the initial website from the interview answers + live data, save it and
 * publish it, but only if the organization has no website yet. Never overwrites an existing draft.
 */
import { rpc } from "@/lib/scholar/rpc";
import { generateSite, type Facts } from "./generator";
import { validateDocument } from "./validate";

export type BootstrapResult = "created" | "exists" | "invalid";
export async function ensureWebsite(org: string): Promise<BootstrapResult> {
  const state = await rpc<{ exists: boolean }>("website_get", { p_school: org });
  if (state.exists) return "exists";
  const facts = await rpc<Facts>("website_facts", { p_school: org });
  const doc = generateSite(facts);
  if (validateDocument(doc).length) return "invalid";
  await rpc<number>("website_save_draft", { p_school: org, p_document: doc, p_expected_rev: 0 });
  await rpc<number>("website_publish", { p_school: org, p_note: "Generated from onboarding" });
  return "created";
}
