/** SHERIVS-B07: officer-invite email content and delivery-outcome mapping (pure; no I/O, no clock). */
export type InviteMailContext = { invite_id: string; email: string; agency_role: string; expires_at: string; jurisdiction: string; host_label: string | null; now: string };
export type InviteEmailStatus = "sent" | "stubbed" | "failed";

/** Only https origins (or localhost for dev) may appear in an emailed link. */
export function safeOrigin(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (u.pathname !== "/" || u.search || u.hash || u.username || u.password) return null;
    if (u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) return u.origin;
    return null;
  } catch { return null; }
}

export const inviteLink = (origin: string, token: string) => `${origin}/gov-invite?token=${encodeURIComponent(token)}`;

export function buildInviteEmail(ctx: InviteMailContext, link: string): { subject: string; body: string } {
  const role = ctx.agency_role.replace(/_/g, " ");
  return {
    subject: `Invitation: ${ctx.jurisdiction} education console (Sherivs Scholar)`,
    body: [
      `You have been invited to the ${ctx.jurisdiction} government education console as ${role}.`,
      "",
      `Accept the invitation (link valid until ${ctx.expires_at.slice(0, 10)}):`,
      link,
      "",
      "You will be asked to sign in with this email address and set up an authenticator app (MFA) before you can view any data.",
      "If you were not expecting this invitation, ignore this email; the link expires on its own.",
    ].join("\n"),
  };
}

/** Map an email adapter result to the stored status. A missing provider is a stub, not a failure. */
export function mapEmailOutcome(r: { outcome?: string; code?: string; providerMessageId?: string }): { status: InviteEmailStatus; detail: string } {
  if (r.providerMessageId && !r.outcome) return { status: "sent", detail: `provider_id:${r.providerMessageId}`.slice(0, 200) };
  if (r.code === "provider_not_configured") return { status: "stubbed", detail: "provider_not_configured" };
  return { status: "failed", detail: (r.code ?? "unknown").slice(0, 200) };
}
