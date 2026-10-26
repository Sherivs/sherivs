import { EMAIL_ROUTING } from "@/lib/public-site/company";

/**
 * Verified public contact channels. Owner-provided mailboxes only.
 * Dedicated privacy@ and legal@ addresses are not confirmed — legal and
 * privacy topics route to info@ until the owner supplies separate inboxes.
 */
export const PUBLIC_CONTACTS = {
  info: EMAIL_ROUTING.info.address,
  hello: EMAIL_ROUTING.hello.address,
  /** Alias used by demo / prospect forms. */
  sales: EMAIL_ROUTING.hello.address,
  support: EMAIL_ROUTING.support.address,
  privacy: EMAIL_ROUTING.info.address,
  legal: EMAIL_ROUTING.info.address,
} as const;

export const PUBLIC_SOCIAL_LINKS: readonly {
  id: "linkedin" | "facebook" | "x" | "instagram" | "github";
  label: string;
  href: string;
  published: boolean;
  notes: string;
}[] = [
  {
    id: "linkedin",
    label: "LinkedIn",
    href: "",
    published: false,
    notes: "Owner reports an official account; profile URL not supplied.",
  },
  {
    id: "facebook",
    label: "Facebook",
    href: "",
    published: false,
    notes: "Owner reports an official account; profile URL not supplied.",
  },
  {
    id: "x",
    label: "X",
    href: "",
    published: false,
    notes: "Owner reports an official account; profile URL not supplied.",
  },
  {
    id: "instagram",
    label: "Instagram",
    href: "",
    published: false,
    notes: "Owner reports an official account; profile URL not supplied.",
  },
  {
    id: "github",
    label: "GitHub",
    href: "",
    published: false,
    notes: "Owner reports an official account; profile URL not supplied.",
  },
];
