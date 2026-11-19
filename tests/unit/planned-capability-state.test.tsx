import type React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const { PlannedCapabilityState, CardNotFoundState } =
  await import("../../frontend/src/components/app-shell/planned-capability-state");
const { plannedCapabilityCopy } =
  await import("../../frontend/src/lib/shell/planned-capability-copy");

const Icon = () => <svg aria-hidden="true" />;

describe("PlannedCapabilityState", () => {
  const html = renderToStaticMarkup(
    <PlannedCapabilityState
      label="Fees & payments"
      kind="nav"
      homeHref="/home"
      Icon={Icon}
      context="Bursar in Test Org"
    />,
  );

  it("is a named region with a level-one heading", () => {
    const id = /<h1 id="([^"]+)">Fees &amp; payments<\/h1>/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<section`);
    expect(html).toContain(`aria-labelledby="${id}"`);
  });

  it("states the status in words, not only by colour", () => {
    expect(html).toContain("<strong>Status:</strong> Planned, not built yet");
    expect(html).toContain('data-card-status="planned"');
  });

  it("says in one sentence what the capability will do", () => {
    expect(html).toContain("Fees &amp; payments will open here as its own screen.");
  });

  it("offers no fake data and no fake actions", () => {
    expect(html).not.toMatch(/<(input|button|select|textarea|form)\b/);
    expect(html).not.toContain("planned-capability-figure");
    expect(html.replace(/<[^>]*>/g, " ")).not.toMatch(/\d/);
    const links = html.match(/<a\b/g) ?? [];
    expect(links).toHaveLength(1);
    expect(html).toContain('href="/home"');
  });

  it("shows a server figure only when one is passed, labelled as read from records", () => {
    const withFigure = renderToStaticMarkup(
      <PlannedCapabilityState
        label="Outstanding fees"
        kind="widget"
        homeHref="/home"
        Icon={Icon}
        figure={{ text: "12", tone: "blue" }}
      />,
    );
    expect(withFigure).toContain("Current figure");
    expect(withFigure).toContain("12");
    expect(withFigure).toContain("Read from your organization&#x27;s records.");
  });

  it("has a sentence for every card kind", () => {
    const copy = plannedCapabilityCopy("en");
    expect(copy.purpose("widget", "X")).toMatch(/^X will show/);
    expect(copy.purpose("action", "X")).toMatch(/^X will let you/);
    expect(copy.purpose("inbox", "X")).toMatch(/^X will collect/);
    expect(copy.purpose("section", "X")).toMatch(/^X will open/);
  });

  it("falls back to English for a locale without strings", () => {
    expect(plannedCapabilityCopy("ha")).toBe(plannedCapabilityCopy("en"));
    expect(plannedCapabilityCopy(undefined)).toBe(plannedCapabilityCopy("en"));
  });
});

describe("CardNotFoundState", () => {
  it("names the missing key under a heading and links home", () => {
    const html = renderToStaticMarkup(<CardNotFoundState sectionKey="w.nope" homeHref="/home" />);
    expect(html).toContain('data-testid="card-not-found"');
    expect(html).toMatch(/<h1 id="[^"]+">Section not found<\/h1>/);
    expect(html).toContain("w.nope");
    expect(html).not.toMatch(/<(input|button|form)\b/);
  });
});
