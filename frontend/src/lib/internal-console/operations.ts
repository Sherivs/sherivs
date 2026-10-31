/**
 * Control-plane tickets, incidents, log search, and billing contracts.
 * PURE: no I/O. Database rows remain the authority.
 */
export const TICKET_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const INCIDENT_STATUSES = [
  "open",
  "acknowledged",
  "mitigating",
  "resolved",
  "closed",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

export const CONSOLE_SUBSCRIPTION_PREFIX = "csub_";

const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["pending", "resolved", "closed"],
  pending: ["open", "resolved", "closed"],
  resolved: ["closed", "open"],
  closed: [],
};

const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  open: ["acknowledged", "mitigating", "resolved", "closed"],
  acknowledged: ["mitigating", "resolved", "closed"],
  mitigating: ["resolved", "closed"],
  resolved: ["closed", "open"],
  closed: [],
};

export function isTicketStatus(value: string): value is TicketStatus {
  return (TICKET_STATUSES as readonly string[]).includes(value);
}

export function isIncidentStatus(value: string): value is IncidentStatus {
  return (INCIDENT_STATUSES as readonly string[]).includes(value);
}

export function canTransitionTicket(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}

export function canTransitionIncident(from: IncidentStatus, to: IncidentStatus): boolean {
  return INCIDENT_TRANSITIONS[from].includes(to);
}

export function sanitizeLogQuery(raw: string): string {
  return raw.trim().slice(0, 80).replace(/[%_]/g, " ").replace(/\s+/g, " ");
}

export function isConsoleSubscriptionReference(reference: string): boolean {
  return reference.startsWith(CONSOLE_SUBSCRIPTION_PREFIX);
}

export interface ConsoleTicket {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  subject: string;
  body: string;
  status: TicketStatus;
  priority: TicketPriority;
  openedBy: string;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface ConsoleIncident {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  title: string;
  details: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  openedBy: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface ConsoleLogHit {
  id: string;
  action: string;
  description: string;
  actor: string | null;
  at: string;
  outcome: string;
}

export interface ConsoleBillingRow {
  id: string;
  schoolId: string;
  organizationId: string | null;
  organizationName: string | null;
  plan: string;
  status: string;
  amountPaid: number;
  paystackReference: string | null;
  startedAt: string | null;
  expiresAt: string | null;
}

export interface ConsoleBillingSnapshot {
  source: string;
  paystackMode: "live" | "test" | "unconfigured";
  subscriptions: ConsoleBillingRow[];
  pricing: Array<{
    schoolId: string;
    organizationName: string | null;
    perStudentFee: number;
    note: string | null;
  }>;
  available: boolean;
  detail: string;
}
