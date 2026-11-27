import { mapScholarIncomingLinkToRoute } from "@/lib/links/app-link-routes";

/**
 * Expo Router native intent hook for universal/app links.
 * /home/notifications currently routes to school home until a dedicated
 * notifications screen exists.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return mapScholarIncomingLinkToRoute(path) ?? path;
}
