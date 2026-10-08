/**
 * Landing-plane resolution for `/` (SSR-safe).
 *
 * The root dispatcher needs to know, before any client state exists, whether
 * the request landed on the Sherivs platform plane or on an organization's
 * public site (tenant host or ?school=slug). On the server this reads the
 * request URL; on the client it reads `window.location`. Both paths run the
 * same pure resolver, so server and client agree and the public homepage can
 * be server-rendered for anonymous visitors.
 *
 * This resolves only a slug for routing. Tenant DATA is still loaded and
 * authorized by the app context / database — the slug is never trusted as
 * authorization (AGENTS §26).
 */
import { createServerFn } from "@tanstack/react-start";
import { resolveTenantSlug, tenantSlugFromUrl } from "@/lib/tenant";

export interface LandingPlane {
  /** Organization slug when the request is on a tenant host / ?school=; null on the platform plane. */
  tenantSlug: string | null;
}

const resolveLandingPlaneOnServer = createServerFn({ method: "GET" }).handler(
  async (): Promise<LandingPlane> => {
    const { getRequestUrl } = await import("@tanstack/react-start/server");
    try {
      return { tenantSlug: tenantSlugFromUrl(getRequestUrl({ xForwardedHost: true })) };
    } catch {
      return { tenantSlug: null };
    }
  },
);

export async function resolveLandingPlane(): Promise<LandingPlane> {
  if (typeof window !== "undefined") return { tenantSlug: resolveTenantSlug() };
  return resolveLandingPlaneOnServer();
}
