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

/** Owner states Sherivs is accepting customers. Not a count or SLA. */
export const ACCEPTING_CUSTOMERS = true;

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
