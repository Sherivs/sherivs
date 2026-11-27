const CANONICAL_HOSTS: Readonly<Record<string, string>> = {
  "sherivs.com": "www.sherivs.com",
  "sherivs.ng": "www.sherivs.ng",
};

/**
 * Redirect apex marketing hosts while leaving association documents on the RP
 * host. The request URL is authoritative; forwarded host headers are ignored.
 */
export function apexRedirectLocation(request: Request): string | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const canonicalHost = CANONICAL_HOSTS[hostname];
  if (!canonicalHost || url.pathname.startsWith("/.well-known/")) return null;
  return `https://${canonicalHost}${url.pathname}${url.search}`;
}
