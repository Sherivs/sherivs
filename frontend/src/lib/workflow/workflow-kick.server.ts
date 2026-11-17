const BEARER_SCHEME = "Bearer";

export function kickWorkflowTick(
  env: Record<string, string | undefined> = process.env,
  fetcher: typeof fetch = fetch,
): void {
  const url = env.WORKFLOW_TICK_URL;
  const secret = env.CRON_SECRET;
  if (env.WORKFLOWS_ENABLED !== "true" || !url || !secret) return;
  try {
    const tickUrl = new URL(url);
    if (tickUrl.protocol !== "https:") return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    void fetcher(tickUrl, {
      method: "POST",
      headers: { authorization: `${BEARER_SCHEME} ${secret}` },
      signal: controller.signal,
    })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
  } catch {
    // A kick is best-effort; the scheduled tick remains the durable fallback.
  }
}
