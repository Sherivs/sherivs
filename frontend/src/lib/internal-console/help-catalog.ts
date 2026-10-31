import { CONSOLE_PATHS } from "./paths";
import type { ConsoleHelpArticle } from "./search";

export const CONSOLE_HELP_ARTICLES: readonly ConsoleHelpArticle[] = [
  {
    id: "console-vs-scholar",
    title: "Internal Console and Sherivs Scholar",
    description:
      "The Internal Console is for Sherivs staff. Sherivs Scholar serves schools. They share a shell language, not a dashboard.",
    href: CONSOLE_PATHS.help,
    capability: null,
  },
  {
    id: "invitations",
    title: "Inviting staff",
    description:
      "Only authorized administrators can invite staff. An invitation is not access until it is accepted and the membership is active.",
    href: CONSOLE_PATHS.teamInvitations,
    capability: "platform.staff.read",
  },
  {
    id: "organizations",
    title: "Organization lifecycle",
    description:
      "Organizations move from draft through review and provisioning before they become active. Activation is a separate authorized step.",
    href: CONSOLE_PATHS.organizations,
    capability: "platform.tenants.read",
  },
  {
    id: "workspaces",
    title: "Personal and shared workspaces",
    description:
      "Every staff member has a personal workspace. Role workspaces are shared operating environments for Operations, Engineering, Support, and Administration. Membership is not a permission grant.",
    href: CONSOLE_PATHS.workspaces,
    capability: null,
  },
  {
    id: "health",
    title: "How platform health is measured",
    description:
      "Status cards use verified checks. Unknown means there is not enough evidence. A loaded page is not a health check.",
    href: CONSOLE_PATHS.activityMetrics,
    anyOf: ["platform.tenants.read", "platform.operations.read", "platform.engineering.read"],
  },
  {
    id: "tickets",
    title: "Support tickets",
    description:
      "Console tickets are staff-operated organization cases. They are not school complaints, student records, or fee invoices.",
    href: CONSOLE_PATHS.activityTickets,
    anyOf: ["platform.support.handle", "platform.tenants.read"],
  },
  {
    id: "incidents",
    title: "Operational incidents",
    description:
      "Incidents are operator-filed operational records. Unknown is not healthy, and this is not a security operations centre.",
    href: CONSOLE_PATHS.activityIncidents,
    anyOf: [
      "platform.engineering.read",
      "platform.operations.read",
      "platform.tenants.read",
      "platform.audit.read",
    ],
  },
  {
    id: "billing",
    title: "Billing and Paystack",
    description:
      "Billing reads public.subscriptions. Paystack Inline collects a configured school monthly fee. The webhook remains the source of truth.",
    href: CONSOLE_PATHS.activityBilling,
    anyOf: ["platform.tenants.manage", "platform.finance.read"],
  },
  {
    id: "support-grants",
    title: "Time-limited support grants",
    description:
      "A platform owner can grant Support staff time-limited access to one provisioned organization. The grant is audited, expires in at most eight hours, and is not tenant membership.",
    href: CONSOLE_PATHS.teamAccess,
    capability: "platform.audit.read",
  },
  {
    id: "audit",
    title: "Audit records",
    description:
      "Administrative actions are recorded through trusted backend paths. Ordinary users cannot edit or delete them.",
    href: CONSOLE_PATHS.activity,
    capability: "platform.audit.read",
  },
];

export function helpArticlesFor(viewer: {
  isSuperAdmin: boolean;
  capabilities: ReadonlySet<string>;
}): ConsoleHelpArticle[] {
  return CONSOLE_HELP_ARTICLES.filter((article) => {
    if (viewer.isSuperAdmin) return true;
    if (article.anyOf?.length) {
      return article.anyOf.some((capability) => viewer.capabilities.has(capability));
    }
    return !article.capability || viewer.capabilities.has(article.capability);
  });
}
