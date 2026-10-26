/**
 * Organization admin onboarding is fulfilled by the Sherivs team.
 * Visitors do not self-register. This helper only builds a mailto to the
 * published hello@ mailbox — it never creates an Auth user or a ticket.
 */
import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";
import { EMAIL_ROUTING } from "@/lib/public-site/company";

export const ONBOARDING_MAILBOX = PUBLIC_CONTACTS.hello;
export const ONBOARDING_MAILBOX_PURPOSE = EMAIL_ROUTING.hello.purpose;
export const ONBOARDING_SUBJECT = "Organization admin account request";

export interface OnboardingRequestValues {
  organization: string;
  name: string;
  email: string;
  role: string;
  message: string;
}

export function buildOnboardingMailto(values: OnboardingRequestValues): { to: string; href: string } {
  const to = ONBOARDING_MAILBOX;
  const body = [
    "Sherivs team — please create an organization admin account.",
    "",
    `Organization: ${values.organization.trim()}`,
    `Admin name: ${values.name.trim()}`,
    `Work email: ${values.email.trim()}`,
    values.role.trim() ? `Role: ${values.role.trim()}` : null,
    "",
    values.message.trim(),
    "",
    "After the admin account is provisioned, that admin will invite users by email with login credentials. Users sign in — they do not self-register.",
  ]
    .filter((line) => line !== null)
    .join("\n");
  const href = `mailto:${to}?subject=${encodeURIComponent(ONBOARDING_SUBJECT)}&body=${encodeURIComponent(body)}`;
  return { to, href };
}
