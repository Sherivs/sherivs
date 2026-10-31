import { PUBLIC_CONTACTS } from "@/lib/public-site/contacts";
import { PRODUCT_NAME } from "@/lib/public-site/company";

export interface FaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
  related: readonly { href: string; label: string }[];
}

export const FAQ_CATEGORIES = ["Sherivs Scholar", "Getting started", "Access and privacy"] as const;

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    id: "what-is-sherivs-scholar",
    category: "Sherivs Scholar",
    question: "What is Sherivs Scholar?",
    answer:
      "Sherivs Scholar, the institutional operating environment from Sherivs, is designed to represent a school's organizational reality and bring its people, responsibilities, information, and supported workflows into one connected digital workspace.",
    related: [
      { href: "/solutions/education", label: PRODUCT_NAME },
      { href: "/sherivs", label: "Product overview" },
    ],
  },
  {
    id: "not-just-school-management",
    category: "Sherivs Scholar",
    question: "Is Sherivs Scholar just a school management system?",
    answer:
      "No. Sherivs Scholar centers on the school as an organization, rather than only a collection of administrative modules. Its approach connects people, organizational relationships, responsibilities, and supported workflows within a shared operating environment.",
    related: [{ href: "/#school-operations", label: "The Sherivs approach" }],
  },
  {
    id: "who-can-use",
    category: "Sherivs Scholar",
    question: "Who can use Sherivs Scholar?",
    answer:
      "The platform is designed for the wider school community, including administrators, teachers, students, parents and guardians, and operational staff. Access and available functionality depend on each person's role and the capabilities enabled for the institution.",
    related: [{ href: "/#community", label: "The school community" }],
  },
  {
    id: "multiple-campuses",
    category: "Sherivs Scholar",
    question: "Can Sherivs Scholar support multiple campuses?",
    answer:
      "Sherivs Scholar aims to represent institutional structures such as school groups, campuses, and different operational environments where supported by the platform's configuration.",
    related: [{ href: "/#flexibility", label: "Organizational flexibility" }],
  },
  {
    id: "ai-per-user",
    category: "Sherivs Scholar",
    question: "Does every user receive an AI assistant?",
    answer:
      "The Sherivs Scholar approach is to provide assistance relevant to each person's role and responsibilities. The available assistance depends on the capabilities implemented and enabled for the institution.",
    related: [{ href: "/#intelligence", label: "Role-aware intelligence" }],
  },
  {
    id: "how-ai-works",
    category: "Sherivs Scholar",
    question: "How does AI assistance work?",
    answer:
      "AI assistance can help users understand relevant information, prepare work, receive recommendations, and complete supported tasks. Available actions remain subject to the applicable permissions, policies, and review requirements.",
    related: [{ href: "/#coordinated-work", label: "Work, coordinated" }],
  },
  {
    id: "protect-information",
    category: "Access and privacy",
    question: "How does Sherivs protect school information?",
    answer:
      "Sherivs Scholar follows controlled access, organizational boundaries, and the appropriate handling of institutional information. Refer to the privacy policy and verified product documentation for details of the controls currently implemented.",
    related: [
      { href: "/privacy-policy", label: "Privacy policy" },
      { href: "/security", label: "Security" },
    ],
  },
  {
    id: "how-to-start",
    category: "Getting started",
    question: "How can a school get started?",
    answer:
      "Schools can follow the official Sherivs Scholar onboarding or account-request process to begin establishing their institutional environment.",
    related: [
      { href: "/onboarding", label: "Get started" },
      { href: "/contact", label: "Contact" },
    ],
  },
  {
    id: "support-path",
    category: "Getting started",
    question: "How can we get support?",
    answer: `Use the support page or the help center. The support form opens your email client to ${PUBLIC_CONTACTS.support}. It does not create a helpdesk ticket unless that mail is received.`,
    related: [
      { href: "/support", label: "Support" },
      { href: "/help", label: "Help and support" },
    ],
  },
];

export const FAQ_PREVIEW_IDS = [
  "what-is-sherivs-scholar",
  "not-just-school-management",
  "who-can-use",
  "multiple-campuses",
  "ai-per-user",
  "how-ai-works",
  "protect-information",
  "how-to-start",
  "support-path",
] as const;
