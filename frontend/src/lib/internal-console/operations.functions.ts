/**
 * Tickets, incidents, log search, and billing RPC stubs.
 * Server implementations live in operations.store.server.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from "./operations";

export const listConsoleTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listTickets } = await import("./operations.store.server");
    return listTickets(context as never);
  });

const ticketCreateSchema = z.object({
  subject: z.string().trim().min(3).max(160),
  body: z.string().trim().min(3).max(4000),
  organizationId: z.string().uuid().optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
});

export const createConsoleTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ticketCreateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { createTicket } = await import("./operations.store.server");
    return createTicket(context as never, data);
  });

const ticketTransitionSchema = z.object({
  id: z.string().uuid(),
  toStatus: z.enum(TICKET_STATUSES),
});

export const transitionConsoleTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => ticketTransitionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { transitionTicket } = await import("./operations.store.server");
    return transitionTicket(context as never, data);
  });

export const listConsoleIncidents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listIncidents } = await import("./operations.store.server");
    return listIncidents(context as never);
  });

const incidentCreateSchema = z.object({
  title: z.string().trim().min(3).max(160),
  details: z.string().trim().min(3).max(4000),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  organizationId: z.string().uuid().optional(),
});

export const createConsoleIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => incidentCreateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { createIncident } = await import("./operations.store.server");
    return createIncident(context as never, data);
  });

const incidentTransitionSchema = z.object({
  id: z.string().uuid(),
  toStatus: z.enum(INCIDENT_STATUSES),
});

export const transitionConsoleIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => incidentTransitionSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { transitionIncident } = await import("./operations.store.server");
    return transitionIncident(context as never, data);
  });

const logSearchSchema = z.object({
  query: z.string().trim().max(80).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const searchConsoleLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => logSearchSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { searchLogs } = await import("./operations.store.server");
    return searchLogs(context as never, data);
  });

export const listConsoleBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { listBilling } = await import("./operations.store.server");
    return listBilling(context as never);
  });

const initSchema = z.object({
  organizationId: z.string().uuid(),
  email: z.string().email(),
});

export const initConsoleSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => initSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { initOrganizationSubscription } = await import("./operations.store.server");
    return initOrganizationSubscription(context as never, data);
  });
