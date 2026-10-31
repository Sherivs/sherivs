/**
 * Browser helper for the authentication audit ingest. Attaches the current
 * session when one exists so session-bound events can be verified server-side.
 * The access token is sent only to this origin. Failures are swallowed by
 * the caller; audit must not block sign-in.
 */
import { supabase } from "@/integrations/supabase/client";

export type SecurityAuditEvent =
  "password_reset_requested" | "password_reset_completed" | "login_failed" | "login_succeeded";

export async function postSecurityAudit(body: {
  event: SecurityAuditEvent;
  email?: string;
}): Promise<Response | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return await fetch("/api/public/audit/password-reset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}
