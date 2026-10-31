import {
  createConsoleIncident,
  createConsoleTicket,
  initConsoleSubscription,
  listConsoleBilling,
  listConsoleIncidents,
  listConsoleTickets,
  searchConsoleLogs,
  transitionConsoleIncident,
  transitionConsoleTicket,
} from "@/lib/internal-console/operations.functions";
import type {
  ConsoleBillingSnapshot,
  ConsoleIncident,
  ConsoleLogHit,
  ConsoleTicket,
  IncidentSeverity,
  IncidentStatus,
  TicketPriority,
  TicketStatus,
} from "@/lib/internal-console/operations";
import { canTransitionIncident, canTransitionTicket } from "@/lib/internal-console/operations";
import {
  CONSOLE_FIXTURE_OPERATOR,
  CONSOLE_FIXTURE_OPS_KEY,
  consoleVisualFixtureActive,
} from "@/lib/internal-console/visual-fixture";

const FIXTURE_KEY = CONSOLE_FIXTURE_OPS_KEY;

type FixtureStore = {
  tickets: ConsoleTicket[];
  incidents: ConsoleIncident[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function emptyStore(): FixtureStore {
  return { tickets: [], incidents: [] };
}

function readStore(): FixtureStore {
  try {
    const raw = window.sessionStorage.getItem(FIXTURE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as FixtureStore;
    return {
      tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [],
      incidents: Array.isArray(parsed.incidents) ? parsed.incidents : [],
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: FixtureStore) {
  window.sessionStorage.setItem(FIXTURE_KEY, JSON.stringify(store));
}

export async function apiListTickets(): Promise<{
  tickets: ConsoleTicket[];
  source: string;
  available: boolean;
}> {
  if (consoleVisualFixtureActive()) {
    return { tickets: readStore().tickets, source: "local visual fixture", available: true };
  }
  return listConsoleTickets();
}

export async function apiCreateTicket(input: {
  subject: string;
  body: string;
  organizationId?: string;
  priority?: TicketPriority;
}): Promise<ConsoleTicket> {
  if (consoleVisualFixtureActive()) {
    const ticket: ConsoleTicket = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId ?? null,
      organizationName: null,
      subject: input.subject,
      body: input.body,
      status: "open",
      priority: input.priority ?? "normal",
      openedBy: CONSOLE_FIXTURE_OPERATOR.id,
      assignedTo: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      resolvedAt: null,
    };
    const store = readStore();
    store.tickets.unshift(ticket);
    writeStore(store);
    return ticket;
  }
  return createConsoleTicket({ data: input });
}

export async function apiTransitionTicket(
  id: string,
  toStatus: TicketStatus,
): Promise<ConsoleTicket> {
  if (consoleVisualFixtureActive()) {
    const store = readStore();
    const ticket = store.tickets.find((row) => row.id === id);
    if (!ticket) throw new Error("Ticket not found.");
    if (!canTransitionTicket(ticket.status, toStatus)) {
      throw new Error("That ticket status change is not allowed.");
    }
    ticket.status = toStatus;
    ticket.updatedAt = nowIso();
    ticket.resolvedAt = toStatus === "resolved" || toStatus === "closed" ? ticket.updatedAt : null;
    writeStore(store);
    return ticket;
  }
  return transitionConsoleTicket({ data: { id, toStatus } });
}

export async function apiListIncidents(): Promise<{
  incidents: ConsoleIncident[];
  source: string;
  available: boolean;
  openCount: number | null;
}> {
  if (consoleVisualFixtureActive()) {
    const incidents = readStore().incidents;
    return {
      incidents,
      source: "local visual fixture",
      available: true,
      openCount: incidents.filter((row) => row.status !== "resolved" && row.status !== "closed")
        .length,
    };
  }
  return listConsoleIncidents();
}

export async function apiCreateIncident(input: {
  title: string;
  details: string;
  severity?: IncidentSeverity;
  organizationId?: string;
}): Promise<ConsoleIncident> {
  if (consoleVisualFixtureActive()) {
    const incident: ConsoleIncident = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId ?? null,
      organizationName: null,
      title: input.title,
      details: input.details,
      severity: input.severity ?? "medium",
      status: "open",
      openedBy: CONSOLE_FIXTURE_OPERATOR.id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      resolvedAt: null,
    };
    const store = readStore();
    store.incidents.unshift(incident);
    writeStore(store);
    return incident;
  }
  return createConsoleIncident({ data: input });
}

export async function apiTransitionIncident(
  id: string,
  toStatus: IncidentStatus,
): Promise<ConsoleIncident> {
  if (consoleVisualFixtureActive()) {
    const store = readStore();
    const incident = store.incidents.find((row) => row.id === id);
    if (!incident) throw new Error("Incident not found.");
    if (!canTransitionIncident(incident.status, toStatus)) {
      throw new Error("That incident status change is not allowed.");
    }
    incident.status = toStatus;
    incident.updatedAt = nowIso();
    incident.resolvedAt =
      toStatus === "resolved" || toStatus === "closed" ? incident.updatedAt : null;
    writeStore(store);
    return incident;
  }
  return transitionConsoleIncident({ data: { id, toStatus } });
}

export async function apiSearchLogs(query?: string): Promise<{
  events: ConsoleLogHit[];
  source: string;
  available: boolean;
}> {
  if (consoleVisualFixtureActive()) {
    const haystack = [
      ...readStore().tickets.map((row) => ({
        id: row.id,
        action: `platform_ticket.${row.status}`,
        description: row.subject,
        actor: CONSOLE_FIXTURE_OPERATOR.name,
        at: row.updatedAt,
        outcome: "recorded",
      })),
      ...readStore().incidents.map((row) => ({
        id: row.id,
        action: `platform_incident.${row.status}`,
        description: row.title,
        actor: CONSOLE_FIXTURE_OPERATOR.name,
        at: row.updatedAt,
        outcome: "recorded",
      })),
    ];
    const q = (query ?? "").trim().toLowerCase();
    const events =
      q.length < 2
        ? haystack
        : haystack.filter((row) => `${row.action} ${row.description}`.toLowerCase().includes(q));
    return { events, source: "local visual fixture", available: true };
  }
  return searchConsoleLogs({ data: { query } });
}

export async function apiListBilling(): Promise<ConsoleBillingSnapshot> {
  if (consoleVisualFixtureActive()) {
    return {
      source: "local visual fixture — no Paystack charges",
      paystackMode: "test",
      subscriptions: [],
      pricing: [],
      available: true,
      detail:
        "Fixture billing is empty on purpose. Live billing reads public.subscriptions after SHERIVS-032 is applied.",
    };
  }
  return listConsoleBilling();
}

export async function apiInitSubscription(organizationId: string, email: string) {
  if (consoleVisualFixtureActive()) {
    throw new Error("Paystack checkout is not available in the local visual fixture.");
  }
  return initConsoleSubscription({ data: { organizationId, email } });
}
