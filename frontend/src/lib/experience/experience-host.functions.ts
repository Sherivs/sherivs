/**
 * Server hostname reader for SSR host dispatch.
 * Uses the incoming Host / X-Forwarded-Host header. No secrets.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { hostnameFromHostHeader } from "./experience-host";

export const readRequestHostname = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const request = getRequest();
    return hostnameFromHostHeader(
      request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
    );
  } catch {
    return "";
  }
});
