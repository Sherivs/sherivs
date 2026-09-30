// ─── Phase 24 — Experience & Design Intelligence ─────────────────────
import { describe, it, expect } from "vitest";
import {
  createDesignToken,
  deprecateToken,
  createCommandPalette,
  filterCommands,
} from "@/lib/experience-core";
import {
  createPersonalizationProfile,
  getDeviceAwareExperience,
  createAIMessage,
  filterCommandsByRole,
  createNotificationExperience,
} from "@/lib/experience-personalization";
import {
  createAccessibilitySystem,
  createEmptyState,
  createOnboardingFlow,
  createMotionSystem,
  checkColorContrast,
} from "@/lib/experience-accessibility";
import {
  createUXTelemetryEvent,
  createExperiment,
  evaluateExperienceSLO,
  evaluateReleaseGate,
  computeUXQAScore,
  evaluateVisualQA,
} from "@/lib/experience-governance";

describe("experience-core — Design Tokens", () => {
  it("creates token", () => {
    const t = createDesignToken({
      name: "color-primary",
      category: "color",
      value: "#1a73e8",
      description: "Primary",
    });
    expect(t.deprecated).toBe(false);
  });
  it("deprecates token", () => {
    const t = createDesignToken({
      name: "color-old",
      category: "color",
      value: "#000",
      description: "Old",
    });
    const d = deprecateToken(t, "color-primary");
    expect(d.deprecated).toBe(true);
    expect(d.replacement).toBe("color-primary");
  });
});

describe("experience-core — Command Palette", () => {
  it("creates palette", () => {
    const p = createCommandPalette({
      commands: [
        {
          id: "open-grades",
          label: "Open Grades",
          category: "navigation",
          keywords: ["grades", "marks"],
          action: "/academic/grades",
        },
      ],
    });
    expect(p.trigger).toBe("cmd+k");
  });
  it("filters commands by query", () => {
    const p = createCommandPalette({
      commands: [
        {
          id: "open-grades",
          label: "Open Grades",
          category: "navigation",
          keywords: ["marks", "scores"],
          action: "/grades",
        },
        {
          id: "open-schedule",
          label: "View Schedule",
          category: "navigation",
          keywords: ["timetable"],
          action: "/schedule",
        },
      ],
    });
    const r = filterCommands(p, "grade");
    expect(r).toHaveLength(1);
    expect(r[0].label).toBe("Open Grades");
  });
});

describe("experience-personalization — Profile", () => {
  it("creates profile with defaults", () => {
    const p = createPersonalizationProfile({ userId: "user-1" });
    expect(p.experienceLevel).toBe("intermediate");
  });
});

describe("experience-personalization — Device-Aware", () => {
  it("returns phone layout", () => {
    const d = getDeviceAwareExperience("phone");
    expect(d.layout).toBe("single_pane");
  });
  it("returns desktop layout", () => {
    const d = getDeviceAwareExperience("desktop");
    expect(d.layout).toBe("multi_pane");
  });
});

describe("experience-personalization — AI Message", () => {
  it("creates user message", () => {
    const m = createAIMessage({ role: "user", content: "What are my grades?" });
    expect(m.role).toBe("user");
  });
  it("creates streaming assistant message", () => {
    const m = createAIMessage({ role: "assistant", content: "Your grades...", streaming: true });
    expect(m.streaming).toBe(true);
  });
});

describe("experience-personalization — Role Filtering", () => {
  it("filters by role", () => {
    const r = filterCommandsByRole(
      [{ id: "c1", label: "Admin Panel", category: "admin", permissions: ["admin"] }],
      "teacher",
    );
    expect(r).toHaveLength(0);
  });
  it("shows commands without permissions", () => {
    const r = filterCommandsByRole(
      [{ id: "c1", label: "General", category: "general" }],
      "teacher",
    );
    expect(r).toHaveLength(1);
  });
});

describe("experience-personalization — Notifications", () => {
  it("creates with defaults", () => {
    const n = createNotificationExperience();
    expect(n.grouping).toBe("by_type");
  });
  it("merges overrides", () => {
    const n = createNotificationExperience({ grouping: "by_app" });
    expect(n.grouping).toBe("by_app");
  });
});
describe("experience-accessibility — System", () => {
  it("creates AA system", () => {
    const a = createAccessibilitySystem();
    expect(a.wcagLevel).toBe("AA");
  });
  it("creates AAA system", () => {
    const a = createAccessibilitySystem("AAA");
    expect(a.wcagLevel).toBe("AAA");
  });
});

describe("experience-accessibility — Empty State", () => {
  it("creates empty state", () => {
    const e = createEmptyState({
      title: "No grades",
      description: "No grades available",
      icon: "book-open",
    });
    expect(e.actionLabel).toBeNull();
  });
  it("creates actionable empty state", () => {
    const e = createEmptyState({
      title: "No data",
      description: "Add data",
      icon: "plus",
      actionLabel: "Add",
      actionRoute: "/add",
    });
    expect(e.actionLabel).toBe("Add");
  });
});

describe("experience-accessibility — Onboarding", () => {
  it("creates skipable flow", () => {
    const o = createOnboardingFlow({
      id: "onboard-1",
      steps: [{ title: "Welcome", description: "Welcome to CoreGrid", target: null }],
    });
    expect(o.skipable).toBe(true);
  });
  it("creates required flow", () => {
    const o = createOnboardingFlow({
      id: "onboard-2",
      steps: [{ title: "Setup", description: "Required setup", target: "/setup" }],
      required: true,
    });
    expect(o.required).toBe(true);
  });
});

describe("experience-accessibility — Motion", () => {
  it("enables animations by default", () => {
    const m = createMotionSystem(false);
    expect(m.animationsEnabled).toBe(true);
  });
  it("disables for reduced motion", () => {
    const m = createMotionSystem(true);
    expect(m.animationsEnabled).toBe(false);
  });
});

describe("experience-accessibility — Color Contrast", () => {
  it("passes AA for black on white", () => {
    const r = checkColorContrast("#000000", "#ffffff");
    expect(r.passes).toBe(true);
  });
  it("fails AA for light gray on white", () => {
    const r = checkColorContrast("#cccccc", "#ffffff");
    expect(r.passes).toBe(false);
  });
});

describe("experience-governance — UX Telemetry", () => {
  it("creates anonymized event", () => {
    const e = createUXTelemetryEvent({ eventType: "click", component: "DashboardCard" });
    expect(e.anonymized).toBe(true);
  });
});

describe("experience-governance — Experiment", () => {
  it("creates experiment", () => {
    const e = createExperiment({
      id: "exp-1",
      name: "New Dashboard",
      variants: [
        { name: "control", weight: 50, config: {} },
        { name: "treatment", weight: 50, config: { showWidget: true } },
      ],
    });
    expect(e.status).toBe("draft");
  });
  it("rejects invalid weights", () => {
    expect(() =>
      createExperiment({
        id: "exp-2",
        name: "Bad",
        variants: [{ name: "a", weight: 30, config: {} }],
      }),
    ).toThrow();
  });
});

describe("experience-governance — SLO", () => {
  it("evaluates healthy SLO", () => {
    const s = evaluateExperienceSLO("page_load", 2000, 1500);
    expect(s.status).toBe("healthy");
  });
  it("evaluates breached SLO", () => {
    const s = evaluateExperienceSLO("page_load", 2000, 2500);
    expect(s.status).toBe("breached");
  });
});

describe("experience-governance — Release Gate", () => {
  it("passes when all checks pass", () => {
    const g = evaluateReleaseGate([
      { name: "lint", passed: true, required: true },
      { name: "test", passed: true, required: true },
    ]);
    expect(g.overallStatus).toBe("passed");
  });
  it("blocks when required check fails", () => {
    const g = evaluateReleaseGate([{ name: "lint", passed: false, required: true }]);
    expect(g.overallStatus).toBe("blocked");
  });
});

describe("experience-governance — UX QA", () => {
  it("computes average score", () => {
    const score = computeUXQAScore({
      discoverability: 8,
      learnability: 7,
      efficiency: 9,
      errorRecovery: 6,
      consistency: 8,
      cognitiveLoad: 7,
    });
    expect(score).toBe(8);
  });
});

describe("experience-governance — Visual QA", () => {
  it("fails on blocker", () => {
    const q = evaluateVisualQA("Button", [
      { name: "color-contrast", passed: false, severity: "blocker" },
    ]);
    expect(q.status).toBe("fail");
  });
  it("passes all checks", () => {
    const q = evaluateVisualQA("Button", [
      { name: "color-contrast", passed: true, severity: "minor" },
    ]);
    expect(q.status).toBe("pass");
  });
});
