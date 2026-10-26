/**
 * Owner-provided public company facts for Sherivs Technologies Limited.
 *
 * Do not invent street addresses, phone numbers, registration numbers, or
 * social URLs. Mailbox SMTP delivery was not proven; sherivs.com has MX
 * records at privateemail.com (audited 2026-10-26). Forms still use mailto
 * and never claim a ticket exists.
 */
export const LEGAL_ENTITY_NAME = "Sherivs Technologies Limited";
export const PUBLIC_BRAND_NAME = "Sherivs";
export const COMPANY_LOCALITY = "Maiduguri";
export const COMPANY_REGION = "Borno State";
export const COMPANY_COUNTRY = "Nigeria";
export const COMPANY_COUNTRY_CODE = "NG";
export const COMPANY_LOCATION_LINE = "Maiduguri, Borno State, Nigeria";
export const PUBLIC_WEBSITE_HOST = "www.sherivs.com";

/**
 * Internal operational fact only. Must never render as a homepage
 * availability announcement, badge, or banner (owner 002).
 */
export const ACCEPTING_CUSTOMERS = true;

/**
 * Owner-supplied public positioning (2026-10-26). Directional language
 * (“is building”, “is developing”) is intentional — not a claim that every
 * capability is generally available today.
 */
export const POSITIONING_TAGLINE = "Intelligence infrastructure for a more connected world";
export const POSITIONING_STATEMENT =
  "Sherivs is building an AI-native institutional computing platform that brings people, organizations, AI workforces, and digital twins into a shared, governed computing environment.";
export const POSITIONING_RETHINKING =
  "Sherivs is rethinking how intelligence is deployed, how work is coordinated, and how digital representations of real-world entities operate across connected systems.";
export const POSITIONING_PROGRAMMABLE =
  "Its long-term vision is to make computing, coordination, and intelligence programmable capabilities that institutions can build upon—not isolated tools that operate in silos.";
export const POSITIONING_FOUNDATIONS =
  "From institutional applications to autonomous AI workforces and state-aware digital twins, Sherivs is developing the foundations for a world in which intelligent systems can work together with greater coherence, accountability, and control.";
export const COMPANY_MISSION =
  "Build the computing infrastructure that enables people, institutions, and intelligent systems to work together.";
export const COMPANY_VISION =
  "A world where intelligence, computation, and coordinated action are accessible capabilities for every institution.";

export const EMAIL_ROUTING = {
  info: {
    address: "info@sherivs.com",
    purpose: "General company and administrative inquiries",
  },
  hello: {
    address: "hello@sherivs.com",
    purpose: "Demo requests, prospective customers, partnerships, business development",
  },
  support: {
    address: "support@sherivs.com",
    purpose: "Existing-customer support, technical problems, account help",
  },
} as const;

export const MAIL_DELIVERY_NOTE =
  "Public forms open the visitor's email client. Sherivs does not confirm that a message was delivered or that a ticket was created until that mail is received. Dedicated privacy@ and legal@ mailboxes have not been owner-confirmed; those topics use info@sherivs.com.";
