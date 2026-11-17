/**
 * Charters for the remaining ten agents (ENGINE-13, ADR-091).
 * Service levels and evaluation bars are starting values for the owner to ratify.
 */
import type { AgentCharter } from "../charter";
import { base, suites } from "./helpers";

export const ONBOARDING_CHARTER: AgentCharter = {
  ...base,
  packCode: "onboarding-agent",
  codename: "Bridge",
  mission:
    "Get every new organization live quickly by planning its setup, checking its data imports without reading the rows, and preparing its training.",
  agentTier: "department",
  accountable: "operations",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["drafting", "classification", "summarization"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "assess.readiness": "observe",
    "plan.setup": "coordinate",
    "validate.import": "analyse",
    "draft.training.plan": "analyse",
    "send.welcome.pack": "originate",
  },
  t3Rules: {},
  slos: [
    {
      id: "setup-plan",
      metric: "New organizations with a setup plan within 4 hours",
      target: 95,
      unit: "percent",
      window: "daily",
    },
    {
      id: "import-dryrun",
      metric: "Import dry-runs reported within 15 minutes",
      target: 95,
      unit: "percent",
      window: "daily",
    },
  ],
  handoffs: [
    {
      to: "support-agent",
      workOrderKind: "support.case",
      when: "An organization is blocked during setup",
    },
    {
      to: "compliance-agent",
      workOrderKind: "personal-data.review",
      when: "An import contains personal data the organization has not described",
    },
    {
      to: "customer-success-agent",
      workOrderKind: "onboarding.complete",
      when: "Setup is finished and adoption tracking should begin",
    },
  ],
  review: {
    cadenceDays: 30,
    reviewer: "operations",
  },
  killScope: "agent",
  evalSuites: suites("onboarding-agent", ["plan.setup", "validate.import", "send.welcome.pack"]),
};

export const SAFEGUARDING_CHARTER: AgentCharter = {
  ...base,
  packCode: "safeguarding-agent",
  codename: "Warden",
  mission:
    "Make sure every safeguarding concern reaches the right human fast, with the case prepared, and never handles a child's case alone.",
  agentTier: "department",
  accountable: "compliance",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["classification", "summarization", "drafting"],
    contextCeiling: "restricted",
    seesCustomerContent: true,
  },
  duties: {
    "screen.report": "analyse",
    "route.designated.lead": "coordinate",
    "draft.guidance": "analyse",
    "notify.designated.lead": "originate",
  },
  t3Rules: {},
  slos: [
    {
      id: "urgent-routing",
      metric: "Urgent reports routed to a human within 5 minutes",
      target: 99,
      unit: "percent",
      window: "daily",
    },
    {
      id: "screen-accuracy",
      metric: "Screening judged correct by the designated lead",
      target: 95,
      unit: "percent",
      window: "weekly",
    },
  ],
  handoffs: [
    {
      to: "compliance-agent",
      workOrderKind: "personal-data.incident",
      when: "A report involves a possible personal-data breach",
    },
    {
      to: "support-agent",
      workOrderKind: "support.case",
      when: "A staff member needs help using the reporting tool",
    },
  ],
  review: {
    cadenceDays: 14,
    reviewer: "compliance",
  },
  killScope: "agent",
  evalSuites: suites("safeguarding-agent", [
    "screen.report",
    "route.designated.lead",
    "notify.designated.lead",
  ]),
};

export const QA_CHARTER: AgentCharter = {
  ...base,
  packCode: "qa-agent",
  codename: "Gauge",
  mission:
    "Check every change before it ships, independently of the agent that wrote it, and recommend holding a release when the evidence is not good enough.",
  agentTier: "department",
  accountable: "engineering",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["summarization", "classification", "drafting"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "run.regression": "analyse",
    "review.change": "analyse",
    "draft.release.notes": "analyse",
    "recommend.release.hold": "coordinate",
  },
  t3Rules: {},
  slos: [
    {
      id: "review-time",
      metric: "Changes reviewed within 30 minutes of being ready",
      target: 90,
      unit: "percent",
      window: "daily",
    },
    {
      id: "escaped-defects",
      metric: "Releases with a defect Gauge had passed",
      target: 2,
      unit: "percent",
      window: "weekly",
    },
  ],
  handoffs: [
    {
      to: "engineering-agent",
      workOrderKind: "change.feedback",
      when: "A change fails review or regression",
    },
  ],
  review: {
    cadenceDays: 30,
    reviewer: "engineering",
  },
  killScope: "agent",
  evalSuites: suites("qa-agent", ["run.regression", "review.change", "recommend.release.hold"]),
};

export const EVALUATION_CHARTER: AgentCharter = {
  ...base,
  packCode: "evaluation-agent",
  codename: "Proctor",
  mission:
    "Test every agent against its charter with synthetic cases and tell the sheriff, with evidence, which agents have earned more autonomy and which should lose it.",
  agentTier: "assurance",
  accountable: "sheriff",
  supervisor: "sheriff",
  modelPolicy: {
    purposes: ["classification", "summarization"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "run.eval.suite": "verify",
    "probe.injection": "verify",
    "score.agent": "verify",
    "report.evaluation": "analyse",
    "recommend.autonomy.change": "coordinate",
  },
  t3Rules: {},
  slos: [
    {
      id: "coverage",
      metric: "Agents evaluated at least once a week",
      target: 100,
      unit: "percent",
      window: "weekly",
    },
    {
      id: "probe-cases",
      metric: "Injection probes run each day",
      target: 20,
      unit: "count",
      window: "daily",
    },
  ],
  handoffs: [],
  review: {
    cadenceDays: 14,
    reviewer: "sheriff",
  },
  killScope: "agent",
  evalSuites: suites("evaluation-agent", [
    "run.eval.suite",
    "probe.injection",
    "score.agent",
    "recommend.autonomy.change",
  ]),
};

export const MARKETING_CHARTER: AgentCharter = {
  ...base,
  packCode: "marketing-agent",
  codename: "Echo",
  mission:
    "Grow awareness of Sherivs by researching, planning and drafting content that is accurate and on brand, and by publishing only what the sheriff has approved.",
  agentTier: "department",
  accountable: "sales",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["drafting", "summarization", "extraction"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "research.topics": "observe",
    "draft.content": "analyse",
    "plan.campaign": "coordinate",
    "send.newsletter": "originate",
    "publish.social.post": "originate",
  },
  t3Rules: {
    "publish.social.post": "owner",
  },
  slos: [
    {
      id: "drafts",
      metric: "Planned content drafted on schedule",
      target: 90,
      unit: "percent",
      window: "weekly",
    },
    {
      id: "claims",
      metric: "Published claims backed by a cited source",
      target: 100,
      unit: "percent",
      window: "weekly",
    },
  ],
  handoffs: [
    {
      to: "localisation-agent",
      workOrderKind: "translation.request",
      when: "Approved content needs translating",
    },
    {
      to: "data-agent",
      workOrderKind: "metric.request",
      when: "A campaign needs performance data",
    },
  ],
  review: {
    cadenceDays: 30,
    reviewer: "sales",
  },
  killScope: "agent",
  evalSuites: suites("marketing-agent", [
    "plan.campaign",
    "send.newsletter",
    "publish.social.post",
  ]),
};

export const LOCALISATION_CHARTER: AgentCharter = {
  ...base,
  packCode: "localisation-agent",
  codename: "Griot",
  mission:
    "Make Sherivs speak the languages of its users by drafting translations that a native speaker reviews before anyone sees them.",
  agentTier: "department",
  accountable: "platform_admin",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["drafting", "extraction"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "extract.strings": "observe",
    "translate.draft": "analyse",
    "check.glossary": "analyse",
    "file.translation": "originate",
  },
  t3Rules: {},
  slos: [
    {
      id: "turnaround",
      metric: "Translation drafts filed within a day of a change",
      target: 90,
      unit: "percent",
      window: "daily",
    },
    {
      id: "review-accept",
      metric: "Drafts accepted by a native reviewer without rework",
      target: 80,
      unit: "percent",
      window: "weekly",
    },
  ],
  handoffs: [],
  review: {
    cadenceDays: 30,
    reviewer: "platform_admin",
  },
  killScope: "agent",
  evalSuites: suites("localisation-agent", ["file.translation"]),
};

export const DATA_CHARTER: AgentCharter = {
  ...base,
  packCode: "data-agent",
  codename: "Prism",
  mission:
    "Be the single source of truth for Sherivs metrics, answering questions with the definition and source, and warning when a number moves unexpectedly.",
  agentTier: "department",
  accountable: "platform_admin",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["summarization", "classification", "extraction"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "refresh.metrics": "originate",
    "answer.metric.question": "analyse",
    "detect.metric.drift": "observe",
    "draft.weekly.brief": "analyse",
  },
  t3Rules: {},
  slos: [
    {
      id: "fresh",
      metric: "Metrics refreshed by 07:00 each day",
      target: 99,
      unit: "percent",
      window: "daily",
    },
    {
      id: "drift",
      metric: "Metric drift flagged within a day",
      target: 90,
      unit: "percent",
      window: "weekly",
    },
  ],
  handoffs: [
    {
      to: "investor-agent",
      workOrderKind: "metrics.pack",
      when: "Investor metrics are needed",
    },
    {
      to: "product-intelligence-agent",
      workOrderKind: "usage.data",
      when: "Product analysis needs usage data",
    },
  ],
  review: {
    cadenceDays: 30,
    reviewer: "platform_admin",
  },
  killScope: "agent",
  evalSuites: suites("data-agent", ["refresh.metrics"]),
};

export const LEGAL_CHARTER: AgentCharter = {
  ...base,
  packCode: "legal-agent",
  codename: "Brief",
  mission:
    "Keep contracts and obligations in order by drafting from approved templates and flagging risk, with counsel and the sheriff deciding anything binding.",
  agentTier: "department",
  accountable: "platform_admin",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["drafting", "summarization", "classification"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "draft.contract": "analyse",
    "review.vendor.terms": "analyse",
    "track.obligations": "coordinate",
    "refer.counsel": "coordinate",
    "send.legal.notice": "originate",
  },
  t3Rules: {},
  slos: [
    {
      id: "draft-time",
      metric: "Contract drafts ready within a day of request",
      target: 90,
      unit: "percent",
      window: "weekly",
    },
    {
      id: "renewals",
      metric: "Renewals flagged 60 days ahead",
      target: 100,
      unit: "percent",
      window: "weekly",
    },
  ],
  handoffs: [
    {
      to: "compliance-agent",
      workOrderKind: "regulatory.question",
      when: "A contract raises a data-protection question",
    },
    {
      to: "revenue-assurance-agent",
      workOrderKind: "commercial.terms",
      when: "A contract changes pricing or payment terms",
    },
  ],
  review: {
    cadenceDays: 14,
    reviewer: "platform_admin",
  },
  killScope: "agent",
  evalSuites: suites("legal-agent", ["track.obligations", "refer.counsel", "send.legal.notice"]),
};

export const PEOPLE_CHARTER: AgentCharter = {
  ...base,
  packCode: "people-agent",
  codename: "Keystone",
  mission:
    "Keep staff and contractor access tidy from first day to last by tracking onboarding, reviewing who can do what, and asking the sheriff for any grant.",
  agentTier: "department",
  accountable: "platform_admin",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["drafting", "classification"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "track.onboarding.tasks": "coordinate",
    "review.access.lists": "observe",
    "draft.offboarding.checklist": "analyse",
    "schedule.access.review": "coordinate",
    "request.access.grant": "coordinate",
  },
  t3Rules: {
    "request.access.grant": "delegate_requires_owner_proposal",
  },
  slos: [
    {
      id: "offboarding",
      metric: "Departures with a checklist within an hour",
      target: 100,
      unit: "percent",
      window: "daily",
    },
    {
      id: "review-done",
      metric: "Scheduled access reviews completed",
      target: 100,
      unit: "percent",
      window: "weekly",
    },
  ],
  handoffs: [
    {
      to: "security-agent",
      workOrderKind: "access.anomaly",
      when: "An access list shows something unexpected",
    },
  ],
  review: {
    cadenceDays: 14,
    reviewer: "platform_admin",
  },
  killScope: "agent",
  evalSuites: suites("people-agent", [
    "track.onboarding.tasks",
    "schedule.access.review",
    "request.access.grant",
  ]),
};

export const INVESTOR_CHARTER: AgentCharter = {
  ...base,
  packCode: "investor-agent",
  codename: "Beacon",
  mission:
    "Keep the founder investor-ready by compiling accurate metrics, drafting updates and keeping the data room complete, while the founder alone shares anything with investors.",
  agentTier: "department",
  accountable: "platform_admin",
  supervisor: "jarvis-executive",
  modelPolicy: {
    purposes: ["drafting", "summarization", "extraction"],
    contextCeiling: "internal",
    seesCustomerContent: false,
  },
  duties: {
    "compile.metrics.pack": "analyse",
    "draft.investor.update": "analyse",
    "answer.diligence.question": "analyse",
    "maintain.data.room": "originate",
    "flag.data.room.gap": "coordinate",
  },
  t3Rules: {},
  slos: [
    {
      id: "pack-ready",
      metric: "Metrics pack ready before each update date",
      target: 100,
      unit: "percent",
      window: "weekly",
    },
    {
      id: "sourced",
      metric: "Answers that cite a source",
      target: 100,
      unit: "percent",
      window: "weekly",
    },
  ],
  handoffs: [
    {
      to: "legal-agent",
      workOrderKind: "contract.question",
      when: "A diligence question concerns a contract",
    },
  ],
  review: {
    cadenceDays: 30,
    reviewer: "platform_admin",
  },
  killScope: "agent",
  evalSuites: suites("investor-agent", ["maintain.data.room", "flag.data.room.gap"]),
};

export const COMPLETION_CHARTERS: readonly AgentCharter[] = Object.freeze([
  ONBOARDING_CHARTER,
  SAFEGUARDING_CHARTER,
  QA_CHARTER,
  EVALUATION_CHARTER,
  MARKETING_CHARTER,
  LOCALISATION_CHARTER,
  DATA_CHARTER,
  LEGAL_CHARTER,
  PEOPLE_CHARTER,
  INVESTOR_CHARTER,
]);
