/**
 * Egress allowlist for adapters (ENGINE-06, ADR-084). Wraps an HttpPort so a
 * request can only reach the hosts an adapter declared, over https, without
 * credentials in the URL. A blocked request never reaches the inner port.
 */
import type { HttpPort, HttpRequest, HttpResponse } from "./adapter-contract";

export class EgressBlockedError extends Error {
  constructor() {
    super("egress_blocked");
    this.name = "EgressBlockedError";
  }
}

export function allowlistedHttp(inner: HttpPort, hosts: readonly string[]): HttpPort {
  const allowed = new Set(hosts.map((h) => h.toLowerCase()));
  return {
    request(req: HttpRequest): Promise<HttpResponse> {
      let url: URL;
      try {
        url = new URL(req.url);
      } catch {
        return Promise.reject(new EgressBlockedError());
      }
      if (
        url.protocol !== "https:" ||
        url.username !== "" ||
        url.password !== "" ||
        url.port !== "" ||
        !allowed.has(url.hostname.toLowerCase())
      ) {
        return Promise.reject(new EgressBlockedError());
      }
      return inner.request(req);
    },
  };
}
