/**
 * M6 (mission E-016, ADR-148) — the draft website for a newly provisioned organization.
 *
 * Built on the server from the approved plan and the request's own facts with the existing
 * website generator (SPEC §6), never from client input. Only facts the organization gave are
 * used (name, contact email, phone, state) — the generator emits no placeholder claims. The
 * draft is not published: an administrator of the organization reviews it first. When the
 * generator cannot produce a valid document from so few facts, the website is recorded as
 * pending instead (null), and provisioning continues.
 */
import { generateSite } from "@/lib/website/generator";
import type { SiteDocument } from "@/lib/website/types";
import { validateDocument } from "@/lib/website/validate";
import type { ValidatedOnboardingPlan } from "./plan-schema";

export interface WebsiteDraftFacts {
  readonly orgName: string;
  readonly slugHint: string;
  readonly contactEmail: string | null;
  readonly contactPhone: string | null;
  readonly state: string | null;
}

const KIND_BY_TEMPLATE: Record<string, string> = {
  tertiary_university: "university",
  tertiary_polytechnic: "polytechnic",
  group: "group",
  authority_information: "government",
};

export function buildWebsiteDraft(
  facts: WebsiteDraftFacts,
  plan: ValidatedOnboardingPlan,
): SiteDocument | null {
  const languages = plan.institutionProfile.languages.filter((l) =>
    ["ha", "yo", "ig", "pcm"].includes(l),
  );
  try {
    const doc = generateSite({
      data: {
        school: {
          name: facts.orgName,
          slug: facts.slugHint,
          email: facts.contactEmail,
          phone: facts.contactPhone,
          address: facts.state,
        },
      },
      onboarding: {
        organisation: { org_type: KIND_BY_TEMPLATE[plan.websiteTemplate], state: facts.state },
        languages,
      },
    });
    return validateDocument(doc).length === 0 ? doc : null;
  } catch {
    return null;
  }
}
