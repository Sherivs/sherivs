/**
 * Server-only tickets, incidents, log search, and billing reads.
 * Not imported from client components.
 */
import { writeAuditRecord } from "@/lib/server/write-audit";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import { assertInternalAal2 } from "@/lib/security/mfa-server";
import { isMissingRelation, store } from "./store";
import {
  CONSOLE_SUBSCRIPTION_PREFIX,
  canTransitionIncident,
  canTransitionTicket,
  isIncidentStatus,
  isTicketStatus,
  sanitizeLogQuery,
  type ConsoleBillingSnapshot,
  type ConsoleIncident,
  type ConsoleLogHit,
  type ConsoleTicket,
  type IncidentSeverity,
  type IncidentStatus,
  type TicketPriority,
  type TicketStatus,
} from "./operations";

const timeAuthority = new TimeAuthority(new SystemClock());

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

type Ctx = {
  supabase: { rpc: RpcClient["rpc"] };
  claims: { exp: number; aal?: unknown };
  userId: string;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function hasCapability(context: Ctx, capability: string): Promise<boolean> {
  const { data, error } = await (context.supabase as unknown as RpcClient).rpc(
    "has_platform_capability",
    { p_capability: capability },
  );
  return !error && data === true;
}

async function assertAnyCapability(context: Ctx, capabilities: readonly string[], aal2 = false) {
  if (aal2) assertInternalAal2(context.claims);
  for (const capability of capabilities) {
    if (await hasCapability(context, capability)) return;
  }
  throw new Error("Not authorized");
}

async function audit(
  context: Ctx,
  action: string,
  table: string,
  recordId: string | null,
  details: Record<string, unknown>,
) {
  await writeAuditRecord(await admin(), {
    action,
    gate: "has_platform_capability",
    tenantId: null,
    actorId: context.userId,
    table,
    recordId,
    outcome: "succeeded",
    details,
  });
}

type TicketRow = {
  id: string;
  organization_id: string | null;
  subject: string;
  body: string;
  status: string;
  priority: string;
  opened_by: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

type IncidentRow = {
  id: string;
  organization_id: string | null;
  title: string;
  details: string | null;
  severity: string;
  status: string;
  opened_by: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

async function organizationNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return names;
  const db = await admin();
  const { data, error } = await store(db)
    .from("platform_organization")
    .select("id, display_name")
    .in("id", unique);
  if (error || !data) return names;
  for (const row of data as Array<{ id: string; display_name: string }>) {
    names.set(row.id, row.display_name);
  }
  return names;
}

function mapTicket(row: TicketRow, names: Map<string, string>): ConsoleTicket {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_id ? (names.get(row.organization_id) ?? null) : null,
    subject: row.subject,
    body: row.body,
    status: isTicketStatus(row.status) ? row.status : "open",
    priority: (["low", "normal", "high", "urgent"] as const).includes(row.priority as TicketPriority)
      ? (row.priority as TicketPriority)
      : "normal",
    openedBy: row.opened_by,
    assignedTo: row.assigned_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

function mapIncident(row: IncidentRow, names: Map<string, string>): ConsoleIncident {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_id ? (names.get(row.organization_id) ?? null) : null,
    title: row.title,
    details: row.details ?? "",
    severity: (["low", "medium", "high", "critical"] as const).includes(
      row.severity as IncidentSeverity,
    )
      ? (row.severity as IncidentSeverity)
      : "medium",
    status: isIncidentStatus(row.status) ? row.status : "open",
    openedBy: row.opened_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

export async function listTickets(
  context: Ctx,
): Promise<{ tickets: ConsoleTicket[]; source: string; available: boolean }> {
  await assertAnyCapability(context, ["platform.tenants.read", "platform.support.handle"]);
  const db = await admin();
  const { data, error } = await store(db)
    .from("platform_ticket")
    .select(
      "id, organization_id, subject, body, status, priority, opened_by, assigned_to, created_at, updated_at, resolved_at",
    )
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingRelation(error)) {
      return { tickets: [], source: "platform_ticket not applied", available: false };
    }
    throw new Error(error.message);
  }
  const rows = (data ?? []) as TicketRow[];
  const names = await organizationNames(rows.map((row) => row.organization_id ?? ""));
  return {
    tickets: rows.map((row) => mapTicket(row, names)),
    source: "platform_ticket",
    available: true,
  };
}

export async function createTicket(
  context: Ctx,
  input: {
    subject: string;
    body: string;
    organizationId?: string;
    priority?: TicketPriority;
  },
): Promise<ConsoleTicket> {
  await assertAnyCapability(context, ["platform.support.handle", "platform.tenants.manage"], true);
  const db = await admin();
  const now = timeAuthority.now().at;
  const { data, error } = await store(db)
    .from("platform_ticket")
    .insert({
      organization_id: input.organizationId ?? null,
      subject: input.subject.trim(),
      body: input.body.trim(),
      status: "open",
      priority: input.priority ?? "normal",
      opened_by: context.userId,
      created_at: now,
      updated_at: now,
    })
    .select(
      "id, organization_id, subject, body, status, priority, opened_by, assigned_to, created_at, updated_at, resolved_at",
    )
    .single();
  if (error) {
    if (isMissingRelation(error)) throw new Error("Ticket storage is not applied.");
    throw new Error(error.message);
  }
  const row = data as TicketRow;
  await audit(context, "platform_ticket.create", "platform_ticket", row.id, {
    organizationId: row.organization_id,
    priority: row.priority,
  });
  const names = await organizationNames(row.organization_id ? [row.organization_id] : []);
  return mapTicket(row, names);
}

export async function transitionTicket(
  context: Ctx,
  input: { id: string; toStatus: TicketStatus },
): Promise<ConsoleTicket> {
  await assertAnyCapability(context, ["platform.support.handle", "platform.tenants.manage"], true);
  const db = await admin();
  const current = await store(db)
    .from("platform_ticket")
    .select(
      "id, organization_id, subject, body, status, priority, opened_by, assigned_to, created_at, updated_at, resolved_at",
    )
    .eq("id", input.id)
    .maybeSingle();
  if (current.error) {
    if (isMissingRelation(current.error)) throw new Error("Ticket storage is not applied.");
    throw new Error(current.error.message);
  }
  const row = current.data as TicketRow | null;
  if (!row) throw new Error("Ticket not found.");
  if (!isTicketStatus(row.status) || !canTransitionTicket(row.status, input.toStatus)) {
    throw new Error("That ticket status change is not allowed.");
  }
  const now = timeAuthority.now().at;
  const resolvedAt = input.toStatus === "resolved" || input.toStatus === "closed" ? now : null;
  const updated = await store(db)
    .from("platform_ticket")
    .update({ status: input.toStatus, updated_at: now, resolved_at: resolvedAt })
    .eq("id", input.id)
    .select(
      "id, organization_id, subject, body, status, priority, opened_by, assigned_to, created_at, updated_at, resolved_at",
    )
    .single();
  if (updated.error) throw new Error(updated.error.message);
  await audit(context, "platform_ticket.status", "platform_ticket", input.id, {
    from: row.status,
    to: input.toStatus,
  });
  const next = updated.data as TicketRow;
  const names = await organizationNames(next.organization_id ? [next.organization_id] : []);
  return mapTicket(next, names);
}

export async function listIncidents(
  context: Ctx,
): Promise<{ incidents: ConsoleIncident[]; source: string; available: boolean; openCount: number | null }> {
  await assertAnyCapability(context, [
    "platform.engineering.read",
    "platform.operations.read",
    "platform.tenants.read",
    "platform.audit.read",
  ]);
  const db = await admin();
  const { data, error } = await store(db)
    .from("platform_incident")
    .select(
      "id, organization_id, title, details, severity, status, opened_by, created_at, updated_at, resolved_at",
    )
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingRelation(error)) {
      return { incidents: [], source: "platform_incident not applied", available: false, openCount: null };
    }
    throw new Error(error.message);
  }
  const rows = (data ?? []) as IncidentRow[];
  const names = await organizationNames(rows.map((row) => row.organization_id ?? ""));
  const incidents = rows.map((row) => mapIncident(row, names));
  return {
    incidents,
    source: "platform_incident",
    available: true,
    openCount: incidents.filter((row) => row.status !== "resolved" && row.status !== "closed").length,
  };
}

export async function createIncident(
  context: Ctx,
  input: {
    title: string;
    details: string;
    severity?: IncidentSeverity;
    organizationId?: string;
  },
): Promise<ConsoleIncident> {
  await assertAnyCapability(
    context,
    ["platform.engineering.read", "platform.tenants.manage", "platform.operations.read"],
    true,
  );
  const db = await admin();
  const now = timeAuthority.now().at;
  const { data, error } = await store(db)
    .from("platform_incident")
    .insert({
      organization_id: input.organizationId ?? null,
      title: input.title.trim(),
      details: input.details.trim(),
      severity: input.severity ?? "medium",
      status: "open",
      opened_by: context.userId,
      created_at: now,
      updated_at: now,
    })
    .select(
      "id, organization_id, title, details, severity, status, opened_by, created_at, updated_at, resolved_at",
    )
    .single();
  if (error) {
    if (isMissingRelation(error)) throw new Error("Incident storage is not applied.");
    throw new Error(error.message);
  }
  const row = data as IncidentRow;
  await audit(context, "platform_incident.create", "platform_incident", row.id, {
    severity: row.severity,
  });
  const names = await organizationNames(row.organization_id ? [row.organization_id] : []);
  return mapIncident(row, names);
}

export async function transitionIncident(
  context: Ctx,
  input: { id: string; toStatus: IncidentStatus },
): Promise<ConsoleIncident> {
  await assertAnyCapability(
    context,
    ["platform.engineering.read", "platform.tenants.manage", "platform.operations.read"],
    true,
  );
  const db = await admin();
  const current = await store(db)
    .from("platform_incident")
    .select(
      "id, organization_id, title, details, severity, status, opened_by, created_at, updated_at, resolved_at",
    )
    .eq("id", input.id)
    .maybeSingle();
  if (current.error) {
    if (isMissingRelation(current.error)) throw new Error("Incident storage is not applied.");
    throw new Error(current.error.message);
  }
  const row = current.data as IncidentRow | null;
  if (!row) throw new Error("Incident not found.");
  if (!isIncidentStatus(row.status) || !canTransitionIncident(row.status, input.toStatus)) {
    throw new Error("That incident status change is not allowed.");
  }
  const now = timeAuthority.now().at;
  const resolvedAt = input.toStatus === "resolved" || input.toStatus === "closed" ? now : null;
  const updated = await store(db)
    .from("platform_incident")
    .update({ status: input.toStatus, updated_at: now, resolved_at: resolvedAt })
    .eq("id", input.id)
    .select(
      "id, organization_id, title, details, severity, status, opened_by, created_at, updated_at, resolved_at",
    )
    .single();
  if (updated.error) throw new Error(updated.error.message);
  await audit(context, "platform_incident.status", "platform_incident", input.id, {
    from: row.status,
    to: input.toStatus,
  });
  const next = updated.data as IncidentRow;
  const names = await organizationNames(next.organization_id ? [next.organization_id] : []);
  return mapIncident(next, names);
}

export async function searchLogs(
  context: Ctx,
  input: { query?: string; limit?: number },
): Promise<{ events: ConsoleLogHit[]; source: string; available: boolean }> {
  await assertAnyCapability(context, ["platform.engineering.read", "platform.audit.read"]);
  const db = await admin();
  const query = sanitizeLogQuery(input.query ?? "");
  let request = db
    .from("audit_logs")
    .select("id, action, user_id, created_at, new_value")
    .or(
      "action.like.platform_%,action.like.platform_ticket.%,action.like.platform_incident.%,action.like.platform_console.%",
    )
    .order("created_at", { ascending: false })
    .limit(input.limit ?? 80);
  if (query.length >= 2) {
    request = db
      .from("audit_logs")
      .select("id, action, user_id, created_at, new_value")
      .or(
        `action.ilike.%${query}%,action.like.platform_%`,
      )
      .ilike("action", `%${query}%`)
      .order("created_at", { ascending: false })
      .limit(input.limit ?? 80);
  }
  const { data, error } = await request;
  if (error) {
    if (isMissingRelation(error)) {
      return { events: [], source: "audit_logs not available", available: false };
    }
    throw new Error(error.message);
  }
  await audit(context, "platform_console.logs.search", "audit_logs", null, {
    queryLength: query.length,
    count: (data ?? []).length,
  });
  const events: ConsoleLogHit[] = (data ?? []).map((row) => {
    const payload = (row.new_value ?? {}) as { outcome?: string };
    return {
      id: String(row.id),
      action: row.action,
      description: row.action.replace(/[._]/g, " "),
      actor: row.user_id,
      at: row.created_at ?? new Date(0).toISOString(),
      outcome: typeof payload.outcome === "string" ? payload.outcome : "recorded",
    };
  });
  return { events, source: "audit_logs", available: true };
}

function paystackMode(): ConsoleBillingSnapshot["paystackMode"] {
  const key = process.env.PAYSTACK_SECRET_KEY ?? "";
  if (!key) return "unconfigured";
  if (key.startsWith("sk_live_")) return "live";
  return "test";
}

export async function listBilling(context: Ctx): Promise<ConsoleBillingSnapshot> {
  await assertAnyCapability(context, ["platform.finance.read", "platform.tenants.manage"]);
  const db = await admin();
  const { data, error } = await db
    .from("subscriptions")
    .select("id, school_id, plan, status, amount_paid, paystack_reference, started_at, expires_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingRelation(error)) {
      return {
        source: "public.subscriptions missing",
        paystackMode: paystackMode(),
        subscriptions: [],
        pricing: [],
        available: false,
        detail: "The subscription table is not available in this environment.",
      };
    }
    throw new Error(error.message);
  }
  const schoolIds = [...new Set((data ?? []).map((row) => row.school_id).filter(Boolean))];
  const orgBySchool = new Map<string, { id: string; display_name: string }>();
  if (schoolIds.length) {
    const orgs = await store(db)
      .from("platform_organization")
      .select("id, school_id, display_name")
      .in("school_id", schoolIds);
    if (!orgs.error && orgs.data) {
      for (const row of orgs.data as Array<{ id: string; school_id: string; display_name: string }>) {
        orgBySchool.set(row.school_id, { id: row.id, display_name: row.display_name });
      }
    }
  }
  const pricingQuery = await store(db)
    .from("school_platform_pricing")
    .select("school_id, per_student_fee, note")
    .limit(200);
  const pricing = ((pricingQuery.data ?? []) as Array<{
    school_id: string;
    per_student_fee: number | string | null;
    note: string | null;
  }>).map((row) => ({
    schoolId: row.school_id,
    organizationName: orgBySchool.get(row.school_id)?.display_name ?? null,
    perStudentFee: Number(row.per_student_fee ?? 0),
    note: row.note ?? null,
  }));
  return {
    source: "public.subscriptions + school_platform_pricing",
    paystackMode: paystackMode(),
    subscriptions: (data ?? []).map((row) => ({
      id: row.id,
      schoolId: row.school_id,
      organizationId: orgBySchool.get(row.school_id)?.id ?? null,
      organizationName: orgBySchool.get(row.school_id)?.display_name ?? null,
      plan: row.plan,
      status: row.status ?? "unknown",
      amountPaid: Number(row.amount_paid ?? 0),
      paystackReference: row.paystack_reference ?? null,
      startedAt: row.started_at ?? null,
      expiresAt: row.expires_at ?? null,
    })),
    pricing,
    available: true,
    detail:
      "These rows are Paystack-oriented payment history for linked schools. They are not recognized revenue or MRR.",
  };
}

export async function initOrganizationSubscription(
  context: Ctx,
  input: { organizationId: string; email: string },
): Promise<{ access_code: string; authorization_url: string; reference: string }> {
  await assertAnyCapability(context, ["platform.tenants.manage"], true);
  if (!(await hasCapability(context, "platform.finance.read")) && !(await hasCapability(context, "platform.tenants.manage"))) {
    throw new Error("Not authorized");
  }
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new Error("Payments are not configured: missing PAYSTACK_SECRET_KEY");
  const db = await admin();
  const org = await store(db)
    .from("platform_organization")
    .select("id, school_id, display_name, lifecycle_state")
    .eq("id", input.organizationId)
    .maybeSingle();
  if (org.error) {
    if (isMissingRelation(org.error)) throw new Error("Organization storage is not applied.");
    throw new Error(org.error.message);
  }
  const organization = org.data as {
    id: string;
    school_id: string | null;
    display_name: string;
    lifecycle_state: string;
  } | null;
  if (!organization) throw new Error("Organization not found.");
  if (!organization.school_id) throw new Error("This organization is not linked to a school yet.");
  const school = await db
    .from("schools")
    .select("id, monthly_fee, subscription_tier")
    .eq("id", organization.school_id)
    .maybeSingle();
  if (school.error) throw new Error(school.error.message);
  const monthly = Number(school.data?.monthly_fee ?? 0);
  if (!(monthly > 0)) {
    throw new Error("No billable monthly fee is configured on the linked school.");
  }
  const now = timeAuthority.now();
  const reference = `${CONSOLE_SUBSCRIPTION_PREFIX}${organization.school_id.replace(/-/g, "").slice(0, 16)}_${now.atMs}`;
  const { data: inserted, error: insertErr } = await db
    .from("subscriptions")
    .insert({
      school_id: organization.school_id,
      plan: school.data?.subscription_tier || "standard",
      status: "pending",
      amount_paid: monthly,
      paystack_reference: reference,
      started_at: now.at,
    })
    .select("id")
    .single();
  if (insertErr) throw new Error(insertErr.message);
  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      amount: Math.round(monthly * 100),
      currency: "NGN",
      reference,
      metadata: {
        subscription_id: inserted.id,
        organization_id: organization.id,
        school_id: organization.school_id,
        initiated_by: context.userId,
      },
    }),
  });
  const body = (await res.json()) as {
    status: boolean;
    message?: string;
    data?: { authorization_url: string; access_code: string; reference: string };
  };
  if (!res.ok || !body.status || !body.data) {
    throw new Error(body.message || `Paystack init failed (${res.status})`);
  }
  await audit(context, "platform_billing.subscription.init", "subscriptions", inserted.id, {
    schoolId: organization.school_id,
    amount: monthly,
    mode: secret.startsWith("sk_live_") ? "live" : "test",
  });
  return {
    access_code: body.data.access_code,
    authorization_url: body.data.authorization_url,
    reference: body.data.reference,
  };
}

export async function countOpenIncidents(): Promise<number | null> {
  const db = await admin();
  const { data, error } = await store(db)
    .from("platform_incident")
    .select("id, status")
    .in("status", ["open", "acknowledged", "mitigating"])
    .limit(500);
  if (error) return null;
  return ((data ?? []) as Array<{ status: string }>).length;
}

export async function countSubscriptions(): Promise<number | null> {
  const db = await admin();
  const { data, error } = await db.from("subscriptions").select("id").limit(1000);
  if (error) return null;
  return (data ?? []).length;
}
