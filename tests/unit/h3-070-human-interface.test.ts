/**
 * CoreGrid — H3-070 phase-50 human-interface contract tests
 * (mission G-070). Zod validation of the human loop-closure substrate
 * surface: server-attested views only, no client authority claims, human
 * loop closure fail-closed, approval surfaces as typed views of server
 * decisions, submissions that can only be handed to the server, explained
 * explanation surfaces, and control/consent/feedback submissions that
 * never claim effect, recording or learning.
 * Pure offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import {
  APPROVAL_DISPLAY_STATES,
  CONTROL_REQUEST_KINDS,
  HUMAN_INTERFACE_CONTRACT_SCHEMA_VERSION,
  INTERACTION_CHANNELS,
  LOOP_CLOSURE_REQUIRED_STAGES,
  LOOP_STAGES,
  MAX_LOOP_STAGES,
  VIEW_DERIVATION_LABEL,
  displayStateForServerDecision,
  humanLoopClosureVerdict,
  parseApprovalResponseSubmission,
  parseApprovalView,
  parseConsentPromptView,
  parseConsentSubmission,
  parseControlRequestSubmission,
  parseExplanationView,
  parseFeedbackSubmission,
  parseInteractionSession,
  parseLoopClosureView,
  parseObservationView,
  submitApprovalResponse,
  submitConsentDecision,
  submitControlRequest,
  submitFeedback,
  type ServerAttestation,
} from "../../frontend/src/lib/human-interface/contracts";

const RECORDED_AT = "2026-10-03T00:00:00.000Z";
const LATER_AT = "2026-10-03T00:05:00.000Z";
const DIGEST = "a".repeat(64);

function attestation(overrides: Record<string, unknown> = {}): ServerAttestation {
  return {
    serverRef: "server:interface-1",
    tenantId: "tenant_a",
    payloadDigest: DIGEST,
    recordedAt: RECORDED_AT,
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: "session:1",
    tenantId: "tenant_a",
    channel: "text",
    localeTag: "en-US",
    state: "AWAITING_INPUT",
    openedAt: RECORDED_AT,
    closedAt: null,
    attestation: attestation(),
    ...overrides,
  };
}

function stageEntry(stage: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    stage,
    state: "attested",
    summary: `server-attested ${stage} stage`,
    enteredAt: RECORDED_AT,
    attestation: attestation(),
    ...overrides,
  };
}

function loopView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    viewId: "view:loop-1",
    sessionId: "session:1",
    tenantId: "tenant_a",
    derivation: "view",
    stages: [
      stageEntry("intent"),
      stageEntry("understanding"),
      stageEntry("action"),
      stageEntry("feedback"),
    ],
    evaluatedAt: RECORDED_AT,
    attestation: attestation(),
    ...overrides,
  };
}

function approvalView(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    approvalId: "approval:1",
    sessionId: "session:1",
    tenantId: "tenant_a",
    derivation: "view",
    subjectDigest: DIGEST,
    impactTier: "critical",
    displayState: "pending",
    decisionRef: "decision:1",
    resolvedAt: null,
    presentedAt: RECORDED_AT,
    expiresAt: LATER_AT,
    attestation: attestation(),
    ...overrides,
  };
}

describe("H3-070 human-interface contracts — module surface", () => {
  it("is versioned and presentation-only by construction", () => {
    expect(HUMAN_INTERFACE_CONTRACT_SCHEMA_VERSION).toBe("1.0");
    expect(VIEW_DERIVATION_LABEL).toBe("view");
    expect(MAX_LOOP_STAGES).toBe(LOOP_STAGES.length);
  });

  it("exposes the phase-50 loop vocabulary in canonical order", () => {
    expect(LOOP_STAGES).toEqual([
      "intent",
      "understanding",
      "knowledge_access",
      "reasoning",
      "simulation",
      "decision",
      "action",
      "feedback",
      "evolution",
    ]);
    expect(LOOP_CLOSURE_REQUIRED_STAGES).toEqual(["intent", "action", "feedback"]);
  });

  it("exposes presentation-only channel and state vocabularies", () => {
    expect(INTERACTION_CHANNELS).toContain("voice");
    expect(APPROVAL_DISPLAY_STATES).toEqual([
      "pending",
      "granted",
      "denied",
      "redacted",
      "expired",
      "revoked",
    ]);
    expect(CONTROL_REQUEST_KINDS).toEqual(["override", "pause", "resume", "terminate"]);
  });
});

describe("interaction session", () => {
  it("parses a server-attested session", () => {
    const parsed = parseInteractionSession(session());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.attestation.tenantId).toBe("tenant_a");
  });

  it("parses presentation preferences as optional and non-authoritative", () => {
    const parsed = parseInteractionSession(
      session({ presentationPreferences: { reducedMotion: true, highContrast: true } }),
    );
    expect(parsed.ok).toBe(true);
  });

  it("rejects unattested sessions", () => {
    const parsed = parseInteractionSession(session({ attestation: undefined }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });

  it("fails closed when a non-closed session carries a close time", () => {
    const parsed = parseInteractionSession(session({ closedAt: LATER_AT }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("cross_record_invariant");
      expect(parsed.issues[0].path).toBe("closedAt");
    }
  });

  it("fails closed when a closed session carries no close time", () => {
    const parsed = parseInteractionSession(session({ state: "CLOSED" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("cross_record_invariant");
  });

  it("rejects unknown keys (strict shape)", () => {
    const parsed = parseInteractionSession(session({ clientRole: "admin" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });
});

describe("human loop-closure view", () => {
  it("parses a canonical-order attested walk", () => {
    const parsed = parseLoopClosureView(loopView());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.derivation).toBe("view");
  });

  it("rejects a walk out of canonical loop order", () => {
    const parsed = parseLoopClosureView(
      loopView({ stages: [stageEntry("action"), stageEntry("intent")] }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("cross_record_invariant");
  });

  it("rejects repeated stages", () => {
    const parsed = parseLoopClosureView(
      loopView({ stages: [stageEntry("intent"), stageEntry("intent")] }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("cross_record_invariant");
  });

  it("requires at least one stage entry", () => {
    const parsed = parseLoopClosureView(loopView({ stages: [] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });
});

describe("human loop closure verdict (fail-closed)", () => {
  it("closes only a fully attested walk reaching feedback", () => {
    const parsed = parseLoopClosureView(loopView());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const verdict = humanLoopClosureVerdict(parsed.value);
      expect(verdict).toEqual({ status: "closed", attestedStages: 4 });
    }
  });

  it("leaves the loop open when a stage is unattested (pending)", () => {
    const parsed = parseLoopClosureView(
      loopView({ stages: [stageEntry("intent"), stageEntry("action", { state: "pending" }), stageEntry("feedback")] }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const verdict = humanLoopClosureVerdict(parsed.value);
      expect(verdict.status).toBe("open");
      if (verdict.status === "open") expect(verdict.reason).toContain("fail-closed");
    }
  });

  it("leaves the loop open when a stage failed", () => {
    const parsed = parseLoopClosureView(
      loopView({ stages: [stageEntry("intent"), stageEntry("action", { state: "failed" }), stageEntry("feedback")] }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const verdict = humanLoopClosureVerdict(parsed.value);
      expect(verdict.status).toBe("open");
    }
  });

  it("leaves the loop open when the walk does not begin at intent", () => {
    const parsed = parseLoopClosureView(
      loopView({ stages: [stageEntry("action"), stageEntry("feedback")] }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const verdict = humanLoopClosureVerdict(parsed.value);
      expect(verdict).toEqual({
        status: "open",
        reason: expect.stringContaining('begins at "action"'),
      });
    }
  });

  it("leaves the loop open when the walk never reaches feedback", () => {
    const parsed = parseLoopClosureView(loopView({ stages: [stageEntry("intent"), stageEntry("action")] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const verdict = humanLoopClosureVerdict(parsed.value);
      expect(verdict.status).toBe("open");
      if (verdict.status === "open") expect(verdict.reason).toContain("feedback");
    }
  });

  it("never presumes closure from an empty walk", () => {
    const parsed = parseLoopClosureView(loopView({ stages: [stageEntry("intent")] }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(humanLoopClosureVerdict(parsed.value).status).toBe("open");
    }
  });
});

describe("approval surface (a VIEW of a server decision — AGENTS §34)", () => {
  it("parses a pending view without a resolution instant", () => {
    const parsed = parseApprovalView(approvalView());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.displayState).toBe("pending");
  });

  it("parses a resolved view carrying a resolution instant", () => {
    const parsed = parseApprovalView(approvalView({ displayState: "denied", resolvedAt: LATER_AT }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.displayState).toBe("denied");
  });

  it("fails closed when a pending view claims resolution", () => {
    const parsed = parseApprovalView(approvalView({ resolvedAt: LATER_AT }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("cross_record_invariant");
      expect(parsed.issues[0].path).toBe("resolvedAt");
    }
  });

  it("fails closed when a resolved view omits the resolution instant", () => {
    const parsed = parseApprovalView(approvalView({ displayState: "granted" }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("cross_record_invariant");
  });

  it("fails closed on a top-level client-authority claim", () => {
    const parsed = parseApprovalView(approvalView({ clientAuthorized: true }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe("client_authority_claim");
      expect(parsed.issues[0].path).toBe("$.clientAuthorized");
    }
  });

  it("fails closed on nested and variant authority-claim key shapes", () => {
    for (const key of ["locally_approved", "selfGranted", "ui_approved"]) {
      const parsed = parseApprovalView(
        approvalView({ presentation: { [key]: true } }),
      );
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe("client_authority_claim");
    }
  });

  it("fails closed on an unattested view", () => {
    const parsed = parseApprovalView(approvalView({ attestation: undefined }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });
});

describe("server decision echo (the only sanctioned display path)", () => {
  it("maps every §16 authorization outcome to a display state", () => {
    expect(displayStateForServerDecision("ALLOW")).toBe("granted");
    expect(displayStateForServerDecision("DENY")).toBe("denied");
    expect(displayStateForServerDecision("REDACT")).toBe("redacted");
    expect(displayStateForServerDecision("ESCALATE")).toBe("pending");
    expect(displayStateForServerDecision("REQUIRE_APPROVAL")).toBe("pending");
  });

  it("echoes a server decision into a renderable view", () => {
    const parsed = parseApprovalView(
      approvalView({
        displayState: displayStateForServerDecision("REQUIRE_APPROVAL"),
        resolvedAt: null,
      }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.displayState).toBe("pending");
  });
});

describe("human response submission (proposal, never resolution)", () => {
  function submission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      submissionId: "submission:1",
      approvalId: "approval:1",
      tenantId: "tenant_a",
      responderKind: "human",
      responderId: "human:1",
      response: "endorse",
      rationale: "reviewed the server-attested subject and endorse",
      submittedAt: RECORDED_AT,
      ...overrides,
    };
  }

  it("parses a human response submission", () => {
    const parsed = parseApprovalResponseSubmission(submission());
    expect(parsed.ok).toBe(true);
  });

  it("fails closed when the responder is not a human identity", () => {
    const parsed = parseApprovalResponseSubmission(
      submission({ responderKind: "agent" }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });

  it("can only yield a submission receipt — never a resolution", () => {
    const parsed = parseApprovalResponseSubmission(submission());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const receipt = submitApprovalResponse(parsed.value);
      expect(receipt.status).toBe("submitted_for_server_adjudication");
      expect(receipt.resolutionClaimed).toBe(false);
      expect(receipt.approvalId).toBe("approval:1");
    }
  });
});

describe("observation surface (a VIEW of server-recorded state)", () => {
  it("parses a server-attested observation view", () => {
    const parsed = parseObservationView({
      observationId: "observation:1",
      sessionId: "session:1",
      tenantId: "tenant_a",
      derivation: "view",
      statement: "the governed action completed on the server",
      subjectDigest: DIGEST,
      presentedAt: RECORDED_AT,
      attestation: attestation(),
    });
    expect(parsed.ok).toBe(true);
  });

  it("rejects an observation that claims to be canonical rather than a view", () => {
    const parsed = parseObservationView({
      observationId: "observation:1",
      sessionId: "session:1",
      tenantId: "tenant_a",
      derivation: "canonical",
      statement: "the governed action completed",
      subjectDigest: DIGEST,
      presentedAt: RECORDED_AT,
      attestation: attestation(),
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });
});

describe("explanation surface (why, evidence, confidence, alternatives)", () => {
  function explanation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      explanationId: "explanation:1",
      subjectRef: "decision:1",
      tenantId: "tenant_a",
      derivation: "view",
      whyStatement: "the server denied the action because the policy forbids it",
      citations: [{ evidenceRef: "evidence:policy-1", digest: DIGEST }],
      confidence: {
        value: 0.9,
        derivedFrom: ["policy_match"],
        method: "policy-deterministic",
      },
      alternatives: ["decision:2"],
      producedAt: RECORDED_AT,
      attestation: attestation(),
      ...overrides,
    };
  }

  it("parses an explained, cited explanation view", () => {
    const parsed = parseExplanationView(explanation());
    expect(parsed.ok).toBe(true);
  });

  it("fails closed on an explanation with no evidence citations", () => {
    const parsed = parseExplanationView(explanation({ citations: [] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });

  it("fails closed on unexplained confidence (no deriving factors)", () => {
    const parsed = parseExplanationView(
      explanation({ confidence: { value: 0.9, derivedFrom: [], method: "x" } }),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });
});

describe("human control submission (queued, never enforced)", () => {
  it("parses and queues an override request without claiming effect", () => {
    const parsed = parseControlRequestSubmission({
      requestId: "request:1",
      sessionId: "session:1",
      tenantId: "tenant_a",
      kind: "override",
      scopeDigest: DIGEST,
      rationale: "human operator overrides the automated path",
      requestedAt: RECORDED_AT,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const receipt = submitControlRequest(parsed.value);
      expect(receipt.status).toBe("queued_for_server_enforcement");
      expect(receipt.effectClaimed).toBe(false);
      expect(receipt.kind).toBe("override");
    }
  });

  it("fails closed on an unknown control kind", () => {
    const parsed = parseControlRequestSubmission({
      requestId: "request:1",
      sessionId: "session:1",
      tenantId: "tenant_a",
      kind: "self_grant",
      scopeDigest: DIGEST,
      rationale: "attempt to expand authority through the interface",
      requestedAt: RECORDED_AT,
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });
});

describe("consent surface (prompt view + decision submission)", () => {
  it("parses a server-attested consent prompt view", () => {
    const parsed = parseConsentPromptView({
      consentId: "consent:1",
      tenantId: "tenant_a",
      derivation: "view",
      scopeDigest: DIGEST,
      statement: "the server requests informed consent for the described scope",
      presentedAt: RECORDED_AT,
      attestation: attestation(),
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.derivation).toBe("view");
  });

  it("fails closed on an unattested consent prompt", () => {
    const parsed = parseConsentPromptView({
      consentId: "consent:1",
      tenantId: "tenant_a",
      derivation: "view",
      scopeDigest: DIGEST,
      statement: "consent prompt without server attestation",
      presentedAt: RECORDED_AT,
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });

  it("accepts a consent decision submission and never claims recording", () => {
    const parsed = parseConsentSubmission({
      submissionId: "submission:consent-1",
      consentId: "consent:1",
      tenantId: "tenant_a",
      subjectId: "subject:1",
      decision: "grant",
      submittedAt: RECORDED_AT,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const receipt = submitConsentDecision(parsed.value);
      expect(receipt.status).toBe("submitted_for_server_recording");
      expect(receipt.consentRecorded).toBe(false);
    }
  });
});

describe("feedback submission (proposal into the loop)", () => {
  it("parses and submits feedback without claiming learning", () => {
    const parsed = parseFeedbackSubmission({
      feedbackId: "feedback:1",
      interactionRef: "session:1",
      tenantId: "tenant_a",
      kind: "correct",
      rationale: "the rendered outcome mislabels the attested stage",
      submittedAt: RECORDED_AT,
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const receipt = submitFeedback(parsed.value);
      expect(receipt.status).toBe("submitted_for_server_processing");
      expect(receipt.learningClaimed).toBe(false);
      expect(receipt.interactionRef).toBe("session:1");
    }
  });

  it("fails closed on a blank rationale", () => {
    const parsed = parseFeedbackSubmission({
      feedbackId: "feedback:1",
      interactionRef: "session:1",
      tenantId: "tenant_a",
      kind: "affirm",
      rationale: "   ",
      submittedAt: RECORDED_AT,
    });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe("invalid_shape");
  });
});

describe("interface is not security (AGENTS §34) — structural assertions", () => {
  it("every receipt type structurally denies claiming the server-side outcome", () => {
    const parsedApproval = parseApprovalResponseSubmission({
      submissionId: "submission:2",
      approvalId: "approval:1",
      tenantId: "tenant_a",
      responderKind: "human",
      responderId: "human:1",
      response: "decline",
      rationale: "declined on review",
      submittedAt: RECORDED_AT,
    });
    expect(parsedApproval.ok).toBe(true);
    if (parsedApproval.ok) {
      expect(submitApprovalResponse(parsedApproval.value).resolutionClaimed).toBe(false);
    }

    const parsedControl = parseControlRequestSubmission({
      requestId: "request:2",
      sessionId: "session:1",
      tenantId: "tenant_a",
      kind: "terminate",
      scopeDigest: DIGEST,
      rationale: "terminating the governed operation",
      requestedAt: RECORDED_AT,
    });
    expect(parsedControl.ok).toBe(true);
    if (parsedControl.ok) {
      expect(submitControlRequest(parsedControl.value).effectClaimed).toBe(false);
    }
  });

  it("a loop closure view is labelled derived-presentation, never canonical truth", () => {
    const parsed = parseLoopClosureView(loopView());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.derivation).not.toBe("canonical");
  });
});