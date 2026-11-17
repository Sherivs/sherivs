/**
 * SV1-TWIN-04 — the proposals module defers to the AI safety boundary.
 * The boundary is replaced with a denying stub to prove the module honours it.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../frontend/src/lib/scholar/ai-safety", () => ({
  decideAiAction: () => ({ allowed: false, reasons: ["stubbed denial"] }),
  AI_FORBIDDEN_ACTIONS: [],
}));

import {
  EMPTY_PROPOSAL_STORE,
  createProposal,
} from "../../frontend/src/lib/scholar/personal-twin/proposals";

describe("AI safety boundary is authoritative", () => {
  it("a denial from decideAiAction blocks an operation proposal", () => {
    const r = createProposal(
      EMPTY_PROPOSAL_STORE,
      {
        proposalId: "p1",
        kind: "recommendation",
        tenantRef: "t1",
        userRef: "u1",
        roleCode: "teacher",
        summary: "Flag a follow-up",
        source: { kind: "record", ref: "r", asOfMs: 1, description: "d" },
        ttlMs: 1000,
        correlationId: "c",
        operationId: "scholar.attendance.flag_followup",
        requiredPermission: "attendance.take",
      },
      [
        {
          id: "scholar.attendance.flag_followup",
          kind: "command",
          surface: "attendance",
          inputShape: "I",
          outputKind: "O",
          requiresAuthorization: true,
        },
      ],
      10,
    );
    expect(r).toMatchObject({ ok: false, reason: "safety_boundary_denied" });
  });

  it("an information-only proposal does not need the boundary", () => {
    const r = createProposal(
      EMPTY_PROPOSAL_STORE,
      {
        proposalId: "p2",
        kind: "away_brief_item",
        tenantRef: "t1",
        userRef: "u1",
        roleCode: "teacher",
        summary: "Two messages arrived",
        source: { kind: "record", ref: "r", asOfMs: 1, description: "d" },
        ttlMs: 1000,
        correlationId: "c",
      },
      [],
      10,
    );
    expect(r.ok).toBe(true);
  });
});
