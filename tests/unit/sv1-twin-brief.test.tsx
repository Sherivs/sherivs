/**
 * SV1-TWIN-05 — assistant panel and offline brief.
 * Rules are tested on the pure view model; markup is checked with a server render.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createTwinBriefClient,
  parseTwinBrief,
  type TwinBriefRequest,
} from "../../frontend/src/lib/assistant/twin-brief-client";
import {
  BRIEF_STALE_AFTER_MS,
  SOURCE_STALE_AFTER_MS,
  ageLabel,
  buildBriefViewModel,
  cacheForContext,
  cardViewModel,
  rejectionMessage,
  type BriefCache,
  type BriefInputs,
} from "../../frontend/src/lib/assistant/twin-brief-model";
import { TwinBriefView } from "../../frontend/src/components/app-shell/twin-brief-panel";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const CTX = "p1|s1|teacher";

function rawItem(over: Record<string, unknown> = {}) {
  return {
    proposalId: "a",
    kind: "recommendation",
    label: "Recommendation",
    summary: "Follow up on three absences",
    sourceKind: "record",
    sourceDescription: "Three absences in Week 45",
    sourceAsOfMs: NOW - HOUR,
    confidence: null,
    actionable: true,
    ...over,
  };
}
const rawBrief = (items: unknown[], over: Record<string, unknown> = {}) => ({
  generatedAtMs: NOW,
  items,
  omitted: 0,
  ...over,
});

function cache(items: unknown[] = [rawItem()], fetchedAtMs = NOW, contextKey = CTX): BriefCache {
  const brief = parseTwinBrief(rawBrief(items));
  if (!brief) throw new Error("fixture brief did not parse");
  return { contextKey, fetchedAtMs, brief };
}

function inputs(over: Partial<BriefInputs> = {}): BriefInputs {
  return {
    contextKey: CTX,
    online: true,
    loading: false,
    serviceAvailable: true,
    lastFetchFailed: false,
    cache: cache(),
    nowMs: NOW,
    ...over,
  };
}

describe("client: no identity from the browser", () => {
  it("sends only the operation and a proposal id", async () => {
    const seen: TwinBriefRequest[] = [];
    const client = createTwinBriefClient(async (r) => {
      seen.push(r);
      return r.op === "brief" ? rawBrief([rawItem()]) : { ok: true };
    });
    await client.fetchBrief();
    await client.decide("a", "approve");
    expect(seen).toEqual([{ op: "brief" }, { op: "decide", proposalId: "a", decision: "approve" }]);
    for (const r of seen) {
      expect(JSON.stringify(r)).not.toMatch(/tenant|user|school|role|profile|token/i);
    }
  });

  it("reports unavailable when no transport is wired, and error when it throws or returns junk", async () => {
    expect(await createTwinBriefClient().fetchBrief()).toEqual({ status: "unavailable" });
    expect(await createTwinBriefClient().decide("a", "dismiss")).toEqual({ status: "unavailable" });
    const boom = createTwinBriefClient(async () => {
      throw new Error("x");
    });
    expect(await boom.fetchBrief()).toEqual({ status: "error" });
    expect(await boom.decide("a", "dismiss")).toEqual({ status: "error" });
    const junk = createTwinBriefClient(async () => "nope");
    expect(await junk.fetchBrief()).toEqual({ status: "error" });
    expect(await junk.decide("a", "dismiss")).toEqual({ status: "error" });
  });

  it("maps a rejection to a known reason and an unknown one to other", async () => {
    const c = (reason: string) => createTwinBriefClient(async () => ({ ok: false, reason }));
    expect(await c("permission_not_held").decide("a", "approve")).toEqual({
      status: "rejected",
      reason: "permission_not_held",
    });
    expect(await c("<script>").decide("a", "approve")).toEqual({
      status: "rejected",
      reason: "other",
    });
  });
});

describe("client: server data is untrusted", () => {
  it("keeps only allowlisted fields and drops cards with no label, source or valid kind", () => {
    const brief = parseTwinBrief(
      rawBrief([
        rawItem({ tenantRef: "other", secret: "x" }),
        rawItem({ proposalId: "b", label: "" }),
        rawItem({ proposalId: "c", sourceDescription: " " }),
        rawItem({ proposalId: "d", kind: "mutation" }),
        rawItem({ proposalId: "e", sourceAsOfMs: Number.NaN }),
        rawItem({ proposalId: "f", sourceKind: "" }),
        null,
        "string",
      ]),
    );
    expect(brief?.items.map((i) => i.proposalId)).toEqual(["a"]);
    expect(brief?.dropped).toBe(7);
    expect(Object.keys(brief!.items[0]).sort()).toEqual(
      [
        "actionable",
        "confidence",
        "kind",
        "label",
        "proposalId",
        "sourceAsOfMs",
        "sourceDescription",
        "sourceKind",
        "summary",
      ].sort(),
    );
  });

  it("rejects a label that does not match the kind, so a prediction cannot pose as a recommendation", () => {
    const brief = parseTwinBrief(
      rawBrief([
        rawItem({ proposalId: "p", kind: "prediction", label: "Recommendation", confidence: 0.5 }),
      ]),
    );
    expect(brief?.items).toHaveLength(0);
    expect(brief?.dropped).toBe(1);
  });

  it("never makes a prediction actionable and requires its confidence", () => {
    const brief = parseTwinBrief(
      rawBrief([
        rawItem({
          proposalId: "p",
          kind: "prediction",
          label: "Prediction",
          confidence: 0.7,
          actionable: true,
        }),
        rawItem({ proposalId: "q", kind: "prediction", label: "Prediction", confidence: 1.5 }),
        rawItem({ proposalId: "r", kind: "prediction", label: "Prediction" }),
      ]),
    );
    expect(brief?.items.map((i) => [i.proposalId, i.actionable])).toEqual([["p", false]]);
  });

  it("treats only a literal true as actionable, de-duplicates, trims text and caps the list", () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      rawItem({ proposalId: `i${i}`, actionable: "yes" }),
    );
    const brief = parseTwinBrief(rawBrief([rawItem({ summary: "  hi  " }), rawItem(), ...many]));
    expect(brief?.items[0].summary).toBe("hi");
    expect(brief?.items.filter((i) => i.proposalId === "a")).toHaveLength(1);
    expect(brief!.items.length).toBeLessThanOrEqual(50);
    expect(brief!.items.every((i) => i.actionable === (i.proposalId === "a"))).toBe(true);
    expect(
      parseTwinBrief(rawBrief([rawItem({ summary: "x".repeat(900) })]))!.items[0].summary,
    ).toHaveLength(280);
  });

  it("rejects a malformed envelope", () => {
    for (const bad of [
      null,
      [],
      { items: [] },
      { generatedAtMs: -1, items: [] },
      { generatedAtMs: NOW },
    ]) {
      expect(parseTwinBrief(bad)).toBeNull();
    }
  });
});

describe("view model: states", () => {
  it("no context, unavailable, loading, error", () => {
    expect(buildBriefViewModel(inputs({ contextKey: "", cache: null })).status).toBe("no_context");
    expect(buildBriefViewModel(inputs({ serviceAvailable: false, cache: null })).status).toBe(
      "unavailable",
    );
    expect(buildBriefViewModel(inputs({ loading: true, cache: null })).status).toBe("loading");
    expect(buildBriefViewModel(inputs({ lastFetchFailed: true, cache: null })).status).toBe(
      "error",
    );
  });

  it("live, empty and stale", () => {
    expect(buildBriefViewModel(inputs()).status).toBe("live");
    expect(buildBriefViewModel(inputs({ cache: cache([]) })).status).toBe("empty");
    const old = buildBriefViewModel(inputs({ nowMs: NOW + BRIEF_STALE_AFTER_MS + 1 }));
    expect(old.status).toBe("stale");
    expect(old.banner?.text).toMatch(/may be out of date/);
    expect(old.freshness).toBe("Updated 15 min ago");
  });

  it("offline with a cache shows it, labelled with its age; offline without one says so", () => {
    const m = buildBriefViewModel(inputs({ online: false, nowMs: NOW + 3 * HOUR }));
    expect(m.status).toBe("offline_cached");
    expect(m.cards).toHaveLength(1);
    expect(m.freshness).toBe("Updated 3 h ago");
    expect(m.banner?.text).toMatch(/offline.*3 h ago.*paused/);
    const none = buildBriefViewModel(inputs({ online: false, cache: null }));
    expect(none.status).toBe("offline_empty");
    expect(none.cards).toHaveLength(0);
  });

  it("a brief fetched for another identity, organization or role is never shown", () => {
    const other = cache([rawItem()], NOW, "p2|s1|teacher");
    expect(cacheForContext(other, CTX)).toBeNull();
    expect(cacheForContext(other, "")).toBeNull();
    for (const key of ["p1|s2|teacher", "p1|s1|bursar", "p2|s1|teacher"]) {
      const m = buildBriefViewModel(inputs({ contextKey: key }));
      expect(m.cards).toHaveLength(0);
      expect(m.freshness).toBeNull();
    }
    const offline = buildBriefViewModel(inputs({ contextKey: "p1|s2|teacher", online: false }));
    expect(offline.status).toBe("offline_empty");
    expect(offline.cards).toHaveLength(0);
  });

  it("notes omitted and hidden items", () => {
    const brief = parseTwinBrief(
      rawBrief([rawItem(), rawItem({ proposalId: "x", label: "" })], { omitted: 3 }),
    )!;
    const m = buildBriefViewModel(inputs({ cache: { contextKey: CTX, fetchedAtMs: NOW, brief } }));
    expect(m.footnote).toBe("3 more not shown. 1 hidden because they had no clear source.");
  });

  it("refresh is possible only online, with a service, a context and no load in flight", () => {
    expect(buildBriefViewModel(inputs()).canRefresh).toBe(true);
    expect(buildBriefViewModel(inputs({ online: false })).canRefresh).toBe(false);
    expect(buildBriefViewModel(inputs({ serviceAvailable: false })).canRefresh).toBe(false);
    expect(buildBriefViewModel(inputs({ loading: true })).canRefresh).toBe(false);
    expect(buildBriefViewModel(inputs({ contextKey: "" })).canRefresh).toBe(false);
  });
});

describe("view model: what a person may do", () => {
  const card = (over: Partial<BriefInputs> = {}, item: unknown = rawItem()) =>
    buildBriefViewModel(inputs({ cache: cache([item]), ...over })).cards[0];

  it("live and fresh: approve and dismiss are enabled", () => {
    const c = card();
    expect(c.approve.enabled).toBe(true);
    expect(c.dismiss.enabled).toBe(true);
    expect(c.label).toBe("Recommendation");
    expect(c.sourceLine).toBe("Source: Three absences in Week 45 (1 h ago)");
  });

  it("stale brief: approve is blocked until refreshed, dismiss still works", () => {
    const c = card({ nowMs: NOW + BRIEF_STALE_AFTER_MS + 1 });
    expect(c.approve).toEqual({ enabled: false, reason: "Refresh the brief before approving." });
    expect(c.dismiss.enabled).toBe(true);
  });

  it("offline: every decision is blocked with a reason, nothing is queued", () => {
    const c = card({ online: false });
    for (const a of [c.approve, c.dismiss]) {
      expect(a).toEqual({ enabled: false, reason: "Needs a connection." });
    }
    const info = card({ online: false }, rawItem({ actionable: false }));
    expect(info.acknowledge).toEqual({ enabled: false, reason: "Needs a connection." });
  });

  it("an out-of-date source blocks approval even on a live brief", () => {
    const c = card({}, rawItem({ sourceAsOfMs: NOW - SOURCE_STALE_AFTER_MS - 1 }));
    expect(c.sourceStale).toBe(true);
    expect(c.approve).toEqual({ enabled: false, reason: "The source data is out of date." });
  });

  it("source freshness is computed here, not trusted from the server", () => {
    const c = card(
      {},
      { ...rawItem({ sourceAsOfMs: NOW - 2 * SOURCE_STALE_AFTER_MS }), freshness: "fresh" },
    );
    expect(c.sourceStale).toBe(true);
  });

  it("a prediction shows its confidence, is information only and can never be approved", () => {
    const c = card(
      {},
      rawItem({ kind: "prediction", label: "Prediction", confidence: 0.62, actionable: true }),
    );
    expect(c.label).toBe("Prediction");
    expect(c.confidenceLine).toBe("62% confidence. A prediction, not a fact.");
    expect(c.informationOnly).toBe(true);
    expect(c.approve.enabled).toBe(false);
    expect(c.acknowledge.enabled).toBe(true);
  });

  it("a prediction is never approvable even if handed in as actionable (defence in depth)", () => {
    const c = cardViewModel(
      {
        proposalId: "p",
        kind: "prediction",
        label: "Prediction",
        summary: "s",
        sourceKind: "model",
        sourceDescription: "d",
        sourceAsOfMs: NOW,
        confidence: 0.5,
        actionable: true,
      },
      "live",
      NOW,
    );
    expect(c.approve.enabled).toBe(false);
  });

  it("an item with no operation can be acknowledged but not approved", () => {
    const c = card(
      {},
      rawItem({ kind: "playbook_step", label: "Playbook suggestion", actionable: false }),
    );
    expect(c.approve.enabled).toBe(false);
    expect(c.acknowledge.enabled).toBe(true);
  });
});

describe("labels and messages", () => {
  it("ageLabel is never negative and reads naturally", () => {
    expect(ageLabel(-5)).toBe("just now");
    expect(ageLabel(30_000)).toBe("just now");
    expect(ageLabel(5 * MIN)).toBe("5 min ago");
    expect(ageLabel(3 * HOUR)).toBe("3 h ago");
    expect(ageLabel(72 * HOUR)).toBe("3 days ago");
  });

  it("rejection messages never blame the person and cover every known reason", () => {
    for (const r of [
      "not_open",
      "proposal_expired",
      "permission_not_held",
      "not_owner",
      "unknown_proposal",
      "other",
    ]) {
      const m = rejectionMessage(r);
      expect(m.length).toBeGreaterThan(10);
      expect(m).not.toMatch(/your fault|you failed|invalid/i);
    }
    expect(rejectionMessage("permission_not_held")).toMatch(/role no longer allows/);
  });
});

describe("markup", () => {
  const noop = () => {};
  function render(over: Partial<BriefInputs> = {}, extra: { confirming?: string | null } = {}) {
    return renderToStaticMarkup(
      <TwinBriefView
        model={buildBriefViewModel(inputs(over))}
        confirmingId={extra.confirming ?? null}
        busyId={null}
        message={null}
        onRefresh={noop}
        onDecide={noop}
        onAskConfirm={noop}
      />,
    );
  }

  it("is a labelled region with a heading, a polite live area and a named refresh button", () => {
    const html = render();
    expect(html).toContain('aria-labelledby="twin-brief-heading"');
    expect(html).toContain('id="twin-brief-heading"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Refresh your twin brief"');
  });

  it("every card shows its label and source, and every button has an accessible name", () => {
    const html = render({
      cache: cache([
        rawItem(),
        rawItem({
          proposalId: "b",
          kind: "prediction",
          label: "Prediction",
          confidence: 0.4,
          actionable: false,
        }),
      ]),
    });
    expect(html.match(/data-testid="twin-brief-card"/g)).toHaveLength(2);
    expect(html).toContain("Recommendation");
    expect(html).toContain("Prediction");
    expect(html.match(/Source: /g)).toHaveLength(2);
    const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)];
    for (const [tag, inner] of buttons) {
      const named =
        /aria-label="[^"]+"/.test(tag) || inner.replace(/<[^>]+>/g, "").trim().length > 0;
      expect(named).toBe(true);
    }
  });

  it("disabled actions point at their reason with aria-describedby", () => {
    const html = render({ online: false });
    const ids = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Needs a connection.");
  });

  it("shows a confirmation step before approval, and no approve button while confirming", () => {
    const html = render({}, { confirming: "a" });
    expect(html).toContain('aria-label="Confirm approval"');
    expect(html).toContain("Confirm approval");
    expect(html).not.toMatch(/aria-label="Approve:/);
  });

  it("renders text as text: markup in a summary is escaped", () => {
    const evil = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
    const html = render({ cache: cache([rawItem({ summary: evil })]) });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("states that nothing runs without approval when there is no brief", () => {
    const html = render({ cache: null, serviceAvailable: false });
    expect(html).toContain("Nothing runs without your approval.");
    expect(html).toContain("not available yet");
  });
});

describe("guard: the twin UI reads only through the client", () => {
  const read = (rel: string) =>
    readFileSync(resolve(__dirname, "../../frontend/src", rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  const files = [
    "components/app-shell/twin-brief-panel.tsx",
    "lib/assistant/twin-brief-client.ts",
    "lib/assistant/twin-brief-model.ts",
  ];

  it("no direct network, database, storage or HTML injection", () => {
    for (const f of files) {
      const src = read(f);
      for (const banned of [
        /\bfetch\s*\(/,
        /XMLHttpRequest/,
        /WebSocket/,
        /@supabase\//,
        /integrations\/supabase/,
        /createServerFn/,
        /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/,
        /dangerouslySetInnerHTML/,
        /\.innerHTML\s*=/,
        /\bnavigator\.serviceWorker\b/,
      ]) {
        expect(src, `${f} matched ${banned}`).not.toMatch(banned);
      }
    }
  });

  it("the panel never reads tenant or identity from anywhere but its props", () => {
    const src = read("components/app-shell/twin-brief-panel.tsx");
    expect(src).not.toMatch(/useApp\b|useAuth\b|tenantRef|userRef|schoolId|profileId/);
  });

  it("Approve only opens the confirmation; the approve decision is sent from the confirmation alone", () => {
    const src = read("components/app-shell/twin-brief-panel.tsx");
    expect(src.match(/onDecide\([^)]*"approve"\)/g)).toHaveLength(1);
    const call = src.search(/onDecide\([^)]*"approve"\)/);
    const groupStart = src.indexOf('role="group"');
    const cancelAt = src.indexOf("Cancel", groupStart);
    expect(call).toBeGreaterThan(groupStart);
    expect(call).toBeLessThan(cancelAt);
    expect(src).toMatch(
      /aria-label=\{`Approve: [^`]*`\}[\s\S]{0,200}onAskConfirm\(card\.proposalId\)/,
    );
  });

  it("the assistant screen passes a context key and a client with no transport", () => {
    const src = read("components/app-shell/assistant-screen.tsx");
    expect(src).toContain("createTwinBriefClient()");
    expect(src).toMatch(/<TwinBriefPanel[\s\S]*contextKey=/);
  });
});
