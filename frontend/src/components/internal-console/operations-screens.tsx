import { useEffect, useState, type FormEvent } from "react";
import { openPaystackInline } from "@/lib/paystack-inline";
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  canTransitionIncident,
  canTransitionTicket,
  type ConsoleIncident,
  type ConsoleTicket,
  type IncidentStatus,
  type TicketStatus,
} from "@/lib/internal-console/operations";
import { useConsole } from "./console-shell";
import { ConsoleNotice } from "./console-primitives";
import {
  apiCreateIncident,
  apiCreateTicket,
  apiInitSubscription,
  apiListBilling,
  apiListIncidents,
  apiListTickets,
  apiSearchLogs,
  apiTransitionIncident,
  apiTransitionTicket,
} from "./operations-api";

function canWriteTickets(capabilities: string[]): boolean {
  return (
    capabilities.includes("platform.support.handle") ||
    capabilities.includes("platform.tenants.manage")
  );
}

function canWriteIncidents(capabilities: string[]): boolean {
  return (
    capabilities.includes("platform.engineering.read") ||
    capabilities.includes("platform.tenants.manage") ||
    capabilities.includes("platform.operations.read")
  );
}

export function ConsoleTickets() {
  const { overview } = useConsole();
  const [tickets, setTickets] = useState<ConsoleTicket[]>([]);
  const [source, setSource] = useState("loading");
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<(typeof TICKET_PRIORITIES)[number]>("normal");
  const [busy, setBusy] = useState(false);
  const capabilities = overview?.viewer.capabilities ?? [];
  const canRead =
    capabilities.includes("platform.tenants.read") ||
    capabilities.includes("platform.support.handle");
  const canWrite = canWriteTickets(capabilities);

  async function load() {
    try {
      const result = await apiListTickets();
      setTickets(result.tickets);
      setSource(result.source);
      setAvailable(result.available);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tickets could not be loaded.");
    }
  }

  useEffect(() => {
    if (canRead) void load();
  }, [canRead]);

  if (!overview) return <section className="sherivs-console-card">Loading tickets…</section>;
  if (!canRead) {
    return (
      <section className="sherivs-console-card">
        <h1>Tickets</h1>
        <p>Support tickets require tenant-read or support-handle capability.</p>
      </section>
    );
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiCreateTicket({ subject, body, priority });
      setSubject("");
      setBody("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create ticket.");
    } finally {
      setBusy(false);
    }
  }

  async function onTransition(id: string, toStatus: TicketStatus) {
    setBusy(true);
    setError(null);
    try {
      await apiTransitionTicket(id, toStatus);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update ticket.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sherivs-console-card" data-testid="console-tickets">
      <p className="sherivs-console-page-kicker">Support</p>
      <h1>Tickets</h1>
      <p>
        These tickets track organization onboarding and product-access issues. They are not school
        complaints, student records, or fee invoices. Source: {source}.
      </p>
      {error ? <ConsoleNotice tone="error">{error}</ConsoleNotice> : null}
      {!available ? (
        <ConsoleNotice>
          Ticket storage is not applied in this environment. SHERIVS-032 creates platform_ticket.
        </ConsoleNotice>
      ) : null}
      {canWrite ? (
        <form onSubmit={(event) => void onCreate(event)} className="sherivs-console-form">
          <label>
            Subject
            <input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              required
              minLength={3}
            />
          </label>
          <label>
            Details
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              required
              minLength={3}
            />
          </label>
          <label>
            Priority
            <select
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as (typeof TICKET_PRIORITIES)[number])
              }
            >
              {TICKET_PRIORITIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="sherivs-console-btn" disabled={busy || !available}>
            Open ticket
          </button>
        </form>
      ) : null}
      <div className="sherivs-console-list" style={{ marginTop: "1rem" }}>
        {tickets.length ? (
          tickets.map((ticket) => (
            <div key={ticket.id} className="sherivs-console-row">
              <strong>{ticket.subject}</strong>
              <small>
                {ticket.status} · {ticket.priority}
                {ticket.organizationName ? ` · ${ticket.organizationName}` : ""}
              </small>
              <p>{ticket.body}</p>
              {canWrite ? (
                <div className="sherivs-console-actions">
                  {TICKET_STATUSES.filter((status) =>
                    canTransitionTicket(ticket.status, status),
                  ).map((status) => (
                    <button
                      key={status}
                      type="button"
                      className="sherivs-console-btn secondary"
                      disabled={busy}
                      onClick={() => void onTransition(ticket.id, status)}
                    >
                      Mark {status}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <p>No tickets are recorded.</p>
        )}
      </div>
    </section>
  );
}

export function ConsoleIncidents() {
  const { overview } = useConsole();
  const [incidents, setIncidents] = useState<ConsoleIncident[]>([]);
  const [source, setSource] = useState("loading");
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [severity, setSeverity] = useState<(typeof INCIDENT_SEVERITIES)[number]>("medium");
  const [busy, setBusy] = useState(false);
  const capabilities = overview?.viewer.capabilities ?? [];
  const canRead =
    capabilities.includes("platform.engineering.read") ||
    capabilities.includes("platform.operations.read") ||
    capabilities.includes("platform.audit.read");
  const canWrite = canWriteIncidents(capabilities);

  async function load() {
    try {
      const result = await apiListIncidents();
      setIncidents(result.incidents);
      setSource(result.source);
      setAvailable(result.available);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incidents could not be loaded.");
    }
  }

  useEffect(() => {
    if (canRead) void load();
  }, [canRead]);

  if (!overview) return <section className="sherivs-console-card">Loading incidents…</section>;
  if (!canRead) {
    return (
      <section className="sherivs-console-card">
        <h1>Incidents</h1>
        <p>Operational incidents require engineering, operations, or audit capability.</p>
      </section>
    );
  }

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiCreateIncident({ title, details, severity });
      setTitle("");
      setDetails("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not file incident.");
    } finally {
      setBusy(false);
    }
  }

  async function onTransition(id: string, toStatus: IncidentStatus) {
    setBusy(true);
    setError(null);
    try {
      await apiTransitionIncident(id, toStatus);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update incident.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sherivs-console-card" data-testid="console-incidents">
      <p className="sherivs-console-page-kicker">Intelligence & Assurance</p>
      <h1>Incidents</h1>
      <p>
        Incidents are operator-filed operational records. They are not a security operations centre.
        Source: {source}.
      </p>
      {error ? <ConsoleNotice tone="error">{error}</ConsoleNotice> : null}
      {!available ? (
        <ConsoleNotice>
          Incident storage is not applied in this environment. SHERIVS-032 creates
          platform_incident.
        </ConsoleNotice>
      ) : null}
      {canWrite ? (
        <form onSubmit={(event) => void onCreate(event)} className="sherivs-console-form">
          <label>
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              minLength={3}
            />
          </label>
          <label>
            Details
            <textarea
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              required
              minLength={3}
            />
          </label>
          <label>
            Severity
            <select
              value={severity}
              onChange={(event) =>
                setSeverity(event.target.value as (typeof INCIDENT_SEVERITIES)[number])
              }
            >
              {INCIDENT_SEVERITIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="sherivs-console-btn" disabled={busy || !available}>
            File incident
          </button>
        </form>
      ) : null}
      <div className="sherivs-console-list" style={{ marginTop: "1rem" }}>
        {incidents.length ? (
          incidents.map((incident) => (
            <div key={incident.id} className="sherivs-console-row">
              <strong>{incident.title}</strong>
              <small>
                {incident.status} · {incident.severity}
                {incident.organizationName ? ` · ${incident.organizationName}` : ""}
              </small>
              <p>{incident.details}</p>
              {canWrite ? (
                <div className="sherivs-console-actions">
                  {INCIDENT_STATUSES.filter((status) =>
                    canTransitionIncident(incident.status, status),
                  ).map((status) => (
                    <button
                      key={status}
                      type="button"
                      className="sherivs-console-btn secondary"
                      disabled={busy}
                      onClick={() => void onTransition(incident.id, status)}
                    >
                      Mark {status}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <p>No incidents are recorded.</p>
        )}
      </div>
    </section>
  );
}

export function ConsoleLogs() {
  const { overview } = useConsole();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<
    Array<{
      id: string;
      action: string;
      description: string;
      actor: string | null;
      at: string;
      outcome: string;
    }>
  >([]);
  const canRead =
    overview?.viewer.capabilities.includes("platform.engineering.read") ||
    overview?.viewer.capabilities.includes("platform.audit.read");

  async function load(nextQuery?: string) {
    try {
      const result = await apiSearchLogs(nextQuery);
      setEvents(result.events);
      setSource(result.source);
      setAvailable(result.available);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logs could not be searched.");
    }
  }

  useEffect(() => {
    if (canRead) void load();
  }, [canRead]);

  if (!overview) return <section className="sherivs-console-card">Loading logs…</section>;
  if (!canRead) {
    return (
      <section className="sherivs-console-card">
        <h1>Logs</h1>
        <p>Technical logs require the engineering or audit capability.</p>
      </section>
    );
  }

  return (
    <section className="sherivs-console-card" data-testid="console-logs">
      <p className="sherivs-console-page-kicker">Activity & Audit</p>
      <h1>Logs</h1>
      <p>
        Searchable control-plane audit actions. Request traces and secrets are not stored here.
        Source: {source || "loading"}.
      </p>
      {error ? <ConsoleNotice tone="error">{error}</ConsoleNotice> : null}
      {!available ? (
        <ConsoleNotice>audit_logs is not available in this environment.</ConsoleNotice>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load(query);
        }}
        className="sherivs-console-form"
      >
        <label>
          Search actions
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="platform_organization"
          />
        </label>
        <button type="submit" className="sherivs-console-btn">
          Search
        </button>
      </form>
      <div className="sherivs-console-list" style={{ marginTop: "1rem" }}>
        {events.length ? (
          events.map((event) => (
            <div key={event.id} className="sherivs-console-row">
              <strong>{event.description}</strong>
              <small>
                {event.action} · {event.outcome} · {event.actor ?? "unknown actor"} ·{" "}
                {new Date(event.at).toLocaleString()}
              </small>
            </div>
          ))
        ) : (
          <p>No matching audit records.</p>
        )}
      </div>
    </section>
  );
}

export function ConsoleBilling() {
  const { overview } = useConsole();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof apiListBilling>> | null>(null);
  const capabilities = overview?.viewer.capabilities ?? [];
  const canRead =
    capabilities.includes("platform.finance.read") ||
    capabilities.includes("platform.tenants.manage");
  const canCharge = capabilities.includes("platform.tenants.manage");

  async function load() {
    try {
      setSnapshot(await apiListBilling());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Billing could not be loaded.");
    }
  }

  useEffect(() => {
    if (canRead) void load();
  }, [canRead]);

  if (!overview) return <section className="sherivs-console-card">Loading billing…</section>;
  if (!canRead) {
    return (
      <section className="sherivs-console-card">
        <h1>Billing</h1>
        <p>Billing requires finance-read or tenant-manage capability.</p>
      </section>
    );
  }

  async function startCheckout(organizationId: string) {
    setBusy(true);
    setError(null);
    try {
      const email = overview?.viewer.email;
      if (!email) throw new Error("Signed-in email is required for checkout.");
      const result = await apiInitSubscription(organizationId, email);
      await openPaystackInline(result.access_code, {
        onSuccess: () => {
          void load();
        },
        onError: (err) => setError(err.message ?? "Paystack checkout failed."),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Paystack checkout.");
    } finally {
      setBusy(false);
    }
  }

  const orgs = (overview.organizations ?? []).filter((row) => row.schoolId);

  return (
    <section className="sherivs-console-card" data-testid="console-billing">
      <p className="sherivs-console-page-kicker">Organizations</p>
      <h1>Billing</h1>
      <p>
        {snapshot?.detail ??
          "School subscription payment history from public.subscriptions. This is not recognized revenue."}
      </p>
      <p>
        Paystack mode: {snapshot?.paystackMode ?? "unknown"}. Source:{" "}
        {snapshot?.source ?? "loading"}.
      </p>
      {snapshot?.paystackMode === "test" ? (
        <ConsoleNotice tone="warning">
          PAYSTACK_SECRET_KEY is a test key. Live charges are not being collected.
        </ConsoleNotice>
      ) : null}
      {error ? <ConsoleNotice tone="error">{error}</ConsoleNotice> : null}
      <h2>Payment history</h2>
      <div className="sherivs-console-list">
        {snapshot?.subscriptions.length ? (
          snapshot.subscriptions.map((row) => (
            <div key={row.id} className="sherivs-console-row">
              <strong>{row.organizationName ?? row.schoolId}</strong>
              <small>
                {row.plan} · {row.status} · {row.amountPaid} ·{" "}
                {row.paystackReference ?? "no reference"}
              </small>
            </div>
          ))
        ) : (
          <p>No subscription payment rows are recorded.</p>
        )}
      </div>
      <h2>Platform pricing</h2>
      <div className="sherivs-console-list">
        {snapshot?.pricing.length ? (
          snapshot.pricing.map((row) => (
            <div key={row.schoolId} className="sherivs-console-row">
              <strong>{row.organizationName ?? row.schoolId}</strong>
              <small>
                Per-student fee {row.perStudentFee}
                {row.note ? ` · ${row.note}` : ""}
              </small>
            </div>
          ))
        ) : (
          <p>No school_platform_pricing rows are recorded.</p>
        )}
      </div>
      {canCharge ? (
        <>
          <h2>Collect a configured monthly fee</h2>
          <p>
            Checkout uses the linked school&apos;s monthly_fee and Paystack Inline. The webhook is
            the source of truth.
          </p>
          <div className="sherivs-console-list">
            {orgs.length ? (
              orgs.map((org) => (
                <div key={org.id} className="sherivs-console-row">
                  <strong>{org.displayName}</strong>
                  <small>{org.lifecycleState}</small>
                  <button
                    type="button"
                    className="sherivs-console-btn"
                    disabled={busy}
                    onClick={() => void startCheckout(org.id)}
                  >
                    Open Paystack Inline
                  </button>
                </div>
              ))
            ) : (
              <p>No provisioned organizations with a linked school are available for checkout.</p>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
