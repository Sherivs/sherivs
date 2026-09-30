/**
 * CoreGrid — Phase 10 Communication Platform: the steward report tests.
 *
 * The report is the phase's L4 evidence, so the tests hold it to the same standard as
 * the code: it must count what the modules actually contain, exercise real organizations
 * rather than describe them, and declare every gap it cannot close.
 */
import { describe, expect, it } from "vitest";

import { PROVIDER_CATALOGUE } from "@/lib/communication-providers";
import { STEWARD_ACTION_KINDS, STEWARD_AUTONOMY_LEVELS } from "@/lib/communication-steward";
import {
  communicationStewardGaps,
  communicationStewardReport,
  communicationStewardRules,
  runCommunicationStewardCheck,
  stewardReportSummary,
} from "@/lib/communication-steward-report";

describe("Phase 10 — the steward report reflects the real contracts", () => {
  it("counts the vocabulary from the module, not from a copy", () => {
    const report = communicationStewardReport();

    expect(report.vocabulary.autonomyLevels).toBe(STEWARD_AUTONOMY_LEVELS.length);
    expect(report.vocabulary.actionKinds).toBe(STEWARD_ACTION_KINDS.length);
    expect(report.vocabulary.personFacingActions).toBeGreaterThan(0);
    expect(report.vocabulary.personFacingActions).toBeLessThan(report.vocabulary.actionKinds);
    expect(report.vocabulary.actionsNeedingAutonomousAuthority).toBe(2);
  });

  it("provisions real organizations rather than describing them", () => {
    const report = communicationStewardReport();

    expect(report.organizations.length).toBeGreaterThanOrEqual(3);
    for (const organization of report.organizations) {
      expect(organization.mandate, organization.tenantId).toContain(organization.organizationName);
      expect(organization.tenantId.length).toBeGreaterThan(0);
      expect(organization.seats).toBeGreaterThan(0);
      expect(organization.jurisdictions.length).toBeGreaterThan(0);
      expect(organization.languages.length).toBeGreaterThan(0);
      expect(organization.autonomy).toBe("AUTONOMOUS");
    }
  });

  it("counts the provider catalogue from the registry itself", () => {
    const report = communicationStewardReport();

    expect(report.providers.adapters).toBe(PROVIDER_CATALOGUE.length);
    expect(report.providers.live.length + report.providers.discovered).toBe(
      PROVIDER_CATALOGUE.length,
    );
    expect(report.providers.live).toEqual(["platform-presence"]);
    expect(report.providers.catalogueFindings).toEqual([]);
    expect(report.providers.capabilityRows).toBe(report.providers.channels);
  });

  it("ties every claimed rule to an enforcing module and a proving suite", () => {
    const rules = communicationStewardRules();

    expect(rules.length).toBeGreaterThanOrEqual(6);
    for (const rule of rules) {
      expect(rule.rule.length, `${rule.id} must state the rule`).toBeGreaterThan(40);
      expect(rule.enforcedBy, `${rule.id} must name its module`).toMatch(/^frontend\/src\/lib\//);
      expect(rule.provedBy, `${rule.id} must name its suite`).toMatch(
        /^tests\/unit\/.*\.test\.ts$/,
      );
    }

    const ids = rules.map((rule) => rule.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "mandate-binds-every-action",
        "autonomy-ladder",
        "mass-and-sensitive-are-witnessed",
        "provider-credentials-are-references",
      ]),
    );
  });
});

describe("Phase 10 — every steward check is a real call, and none of them fails", () => {
  it("passes every check it runs", () => {
    const checks = runCommunicationStewardCheck();
    const failing = checks
      .filter((check) => !check.ok)
      .map((check) => `${check.id}: ${check.detail}`);

    expect(failing).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(8);
  });

  it("reports, for each check, what it observed rather than what it expects", () => {
    for (const check of runCommunicationStewardCheck()) {
      expect(check.id.length, "a check needs an id").toBeGreaterThan(3);
      expect(check.proves.length, `${check.id} must state what it proves`).toBeGreaterThan(20);
      expect(check.detail.length, `${check.id} must report an observation`).toBeGreaterThan(3);
    }
  });

  it("names the decisions it observed, so the surface cannot restate them as aspirations", () => {
    const checks = runCommunicationStewardCheck();
    const ladder = checks.find((check) => check.id === "failover-ladder-is-declared");
    expect(ladder?.detail).toContain("twilio:primary");
    expect(ladder?.detail).toContain("africas-talking:regional");

    const ladder2 = checks.find((check) => check.id === "autonomy-ladder-is-monotone");
    expect(ladder2?.detail).toContain("AUTONOMOUS=ALLOW");
    expect(ladder2?.detail).toContain("DRAFT=REQUIRE_APPROVAL");

    const live = checks.find((check) => check.id === "no-external-provider-is-live-yet");
    expect(live?.detail).toContain("platform-presence");
    expect(live?.detail).toContain("refused");
  });

  it("reports healthy only when nothing failed", () => {
    const report = communicationStewardReport();

    expect(report.failed).toBe(report.failingChecks.length);
    expect(report.passed + report.failed).toBe(report.checks.length);
    expect(report.healthy).toBe(report.failed === 0);
    expect(report.healthy).toBe(true);
  });
});

describe("Phase 10 — the report declares what the platform cannot yet do", () => {
  it("reports each gap with its consequence and its owner", () => {
    const gaps = communicationStewardGaps();

    expect(gaps.length).toBeGreaterThanOrEqual(5);
    for (const gap of gaps) {
      expect(gap.gap.length, `${gap.id} must state the gap`).toBeGreaterThan(40);
      expect(gap.consequence.length, `${gap.id} must state the consequence`).toBeGreaterThan(40);
      expect(gap.owner.length, `${gap.id} must name an owner`).toBeGreaterThan(10);
    }

    const ids = gaps.map((gap) => gap.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "no-live-external-provider",
        "no-persistence",
        "no-telephony-binding",
        "no-steward-model",
      ]),
    );
  });

  it("keeps the gaps visible in the report and in one summary line", () => {
    const report = communicationStewardReport();
    const summary = stewardReportSummary(report);

    expect(report.gaps.length).toBeGreaterThanOrEqual(5);
    expect(summary).toContain(`${report.gaps.length} declared gaps`);
    expect(summary).toContain(`${report.providers.live.length} live`);
    expect(summary).toContain(`${report.passed}/${report.checks.length}`);
    expect(summary).toContain("organizations provisioned");
  });
});
