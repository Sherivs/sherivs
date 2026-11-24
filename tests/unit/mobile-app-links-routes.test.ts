import { describe, expect, it } from "vitest";
import {
  APP_LINK_ROUTE_FALLBACK,
  mapScholarIncomingLinkToRoute,
} from "../../mobile/src/lib/links/app-link-routes";

describe("mobile app-link route mapping", () => {
  it("maps the allow-listed Scholar web paths to explicit app routes", () => {
    expect(mapScholarIncomingLinkToRoute("/m/student-portal")).toBe(APP_LINK_ROUTE_FALLBACK);
    expect(mapScholarIncomingLinkToRoute("/home/notifications")).toBe(APP_LINK_ROUTE_FALLBACK);
    expect(mapScholarIncomingLinkToRoute("/home/notifications/unread")).toBe(
      APP_LINK_ROUTE_FALLBACK,
    );
    expect(mapScholarIncomingLinkToRoute("/results")).toBe("/(school)/results");
    expect(mapScholarIncomingLinkToRoute("/fees/history")).toBe("/(school)/fees");
    expect(mapScholarIncomingLinkToRoute("/messages/thread/1")).toBe("/(school)/messages");
    expect(mapScholarIncomingLinkToRoute("/cbt/exams")).toBe("/(school)/cbt");
  });

  it("maps absolute app.sherivs.com links and ignores unknown or non-app hosts", () => {
    expect(mapScholarIncomingLinkToRoute("https://app.sherivs.com/results?term=1")).toBe(
      "/(school)/results",
    );
    expect(mapScholarIncomingLinkToRoute("https://sherivs.com/results")).toBeNull();
    expect(mapScholarIncomingLinkToRoute("https://www.sherivs.com/messages")).toBeNull();
    expect(mapScholarIncomingLinkToRoute("https://evil.example/messages")).toBeNull();
  });

  it("does not rewrite unknown or malformed paths", () => {
    expect(mapScholarIncomingLinkToRoute("/")).toBeNull();
    expect(mapScholarIncomingLinkToRoute("/request-demo")).toBeNull();
    expect(mapScholarIncomingLinkToRoute("/home")).toBeNull();
    expect(mapScholarIncomingLinkToRoute("javascript:alert(1)")).toBeNull();
    expect(mapScholarIncomingLinkToRoute("results")).toBeNull();
  });
});
