/**
 * SHERIVS-029: Vercel project-domain integration point.
 * Adds a verified school hostname to the Vercel project so it gets TLS and routes to this app.
 * STUBBED until VERCEL_TOKEN and VERCEL_PROJECT_ID are configured: returns "stubbed" and makes no call.
 * Never logs the token.
 */
export type VercelDomainResult = { status: "stubbed" | "added" | "error"; detail?: string };

export async function addDomainToVercel(hostname: string, fetchImpl: typeof fetch = fetch): Promise<VercelDomainResult> {
  const token = process.env.VERCEL_TOKEN;
  const project = process.env.VERCEL_PROJECT_ID;
  const team = process.env.VERCEL_TEAM_ID;
  if (!token || !project) return { status: "stubbed", detail: "VERCEL_TOKEN / VERCEL_PROJECT_ID not configured" };
  const url = `https://api.vercel.com/v10/projects/${encodeURIComponent(project)}/domains${team ? `?teamId=${encodeURIComponent(team)}` : ""}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: hostname }),
  });
  if (res.ok) return { status: "added" };
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
  // Already on this project counts as success.
  if (body.error?.code === "domain_already_in_use" || body.error?.code === "domain_already_exists") return { status: "added", detail: body.error.code };
  return { status: "error", detail: `${res.status} ${body.error?.code ?? ""}`.trim() };
}
